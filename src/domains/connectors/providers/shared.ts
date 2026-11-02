import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Choice, FieldInfo } from "../catalog";
import { providerCall, usableTokens, type Connection } from "../framework";

type Client = SupabaseClient<Database>;

/** What a provider's server half needs to talk to the app. */
export type ApiCtx = { admin: Client; connection: Connection; fetch: typeof fetch };

/** The server half of an app: what the settings pickers and the field
 * list read from it. Its sync is a registered `sync_response` action. */
export type ProviderAdapter = {
  choices(ctx: ApiCtx, source: string, parent?: string): Promise<Choice[]>;
  fields(ctx: ApiCtx, settings: Record<string, unknown>): Promise<FieldInfo[]>;
};

/** A refusal or failure while configuring, worded for the creator. */
export class AppError extends Error {}

/** A call made while configuring (pickers, fields): fresh tokens, and a
 * readable error instead of a job outcome. */
export async function configCall<T = unknown>(
  ctx: ApiCtx,
  url: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<T> {
  await usableTokens(ctx.admin, ctx.connection, ctx.fetch);
  const res = await providerCall(ctx.fetch, url, {
    ...init,
    token: ctx.connection.tokens.accessToken,
  });
  if (!res.ok) {
    const error = res.result.ok ? "failed" : res.result.error;
    throw new AppError(
      /HTTP 40[13]/.test(error)
        ? "The app refused access. Reconnect it, or check its permissions."
        : `The app said: ${error}`,
    );
  }
  return res.data as T;
}

export const byName = (a: Choice, b: Choice) => a.name.localeCompare(b.name);
