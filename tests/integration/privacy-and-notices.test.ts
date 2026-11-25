import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@/lib/supabase/database.types";
import {
  admin,
  call,
  canRunLocally,
  clearStaff,
  person,
  sql,
  staffTeam,
  type Person,
} from "./staff-helpers";
import { sendQueuedNotices } from "@/domains/ops/background";
import type { OutgoingEmail } from "@/domains/notifications/mailer";

/**
 * Super Admin Phase 4 (migration 74) against the real database: a privacy
 * request found across workspaces, exported once identity is checked,
 * erased only with someone else's approval and with evidence kept;
 * retention runs and deadlines raising alerts; and customer notices that
 * need approval, bind their wording, and log every recipient.
 */
const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
const describeLocal = canRunLocally ? describe : describe.skip;
const subject = `person-${runId}@privacy-test.example.com`;
const bystander = `other-${runId}@privacy-test.example.com`;

const schema = {
  schemaVersion: 1,
  meta: { title: "Signup" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    { id: "q_email", type: "email", order: 0, label: "Your email", settings: {} },
    { id: "q_note", type: "short_text", order: 1, label: "Anything else", settings: {} },
  ],
  logic: [],
} as unknown as Json;

describeLocal("Super Admin Phase 4: privacy requests, retention, notices", () => {
  let owner: Person;
  let privacyLead: Person;
  let support: Person;
  let customerA: Person;
  let customerB: Person;
  const people: Person[] = [];
  const workspaces: string[] = [];
  const forms: string[] = [];
  let requestId: string;

  async function workspaceWithForm(name: string, customer: Person) {
    const { data: ws } = await admin
      .from("workspaces")
      .insert({ name, slug: `${name.toLowerCase()}-${runId}`, owner_id: customer.id })
      .select("id")
      .single();
    await admin
      .from("workspace_members")
      .insert({ workspace_id: ws!.id, user_id: customer.id, role: "owner" });
    const { data: form } = await admin
      .from("forms")
      .insert({
        workspace_id: ws!.id,
        title: `${name} form`,
        slug: `${name.toLowerCase()}-form-${runId}`,
        created_by: customer.id,
      })
      .select("id")
      .single();
    await admin.rpc("publish_form_version", {
      target_form_id: form!.id,
      compiled_schema: schema,
    });
    const version = (
      await admin
        .from("form_versions")
        .select("id")
        .eq("form_id", form!.id)
        .eq("status", "published")
        .single()
    ).data!.id;
    workspaces.push(ws!.id);
    forms.push(form!.id);
    return { workspaceId: ws!.id, formId: form!.id, versionId: version };
  }

  async function respond(
    formId: string,
    versionId: string,
    value: Json,
    visitorId: string | null = null,
  ) {
    const { data: r } = await admin
      .from("responses")
      .insert({
        form_id: formId,
        form_version_id: versionId,
        status: "completed",
        completed_at: new Date().toISOString(),
        visitor_id: visitorId,
      })
      .select("id")
      .single();
    await admin.from("answers").insert([
      { response_id: r!.id, question_id: "q_email", value },
      { response_id: r!.id, question_id: "q_note", value: "Hello" },
    ]);
    return r!.id;
  }

  let a: Awaited<ReturnType<typeof workspaceWithForm>>;
  let b: Awaited<ReturnType<typeof workspaceWithForm>>;
  let theirs: string[];
  let others: string;

  beforeAll(async () => {
    owner = await person("pv-owner", runId, { mfa: true });
    privacyLead = await person("pv-privacy", runId, { mfa: true });
    support = await person("pv-support", runId, { mfa: true });
    customerA = await person("pv-cust-a", runId, { mfa: false });
    customerB = await person("pv-cust-b", runId, { mfa: false });
    people.push(owner, privacyLead, support, customerA, customerB);
    sql("delete from private.ops_alerts; delete from private.messages;");
    await staffTeam(owner, [
      { person: privacyLead, role: "privacy" },
      { person: support, role: "support" },
    ]);

    a = await workspaceWithForm("Alpha", customerA);
    b = await workspaceWithForm("Beta", customerB);
    theirs = [
      await respond(a.formId, a.versionId, subject, `visitor-${runId}`),
      // Different case, and a contact step's email in another workspace.
      await respond(b.formId, b.versionId, {
        name: "Pat",
        email: subject.toUpperCase(),
      } as Json),
    ];
    others = await respond(a.formId, a.versionId, bystander);

    await admin.from("uploads").insert({
      response_id: theirs[0],
      question_id: "q_note",
      storage_path: `${a.formId}/${theirs[0]}/cv.pdf`,
      original_filename: "cv.pdf",
      mime_type: "application/pdf",
      size_bytes: 100,
    });
    await admin.from("visitor_profiles").insert({
      workspace_id: a.workspaceId,
      visitor_id: `visitor-${runId}`,
      key: "q_email",
      value: subject,
      question_type: "email",
    });
    const { data: hook } = await admin
      .from("webhook_endpoints")
      .insert({
        form_id: a.formId,
        url: "https://hooks.example.com/p",
        signing_secret: "s",
      })
      .select("id")
      .single();
    await admin.from("webhook_deliveries").insert({
      endpoint_id: hook!.id,
      response_id: theirs[0],
      event_id: crypto.randomUUID(),
      event_type: "response.completed",
      dedupe_key: `pv-${runId}`,
      payload: { email: subject },
    });
    const { data: bt } = await admin
      .from("booking_types")
      .insert({
        workspace_id: b.workspaceId,
        name: "Call",
        duration_minutes: 30,
        time_zone: "UTC",
      })
      .select("id")
      .single();
    sql(`insert into public.bookings (booking_type_id, host_id, form_id, starts_at, ends_at,
           blocked, manage_token_hash, attendee_name, attendee_email)
         values ('${bt!.id}', '${customerB.id}', '${b.formId}', now() + interval '1 day',
           now() + interval '1 day 30 minutes',
           tstzrange(now() + interval '1 day', now() + interval '1 day 30 minutes'),
           'hash-${runId}', 'Pat', '${subject}');`);
  }, 120_000);

  afterAll(async () => {
    if (!canRunLocally) return;
    sql(
      "delete from private.ops_alerts; delete from private.message_sends; delete from private.messages; delete from private.privacy_requests; delete from private.storage_deletions where reason like 'privacy:%';",
    );
    clearStaff();
    for (const id of workspaces) await admin.from("workspaces").delete().eq("id", id);
    for (const p of people) await admin.auth.admin.deleteUser(p.id);
  });

  it("logs a request with a 30-day deadline; support can't", async () => {
    expect(
      await call(support, "admin_privacy_open", {
        p_type: "erasure",
        p_email: subject,
        p_received_at: null,
        p_note: "",
      }),
    ).toMatchObject({ ok: false, code: "denied" });
    const opened = await call(privacyLead, "admin_privacy_open", {
      p_type: "erasure",
      p_email: subject,
      p_received_at: null,
      p_note: "Email to privacy@",
    });
    expect(opened.ok).toBe(true);
    requestId = opened.id as string;
    const days = Number(
      sql(
        `select extract(day from due_at - received_at) from private.privacy_requests where id = '${requestId}'`,
      ),
    );
    expect(days).toBe(30);
  });

  it("finds the person in every workspace, by any case of the address", async () => {
    const found = await call(privacyLead, "admin_privacy_find", { p_id: requestId });
    const scope = found.scope as {
      responses: number;
      bookings: number;
      workspaces: { id: string; responses: number }[];
    };
    expect(scope.responses).toBe(2);
    expect(scope.bookings).toBe(1);
    expect(scope.workspaces.map((w) => w.id).sort()).toEqual([...workspaces].sort());
  });

  it("exports only after identity is checked, with question labels", async () => {
    expect(await call(privacyLead, "admin_privacy_export", { p_id: requestId })).toEqual({
      ok: false,
      code: "not_verified",
    });
    expect(
      await call(privacyLead, "admin_privacy_verify", {
        p_id: requestId,
        p_note: "Replied from the address",
      }),
    ).toEqual({ ok: true });
    const exported = await call(privacyLead, "admin_privacy_export", { p_id: requestId });
    const data = exported.export as {
      responses: { organisation: string; answers: { question: string }[] }[];
      bookings: unknown[];
    };
    expect(data.responses).toHaveLength(2);
    expect(data.responses[0].answers.map((x) => x.question)).toContain("Your email");
    expect(data.bookings).toHaveLength(1);
    expect(
      sql(
        `select count(*) from private.platform_audit_log where action = 'privacy.exported' and target_id = '${requestId}'`,
      ),
    ).toBe("1");
  });

  it("erases only with another person's approval, everywhere, and keeps the evidence", async () => {
    const change = await call(privacyLead, "admin_request_change", {
      p_action: "privacy.erase",
      p_target_type: "privacy_request",
      p_target_id: requestId,
      p_payload: { email: subject },
      p_reason: "Person asked to be forgotten",
    });
    expect(
      await call(privacyLead, "admin_apply_privacy_erasure", { p_request_id: change.id }),
    ).toEqual({ ok: false, code: "approval_required" });
    expect(
      await call(owner, "admin_decide_change", {
        p_id: change.id,
        p_approve: true,
        p_note: "Checked",
      }),
    ).toEqual({ ok: true });
    const done = await call(privacyLead, "admin_apply_privacy_erasure", {
      p_request_id: change.id,
    });
    expect(done.ok).toBe(true);
    expect(done.evidence).toMatchObject({
      responses: 2,
      files_queued: 1,
      webhook_payloads: 1,
      remembered_answers: 1,
      bookings_anonymised: 1,
    });

    const left = await admin
      .from("responses")
      .select("id")
      .in("id", [...theirs, others]);
    expect(left.data!.map((r) => r.id)).toEqual([others]);
    expect(
      sql(
        `select count(*) from public.bookings where lower(attendee_email) = '${subject}'`,
      ),
    ).toBe("0");
    expect(
      sql(
        `select count(*) from public.audit_logs where action = 'support.privacy_erased' and target_id = '${requestId}'`,
      ),
    ).toBe("2");
    expect(
      sql(`select status from private.privacy_requests where id = '${requestId}'`),
    ).toBe("completed");

    // The file is removed later by the ops job, through the storage API.
    const { data: claimed } = await admin.rpc("ops_storage_deletions_claim", {
      p_limit: 10,
    });
    const mine = (claimed ?? []).filter((c) => c.path.includes(theirs[0]));
    expect(mine).toHaveLength(1);
    await admin.rpc("ops_storage_deletions_done", { p_ids: mine.map((c) => c.id) });
    expect(
      sql(
        `select count(*) from private.storage_deletions where path like '%${theirs[0]}%' and done_at is null`,
      ),
    ).toBe("0");
  });

  it("alerts on a missed deadline and a failed or missing retention run", async () => {
    const late = await call(privacyLead, "admin_privacy_open", {
      p_type: "access",
      p_email: bystander,
      p_received_at: null,
      p_note: "",
    });
    sql(
      `update private.privacy_requests set due_at = now() - interval '1 day' where id = '${late.id}';`,
    );
    await admin.rpc("ops_record_retention_run", {
      p_job: "completed_responses",
      p_ok: false,
      p_counts: {},
      p_error: "timeout",
    });
    await admin.rpc("ops_phase4_checks");
    const open = sql(
      "select string_agg(kind || ':' || severity, ',' order by kind) from private.ops_alerts where resolved_at is null",
    );
    expect(open).toContain("privacy_overdue:critical");
    expect(open).toContain("retention_failing:critical");

    await admin.rpc("ops_record_retention_run", {
      p_job: "completed_responses",
      p_ok: true,
      p_counts: { deleted: 0 },
    });
    expect(
      await call(privacyLead, "admin_privacy_close", {
        p_id: late.id,
        p_status: "completed",
        p_note: "Sent them the export",
      }),
    ).toEqual({ ok: true });
    await admin.rpc("ops_phase4_checks");
    const after = sql(
      "select coalesce(string_agg(kind, ','), '') from private.ops_alerts where resolved_at is null",
    );
    expect(after).not.toContain("privacy_overdue");
    expect(after).not.toContain("retention_failing");

    sql("update private.retention_runs set ran_at = ran_at - interval '3 days';");
    await admin.rpc("ops_phase4_checks");
    expect(
      sql(
        "select count(*) from private.ops_alerts where kind = 'retention_stale' and resolved_at is null",
      ),
    ).toBe("1");
    sql("update private.retention_runs set ran_at = ran_at + interval '3 days';");
  });

  it("sends a notice only as approved, to each owner once, and logs every send", async () => {
    expect(
      await call(support, "admin_message_draft", {
        p_kind: "incident",
        p_subject: "Nope",
        p_body: "Support can't send notices.",
        p_audience: { type: "all" },
      }),
    ).toMatchObject({ ok: false, code: "denied" });
    const audience = { type: "workspaces", ids: workspaces };
    const draft = await call(owner, "admin_message_draft", {
      p_kind: "incident",
      p_subject: "Delayed webhooks this morning",
      p_body: "Some webhooks were delayed by up to 20 minutes. All were delivered.",
      p_audience: audience,
    });
    expect(draft).toMatchObject({ ok: true, recipients: 2 });

    // An approval for different wording doesn't send this notice.
    const wrong = await call(owner, "admin_request_change", {
      p_action: "message.send",
      p_target_type: "message",
      p_target_id: draft.id,
      p_payload: {
        kind: "incident",
        subject: "Something else entirely",
        body: "Some webhooks were delayed by up to 20 minutes. All were delivered.",
        audience,
      },
      p_reason: "Tell affected customers",
    });
    expect(
      await call(owner, "admin_emergency_approve", {
        p_id: wrong.id,
        p_reason: "Testing the wording check",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await call(owner, "admin_apply_message_send", { p_request_id: wrong.id }),
    ).toEqual({
      ok: false,
      code: "invalid",
      why: "notice does not match",
    });

    const right = await call(owner, "admin_request_change", {
      p_action: "message.send",
      p_target_type: "message",
      p_target_id: draft.id,
      p_payload: {
        kind: "incident",
        subject: "Delayed webhooks this morning",
        body: "Some webhooks were delayed by up to 20 minutes. All were delivered.",
        audience,
      },
      p_reason: "Tell affected customers",
    });
    expect(
      await call(owner, "admin_apply_message_send", { p_request_id: right.id }),
    ).toEqual({
      ok: false,
      code: "approval_required",
    });
    // Privacy leads can't approve notices.
    expect(
      await call(privacyLead, "admin_decide_change", {
        p_id: right.id,
        p_approve: true,
        p_note: "",
      }),
    ).toMatchObject({ ok: false, code: "denied" });
    // A second owner-or-admin isn't in this team: the owner's logged emergency path.
    await call(owner, "admin_emergency_approve", {
      p_id: right.id,
      p_reason: "Only owner in test",
    });
    expect(
      await call(owner, "admin_apply_message_send", { p_request_id: right.id }),
    ).toEqual({
      ok: true,
      recipients: 2,
    });

    const { data: batch } = await admin.rpc("ops_message_claim", { p_limit: 10 });
    expect((batch ?? []).map((x) => x.email).sort()).toEqual(
      [customerA.email, customerB.email].sort(),
    );
    // Claimed sends aren't handed out twice.
    expect((await admin.rpc("ops_message_claim", { p_limit: 10 })).data).toEqual([]);
    for (const s of batch ?? []) {
      await admin.rpc("ops_message_result", {
        p_id: s.id,
        p_ok: true,
        p_provider_id: "re_1",
      });
    }
    expect(sql(`select status from private.messages where id = '${draft.id}'`)).toBe(
      "sent",
    );
    expect(
      sql(
        `select count(*) from private.message_sends where message_id = '${draft.id}' and status = 'sent'`,
      ),
    ).toBe("2");
  });

  it("starts at most five notices a day", async () => {
    sql("update private.messages set started_at = now() where status = 'sent';");
    for (let i = 0; i < 4; i += 1) {
      sql(`insert into private.messages (kind, subject, body, audience, status, created_by, started_at)
           values ('service', 'Filler ${i}', 'Filler notice body', '{"type":"all"}', 'sent', '${owner.id}', now());`);
    }
    const draft = await call(owner, "admin_message_draft", {
      p_kind: "service",
      p_subject: "One too many",
      p_body: "This one should wait a day.",
      p_audience: { type: "all" },
    });
    const req = await call(owner, "admin_request_change", {
      p_action: "message.send",
      p_target_type: "message",
      p_target_id: draft.id,
      p_payload: {
        kind: "service",
        subject: "One too many",
        body: "This one should wait a day.",
        audience: { type: "all" },
      },
      p_reason: "Testing the daily limit",
    });
    await call(owner, "admin_emergency_approve", {
      p_id: req.id,
      p_reason: "Testing the daily limit",
    });
    expect(
      await call(owner, "admin_apply_message_send", { p_request_id: req.id }),
    ).toEqual({
      ok: false,
      code: "invalid",
      why: "daily_limit",
    });
  });

  it("email outage drill: a notice is retried once the provider is back, never sent twice", async () => {
    // Straight into the queue (today's five-a-day limit is used up above).
    const id =
      sql(`insert into private.messages (kind, subject, body, audience, recipients, status, created_by, started_at)
         values ('incident', 'Drill notice', 'Email provider outage drill.', '{"type":"all"}', 1, 'sending', '${owner.id}', now())
         returning id;`).split("\n")[0];
    sql(
      `insert into private.message_sends (message_id, email) values ('${id}', '${customerA.email}');`,
    );

    const keys: string[] = [];
    const down = async (email: OutgoingEmail) => {
      keys.push(email.idempotencyKey!);
      return { ok: false } as const;
    };
    expect(await sendQueuedNotices(admin, down)).toEqual({ sent: 0, failed: 1 });
    expect(
      sql(
        `select status || ':' || attempts from private.message_sends where message_id = '${id}'`,
      ),
    ).toBe("queued:1");

    const up = async (email: OutgoingEmail) => {
      keys.push(email.idempotencyKey!);
      return { ok: true, id: "re_drill" } as const;
    };
    expect(await sendQueuedNotices(admin, up)).toEqual({ sent: 1, failed: 0 });
    expect(await sendQueuedNotices(admin, up)).toEqual({ sent: 0, failed: 0 });
    expect(sql(`select status from private.messages where id = '${id}'`)).toBe("sent");
    // The same key both times: the provider would drop a duplicate.
    expect(new Set(keys).size).toBe(1);
  });

  it("keeps the ops job's functions to the secret key", async () => {
    for (const fn of [
      "ops_phase4_checks",
      "ops_message_claim",
      "ops_storage_deletions_claim",
    ]) {
      const { error } = await customerA.client.rpc(fn as never);
      expect(error, fn).not.toBeNull();
    }
  });
});
