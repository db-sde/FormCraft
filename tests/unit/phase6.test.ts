import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  applyMapping,
  emailFrom,
  resolveSource,
  sourceOptions,
  type MappingContext,
} from "@/domains/connectors/mapping";
import {
  APPS,
  fieldMatches,
  isReplayable,
  MailchimpSettings,
  SETTINGS_SCHEMAS,
} from "@/domains/connectors/catalog";
import { LINK_PROVIDERS, asBoolean, asList, asNumber } from "@/domains/connectors/links";
import { describeError } from "@/domains/connectors/framework";
import { airtableValue } from "@/domains/connectors/providers/airtable";
import { notionValue } from "@/domains/connectors/providers/notion";
import {
  instanceBase,
  salesforceFields,
  salesforceValue,
  soqlString,
} from "@/domains/connectors/providers/salesforce";
import { memberId } from "@/domains/connectors/providers/mailchimp";
import { zohoBase, zohoValue } from "@/domains/connectors/providers/zoho";
import {
  leadTitle,
  pipedriveBase,
  pipedriveValue,
} from "@/domains/connectors/providers/pipedrive";
import type { Connection } from "@/domains/connectors/framework";

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Leads" },
  theme: {
    primaryColor: "#000000",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  logic: [],
  variables: [{ id: "v1", name: "score", type: "number", initial: 0 }],
  hiddenFields: [{ name: "utm_source" }],
  questions: [
    {
      id: "q_contact",
      type: "contact_info",
      order: 0,
      label: "You",
      required: true,
      settings: { fields: ["name", "email"] },
    },
    {
      id: "q_tools",
      type: "multi_select",
      order: 1,
      label: "Tools",
      required: false,
      settings: {
        options: [
          { id: "o1", label: "Slack" },
          { id: "o2", label: "Notion" },
        ],
      },
    },
    {
      id: "q_n",
      type: "number",
      order: 2,
      label: "Seats",
      required: false,
      settings: {},
    },
    {
      id: "q_yes",
      type: "yes_no",
      order: 3,
      label: "News?",
      required: false,
      settings: {},
    },
    {
      id: "q_file",
      type: "file_upload",
      order: 4,
      label: "CV",
      required: false,
      settings: {},
    },
  ],
} as unknown as FormSchemaV1;

const ctx: MappingContext = {
  id: "11111111-2222-4333-8444-555555555555",
  completedAt: "2026-11-02T10:00:00.000Z",
  form: { id: "f1", title: "Leads", workspaceId: "w1" },
  schema,
  answers: {
    q_contact: { name: " Ada Lovelace ", email: "Ada@Example.com" },
    q_tools: ["o1", "o2"],
    q_n: 12,
    q_yes: false,
    q_file: ["upload-1"],
  },
  hidden: { utm_source: "ads" },
  variables: { v1: 7 },
};

