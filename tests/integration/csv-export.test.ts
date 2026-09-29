import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { buildResponsesCsv } from "@/domains/responses";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

/**
 * Regression: the export read responses and answers with single
 * selects, which PostgREST silently caps at max_rows (1000) — so any
 * form with more than 1000 responses exported a truncated CSV with no
 * error. Seeds past that cap and checks every row arrives, with file
 * answers shown by their original file name.
 */

function admin(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set for integration tests",
    );
  }
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Export test form" },
  theme: {
    primaryColor: "#0f172a",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end_default", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q_name",
      type: "short_text",
      order: 0,
      label: "Name",
      required: true,
      settings: {},
    },
    {
      id: "q_file",
      type: "file_upload",
      order: 1,
      label: "CV",
      required: false,
      settings: { acceptedMimeTypes: ["application/pdf"], maxSizeMb: 10 },
    },
  ],
  logic: [],
};

const RESPONSE_COUNT = 1050;

describe("CSV export (integration)", () => {
  const supabase = admin();
  const runId = crypto.randomUUID().slice(0, 8);
  let userId: string;
  let workspaceId: string;
  let formId: string;

  beforeAll(async () => {
    const { data: user, error: userError } = await supabase.auth.admin.createUser({
      email: `csv-export-${runId}@example.com`,
      password: crypto.randomUUID(),
      email_confirm: true,
    });
    if (userError) throw userError;
    userId = user.user.id;

    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .insert({ name: "CSV export test", slug: `csv-${runId}`, owner_id: userId })
      .select("id")
      .single();
    if (workspaceError) throw workspaceError;
    workspaceId = workspace.id;

    const { data: form, error: formError } = await supabase
      .from("forms")
      .insert({
        workspace_id: workspaceId,
        title: "Export test",
        slug: `csv-export-${runId}`,
        created_by: userId,
      })
      .select("id")
      .single();
    if (formError) throw formError;
    formId = form.id;

    const { data: version, error: versionError } = await supabase
      .from("form_versions")
      .insert({
        form_id: formId,
        status: "draft",
        version_number: 1,
        schema: schema as unknown as Json,
      })
      .select("id")
      .single();
    if (versionError) throw versionError;

    const base = Date.now() - RESPONSE_COUNT * 1000;
    const responses = Array.from({ length: RESPONSE_COUNT }, (_, i) => ({
      form_id: formId,
      form_version_id: version.id,
      status: "completed" as const,
      ending_id: "end_default",
      completed_at: new Date(base + i * 1000).toISOString(),
    }));
    const { data: inserted, error: responsesError } = await supabase
      .from("responses")
      .insert(responses)
      .select("id, completed_at")
      .order("completed_at");
    if (responsesError) throw responsesError;

    const { error: answersError } = await supabase.from("answers").insert(
      inserted.map((r, i) => ({
        response_id: r.id,
        question_id: "q_name",
        value: `Person ${i}` as Json,
      })),
    );
    if (answersError) throw answersError;

    // One file answer, on the newest response.
    const last = inserted[inserted.length - 1];
    const { data: upload, error: uploadError } = await supabase
      .from("uploads")
      .insert({
        response_id: last.id,
        question_id: "q_file",
        storage_path: `test/${runId}.pdf`,
        original_filename: "ada-cv.pdf",
        mime_type: "application/pdf",
        size_bytes: 1234,
      })
      .select("id")
      .single();
    if (uploadError) throw uploadError;
    await supabase
      .from("answers")
      .insert({ response_id: last.id, question_id: "q_file", value: upload.id as Json });
  }, 60_000);

  afterAll(async () => {
    if (workspaceId) await supabase.from("workspaces").delete().eq("id", workspaceId);
    if (userId) await supabase.auth.admin.deleteUser(userId);
  });

  it("exports every response past PostgREST's 1000-row cap", async () => {
    const csv = await buildResponsesCsv(supabase, formId);
    const lines = csv.trimEnd().split("\r\n");

    expect(lines[0]).toBe("Submitted at,Ending,Name,CV");
    expect(lines).toHaveLength(RESPONSE_COUNT + 1);
    expect(lines[1]).toContain("Person 0");
    expect(lines[RESPONSE_COUNT]).toContain(`Person ${RESPONSE_COUNT - 1}`);
    expect(lines[RESPONSE_COUNT]).toMatch(/,ada-cv\.pdf$/);
  }, 60_000);
});
