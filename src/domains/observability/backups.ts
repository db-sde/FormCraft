/**
 * Backup status from Supabase's Management API (Super Admin ADM-077). Needs
 * a fine-grained access token that can only read backups
 * (SUPABASE_MANAGEMENT_TOKEN, "backups_read") and the project ref
 * (SUPABASE_PROJECT_REF). Server-side only; the token never reaches a
 * browser or the database.
 */
export type BackupStatus =
  | { configured: false }
  | { configured: true; ok: false; error: string }
  | {
      configured: true;
      ok: true;
      pitrEnabled: boolean;
      latestBackupAt: string | null;
      backups: number;
      /** No backup in the last 26 hours and no point-in-time recovery. */
      stale: boolean;
    };

const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

export async function getBackupStatus(
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<BackupStatus> {
  const token = process.env.SUPABASE_MANAGEMENT_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref || !/^[a-z0-9]{20}$/.test(ref)) return { configured: false };
  try {
    const res = await fetcher(
      `https://api.supabase.com/v1/projects/${ref}/database/backups`,
      {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok)
      return { configured: true, ok: false, error: `Supabase answered ${res.status}` };
    const data = (await res.json()) as {
      pitr_enabled?: boolean;
      backups?: { inserted_at?: string; status?: string }[];
    };
    const done = (data.backups ?? []).filter(
      (b) => (b.status ?? "COMPLETED") === "COMPLETED",
    );
    const latest =
      done
        .map((b) => b.inserted_at)
        .filter((t): t is string => typeof t === "string" && !Number.isNaN(Date.parse(t)))
        .sort()
        .at(-1) ?? null;
    const pitrEnabled = data.pitr_enabled === true;
    return {
      configured: true,
      ok: true,
      pitrEnabled,
      latestBackupAt: latest,
      backups: done.length,
      stale:
        !pitrEnabled &&
        (latest === null || now.getTime() - Date.parse(latest) > STALE_AFTER_MS),
    };
  } catch {
    return { configured: true, ok: false, error: "Couldn't reach Supabase" };
  }
}
