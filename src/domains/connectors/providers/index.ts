import type { LinkProvider } from "../links";
import { airtable } from "./airtable";
import { mailchimp } from "./mailchimp";
import { notion } from "./notion";
import { pipedrive } from "./pipedrive";
import { salesforce } from "./salesforce";
import type { ProviderAdapter } from "./shared";
import { zoho } from "./zoho";

/** The server half of each business app (importing registers their
 * `sync_response` actions). */
export const ADAPTERS: Record<LinkProvider, ProviderAdapter> = {
  airtable,
  salesforce,
  notion,
  mailchimp,
  zoho_crm: zoho,
  pipedrive,
};
