import { describe, expect, it } from "vitest";
import { removeQueuedFiles, sendQueuedNotices } from "@/domains/ops/background";
import type { OutgoingEmail } from "@/domains/notifications/mailer";

/**
 * The ops job's Phase 4 work with stand-ins for the database and the
 * mailer: each notice is sent once per recipient (an idempotency key per
 * send), the result goes back to the database, and erased files are
 * removed in batches with failures reported rather than lost.
 */
function fakeAdmin(rows: Record<string, unknown[]>, removeFails = false) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const removed: { bucket: string; paths: string[] }[] = [];
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: rows[fn] ?? null, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          removed.push({ bucket, paths });
          return removeFails
            ? { data: null, error: { message: "storage unavailable" } }
            : { data: [], error: null };
        },
      }),
    },
  };
  return { admin: admin as never, calls, removed };
}

describe("sendQueuedNotices", () => {
  const claimed = [
    {
      id: 1,
      email: "a@example.com",
      kind: "incident",
      subject: "Delays",
      body: "Body <b>1</b>",
    },
    {
      id: 2,
      email: "b@example.com",
      kind: "billing",
      subject: "Invoices",
      body: "Body 2",
    },
  ];

  it("sends each claimed notice once, with a key per send, and reports back", async () => {
    const { admin, calls } = fakeAdmin({ ops_message_claim: claimed });
    const sent: OutgoingEmail[] = [];
    const result = await sendQueuedNotices(admin, async (email) => {
      sent.push(email);
      return email.to[0] === "b@example.com" ? { ok: false } : { ok: true, id: "re_9" };
    });
    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(sent.map((e) => [e.to, e.idempotencyKey])).toEqual([
      [["a@example.com"], "notice-1"],
      [["b@example.com"], "notice-2"],
    ]);
    // The body is escaped in HTML, and says why they got it.
    expect(sent[0].html).not.toContain("<b>1</b>");
    expect(sent[0].text).toContain("own a FormCraft workspace");
    expect(calls.filter((c) => c.fn === "ops_message_result").map((c) => c.args)).toEqual(
      [
        { p_id: 1, p_ok: true, p_provider_id: "re_9", p_error: undefined },
        {
          p_id: 2,
          p_ok: false,
          p_provider_id: undefined,
          p_error: "The email provider refused it",
        },
      ],
    );
  });

  it("claims nothing when email isn't set up", async () => {
    const { admin, calls } = fakeAdmin({ ops_message_claim: claimed });
    expect(await sendQueuedNotices(admin, null)).toEqual({ sent: 0, failed: 0 });
    expect(calls).toEqual([]);
  });
});

describe("removeQueuedFiles", () => {
  const queue = Array.from({ length: 150 }, (_, i) => ({
    id: i + 1,
    bucket: "response-uploads",
    path: `f/${i}.pdf`,
  }));

  it("removes in batches of 100 and marks them done", async () => {
    const { admin, calls, removed } = fakeAdmin({ ops_storage_deletions_claim: queue });
    expect(await removeQueuedFiles(admin)).toEqual({ removed: 150, failed: 0 });
    expect(removed.map((r) => r.paths.length)).toEqual([100, 50]);
    const done = calls.filter((c) => c.fn === "ops_storage_deletions_done");
    expect(done.map((c) => (c.args.p_ids as number[]).length)).toEqual([100, 50]);
    expect(done.every((c) => c.args.p_error === undefined)).toBe(true);
  });

  it("reports a storage failure so the files are tried again", async () => {
    const { admin, calls } = fakeAdmin(
      { ops_storage_deletions_claim: queue.slice(0, 3) },
      true,
    );
    expect(await removeQueuedFiles(admin)).toEqual({ removed: 0, failed: 3 });
    expect(calls.find((c) => c.fn === "ops_storage_deletions_done")?.args.p_error).toBe(
      "storage unavailable",
    );
  });
});
