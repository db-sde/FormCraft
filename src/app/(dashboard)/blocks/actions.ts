"use server";

import { recordAudit } from "@/domains/audit/record";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { canEdit } from "@/domains/workspaces";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import {
  createBlock,
  getBlock,
  getBlockVersion,
  listBlocks,
  publishBlockVersion,
  type BlockSummary,
} from "@/domains/blocks/queries";
import { parseBlockQuestions } from "@/domains/blocks/content";

/**
 * Question blocks (master spec F-09). Everyone in the workspace can read
 * and insert blocks; editors and up create and change them — checked here
 * and again by row-level security. Every change is audited.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const Name = z.string().trim().min(1, "Give the block a name.").max(120);
const Description = z.string().trim().max(500).optional();

async function editorOrNull() {
  const ctx = await getCurrentWorkspace();
  return canEdit(ctx.workspace.role) ? ctx : null;
}

function problem(error: unknown, fallback: string): string {
  if (error instanceof z.ZodError) return "Some of the block's questions aren't valid.";
  if (error instanceof Error && /block can't|share an id/.test(error.message)) {
    return error.message.charAt(0).toUpperCase() + error.message.slice(1) + ".";
  }
  return fallback;
}

export async function listBlocksAction(): Promise<BlockSummary[]> {
  const { supabase, workspace } = await getCurrentWorkspace();
  return listBlocks(supabase, workspace.id);
}

/** A block's version (its latest by default), for inserting or reviewing. */
export async function getBlockVersionAction(
  blockId: string,
  version?: number,
): Promise<Result<{ name: string; version: number; questions: QuestionV1[] }>> {
  if (!z.string().uuid().safeParse(blockId).success) {
    return { ok: false, message: "Block not found." };
  }
  const { supabase, workspace } = await getCurrentWorkspace();
  const block = await getBlock(supabase, workspace.id, blockId);
  if (!block) return { ok: false, message: "Block not found." };
  const wanted = version ?? block.current_version;
  const questions = await getBlockVersion(supabase, blockId, wanted);
  if (!questions) return { ok: false, message: "That version doesn't exist." };
  return { ok: true, name: block.name, version: wanted, questions };
}

/** Latest versions of the blocks a form uses, so it can offer updates. */
export async function blockStatusAction(
  blockIds: string[],
): Promise<{ id: string; name: string; currentVersion: number; archived: boolean }[]> {
  const ids = blockIds
    .filter((id) => z.string().uuid().safeParse(id).success)
    .slice(0, 100);
  if (ids.length === 0) return [];
  const { supabase, workspace } = await getCurrentWorkspace();
  const { data } = await supabase
    .from("question_blocks")
    .select("id, name, current_version, archived_at")
    .eq("workspace_id", workspace.id)
    .in("id", ids);
  return (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    currentVersion: b.current_version,
    archived: b.archived_at !== null,
  }));
}

export async function createBlockAction(input: {
  name: string;
  description?: string;
  questions: QuestionV1[];
}): Promise<Result<{ id: string; version: number; questions: QuestionV1[] }>> {
  const name = Name.safeParse(input.name);
  if (!name.success) return { ok: false, message: name.error.issues[0].message };
  const ctx = await editorOrNull();
  if (!ctx) return { ok: false, message: "Only editors can create blocks." };
  try {
    const questions = parseBlockQuestions(input.questions);
    const { id, version } = await createBlock(ctx.supabase, {
      workspaceId: ctx.workspace.id,
      name: name.data,
      description: Description.parse(input.description),
      questions,
      userId: ctx.user.id,
    });
    await recordAudit({
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      action: "block.created",
      target: { type: "question_block", id },
      metadata: { name: name.data, questions: questions.length },
    });
    revalidatePath("/blocks");
    return { ok: true, id, version, questions };
  } catch (error) {
    return {
      ok: false,
      message: problem(error, "Couldn't save the block. Please try again."),
    };
  }
}

/** Publishes the block's next version. Forms using it are offered the
 * update; none changes until its own editor applies it. */
export async function publishBlockVersionAction(
  blockId: string,
  input: { name: string; description?: string; questions: QuestionV1[] },
): Promise<Result<{ version: number }>> {
  const name = Name.safeParse(input.name);
  if (!name.success) return { ok: false, message: name.error.issues[0].message };
  const ctx = await editorOrNull();
  if (!ctx) return { ok: false, message: "Only editors can change blocks." };
  const block = await getBlock(ctx.supabase, ctx.workspace.id, blockId);
  if (!block || block.archived_at) return { ok: false, message: "Block not found." };
  try {
    const version = await publishBlockVersion(ctx.supabase, blockId, input.questions);
    await ctx.supabase
      .from("question_blocks")
      .update({
        name: name.data,
        description: Description.parse(input.description) || null,
      })
      .eq("id", blockId);
    await recordAudit({
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      action: "block.version_published",
      target: { type: "question_block", id: blockId },
      metadata: { version },
    });
    revalidatePath(`/blocks/${blockId}`);
    revalidatePath("/blocks");
    return { ok: true, version };
  } catch (error) {
    return {
      ok: false,
      message: problem(error, "Couldn't publish the block. Please try again."),
    };
  }
}

/** Rollback: publishes a copy of an earlier version as the newest. */
export async function restoreBlockVersionAction(
  blockId: string,
  version: number,
): Promise<Result<{ version: number }>> {
  const ctx = await editorOrNull();
  if (!ctx) return { ok: false, message: "Only editors can change blocks." };
  const old = await getBlockVersionAction(blockId, version);
  if (!old.ok) return old;
  try {
    const next = await publishBlockVersion(ctx.supabase, blockId, old.questions);
    await recordAudit({
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      action: "block.restored",
      target: { type: "question_block", id: blockId },
      metadata: { from: version, version: next },
    });
    revalidatePath(`/blocks/${blockId}`);
    return { ok: true, version: next };
  } catch {
    return { ok: false, message: "Couldn't restore that version." };
  }
}

/** Takes the block out of the library. Forms keep their copies (still
 * locked to their version) and can detach them. */
export async function archiveBlockAction(blockId: string): Promise<Result> {
  const ctx = await editorOrNull();
  if (!ctx) return { ok: false, message: "Only editors can archive blocks." };
  const { data, error } = await ctx.supabase
    .from("question_blocks")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", blockId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id");
  if (error || !data?.length)
    return { ok: false, message: "Couldn't archive the block." };
  await recordAudit({
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    action: "block.archived",
    target: { type: "question_block", id: blockId },
  });
  revalidatePath("/blocks");
  return { ok: true };
}
