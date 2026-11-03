import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { completeResponse, startResponse } from "@/domains/responses";
import {
  cancelBooking,
  confirmBooking,
  loadBookingType,
  newManageToken,
  reserveSlot,
  slotsBetween,
} from "@/domains/bookings/server";
import { holdBookings, settleBookings } from "@/domains/bookings/submit";
import { sendDueReminders } from "@/domains/bookings/emails";
import { syncCalendarBookings, eventIdFor } from "@/domains/bookings/google-calendar";
import "@/domains/connectors/registry";
import {
  dispatchConnectorJobs,
  enqueueJob,
  saveConnection,
} from "@/domains/connectors/framework";
import type { OutgoingEmail, Send } from "@/domains/notifications/mailer";

/**
 * Master spec Phase 5 against the real database: the overlap rule under
 * races, buffers and teams, holds around a submit, reminders once, the
 * connector worker (idempotent calendar events, retries, auth failures)
 * and calendar changes picked up from Google.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin: SupabaseClient<Database> = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
  },
);
const runId = crypto.randomUUID().slice(0, 8);

type Person = { id: string; email: string; client: SupabaseClient<Database> };
const people: Person[] = [];
async function person(name: string): Promise<Person> {
  const email = `${name}-${runId}@example.com`;
  const password = crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false },
  });
  const { error: signIn } = await client.auth.signInWithPassword({ email, password });
  if (signIn) throw signIn;
  const p = { id: data.user.id, email, client };
  people.push(p);
  return p;
}

let ana: Person;
let ben: Person;
let outsider: Person;
let workspaceId: string;
let typeId: string;
let formId: string;

// Next Tuesday, as a date in UTC (the booking type's zone).
function nextTuesday(): string {
  const d = new Date();
  const add = (2 - d.getUTCDay() + 7) % 7 || 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add))
    .toISOString()
    .slice(0, 10);
}
const DAY = nextTuesday();
const at = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`;
// A week later: a clean day for the calendar tests.
const DAY2 = new Date(Date.parse(`${DAY}T00:00:00Z`) + 7 * 86_400_000)
  .toISOString()
  .slice(0, 10);
const at2 = (hhmm: string) => `${DAY2}T${hhmm}:00.000Z`;

const schema = (bookingTypeId: string): FormSchemaV1 => ({
  schemaVersion: 1,
  meta: { title: "Book a call" },
  theme: {
    primaryColor: "#0f172a",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Booked", isDefault: true }],
  logic: [],
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
      id: "q_email",
      type: "email",
      order: 1,
      label: "Email",
      required: true,
      settings: {},
    },
    {
      id: "q_time",
      type: "booking",
      order: 2,
      label: "Pick a time",
      required: true,
      settings: { bookingTypeId, nameQuestionId: "q_name", emailQuestionId: "q_email" },
    },
  ],
});

beforeAll(async () => {
  ana = await person("bk-ana");
  ben = await person("bk-ben");
  outsider = await person("bk-out");
  const { data: ws } = await admin
    .from("workspaces")
    .insert({ name: "Bookings", slug: `bk-${runId}`, owner_id: ana.id })
    .select("id")
    .single();
  workspaceId = ws!.id;
  await admin.from("workspace_members").insert([
    { workspace_id: workspaceId, user_id: ana.id, role: "owner", permissions: {} },
    { workspace_id: workspaceId, user_id: ben.id, role: "editor", permissions: {} },
  ]);
  const { data: type, error } = await ana.client
    .from("booking_types")
    .insert({
      workspace_id: workspaceId,
      name: "Intro call",
      duration_minutes: 30,
      buffer_after_minutes: 15,
      min_notice_minutes: 0,
      max_days_ahead: 30,
      time_zone: "UTC",
      weekly: [{ day: 2, start: "09:00", end: "12:00" }] as unknown as Json,
    })
    .select("id")
    .single();
  if (error) throw error;
  typeId = type!.id;
  await ana.client.from("booking_hosts").insert([
    { booking_type_id: typeId, user_id: ana.id },
    { booking_type_id: typeId, user_id: ben.id },
  ]);
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Book",
      slug: `book-${runId}`,
      created_by: ana.id,
    })
    .select("id")
    .single();
  formId = form!.id;
  const s = schema(typeId) as unknown as Json;
  await admin
    .from("form_versions")
    .insert({ form_id: formId, status: "draft", version_number: 1, schema: s });
  const { error: pubError } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: s,
  });
  if (pubError) throw pubError;
}, 60_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", workspaceId);
  for (const p of people) await admin.auth.admin.deleteUser(p.id);
});

async function newResponse() {
  return (await startResponse(admin, formId)).responseId;
}

describe("booking rules (F-27)", () => {
  it("lets each host take a slot once, even when requests race", async () => {
    const type = (await loadBookingType(admin, typeId))!;
    const start = at("09:00");
    const attempts = await Promise.all(
      [1, 2, 3].map(async () =>
        reserveSlot(admin, {
          type,
          start,
          formId,
          responseId: await newResponse(),
          attendee: { name: "X", email: null, timeZone: null },
        }),
      ),
    );
    const won = attempts.filter((a) => a.ok);
    // Two hosts: two bookings at 09:00, never two for the same host.
    expect(won).toHaveLength(2);
    expect(new Set(won.map((w) => (w.ok ? w.hostId : ""))).size).toBe(2);
    expect(attempts.find((a) => !a.ok)).toMatchObject({
      message: expect.stringMatching(/isn't available|was just taken/),
    });
    // With both hosts busy at 09:00 (plus the 15-minute buffer), 09:30 is gone too.
    const slots = (await slotsBetween(admin, type, DAY, DAY, { fetch: undefined })).map(
      (s) => s.start,
    );
    expect(slots).not.toContain(at("09:00"));
    expect(slots).not.toContain(at("09:30"));
    expect(slots).toContain(at("10:00"));
  });

  it("lets an unconfirmed hold lapse after 15 minutes", async () => {
    const type = (await loadBookingType(admin, typeId))!;
    const held = await reserveSlot(admin, {
      type,
      start: at("11:00"),
      formId,
      responseId: await newResponse(),
      attendee: { name: null, email: null, timeZone: null },
    });
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    await admin
      .from("bookings")
      .update({ created_at: new Date(Date.now() - 20 * 60_000).toISOString() })
      .eq("id", held.bookingId);
    const slots = await slotsBetween(admin, type, DAY, DAY);
    expect(slots.find((s) => s.start === at("11:00"))?.hostIds).toContain(held.hostId);
  });
});

describe("booking on submit (F-27)", () => {
  it("holds, completes, confirms; a taken slot is an answer error; repeats don't double book", async () => {
    const answers = (start: string) => ({
      q_name: "Ada Lovelace",
      q_email: "ada@example.com",
      q_time: { start, timeZone: "Europe/London" },
    });
    const r1 = await newResponse();
    const holds = await holdBookings(admin, r1, answers(at("10:30")));
    expect(holds.ok).toBe(true);
    const done = await completeResponse(
      admin,
      r1,
      1,
      "q_time",
      answers(at("10:30")),
      crypto.randomUUID(),
    );
    expect(done.ok).toBe(true);
    if (!holds.ok) return;
    const confirmed = await settleBookings(admin, holds.held, r1, done.ok);
    expect(confirmed).toHaveLength(1);
    const { data: booking } = await admin
      .from("bookings")
      .select("status, attendee_email, attendee_name, attendee_time_zone")
      .eq("response_id", r1)
      .single();
    expect(booking).toMatchObject({
      status: "confirmed",
      attendee_email: "ada@example.com",
      attendee_name: "Ada Lovelace",
      attendee_time_zone: "Europe/London",
    });
    // A repeat submit finds the same booking.
    const again = await holdBookings(admin, r1, answers(at("10:30")));
    expect(again.ok && again.held[0].existing).toBe(true);

    // Take the other host at 10:30, then a third respondent can't have it.
    const r2 = await newResponse();
    const h2 = await holdBookings(admin, r2, answers(at("10:30")));
    expect(h2.ok).toBe(true);
    const r3 = await newResponse();
    const h3 = await holdBookings(admin, r3, answers(at("10:30")));
    expect(h3).toMatchObject({ ok: false, errors: [{ questionId: "q_time" }] });
    // r2 never completes: its hold is released.
    if (h2.ok) await settleBookings(admin, h2.held, r2, false);
    const { data: released } = await admin
      .from("bookings")
      .select("status")
      .eq("response_id", r2)
      .single();
    expect(released?.status).toBe("cancelled");
  });

  it("sends each reminder once", async () => {
    const type = (await loadBookingType(admin, typeId))!;
    const soon = await reserveSlot(admin, {
      type,
      start: at("11:30"),
      formId,
      responseId: await newResponse(),
      attendee: { name: "Bo", email: "bo@example.com", timeZone: "UTC" },
    });
    if (!soon.ok) throw new Error(soon.message);
    await confirmBooking(admin, soon.bookingId, null);
    const sent: OutgoingEmail[] = [];
    const send: Send = async (e) => {
      sent.push(e);
      return { ok: true };
    };
    const now = new Date(Date.parse(at("11:30")) - 2 * 3_600_000);
    await sendDueReminders(admin, { now, send });
    await sendDueReminders(admin, { now, send });
    const mine = sent.filter((e) => e.to.includes("bo@example.com"));
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toMatch(/^Reminder/);
    expect(new TextDecoder().decode(mine[0].attachments![0].content)).toContain(
      "BEGIN:VEVENT",
    );
  });

  it("keeps bookings to members who may see responses; secrets to the server", async () => {
    const { data: seen } = await outsider.client
      .from("bookings")
      .select("id")
      .eq("booking_type_id", typeId);
    expect(seen).toEqual([]);
    const { data: mine } = await ben.client
      .from("bookings")
      .select("id")
      .eq("booking_type_id", typeId);
    expect((mine ?? []).length).toBeGreaterThan(0);
    const { error } = await ana.client.from("connector_connections").select("id");
    expect(error).not.toBeNull();
    const { error: direct } = await ana.client.rpc("book_slot", {
      p_booking_type_id: typeId,
      p_host_ids: [ana.id],
      p_starts_at: at("09:00"),
      p_form_id: formId,
      p_response_id: crypto.randomUUID(),
      p_attendee_name: "",
      p_attendee_email: "",
      p_attendee_time_zone: "",
      p_manage_token_hash: newManageToken().hash,
    });
    expect(direct).not.toBeNull();
  });
});

describe("Google Calendar through the connector worker (F-43)", () => {
  it("creates each event once, retries failures, and stops on auth errors", async () => {
    const connectionId = await saveConnection(admin, {
      workspaceId,
      userId: ana.id,
      provider: "google_calendar",
      tokens: { accessToken: "token", expiresAt: Date.now() + 3_600_000 },
      label: "ana@example.com",
      createdBy: ana.id,
    });
    const type = (await loadBookingType(admin, typeId))!;
    const r = await reserveSlot(
      admin,
      {
        type,
        start: at2("11:00"),
        formId,
        responseId: await newResponse(),
        attendee: { name: "Cy", email: "cy@example.com", timeZone: "UTC" },
      },
      {
        fetch: (async () =>
          new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), {
            status: 200,
          })) as unknown as typeof fetch,
      },
    );
    if (!r.ok) throw new Error(r.message);
    // The booking went to whichever host was free; make it Ana's for the test.
    await admin.from("bookings").update({ host_id: ana.id }).eq("id", r.bookingId);
    await confirmBooking(admin, r.bookingId, null);
    // Queued once even if asked again.
    await enqueueJob(admin, {
      connectionId,
      workspaceId,
      provider: "google_calendar",
      action: "create_event",
      idempotencyKey: `gcal:create_event:${r.bookingId}`,
      bookingId: r.bookingId,
    });
    const { count } = await admin
      .from("connector_jobs")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", r.bookingId)
      .eq("action", "create_event");
    expect(count).toBe(1);

    const calls: { url: string; body: unknown }[] = [];
    let reply = 503;
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify({ error: { message: "x" } }), { status: reply });
    }) as unknown as typeof fetch;
    await dispatchConnectorJobs(admin, { fetch: fake });
    const job = async () =>
      (
        await admin
          .from("connector_jobs")
          .select("status, attempt_count, last_error")
          .eq("booking_id", r.bookingId)
          .eq("action", "create_event")
          .single()
      ).data;
    expect(await job()).toMatchObject({ status: "failed", attempt_count: 1 });
    expect(calls[0].body).toMatchObject({
      id: eventIdFor(r.bookingId),
      attendees: [{ email: "cy@example.com" }],
    });

    // A retry after a timeout: Google already has it (409) — done, no duplicate.
    reply = 409;
    await admin
      .from("connector_jobs")
      .update({ next_attempt_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("booking_id", r.bookingId);
    await dispatchConnectorJobs(admin, { fetch: fake });
    expect(await job()).toMatchObject({ status: "succeeded" });

    // Deleted in Google: the booking is cancelled, and noted.
    const gone = (async () =>
      new Response("", { status: 404 })) as unknown as typeof fetch;
    const sync = await syncCalendarBookings(admin, { fetch: gone });
    expect(sync.cancelled).toBeGreaterThanOrEqual(1);
    const { data: b } = await admin
      .from("bookings")
      .select("status, cancelled_by")
      .eq("id", r.bookingId)
      .single();
    expect(b).toMatchObject({ status: "cancelled", cancelled_by: "calendar" });

    // Cancelling another booking queues a delete; a 401 marks the
    // connection for reconnecting.
    const r2 = await reserveSlot(
      admin,
      {
        type,
        start: at2("10:00"),
        formId,
        responseId: await newResponse(),
        attendee: { name: null, email: null, timeZone: null },
      },
      {
        fetch: (async () =>
          new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), {
            status: 200,
          })) as unknown as typeof fetch,
      },
    );
    if (!r2.ok) throw new Error(r2.message);
    await admin.from("bookings").update({ host_id: ana.id }).eq("id", r2.bookingId);
    await confirmBooking(admin, r2.bookingId, null);
    await admin.from("connector_jobs").delete().eq("booking_id", r2.bookingId);
    await cancelBooking(admin, r2.bookingId, "host");
    await dispatchConnectorJobs(admin, {
      fetch: (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch,
    });
    const { data: conn } = await admin
      .from("connector_connections")
      .select("status")
      .eq("id", connectionId)
      .single();
    expect(conn?.status).toBe("invalid");
  });

  it("hides a host whose calendar can't be read", async () => {
    const type = (await loadBookingType(admin, typeId))!;
    // Ana's connection is invalid now: her times aren't offered.
    const slots = await slotsBetween(admin, type, DAY2, DAY2);
    expect(slots.every((s) => !s.hostIds.includes(ana.id))).toBe(true);
    expect(slots.some((s) => s.hostIds.includes(ben.id))).toBe(true);
  });
});
