/**
 * One plain voice for features this site hasn't switched on (no email
 * provider, AI key, Google app, captcha keys…). Creators see this
 * instead of a hidden section, a missing-key error or a Connect button
 * that can't work. It never names an environment variable, never
 * promises a date (roadmap v3.1 §J: nothing looks ready unless it is),
 * and tells them there's nothing in their form to fix.
 */

/** Short title, e.g. "Google Sheets isn't set up on this site yet". */
export function notSetUpTitle(feature: string, plural = false): string {
  return `${feature} ${plural ? "aren't" : "isn't"} set up on this site yet`;
}

/** The longer note shown under the title. */
export const NOT_SET_UP_BODY =
  "It needs an account with the provider that this site hasn't added yet, so it can't be used here for now. It'll appear here once it's set up; there's nothing you need to change in your form.";

/** One sentence for a toast or an action's error message. */
export function notSetUpMessage(feature: string): string {
  return `${feature} isn't set up on this site yet, so it can't be used for now.`;
}