describe("mapping (spec §5.3)", () => {
  it("reads answers, their parts, results, URL fields, metadata and fixed text", () => {
    expect(resolveSource(ctx, "answer:q_contact.name")).toBe("Ada Lovelace");
    expect(resolveSource(ctx, "answer:q_tools")).toBe("Slack; Notion");
    expect(resolveSource(ctx, "answer:q_n")).toBe(12);
    expect(resolveSource(ctx, "answer:q_yes")).toBe(false);
    expect(resolveSource(ctx, "variable:score")).toBe(7);
    expect(resolveSource(ctx, "hidden:utm_source")).toBe("ads");
    expect(resolveSource(ctx, "meta:response_id")).toBe(ctx.id);
    expect(resolveSource(ctx, "meta:form_title")).toBe("Leads");
    expect(resolveSource(ctx, "text:Website: form")).toBe("Website: form");
    expect(resolveSource(ctx, "answer:missing")).toBeNull();
    expect(resolveSource(ctx, "bogus:x")).toBeNull();
  });

  it("never sends uploads, skips answers off the path, and leaves out empty values", () => {
    expect(resolveSource(ctx, "answer:q_file")).toBeNull();
    expect(
      resolveSource({ ...ctx, path: [{ id: "q_contact" }] }, "answer:q_n"),
    ).toBeNull();
    expect(
      applyMapping(ctx, [
        { field: "Name", source: "answer:q_contact.name" },
        { field: "Phone", source: "answer:q_contact.phone" },
        { field: "News", source: "answer:q_yes" },
      ]),
    ).toEqual({ Name: "Ada Lovelace", News: false });
    expect(emailFrom(ctx, "answer:q_contact.email")).toBe("ada@example.com");
    expect(emailFrom(ctx, "answer:q_contact.name")).toBeNull();
  });

  it("offers the form's answers, parts, results and metadata, but not uploads", () => {
    const values = sourceOptions(schema).map((o) => o.value);
    expect(values).toEqual(
      expect.arrayContaining([
        "answer:q_contact.name",
        "answer:q_contact.email",
        "answer:q_tools",
        "variable:score",
        "hidden:utm_source",
        "meta:response_id",
      ]),
    );
    expect(values).not.toContain("answer:q_contact.phone");
    expect(values.some((v) => v.startsWith("answer:q_file"))).toBe(false);
  });

  it("reads loose values the way apps want them", () => {
    expect(asNumber("12.5")).toBe(12.5);
    expect(asNumber("twelve")).toBeNull();
    expect(asBoolean("Yes")).toBe(true);
    expect(asBoolean("maybe")).toBeNull();
    expect(asList("Slack, Inc; Notion")).toEqual(["Slack, Inc", "Notion"]);
  });
});

describe("the app catalog", () => {
  it("covers every app the database accepts, each with settings", () => {
    const sql = readFileSync(
      "supabase/migrations/00000000000051_connector_links.sql",
      "utf8",
    );
    for (const p of LINK_PROVIDERS) {
      expect(sql).toContain(`'${p}'`);
      expect(SETTINGS_SCHEMAS[p]).toBeDefined();
      expect(APPS.find((a) => a.provider === p)).toBeDefined();
    }
  });

  it("defaults Mailchimp to double opt-in", () => {
    expect(
      MailchimpSettings.parse({ audienceId: "a", emailSource: "answer:q" }),
    ).toMatchObject({ doubleOptIn: true, tags: [] });
  });

  it("filters fields by type or trait, and knows what can be sent again", () => {
    const f = {
      key: "X__c",
      label: "X",
      type: "string",
      required: false,
      supported: true,
    };
    expect(fieldMatches({ ...f, tags: ["externalId"] }, ["externalId"])).toBe(true);
    expect(fieldMatches(f, ["externalId"])).toBe(false);
    expect(
      isReplayable({ status: "exhausted", action: "create_event", last_error: "x" }),
    ).toBe(true);
    expect(
      isReplayable({
        status: "skipped",
        action: "sync_response",
        last_error: "Disconnected",
      }),
    ).toBe(true);
    expect(
      isReplayable({
        status: "skipped",
        action: "sync_response",
        last_error: "No marketing consent",
      }),
    ).toBe(false);
  });

  it("words each provider's errors with the field they're about", () => {
    expect(
      describeError([{ message: "Required fields are missing", fields: ["Company"] }]),
    ).toBe("Required fields are missing (Company)");
    expect(
      describeError({
        data: [
          { message: "required field not found", details: { api_name: "Last_Name" } },
        ],
      }),
    ).toBe("required field not found (Last_Name)");
    expect(describeError({ error: { type: "INVALID", message: "Unknown field" } })).toBe(
      "Unknown field",
    );
    expect(describeError({ title: "Invalid Resource", detail: "Bad email" })).toBe(
      "Bad email",
    );
  });
});

