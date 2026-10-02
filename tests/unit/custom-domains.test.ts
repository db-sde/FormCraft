// @vitest-environment node
import { describe, expect, it } from "vitest";
import { dnsInstructions, normalizeHostname } from "@/domains/domains";

describe("normalizeHostname (P2.2)", () => {
  it("cleans up what people paste", () => {
    expect(normalizeHostname("https://Forms.Example.com/apply?x=1")).toBe(
      "forms.example.com",
    );
    expect(normalizeHostname("forms.example.com.")).toBe("forms.example.com");
    expect(normalizeHostname(" apply.example.co.uk:443 ")).toBe("apply.example.co.uk");
  });

  it("refuses things that can't be a customer's domain", () => {
    for (const bad of [
      "example",
      "localhost",
      "acme.localhost",
      "printer.local",
      "10.0.0.1",
      "-bad.example.com",
      "under_score.example.com",
      `${"a".repeat(64)}.example.com`,
    ]) {
      expect(() => normalizeHostname(bad), bad).toThrow();
    }
  });
});

describe("dnsInstructions", () => {
  it("asks for a TXT challenge with the token and a CNAME", () => {
    const records = dnsInstructions({
      hostname: "forms.example.com",
      verificationToken: "ab12",
    });
    expect(records.txt).toEqual({
      name: "_formcraft-challenge.forms.example.com",
      value: "formcraft-verify=ab12",
    });
    expect(records.cname.name).toBe("forms.example.com");
  });
});
