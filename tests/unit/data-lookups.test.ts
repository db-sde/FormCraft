// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseFormSchema } from "@/domains/forms/schema";
import {
  buildLookupUrl,
  extractPath,
  LookupError,
  validateLookupUrl,
} from "@/domains/integrations/lookups";

/** Data lookups (logic spec phase 24): the parts that decide where an
 * outbound request goes and what comes back from it. */
const schema = parseFormSchema({
  schemaVersion: 1,
  meta: { title: "Lookup" },
  theme: {},
  endings: [{ id: "end", title: "Done", isDefault: true }],
  questions: [
    { id: "mail", type: "email", order: 0, label: "Email", settings: {} },
    {
      id: "who",
      type: "contact_info",
      order: 1,
      label: "You",
      settings: { fields: ["name", "company"], requiredFields: [] },
    },
  ],
  logic: [],
});

describe("where a lookup may go", () => {
  it("accepts a public HTTPS URL with answers in the path or query", async () => {
    await expect(
      validateLookupUrl(
        "https://api.example.com/v1/people/{{answer:mail}}?co={{answer:who.company}}",
      ),
    ).resolves.toBe("api.example.com");
  });

  it("refuses answers in the address, plain HTTP, private networks and URL credentials", async () => {
    const refuse = async (url: string) => {
      await expect(validateLookupUrl(url)).rejects.toBeInstanceOf(LookupError);
    };
    await refuse("https://{{answer:mail}}/v1");
    await refuse("https://{{answer:mail}}.example.com/v1");
    await refuse("https://api.example.com:{{answer:mail}}/v1");
    await refuse("https://api.example.com{{answer:mail}}");
    await refuse("http://api.example.com/v1");
    await refuse("https://10.0.0.5/v1");
    await refuse("https://169.254.169.254/latest/meta-data");
    await refuse("https://service.internal/v1");
    await refuse("https://user:secret@api.example.com/v1");
    await refuse("not a url");
  });
});

describe("the URL that's called", () => {
  const url = (template: string, answers: Record<string, unknown>) =>
    buildLookupUrl(template, schema, answers).toString();

  it("inserts answers percent-encoded", () => {
    expect(
      url("https://api.example.com/people/{{answer:mail}}?co={{ answer:who.company }}", {
        mail: "ada+test@example.com",
        who: { name: "Ada", company: "Analytical Engines & Co" },
      }),
    ).toBe(
      "https://api.example.com/people/ada%2Btest%40example.com?co=Analytical%20Engines%20%26%20Co",
    );
  });

  it("can't be steered to another path, query or host by an answer", () => {
    const hostile = [
      "../../admin",
      "x?role=admin&y=",
      "x#frag",
      "@evil.example/",
      "//evil.example/",
      "x\r\nHost: evil.example",
      "%2e%2e%2fadmin",
    ];
    for (const value of hostile) {
      const built = buildLookupUrl(
        "https://api.example.com/people/{{answer:mail}}/profile?src=form",
        schema,
        { mail: value },
      );
      expect(built.host).toBe("api.example.com");
      expect(built.pathname.startsWith("/people/")).toBe(true);
      expect(built.pathname.endsWith("/profile")).toBe(true);
      expect(built.pathname.split("/")).toHaveLength(4);
      expect(built.search).toBe("?src=form");
      expect(built.hash).toBe("");
    }
  });

  it("uses an empty value for a missing answer or unknown question", () => {
    expect(url("https://api.example.com/p?e={{answer:mail}}&x={{answer:nope}}", {})).toBe(
      "https://api.example.com/p?e=&x=",
    );
  });

  it("limits how much of an answer is sent", () => {
    const built = buildLookupUrl("https://api.example.com/p?e={{answer:mail}}", schema, {
      mail: "a".repeat(5000),
    });
    expect(built.searchParams.get("e")).toHaveLength(500);
  });
});

describe("reading the reply", () => {
  const reply = {
    company: {
      name: "Analytical Engines",
      employees: 250,
      public: false,
      tags: ["a", "b"],
    },
    results: [{ id: 7 }, { id: 8 }],
    nothing: null,
  };

  it("follows dots and indexes to text, numbers and booleans", () => {
    expect(extractPath(reply, "company.name")).toBe("Analytical Engines");
    expect(extractPath(reply, "company.employees")).toBe("250");
    expect(extractPath(reply, "company.public")).toBe("false");
    expect(extractPath(reply, "results[1].id")).toBe("8");
    expect(extractPath(reply, "$.company.tags[0]")).toBe("a");
  });

  it("returns nothing for objects, lists, nulls and missing paths", () => {
    expect(extractPath(reply, "company")).toBeNull();
    expect(extractPath(reply, "company.tags")).toBeNull();
    expect(extractPath(reply, "nothing")).toBeNull();
    expect(extractPath(reply, "company.missing.deeper")).toBeNull();
    expect(extractPath(reply, "results[9].id")).toBeNull();
    expect(extractPath("just text", "length")).toBeNull();
  });

  it("doesn't reach into prototypes, and keeps values short", () => {
    expect(extractPath(reply, "__proto__.constructor.name")).toBeNull();
    expect(extractPath(reply, "company.constructor.name")).toBeNull();
    expect(extractPath(reply, "results.length")).toBeNull();
    expect(extractPath({ long: "x".repeat(2000) }, "long")).toHaveLength(500);
  });
});
