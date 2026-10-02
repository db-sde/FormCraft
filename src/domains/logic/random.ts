import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

/**
 * Deterministic randomness for a response (logic spec phase 19). One
 * seed per response — made in the respondent's browser, stored on the
 * response — so the same seed always gives the same pool picks and
 * option order, in the browser and in the server's walk. Not a security
 * control: a respondent who picked their own seed could only choose
 * among questions the creator put in the pool.
 */

export const SEED_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function newSeed(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/** 32-bit FNV-1a of a string. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small, fast, well-distributed PRNG. */
function generator(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a seeded generator; the input isn't changed. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const next = generator(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Questions a pool leaves out for this seed. Each pool is drawn on its
 * own (seed + pool id), so editing one pool doesn't reshuffle another. */
export function questionsLeftOut(
  schema: Pick<FormSchemaV1, "pools" | "questions">,
  seed: string,
): Set<string> {
  const out = new Set<string>();
  const existing = new Set(schema.questions.map((q) => q.id));
  for (const pool of schema.pools ?? []) {
    const members = pool.questionIds.filter((id) => existing.has(id));
    const picked = new Set(
      seededShuffle(members, `${seed}:${pool.id}`).slice(0, pool.pick),
    );
    for (const id of members) if (!picked.has(id)) out.add(id);
  }
  return out;
}
