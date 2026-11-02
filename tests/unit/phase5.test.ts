import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  attendeeMayChange,
  availableSlots,
  blockedRange,
  candidateStarts,
  hostOrder,
  type BookingRules,
} from "@/domains/bookings/availability";
import { parseRange } from "@/domains/bookings/server";
import { eventIdFor } from "@/domains/bookings/google-calendar";
import { bookingIcs } from "@/domains/bookings/emails";
import {
  authorizeUrl,
  createConnectState,
  pkceFor,
  refreshIfNeeded,
  safeReturnPath,
  TokenError,
  verifyConnectState,
} from "@/domains/connectors/oauth";
import { providerCall } from "@/domains/connectors/framework";

const rules: BookingRules = {
  durationMinutes: 30,
  intervalMinutes: null,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 60,
  maxDaysAhead: 14,
  timeZone: "Asia/Kolkata",
  weekly: [{ day: 2, start: "10:00", end: "12:00" }], // Tuesdays
  blockedDates: [],
};
// Monday 2 Nov 2026, 09:00 UTC (14:30 in Kolkata).
const NOW = Date.UTC(2026, 10, 2, 9, 0);
const iso = (ms: number) => new Date(ms).toISOString();

describe("slots (F-27)", () => {
  it("offers the weekly hours in the booking type's zone", () => {
    const starts = candidateStarts(rules, "2026-11-03", "2026-11-03", NOW).map(iso);
    // 10:00–12:00 IST = 04:30–06:30 UTC, every 30 minutes, ending by 12:00.
    expect(starts).toEqual([
      "2026-11-03T04:30:00.000Z",
      "2026-11-03T05:00:00.000Z",
      "2026-11-03T05:30:00.000Z",
      "2026-11-03T06:00:00.000Z",
    ]);
  });

  it("respects notice, the horizon, days off and the interval", () => {
    const soon = candidateStarts(
      rules,
      "2026-11-03",
      "2026-11-03",
      Date.UTC(2026, 10, 3, 4, 45),
    );
    expect(soon.map(iso)).toEqual(["2026-11-03T06:00:00.000Z"]); // 60 min notice
    expect(candidateStarts(rules, "2026-11-24", "2026-11-24", NOW)).toEqual([]); // > 14 days
    expect(
      candidateStarts(
        { ...rules, blockedDates: ["2026-11-03"] },
        "2026-11-03",
        "2026-11-03",
        NOW,
      ),
    ).toEqual([]);
    expect(
      candidateStarts(
        { ...rules, intervalMinutes: 60 },
        "2026-11-03",
        "2026-11-03",
        NOW,
      ).map(iso),
    ).toEqual(["2026-11-03T04:30:00.000Z", "2026-11-03T05:30:00.000Z"]);
  });

  it("handles daylight saving: no slot in the gap, one in the overlap", () => {
    const ny = {
      ...rules,
      timeZone: "America/New_York",
      minNoticeMinutes: 0,
      durationMinutes: 60,
    };
    const back = candidateStarts(
      { ...ny, weekly: [{ day: 0, start: "00:00", end: "04:00" }] },
      "2026-11-01",
      "2026-11-01",
      Date.UTC(2026, 9, 31),
    ).map(iso);
    expect(back).toEqual([
      "2026-11-01T04:00:00.000Z",
      "2026-11-01T05:00:00.000Z",
      "2026-11-01T07:00:00.000Z",
      "2026-11-01T08:00:00.000Z",
    ]);
    const forward = candidateStarts(
      { ...ny, weekly: [{ day: 0, start: "01:00", end: "04:00" }] },
      "2027-03-14",
      "2027-03-14",
      Date.UTC(2027, 2, 10),
    ).map(iso);
    expect(forward).toEqual(["2027-03-14T06:00:00.000Z", "2027-03-14T07:00:00.000Z"]);
  });

  it("offers a slot only to hosts free for it, buffers included, and hides unreadable hosts", () => {
    const buffered = { ...rules, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 };
    const start = Date.UTC(2026, 10, 3, 5, 0);
    expect(blockedRange(buffered, start)).toEqual({
      start: start - 15 * 60_000,
      end: start + 45 * 60_000,
    });
    const busy = new Map([
      ["ana", [{ start: start + 40 * 60_000, end: start + 90 * 60_000 }]], // clashes with the after-buffer
      ["ben", []],
    ]);
    const slots = availableSlots(buffered, ["ana", "ben", "cy"], busy, [start]);
    expect(slots).toEqual([{ start: iso(start), hostIds: ["ben"] }]); // cy: calendar unreadable
    expect(availableSlots(buffered, ["ana"], busy, [start])).toEqual([]);
  });

  it("shares bookings across hosts and stops attendee changes inside the notice", () => {
    expect(
      hostOrder(
        ["a", "b", "c"],
        new Map([
          ["a", 3],
          ["b", 1],
        ]),
      ),
    ).toEqual(["c", "b", "a"]);
    const start = new Date(NOW + 30 * 60_000).toISOString();
    expect(attendeeMayChange({ minNoticeMinutes: 60 }, start, NOW)).toBe(false);
    expect(attendeeMayChange({ minNoticeMinutes: 10 }, start, NOW)).toBe(true);
  });

  it("reads Postgres ranges", () => {
    expect(parseRange('["2026-11-03 05:00:00+00","2026-11-03 05:30:00+00")')).toEqual({
      start: Date.UTC(2026, 10, 3, 5, 0),
      end: Date.UTC(2026, 10, 3, 5, 30),
    });
  });
});

