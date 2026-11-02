import { z } from "zod";

/**
 * The business apps a form can send responses to (master spec Phase 6),
 * as the Integrations page shows them: what each needs to know (its
 * settings) and how they're picked. Safe to import in the browser; the
 * server-side halves are in ./providers.
 */

export type Choice = { id: string; name: string };

/** A destination field, as the app describes it. Unsupported ones (a
 * formula, an attachment, a link to another record…) are listed so the
 * creator sees why they can't be filled. */
export type FieldInfo = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  supported: boolean;
  /** Extra traits a setting can filter on ("externalId"). */
  tags?: string[];
};

export function fieldMatches(field: FieldInfo, types: string[] | undefined): boolean {
  return (
    !types ||
    types.includes(field.type) ||
    (field.tags ?? []).some((t) => types.includes(t))
  );
}

export type SettingSpec = { key: string; label: string; help?: string } & (
  | {
      kind: "choice";
      /** What to load from the app (bases, tables, databases…). */
      source: string;
      /** A setting this one depends on (a base's tables). */
      parent?: string;
    }
  | { kind: "static"; options: Choice[] }
  /** A field of the destination, limited to these types. */
  | { kind: "field"; types?: string[]; optional?: boolean }
  /** A question of the form, of these types. */
  | { kind: "question"; types: string[]; optional?: boolean }
  /** Any mapping source (an email answer). */
  | { kind: "source" }
  | { kind: "switch" }
  | { kind: "tags" }
);

const id = z.string().trim().min(1).max(200);
const optionalId = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => v || undefined);

export const AirtableSettings = z.object({
  baseId: id,
  tableId: id,
  /** The field that holds the response ID: records are upserted on it,
   * so a retry updates the same record. */
  matchField: id,
});

export const SalesforceSettings = z.object({
  object: z.enum(["Lead", "Contact"]),
  dedupe: z.enum(["email", "external_id"]),
  /** With external_id: a field marked External ID holding the response ID. */
  externalIdField: optionalId,
  /** Leads: run the org's lead assignment rules (routing). */
  assignmentRules: z.boolean().default(false),
});

export const NotionSettings = z.object({
  databaseId: id,
  /** A text property holding the response ID: the page is found by it
   * before one is created. */
  idProperty: id,
});

export const MailchimpSettings = z.object({
  audienceId: id,
  /** Where the email address comes from (a mapping source). */
  emailSource: id,
  /** A yes/no question respondents must answer yes to be added. */
  consentQuestionId: optionalId,
  /** New contacts confirm by email before they're subscribed. */
  doubleOptIn: z.boolean().default(true),
  tags: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
});

export const ZohoSettings = z.object({
  module: z.enum(["Leads", "Contacts"]),
});

export const PipedriveSettings = z.object({
  /** person: create or update a person; lead: that, plus a lead for them. */
  target: z.enum(["person", "lead"]),
});

export const SETTINGS_SCHEMAS = {
  airtable: AirtableSettings,
  salesforce: SalesforceSettings,
  notion: NotionSettings,
  mailchimp: MailchimpSettings,
  zoho_crm: ZohoSettings,
  pipedrive: PipedriveSettings,
} as const;

export type AppInfo = {
  provider: keyof typeof SETTINGS_SCHEMAS;
  label: string;
  description: string;
  /** What a synced response becomes there. */
  noun: string;
  settings: SettingSpec[];
  /** The settings the field list depends on. */
  fieldsNeed: string[];
  /** Where duplicates are matched, for the panel's explanation. */
  dedupe: string;
};

