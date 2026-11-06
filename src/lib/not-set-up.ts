/**
 * One friendly voice for features this server hasn't switched on yet
 * (no email provider, AI key, Google app, captcha keys…). Creators see
 * this instead of a hidden section or a missing-key error: it never names
 * an environment variable, and it tells them there's nothing to fix.
 */

/** Short title, e.g. "Google Sheets is almost here" ("Apps are…"). */
export function notSetUpTitle(feature: string, plural = false): string {
  return `${feature} ${plural ? "are" : "is"} almost here`;
}

/** The longer note shown under the title. */
export const NOT_SET_UP_BODY =
  "We're putting the finishing touches on this one behind the scenes. It'll switch on right here as soon as it's ready, so there's nothing you need to do.";

/** One sentence for a toast or an action's error message. */
export function notSetUpMessage(feature: string): string {
  return `${feature} isn't switched on yet. We're putting the finishing touches on it, so hang tight!`;
}
