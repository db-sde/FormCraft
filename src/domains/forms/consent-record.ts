import { createHash } from "node:crypto";
import { consentParts, type ConsentAnswer, type ConsentQuestion } from "./range-consent";

/**
 * The server's half of a consent answer (F-62). Node's crypto, so it
 * never goes into a browser bundle.
 */

/** Which notice an answer agreed to: a hash of exactly what was shown,
 * so changing a word gives a new version. Short enough to read. */
export function consentVersion(question: ConsentQuestion): string {
  const { content, acknowledgeLabel, optInLabel } = question.settings;
  return createHash("sha256")
    .update(JSON.stringify([content, acknowledgeLabel, optInLabel ?? ""]))
    .digest("hex")
    .slice(0, 16);
}

/** The server's record of a consent answer: only the two ticks are taken
 * from the browser; which notice and when are its own. */
export function normalizeConsent(
  question: ConsentQuestion,
  value: unknown,
  now: Date = new Date(),
): ConsentAnswer | unknown {
  const parts = consentParts(value);
  if (!parts || typeof parts.acknowledged !== "boolean") return value;
  return {
    acknowledged: parts.acknowledged,
    ...(question.settings.optInLabel ? { optIn: parts.optIn === true } : {}),
    version: consentVersion(question),
    ...(question.settings.versionLabel
      ? { versionLabel: question.settings.versionLabel }
      : {}),
    acceptedAt: now.toISOString(),
  };
}
