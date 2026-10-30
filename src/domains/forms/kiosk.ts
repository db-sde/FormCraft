import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { hashPassword, verifyPassword } from "./access";

type Client = SupabaseClient<Database>;

/**
 * Kiosk mode (master spec F-15): one device in a lobby or at an event,
 * one respondent after another. The kiosk link (`?kiosk=1`) only works
 * when the creator has turned kiosk mode on for the form.
 *
 * What it does: full screen after a tap; after each submit, the ending
 * for a few seconds and then a fresh, empty form; after a stretch with
 * no touches, "Still there?" and then the same reset. Nothing a
 * respondent typed is kept in the browser — no resume, no "welcome
 * back", no answers remembered from earlier visitors — so the next person
 * sees none of it. Unfinished answers are treated as on any device: kept
 * on the server only if the form saves unfinished responses.
 *
 * The exit PIN only guards leaving kiosk mode from the form itself. It
 * doesn't lock the device (a browser can't): use the tablet's own
 * guided-access or screen-pinning setting for that, as the settings say.
 */

export const KioskConfig = z.object({
  /** Seconds the ending shows before the form starts again. */
  resetSeconds: z.number().int().min(3).max(60).default(8),
  /** Seconds without a touch before "Still there?" appears. */
  idleSeconds: z.number().int().min(30).max(900).default(90),
});
export type KioskConfig = z.infer<typeof KioskConfig>;

export const KIOSK_PARAM = "kiosk";
export const KIOSK_PIN_PATTERN = /^\d{4,8}$/;

/** The stored setting, or null when kiosk mode is off (or malformed). */
export function readKioskConfig(raw: Json | null | undefined): KioskConfig | null {
  if (!raw) return null;
  const parsed = KioskConfig.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function getKioskPinHash(
  admin: Client,
  formId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("form_kiosk_secrets")
    .select("pin_hash")
    .eq("form_id", formId)
    .maybeSingle();
  if (error) throw error;
  return data?.pin_hash ?? null;
}

/** Sets or clears (null) the exit PIN. Service role, after the caller's
 * own permission check. */
export async function setKioskPin(admin: Client, formId: string, pin: string | null) {
  if (pin === null) {
    const { error } = await admin
      .from("form_kiosk_secrets")
      .delete()
      .eq("form_id", formId);
    if (error) throw error;
    return;
  }
  const { error } = await admin.from("form_kiosk_secrets").upsert({
    form_id: formId,
    pin_hash: await hashPassword(pin),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function checkKioskPin(
  admin: Client,
  formId: string,
  pin: string,
): Promise<boolean> {
  const hash = await getKioskPinHash(admin, formId);
  // No PIN set: leaving is allowed.
  return hash === null || verifyPassword(pin, hash);
}
