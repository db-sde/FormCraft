import { test, expect, type Request } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { createApiKey } from "@/domains/api/keys";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * The developer spec's six features, end to end (26 Nov 2026): archived
 * forms are gone (HTTP 410), the API on Free with its published limits,
 * link preview tags, the font library served by FormCraft, plan checks on
 * share images, and the public security and developer pages.
 */
const schema = (theme: Record<string, unknown> = {}) =>
  ({
    schemaVersion: 1,
    meta: { title: "Gap form", description: "A short form" },
    theme: { primaryColor: "#1f1f1f", backgroundColor: "#ffffff", ...theme },
    endings: [{ id: "end", title: "Thanks", isDefault: true }],
    questions: [
      {
        id: "q1",
        type: "short_text",
        order: 0,
        label: "What's your name?",
        required: false,
        settings: {},
      },
    ],
    logic: [],
  }) as unknown as FormSchemaV1;

async function workspaceOf(userId: string) {
  const { data } = await adminClient()
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId)
    .single();
  return data!.id;
}

test.describe("developer spec gap features", () => {
  test("an archived form is gone (410, noindex); the API restores it", async ({
    request,
  }) => {
    const user = await createConfirmedUser("e2e-archive");
    try {
      const { formId, liveLink } = await createPublishedForm(user, schema());
      const workspaceId = await workspaceOf(user.userId);
      const { key } = await createApiKey(adminClient(), {
        workspaceId,
        name: "Archive",
        createdBy: user.userId,
        scopes: ["forms:read", "forms:write"],
      });
      const auth = { Authorization: `Bearer ${key}` };

      const archived = await request.post(`/api/v1/forms/${formId}/archive`, {
        headers: auth,
      });
      expect(archived.status()).toBe(200);
      const page = await request.get(liveLink);
      expect(page.status()).toBe(410);
      expect(page.headers()["x-robots-tag"]).toContain("noindex");
      expect(await page.text()).toContain("This form is no longer available");

      const list = await request.get("/api/v1/forms?archived=true", { headers: auth });
      expect((await list.json()).forms).toEqual([
        expect.objectContaining({ id: formId, archived: true }),
      ]);
      expect(
        (await request.get("/api/v1/forms?archived=maybe", { headers: auth })).status(),
      ).toBe(400);

      const restored = await request.post(`/api/v1/forms/${formId}/restore`, {
        headers: auth,
      });
      expect(restored.status()).toBe(200);
      const { data: form } = await adminClient()
        .from("forms")
        .select("archived_at")
        .eq("id", formId)
        .single();
      expect(form!.archived_at).toBeNull();
      // Back in the lists, unpublished until published again (QA FC15-19).
      for (const filter of ["false", "all"]) {
        const back = await request.get(`/api/v1/forms?archived=${filter}`, {
          headers: auth,
        });
        expect((await back.json()).forms).toContainEqual(
          expect.objectContaining({ id: formId, archived: false, published: false }),
        );
      }
      const archivedNow = await request.get("/api/v1/forms?archived=true", {
        headers: auth,
      });
      expect((await archivedNow.json()).forms).toEqual([]);
    } finally {
      await deleteUser(user.userId);
    }
  });

  test("a key without forms:write can't archive", async ({ request }) => {
    const user = await createConfirmedUser("e2e-archive-ro");
    try {
      const { formId } = await createPublishedForm(user, schema());
      const { key } = await createApiKey(adminClient(), {
        workspaceId: await workspaceOf(user.userId),
        name: "Read only",
        createdBy: user.userId,
      });
      const res = await request.post(`/api/v1/forms/${formId}/archive`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      expect(res.status()).toBe(403);
    } finally {
      await deleteUser(user.userId);
    }
  });

  test("the API is on Free, with limit headers and a 429 that says when to retry", async ({
    request,
  }) => {
    const user = await createConfirmedUser("e2e-api-free");
    try {
      await createPublishedForm(user, schema());
      const workspaceId = await workspaceOf(user.userId);
      const { key } = await createApiKey(adminClient(), {
        workspaceId,
        name: "Free key",
        createdBy: user.userId,
      });
      const auth = { Authorization: `Bearer ${key}` };
      const first = await request.get("/api/v1/me", { headers: auth });
      expect(first.status()).toBe(200);
      expect(first.headers()["x-ratelimit-limit"]).toBe("60");
      expect(Number(first.headers()["x-ratelimit-remaining"])).toBeLessThanOrEqual(99);
      expect(first.headers()["x-ratelimit-daily-remaining"]).toBe("4999");

      // A tiny bucket, to see the refusal.
      await adminClient()
        .from("workspaces")
        .update({ entitlement_overrides: { api_burst: 1, api_requests_per_minute: 1 } })
        .eq("id", workspaceId);
      await adminClient().from("workspaces").select("id").eq("id", workspaceId);
      let limited = null;
      for (let i = 0; i < 4 && !limited; i += 1) {
        const res = await request.get("/api/v1/me", { headers: auth });
        if (res.status() === 429) limited = res;
      }
      expect(limited).not.toBeNull();
      expect(Number(limited!.headers()["retry-after"])).toBeGreaterThan(0);
      expect(await limited!.json()).toMatchObject({
        error: "rate_limited",
        scope: "minute",
        retry_after: expect.any(Number),
      });
    } finally {
      await deleteUser(user.userId);
    }
  });

  test("a form's link preview: title, canonical, noindex until indexing is on", async ({
    page,
  }) => {
    const user = await createConfirmedUser("e2e-seo");
    try {
      const { liveLink } = await createPublishedForm(user, schema());
      await page.goto(liveLink);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
        "content",
        "Gap form",
      );
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        /noindex/,
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        new RegExp(`${liveLink.replace(/^https?:\/\/[^/]+/, "")}$`),
      );
      await expect(page.locator('meta[property="og:url"]')).toHaveCount(1);
    } finally {
      await deleteUser(user.userId);
    }
  });

  test("library fonts come from FormCraft, never from Google", async ({ page }) => {
    const user = await createConfirmedUser("e2e-fonts");
    try {
      const { liveLink } = await createPublishedForm(
        user,
        schema({
          fontFamily: "library",
          libraryFont: "Fraunces",
          headingFont: "Playfair Display",
          headingWeight: 700,
        }),
      );
      const requests: string[] = [];
      page.on("request", (r: Request) => requests.push(r.url()));
      await page.goto(liveLink);
      await expect(page.getByText("What's your name?")).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(requests.some((u) => u.includes("/fonts/css?family=Fraunces"))).toBe(true);
      expect(
        requests.some((u) => u.includes("/fonts/css?family=Playfair%20Display")),
      ).toBe(true);
      expect(requests.filter((u) => /fonts\.(googleapis|gstatic)\.com/.test(u))).toEqual(
        [],
      );
      // Within the budget: two families, at most four font files.
      expect(
        requests.filter((u) => u.includes("/fonts/file/")).length,
      ).toBeLessThanOrEqual(4);
    } finally {
      await deleteUser(user.userId);
    }
  });

  test("a Free workspace can't upload a share image", async ({ page }) => {
    const user = await createConfirmedUser("e2e-seo-free");
    try {
      const { formId } = await createPublishedForm(user, schema());
      await loginViaUI(page, user.email, user.password);
      const res = await page.request.post(`/api/forms/${formId}/seo-asset`, {
        multipart: {
          kind: "image",
          file: { name: "a.png", mimeType: "image/png", buffer: Buffer.from("x") },
        },
      });
      expect(res.status()).toBe(403);
      expect(await res.json()).toMatchObject({ code: "plan_required" });
    } finally {
      await deleteUser(user.userId);
    }
  });

  test("billing webhooks refuse anything unsigned", async ({ request }) => {
    for (const path of ["/api/billing/stripe", "/api/billing/razorpay"]) {
      const res = await request.post(path, {
        data: { type: "customer.subscription.updated" },
      });
      expect([400, 404]).toContain(res.status());
    }
  });

  test("security and developer pages use the approved wording and the limits table", async ({
    page,
  }) => {
    await page.goto("/security");
    await expect(
      page.getByText("Hosted on SOC 2 audited infrastructure (Vercel, Supabase)").first(),
    ).toBeVisible();
    await expect(page.getByText(/FormCraft is SOC ?2 compliant/i)).toHaveCount(0);
    await page.goto("/developers");
    await expect(page.getByRole("table")).toContainText("5,000");
    await expect(page.getByRole("table")).toContainText("No daily cap (fair use)");
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: "API limits" })).toBeVisible();
  });
});
