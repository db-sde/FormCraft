import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { deleteAccount } from "@/domains/identity";

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

describe("deleteAccount (integration)", () => {
  it("removes the user, their workspace, forms and responses", async () => {
    const id = crypto.randomUUID().slice(0, 8);
    const { data: created, error } = await admin.auth.admin.createUser({
      email: `delete-me-${id}@example.com`,
      password: crypto.randomUUID(),
      email_confirm: true,
    });
    if (error) throw error;
    const userId = created.user.id;

    const { data: workspace } = await admin
      .from("workspaces")
      .insert({ name: "Doomed", slug: `doomed-${id}`, owner_id: userId })
      .select("id")
      .single();
    await admin
      .from("workspace_members")
      .insert({ workspace_id: workspace!.id, user_id: userId, role: "owner" });
    const { data: form } = await admin
      .from("forms")
      .insert({
        workspace_id: workspace!.id,
        title: "Doomed form",
        slug: `doomed-form-${id}`,
        created_by: userId,
      })
      .select("id")
      .single();
    const { data: version } = await admin
      .from("form_versions")
      .insert({
        form_id: form!.id,
        status: "draft",
        version_number: 1,
        schema: {} as Json,
      })
      .select("id")
      .single();
    const { data: response } = await admin
      .from("responses")
      .insert({ form_id: form!.id, form_version_id: version!.id })
      .select("id")
      .single();

    await deleteAccount(admin, userId);

    const { data: user } = await admin.auth.admin.getUserById(userId);
    expect(user.user).toBeNull();
    const [w, f, r] = await Promise.all([
      admin.from("workspaces").select("id").eq("id", workspace!.id),
      admin.from("forms").select("id").eq("id", form!.id),
      admin.from("responses").select("id").eq("id", response!.id),
    ]);
    expect([w.data, f.data, r.data]).toEqual([[], [], []]);
  });
});
