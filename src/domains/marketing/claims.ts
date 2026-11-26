/**
 * The approved SOC 2 wording (developer spec, 26 Nov 2026, item 6).
 * FormCraft runs on SOC 2 audited infrastructure; FormCraft itself has not
 * been audited, so every claim names the providers. Use these exactly;
 * `npm run check:claims` fails the build on the banned phrasings.
 */
export const SOC2_SHORT = "Hosted on SOC 2 audited infrastructure (Vercel, Supabase)";

export const SOC2_LONG =
  "FormCraft runs on Vercel and Supabase, which both hold SOC 2 Type 2 attestations for their infrastructure. FormCraft's own controls are described on this page; FormCraft has not completed its own SOC 2 audit.";

/** Phrasings that must never appear in the site, the app or emails. */
export const BANNED_CLAIMS: RegExp[] = [
  /SOC\s?2\s+compliant/i,
  /SOC\s?2\s+certified/i,
  /SOC\s?2\s+certification/i,
  /our\s+SOC\s?2\s+report/i,
];

/** The banned phrasings in a piece of text, line by line (the approved
 * long wording is allowed). */
export function bannedClaimsIn(text: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.includes(SOC2_LONG)) return;
    if (BANNED_CLAIMS.some((re) => re.test(line)))
      found.push({ line: i + 1, text: line.trim() });
  });
  return found;
}
