import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotSetUpYet } from "@/components/not-set-up-yet";
import { NOT_SET_UP_BODY, notSetUpMessage, notSetUpTitle } from "@/lib/not-set-up";

/**
 * Features this server hasn't switched on yet get one friendly note
 * instead of a hidden section or a missing-key error.
 */
describe("the not-set-up-yet message", () => {
  it("is friendly and never names a server setting", () => {
    for (const text of [
      notSetUpTitle("Google Sheets"),
      NOT_SET_UP_BODY,
      notSetUpMessage("AI"),
    ]) {
      expect(text).not.toMatch(/[A-Z]+_[A-Z_]+|\.env|server/);
    }
    expect(notSetUpTitle("Google Sheets")).toBe("Google Sheets is almost here");
    expect(notSetUpTitle("Apps", true)).toBe("Apps are almost here");
    expect(notSetUpMessage("AI")).toMatch(/^AI isn't switched on yet\./);
  });

  it("renders the feature, the note and what still works", () => {
    const html = renderToStaticMarkup(
      <NotSetUpYet feature="Google Calendar">Bookings still work.</NotSetUpYet>,
    );
    expect(html).toContain('role="note"');
    expect(html).toContain("Google Calendar is almost here");
    expect(html).toContain("finishing touches");
    expect(html).toContain("Bookings still work.");
  });
});

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("customer-facing text", () => {
  it("doesn't tell creators about environment variables", () => {
    // A server-setting name inside a string, outside process.env reads
    // and comments, is something a creator would see.
    const leaks = ["src/app", "src/components"].flatMap(files).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .map((line) => line.replace(/process\.env\.[A-Z0-9_]+/g, ""))
        .filter((line) =>
          /[A-Z]+_(API_KEY|SECRET_KEY|SITE_KEY|CLIENT_ID|CLIENT_SECRET|API_TOKEN)|\.env\.example/.test(
            line,
          ),
        )
        .map((line) => `${file}: ${line.trim()}`),
    );
    expect(leaks).toEqual([]);
  });
});
