import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { HANDLER_ROUTES, PAGE_ROUTES } from "../e2e/routes";

const APP_DIR = join(__dirname, "..", "..", "src", "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** src/app/(group)/forms/[id]/page.tsx → /forms/[id] */
function toRoute(file: string): string {
  const parts = relative(APP_DIR, file)
    .split(sep)
    .slice(0, -1)
    .filter((p) => !(p.startsWith("(") && p.endsWith(")")));
  return `/${parts.join("/")}`;
}

describe("route registry (tests/e2e/routes.ts)", () => {
  const files = walk(APP_DIR);

  it("lists every page, and only real pages", () => {
    const pages = files.filter((f) => f.endsWith(`${sep}page.tsx`)).map(toRoute);
    expect([...pages].sort()).toEqual([...PAGE_ROUTES].sort());
  });

  it("lists every route handler, and only real ones", () => {
    const handlers = files.filter((f) => f.endsWith(`${sep}route.ts`)).map(toRoute);
    expect([...handlers].sort()).toEqual(Object.keys(HANDLER_ROUTES).sort());
  });
});
