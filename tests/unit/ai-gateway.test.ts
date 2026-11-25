// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, relative } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testAiSession } from "../ai-session";

vi.mock("server-only", () => ({}));

/**
 * Super Admin Phase 3 (docs/super-admin-design.md §3.10): every model call
 * goes through domains/ai/gateway.ts, which applies the database's
 * settings and records cost. These checks fail the build if code calls a
 * model, or spends AI credits, any other way.
 */
const root = process.cwd();
const GATEWAY = "src/domains/ai/gateway.ts";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

const migration = readFileSync(
  join(root, "supabase/migrations/00000000000073_ai_gateway.sql"),
  "utf8",
);

describe("one gateway for every AI call", () => {
  const files = sourceFiles(join(root, "src")).map((path) => ({
    path: relative(root, path),
    text: readFileSync(path, "utf8"),
  }));

  it("only the gateway constructs a client or sends a message", () => {
    const offenders = files
      .filter((f) => f.path !== GATEWAY)
      .filter((f) =>
        /new\s+Anthropic\s*\(|\.messages\.(create|stream|batches)|\.beta\.messages\b|countTokens\s*\(/.test(
          f.text,
        ),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("only the database's gateway check spends AI credits", () => {
    const offenders = files
      .filter(
        (f) =>
          /["']ai_credits["']/.test(f.text) && /spend_usage|increment_usage/.test(f.text),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("the feature list matches the database's", async () => {
    const { AI_FEATURES } = await import("@/domains/ai/gateway");
    const seeded = migration
      .match(/insert into private\.ai_settings \(feature\) values([\s\S]*?);/)![1]
      .match(/'([a-z_]+)'/g)!
      .map((s) => s.slice(1, -1));
    expect([...seeded].sort()).toEqual([...AI_FEATURES].sort());
  });

  it("the allowed models match the database's, and each has a price", async () => {
    const { ALLOWED_MODELS } = await import("@/domains/ai/gateway");
    const allowed = Object.keys(ALLOWED_MODELS).sort();
    const lists = [...migration.matchAll(/model\S* (?:not )?in \(('claude[^)]*)\)/g)].map(
      (m) =>
        m[1]
          .split(",")
          .map((s) => s.trim().slice(1, -1))
          .sort(),
    );
    expect(lists.length).toBeGreaterThanOrEqual(2);
    for (const list of lists) expect(list).toEqual(allowed);
    for (const model of allowed) expect(migration).toContain(`('${model}', '2026-01-01'`);
  });
});

describe("usageAttempts", () => {
  it("prices a refused attempt and its fallback separately", async () => {
    const { usageAttempts } = await import("@/domains/ai/gateway");
    const message = {
      model: "claude-opus-4-8",
      usage: {
        input_tokens: 900,
        output_tokens: 200,
        iterations: [
          {
            type: "message",
            model: null,
            input_tokens: 1000,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          {
            type: "fallback_message",
            model: "claude-opus-4-8",
            input_tokens: 900,
            output_tokens: 200,
            cache_read_input_tokens: 50,
            cache_creation_input_tokens: 0,
          },
        ],
      },
    };
    expect(usageAttempts(message as never, "claude-opus-5-5")).toEqual([
      {
        model: "claude-opus-5-5",
        input_tokens: 1000,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      {
        model: "claude-opus-4-8",
        input_tokens: 900,
        output_tokens: 200,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 0,
      },
    ]);
  });

  it("uses the top-level usage when there are no iterations", async () => {
    const { usageAttempts } = await import("@/domains/ai/gateway");
    const message = {
      model: "claude-sonnet-5-5",
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null },
    };
    expect(usageAttempts(message as never, "claude-sonnet-5-5")).toEqual([
      {
        model: "claude-sonnet-5-5",
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    ]);
  });
});

describe("a session's calls", () => {
  let server: Server;
  let bodies: Record<string, unknown>[] = [];
  let status = 200;
  const env = { ...process.env };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw);
        bodies.push(body);
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        if (status !== 200) {
          res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error" } }));
          return;
        }
        res.end(
          JSON.stringify({
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: body.model,
            content: [{ type: "text", text: "{}" }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 7, output_tokens: 3 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  afterAll(async () => {
    process.env = env;
    await new Promise((resolve) => server.close(resolve));
  });
  beforeEach(() => {
    bodies = [];
    status = 200;
  });

  const ask = { max_tokens: 16000, messages: [{ role: "user" as const, content: "hi" }] };

  it("uses the database's model, with the server-side fallback, and records the cost", async () => {
    const { ai, recorded } = await testAiSession("form_edit", "claude-sonnet-5-5");
    await ai.create(ask);
    expect(bodies[0]).toMatchObject({ model: "claude-sonnet-5-5", fallbacks: "default" });
    expect(recorded).toEqual([
      expect.objectContaining({
        p_feature: "form_edit",
        p_requested_model: "claude-sonnet-5-5",
        p_outcome: "ok",
        p_attempts: [expect.objectContaining({ input_tokens: 7, output_tokens: 3 })],
      }),
    ]);
  });

  it("calls Haiku without a fallback (it has none)", async () => {
    const { ai } = await testAiSession("follow_up", "claude-haiku-5-5");
    await ai.create(ask);
    expect(bodies[0].model).toBe("claude-haiku-5-5");
    expect(bodies[0]).not.toHaveProperty("fallbacks");
  });

  it("records a failed call, then lets the error through", async () => {
    status = 400;
    const { ai, recorded } = await testAiSession("form_review");
    await expect(ai.create(ask)).rejects.toThrow();
    expect(recorded[0]).toMatchObject({ p_outcome: "error", p_attempts: [] });
  });
});
