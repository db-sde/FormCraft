import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { FormSchemaError } from "@/domains/forms/schema/validate";
import {
  blockInstances,
  lockProblem,
  parseBlockQuestions,
  type BlockQuestion,
} from "./content";

type Client = SupabaseClient<Database>;

/**
 * Question blocks in the database (master spec F-09). Reads and writes go
 * through the caller's own client: row-level security lets workspace
 * members read and editors and up write (migration 46).
 */

export type BlockSummary = {
  id: string;
  name: string;
  description: string | null;
  currentVersion: number;
  updatedAt: string;
  archived: boolean;
};

export async function listBlocks(
  supabase: Client,
  workspaceId: string,
  { includeArchived = false } = {},
): Promise<BlockSummary[]> {
  let query = supabase
    .from("question_blocks")
    .select("id, name, description, current_version, updated_at, archived_at")
    .eq("workspace_id", workspaceId)
    .order("name");
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    currentVersion: b.current_version,
    updatedAt: b.updated_at,
    archived: b.archived_at !== null,
  }));
}

export async function getBlock(supabase: Client, workspaceId: string, blockId: string) {
  const { data, error } = await supabase
    .from("question_blocks")
    .select("id, name, description, current_version, updated_at, archived_at")
    .eq("id", blockId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getBlockVersion(
  supabase: Client,
  blockId: string,
  version: number,
): Promise<BlockQuestion[] | null> {
  const { data, error } = await supabase
    .from("question_block_versions")
    .select("questions")
    .eq("block_id", blockId)
    .eq("version", version)
    .maybeSingle();
  if (error) throw error;
  return data ? parseBlockQuestions(data.questions) : null;
}

export async function listBlockVersions(supabase: Client, blockId: string) {
  const { data, error } = await supabase
    .from("question_block_versions")
    .select("version, created_at, questions, profiles(full_name)")
    .eq("block_id", blockId)
    .order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((v) => ({
    version: v.version,
    createdAt: v.created_at,
    questionCount: Array.isArray(v.questions) ? v.questions.length : 0,
    by: (v.profiles as { full_name?: string | null } | null)?.full_name ?? null,
  }));
}

/** A new block, its first version made of these questions. */
export async function createBlock(
  supabase: Client,
  input: {
    workspaceId: string;
    name: string;
    description?: string;
    questions: BlockQuestion[];
    userId: string;
  },
): Promise<{ id: string; version: number }> {
  const questions = parseBlockQuestions(input.questions);
  const { data: block, error } = await supabase
    .from("question_blocks")
    .insert({
      workspace_id: input.workspaceId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      created_by: input.userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  const { error: versionError } = await supabase.from("question_block_versions").insert({
    block_id: block.id,
    version: 1,
    questions: questions as unknown as Json,
    created_by: input.userId,
  });
  if (versionError) throw versionError;
  return { id: block.id, version: 1 };
}

/** Publishes the next version (numbered in one transaction). */
export async function publishBlockVersion(
  supabase: Client,
  blockId: string,
  questions: BlockQuestion[],
): Promise<number> {
  const parsed = parseBlockQuestions(questions);
  const { data, error } = await supabase.rpc("publish_question_block_version", {
    p_block_id: blockId,
    p_questions: parsed as unknown as Json,
  });
  if (error) throw error;
  return data;
}

/** Forms in the workspace whose draft or live version uses the block. */
export async function blockUsage(
  supabase: Client,
  workspaceId: string,
  blockId: string,
): Promise<{ formId: string; title: string; versions: number[] }[]> {
  const { data, error } = await supabase
    .from("form_versions")
    .select("schema, status, forms!inner(id, title, workspace_id, deleted_at)")
    .eq("forms.workspace_id", workspaceId)
    .is("forms.deleted_at", null)
    .in("status", ["draft", "published"])
    .filter("schema", "cs", JSON.stringify({ questions: [{ block: { id: blockId } }] }));
  if (error) throw error;
  const byForm = new Map<
    string,
    { formId: string; title: string; versions: Set<number> }
  >();
  for (const row of data ?? []) {
    const form = row.forms as { id: string; title: string };
    const entry = byForm.get(form.id) ?? {
      formId: form.id,
      title: form.title,
      versions: new Set(),
    };
    for (const instance of blockInstances((row.schema as FormSchemaV1).questions ?? [])) {
      if (instance.blockId === blockId) entry.versions.add(instance.version);
    }
    byForm.set(form.id, entry);
  }
  return [...byForm.values()].map((e) => ({ ...e, versions: [...e.versions].sort() }));
}

/**
 * The lock, enforced by the server: a form's copies of block questions
 * must match their block version exactly (F-09). Run on every draft save
 * and again at publish, since drafts can also be written directly.
 */
export async function assertBlockLocks(
  supabase: Client,
  workspaceId: string,
  schema: FormSchemaV1,
): Promise<void> {
  const instances = blockInstances(schema.questions);
  if (instances.length === 0) return;
  const blockIds = [...new Set(instances.map((i) => i.blockId))];
  const { data: blocks, error } = await supabase
    .from("question_blocks")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .in("id", blockIds);
  if (error) throw error;
  const names = new Map((blocks ?? []).map((b) => [b.id, b.name]));
  const versions = new Map<string, BlockQuestion[]>();
  for (const instance of instances) {
    const key = `${instance.blockId}:${instance.version}`;
    if (versions.has(key) || !names.has(instance.blockId)) continue;
    const questions = await getBlockVersion(supabase, instance.blockId, instance.version);
    if (questions) versions.set(key, questions);
  }
  const problem = lockProblem(schema.questions, versions, names);
  if (problem) {
    throw new FormSchemaError(`block lock: ${problem}`, "block_locked", {
      message: problem,
    });
  }
}