describe("app values", () => {
  it("Airtable (F-33): numbers, checkboxes, multi-selects and dates", () => {
    expect(airtableValue("number", "42")).toEqual({ ok: true, value: 42 });
    expect(airtableValue("number", "lots")).toMatchObject({ ok: false });
    expect(airtableValue("checkbox", true)).toEqual({ ok: true, value: true });
    expect(airtableValue("multipleSelects", "A; B")).toEqual({
      ok: true,
      value: ["A", "B"],
    });
    expect(airtableValue("date", "2026-11-02T10:00:00Z")).toEqual({
      ok: true,
      value: "2026-11-02",
    });
  });

  it("Notion (F-36): property shapes, option names without commas, unsupported types", () => {
    expect(notionValue("title", "Ada")).toEqual({
      ok: true,
      value: { title: [{ type: "text", text: { content: "Ada" } }] },
    });
    expect(notionValue("select", "Big, small")).toEqual({
      ok: true,
      value: { select: { name: "Big  small" } },
    });
    expect(notionValue("multi_select", "A; B")).toEqual({
      ok: true,
      value: { multi_select: [{ name: "A" }, { name: "B" }] },
    });
    expect(notionValue("people", "x")).toMatchObject({ ok: false });
  });

  it("Salesforce (F-34): required and unsupported fields, values, safe queries", () => {
    const fields = salesforceFields([
      {
        name: "LastName",
        label: "Last Name",
        type: "string",
        createable: true,
        updateable: true,
        nillable: false,
        defaultedOnCreate: false,
        externalId: false,
      },
      {
        name: "OwnerId",
        label: "Owner",
        type: "reference",
        createable: true,
        updateable: true,
        nillable: false,
        defaultedOnCreate: true,
        externalId: false,
      },
      {
        name: "Ref__c",
        label: "Ref",
        type: "string",
        createable: true,
        updateable: true,
        nillable: true,
        defaultedOnCreate: false,
        externalId: true,
      },
    ]);
    expect(fields.map((f) => [f.key, f.required, f.supported, f.tags])).toEqual([
      ["LastName", true, true, undefined],
      ["OwnerId", false, false, undefined],
      ["Ref__c", false, true, ["externalId"]],
    ]);
    expect(salesforceValue("multipicklist", "A; B")).toBe("A;B");
    expect(salesforceValue("boolean", "yes")).toBe(true);
    expect(soqlString("o'brien\\")).toBe("'o\\'brien\\\\'");
    const conn = (extra: Record<string, string>) =>
      ({ tokens: { accessToken: "t", extra } }) as unknown as Connection;
    expect(instanceBase(conn({ instance_url: "https://acme.my.salesforce.com/x" }))).toBe(
      "https://acme.my.salesforce.com",
    );
    expect(instanceBase(conn({ instance_url: "http://acme.example" }))).toBeNull();
  });

  it("Mailchimp (F-38): the member id is the md5 of the lowercased email", () => {
    expect(memberId(" Ada@Example.com ")).toBe(memberId("ada@example.com"));
    expect(memberId("ada@example.com")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("Zoho and Pipedrive (F-40): their own domains only, and values", () => {
    const conn = (extra: Record<string, string>) =>
      ({ tokens: { accessToken: "t", extra } }) as unknown as Connection;
    expect(zohoBase(conn({ api_domain: "https://www.zohoapis.eu" }))).toBe(
      "https://www.zohoapis.eu/crm/v6",
    );
    expect(zohoBase(conn({ api_domain: "https://evil.example" }))).toBeNull();
    expect(pipedriveBase(conn({ api_domain: "https://acme.pipedrive.com" }))).toBe(
      "https://acme.pipedrive.com/api/v1",
    );
    expect(
      pipedriveBase(conn({ api_domain: "https://pipedrive.com.evil.example" })),
    ).toBeNull();
    expect(zohoValue("multiselectpicklist", "A; B")).toEqual(["A", "B"]);
    const size = {
      key: "abc",
      name: "Size",
      field_type: "enum",
      options: [
        { id: 1, label: "Small" },
        { id: 2, label: "Large" },
      ],
    };
    expect(pipedriveValue(size, "Large")).toBe(2);
    expect(pipedriveValue(size, "Huge")).toBeNull();
    expect(pipedriveValue({ ...size, field_type: "set" }, "Small; Large")).toBe("1,2");
    expect(leadTitle("Contact us", ctx.id)).toBe("Contact us · 11111111");
  });
});
