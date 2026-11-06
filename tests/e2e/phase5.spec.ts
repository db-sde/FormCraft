import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import type { Json } from "@/lib/supabase/database.types";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * Master spec Phase 5 through the running app: a respondent books a time
 * in a form, the slot disappears for the next person, the creator sees
 * it on Bookings, and connecting a calendar without server credentials
 * explains itself.
 */
async function bookingType(userId: string) {
  const admin = adminClient();
  const { data: ws } = await admin
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId)
    .single();
  const { data: type } = await admin
    .from("booking_types")
    .insert({
      workspace_id: ws!.id,
      name: "Intro call",
      duration_minutes: 30,
      min_notice_minutes: 0,
      max_days_ahead: 14,
      time_zone: "UTC",
      // Every day, all day: there's always a slot in the next week.
      weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        day,
        start: "00:00",
        end: "24:00",
      })) as unknown as Json,
    })
    .select("id")
    .single();
  await admin
    .from("booking_hosts")
    .insert({ booking_type_id: type!.id, user_id: userId });
  return type!.id;
}

function schema(typeId: string): FormSchemaV1 {
  return {
    schemaVersion: 1,
    meta: { title: "Book a call" },
    theme: {
      primaryColor: "#1d4ed8",
      backgroundColor: "#ffffff",
      fontFamily: "inter",
      buttonStyle: "rounded",
    },
    endings: [{ id: "end", title: "See you then", isDefault: true }],
    logic: [],
    questions: [
      {
        id: "q_email",
        type: "email",
        order: 0,
        label: "Your email",
        required: true,
        settings: {},
      },
      {
        id: "q_time",
        type: "booking",
        order: 1,
        label: "Pick a time",
        required: true,
        settings: { bookingTypeId: typeId, emailQuestionId: "q_email" },
      },
    ],
  };
}

test.describe("phase 5", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-phase5");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("book a time in a form; it's gone for the next person; the creator sees it", async ({
    page,
    browser,
  }) => {
    // A first form makes the user's workspace.
    const warmup = schema("00000000-0000-4000-8000-000000000000");
    await createPublishedForm(user, {
      ...warmup,
      questions: warmup.questions.slice(0, 1),
    });
    const typeId = await bookingType(user.userId);
    const { formId, liveLink: link } = await createPublishedForm(user, schema(typeId));

    await page.goto(link);
    await page.getByRole("textbox").fill("ada@example.com");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Times are in your time zone/)).toBeVisible();
    const first = page.locator("section[aria-label] button").first();
    await expect(first).toBeVisible({ timeout: 10000 });
    const label = await first.textContent();
    await first.click();
    await expect(page.getByText(/^Chosen:/)).toBeVisible();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("heading", { name: "See you then" })).toBeVisible();

    const admin = adminClient();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("bookings")
          .select("status, attendee_email")
          .eq("form_id", formId);
        return data;
      })
      .toEqual([{ status: "confirmed", attendee_email: "ada@example.com" }]);

    // The next visitor isn't offered that time on that day.
    const other = await browser.newContext();
    const p2 = await other.newPage();
    await p2.goto(link);
    await p2.getByRole("textbox").fill("bo@example.com");
    await p2.keyboard.press("Enter");
    const firstDay = p2.locator("section[aria-label]").first();
    await expect(firstDay.locator("button").first()).toBeVisible({ timeout: 10000 });
    expect(await firstDay.locator("button").first().textContent()).not.toBe(label);
    await other.close();

    // The creator sees it on Bookings.
    await loginViaUI(page, user.email, user.password);
    await page.goto("/bookings");
    await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
    await expect(page.getByText(/Intro call · ada@example.com/)).toBeVisible();
  });

  test("a submit caught by the spam trap books nothing", async ({ page }) => {
    const warmup = schema("00000000-0000-4000-8000-000000000000");
    await createPublishedForm(user, {
      ...warmup,
      questions: warmup.questions.slice(0, 1),
    });
    const typeId = await bookingType(user.userId);
    const { formId, liveLink: link } = await createPublishedForm(user, schema(typeId));
    await page.goto(link);
    await page.getByRole("textbox").fill("bot@example.com");
    await page.keyboard.press("Enter");
    const first = page.locator("section[aria-label] button").first();
    await expect(first).toBeVisible({ timeout: 10000 });
    await first.click();
    // What a bot does: fill the field people never see.
    await page.evaluate(() => {
      const trap = document.querySelector<HTMLInputElement>('input[name="zq7_hp"]');
      if (trap) trap.value = "https://spam.example";
    });
    await page.getByRole("button", { name: "Submit" }).click();
    // Kept quietly (the bot sees the ending), but nothing is booked.
    await expect(page.getByRole("heading", { name: "See you then" })).toBeVisible();
    const admin = adminClient();
    const { data: response } = await admin
      .from("responses")
      .select("status, spam_suspected")
      .eq("form_id", formId)
      .single();
    expect(response).toEqual({ status: "completed", spam_suspected: true });
    const { data: bookings } = await admin
      .from("bookings")
      .select("id")
      .eq("form_id", formId);
    expect(bookings).toEqual([]);
  });

  test("the attendee's link cancels the booking", async ({ page }) => {
    const warmup = schema("00000000-0000-4000-8000-000000000000");
    await createPublishedForm(user, {
      ...warmup,
      questions: warmup.questions.slice(0, 1),
    });
    const typeId = await bookingType(user.userId);
    const token = "t".repeat(43);
    const startsAt = new Date(Date.now() + 3 * 86_400_000);
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
    const { data: booking } = await adminClient()
      .from("bookings")
      .insert({
        booking_type_id: typeId,
        host_id: user.userId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        blocked: `[${startsAt.toISOString()},${endsAt.toISOString()})`,
        status: "confirmed",
        manage_token_hash: createHash("sha256").update(token).digest("hex"),
      })
      .select("id")
      .single();
    await page.goto(`/booking/${token}`);
    await expect(page.getByRole("heading", { name: "Intro call" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel booking" }).click();
    await expect(page.getByText("This booking is cancelled.")).toBeVisible();
    const { data } = await adminClient()
      .from("bookings")
      .select("status, cancelled_by")
      .eq("id", booking!.id)
      .single();
    expect(data).toEqual({ status: "cancelled", cancelled_by: "attendee" });
  });

  test("connecting a calendar without server credentials explains itself", async ({
    page,
  }) => {
    await loginViaUI(page, user.email, user.password);
    const res = await page.request.get(
      "/api/connectors/google_calendar/authorize?returnTo=/bookings",
      { maxRedirects: 0 },
    );
    expect(res.status()).toBe(307);
    expect(res.headers().location).toContain("/bookings?connect_error=not_configured");
    const back = await page.request.get(
      "/api/connectors/oauth/callback?state=forged&code=x",
      {
        maxRedirects: 0,
      },
    );
    expect(back.headers().location).toContain("connect_error=expired");
    const slots = await page.request.get(
      `/api/bookings/slots?response=${crypto.randomUUID()}&question=q&from=2026-11-03`,
    );
    expect(slots.status()).toBe(404);
    const manage = await page.request.post("/api/bookings/manage", {
      data: { action: "cancel", token: "x".repeat(43) },
    });
    expect(manage.status()).toBe(404);
  });
});