export const APPS: AppInfo[] = [
  {
    provider: "airtable",
    label: "Airtable",
    description: "Add a record to an Airtable table for each response.",
    noun: "record",
    settings: [
      { key: "baseId", label: "Base", kind: "choice", source: "bases" },
      {
        key: "tableId",
        label: "Table",
        kind: "choice",
        source: "tables",
        parent: "baseId",
      },
      {
        key: "matchField",
        label: "Response ID field",
        kind: "field",
        types: ["singleLineText"],
        help: "A text field that holds each response's ID, so a retry updates the same record.",
      },
    ],
    fieldsNeed: ["baseId", "tableId"],
    dedupe: "Records are matched on the response ID field.",
  },
  {
    provider: "salesforce",
    label: "Salesforce",
    description: "Create or update a lead or contact for each response.",
    noun: "lead or contact",
    settings: [
      {
        key: "object",
        label: "Create",
        kind: "static",
        options: [
          { id: "Lead", name: "Leads" },
          { id: "Contact", name: "Contacts" },
        ],
      },
      {
        key: "dedupe",
        label: "Match existing by",
        kind: "static",
        options: [
          { id: "email", name: "Email" },
          { id: "external_id", name: "An External ID field (the response ID)" },
        ],
      },
      {
        key: "externalIdField",
        label: "External ID field",
        kind: "field",
        types: ["externalId"],
        optional: true,
        help: "Only when matching by External ID.",
      },
      {
        key: "assignmentRules",
        label: "Run lead assignment rules",
        kind: "switch",
        help: "Leads go to the owner your Salesforce rules pick.",
      },
    ],
    fieldsNeed: ["object"],
    dedupe:
      "Existing records are matched by email (or your External ID field) and updated.",
  },
  {
    provider: "notion",
    label: "Notion",
    description: "Add a page to a Notion database for each response.",
    noun: "page",
    settings: [
      { key: "databaseId", label: "Database", kind: "choice", source: "databases" },
      {
        key: "idProperty",
        label: "Response ID property",
        kind: "field",
        types: ["rich_text"],
        help: "A text property that holds each response's ID, so a retry updates the same page.",
      },
    ],
    fieldsNeed: ["databaseId"],
    dedupe: "Pages are matched on the response ID property.",
  },
  {
    provider: "mailchimp",
    label: "Mailchimp",
    description: "Add respondents to a Mailchimp audience, with tags.",
    noun: "contact",
    settings: [
      { key: "audienceId", label: "Audience", kind: "choice", source: "audiences" },
      { key: "emailSource", label: "Email address", kind: "source" },
      {
        key: "consentQuestionId",
        label: "Only with consent from",
        kind: "question",
        types: ["yes_no"],
        optional: true,
        help: "A yes/no question; only people who answer yes are added.",
      },
      {
        key: "doubleOptIn",
        label: "Ask new contacts to confirm by email",
        kind: "switch",
        help: "Double opt-in: they're subscribed once they confirm.",
      },
      { key: "tags", label: "Tags", kind: "tags" },
    ],
    fieldsNeed: ["audienceId"],
    dedupe:
      "Contacts are matched by email and updated; people who unsubscribed stay unsubscribed.",
  },
  {
    provider: "zoho_crm",
    label: "Zoho CRM",
    description: "Create or update a lead or contact for each response.",
    noun: "lead or contact",
    settings: [
      {
        key: "module",
        label: "Create",
        kind: "static",
        options: [
          { id: "Leads", name: "Leads" },
          { id: "Contacts", name: "Contacts" },
        ],
      },
    ],
    fieldsNeed: ["module"],
    dedupe: "Existing records are matched by email and updated.",
  },
  {
    provider: "pipedrive",
    label: "Pipedrive",
    description: "Create or update a person, and optionally a lead, for each response.",
    noun: "person",
    settings: [
      {
        key: "target",
        label: "Create",
        kind: "static",
        options: [
          { id: "person", name: "A person" },
          { id: "lead", name: "A person and a lead" },
        ],
      },
    ],
    fieldsNeed: ["target"],
    dedupe: "People are matched by email and updated; a response makes at most one lead.",
  },
];

export function appInfo(provider: string): AppInfo | null {
  return APPS.find((a) => a.provider === provider) ?? null;
}

/** Whether a connector job can be sent again by hand: failed or given
 * up, or an app sync skipped because the app wasn't connected. */
export function isReplayable(job: {
  status: string;
  action: string;
  last_error: string | null;
}): boolean {
  if (job.status === "failed" || job.status === "exhausted") return true;
  return (
    job.status === "skipped" &&
    job.action === "sync_response" &&
    /disconnected|reconnect/i.test(job.last_error ?? "")
  );
}