describe("Google Calendar (F-43)", () => {
  it("derives a valid, stable event id from the booking", () => {
    const id = eventIdFor("3F2504E0-4F89-11D3-9A0C-0305E82C3301");
    expect(id).toBe("fc3f2504e04f8911d39a0c0305e82c3301");
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
  });

  it("writes a calendar file with escaped text", () => {
    const ics = bookingIcs({
      bookingId: "b1",
      title: "Intro, call; with Ada",
      startsAt: "2026-11-03T05:00:00.000Z",
      endsAt: "2026-11-03T05:30:00.000Z",
      location: "Line 1\nLine 2",
    });
    expect(ics).toContain("DTSTART:20261103T050000Z");
    expect(ics).toContain("SUMMARY:Intro\\, call\\; with Ada");
    expect(ics).toContain("LOCATION:Line 1\\nLine 2");
    expect(ics).toContain("UID:b1@formcraft");
    expect(
      bookingIcs({
        bookingId: "b1",
        title: "x",
        startsAt: "2026-11-03T05:00:00Z",
        endsAt: "2026-11-03T05:30:00Z",
        cancelled: true,
      }),
    ).toContain("STATUS:CANCELLED");
  });
});

describe("connector OAuth (spec §5.3)", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.APP_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
    process.env.AIRTABLE_CLIENT_ID = "air-id";
    process.env.AIRTABLE_CLIENT_SECRET = "air-secret";
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("signs state for one user and browser, and refuses anything else", () => {
    const { state, nonce } = createConnectState(
      {
        provider: "airtable",
        workspaceId: "w1",
        userId: "u1",
        personal: false,
        returnTo: "/forms/f1/integrations",
      },
      { now: 1_000_000 },
    );
    const ok = verifyConnectState(
      state,
      { userId: "u1", cookieNonce: nonce },
      { now: 1_000_000 },
    );
    expect(ok).toMatchObject({
      ok: true,
      value: { provider: "airtable", returnTo: "/forms/f1/integrations" },
    });
    expect(
      verifyConnectState(state, { userId: "u2", cookieNonce: nonce }, { now: 1_000_000 }),
    ).toMatchObject({ ok: false, reason: "wrong_user" });
    expect(
      verifyConnectState(
        state,
        { userId: "u1", cookieNonce: "other" },
        { now: 1_000_000 },
      ),
    ).toMatchObject({ ok: false, reason: "no_cookie" });
    expect(
      verifyConnectState(
        state,
        { userId: "u1", cookieNonce: nonce },
        { now: 1_000_000 + 11 * 60_000 },
      ),
    ).toMatchObject({ ok: false, reason: "expired" });
    expect(
      verifyConnectState(`${state}x`, { userId: "u1", cookieNonce: nonce }),
    ).toMatchObject({ ok: false });
    expect(safeReturnPath("https://evil.example")).toBe("/settings");
    expect(safeReturnPath("//evil.example")).toBe("/settings");
  });

  it("builds an authorize URL with PKCE for providers that support it", () => {
    const url = new URL(authorizeUrl("airtable", "STATE", "NONCE"));
    expect(url.origin + url.pathname).toBe("https://airtable.com/oauth2/v1/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example/api/connectors/oauth/callback",
    );
    expect(url.searchParams.get("code_challenge")).toBe(pkceFor("NONCE").challenge);
    expect(url.searchParams.get("state")).toBe("STATE");
  });

  it("refreshes tokens near expiry, keeps the refresh token, and reports refusals", async () => {
    const fresh = await refreshIfNeeded("airtable", {
      accessToken: "a",
      expiresAt: Date.now() + 3_600_000,
    });
    expect(fresh.refreshed).toBe(false);
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: "b", expires_in: 3600 }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;
    const next = await refreshIfNeeded(
      "airtable",
      { accessToken: "a", refreshToken: "r", expiresAt: Date.now() },
      fetcher,
    );
    expect(next).toMatchObject({
      refreshed: true,
      tokens: { accessToken: "b", refreshToken: "r" },
    });
    const refusing = (async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
      })) as unknown as typeof fetch;
    await expect(
      refreshIfNeeded(
        "airtable",
        { accessToken: "a", refreshToken: "r", expiresAt: Date.now() },
        refusing,
      ),
    ).rejects.toBeInstanceOf(TokenError);
  });

  it("classifies provider errors: auth stops, 429/5xx retry, other 4xx don't", async () => {
    const reply = (status: number) =>
      (async () =>
        new Response(JSON.stringify({ message: "nope" }), {
          status,
        })) as unknown as typeof fetch;
    const r401 = await providerCall(reply(401), "https://x", { token: "t" });
    expect(r401).toMatchObject({ ok: false, result: { retry: false, auth: true } });
    expect(await providerCall(reply(429), "https://x", { token: "t" })).toMatchObject({
      ok: false,
      result: { retry: true },
    });
    expect(await providerCall(reply(503), "https://x", { token: "t" })).toMatchObject({
      ok: false,
      result: { retry: true },
    });
    expect(await providerCall(reply(422), "https://x", { token: "t" })).toMatchObject({
      ok: false,
      result: { retry: false },
    });
    const ok = await providerCall(reply(200), "https://x", { token: "t" });
    expect(ok).toMatchObject({ ok: true, data: { message: "nope" } });
  });
});
