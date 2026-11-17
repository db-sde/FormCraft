import { GoogleDriveSettings } from "../catalog";
import { providerCall, registerAction, type ActionResult } from "../framework";
import { loadSync, mappingProblem } from "../links";
import { configCall, type ProviderAdapter } from "./shared";

/**
 * Google Drive (F-50): a response's uploaded files copied into a Drive
 * folder. Uses the narrowest scope there is (drive.file): FormCraft only
 * ever sees the folders and files it made itself, never the rest of the
 * creator's Drive. So the destination is a folder FormCraft creates (or
 * one it made for another form), found again by a private tag
 * (appProperties) rather than by name.
 *
 * Every file is tagged with its upload's id: a retry after a timeout
 * finds it and doesn't upload it twice. Files are private unless the
 * creator shares the folder. A failed copy is retried with backoff and
 * never touches the response itself. Deleting a response in FormCraft
 * doesn't delete its copies in Drive: they belong to the Drive's owner
 * (DECISIONS.md).
 */

const api = () => process.env.GOOGLE_DRIVE_API_BASE ?? "https://www.googleapis.com";
const FOLDER = "application/vnd.google-apps.folder";
/** The choice that makes (or finds) a folder just for this form. */
export const NEW_FOLDER = "new";

type DriveFile = { id: string; name: string };

/** Characters Drive and every desktop sync client accept in a name. */
export function safeDriveName(raw: string, max = 180): string {
  const cleaned = raw
    // Control characters, and the ones Windows/macOS sync refuses.
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "");
  return (cleaned || "file").slice(0, max);
}

/** A Drive query string literal. */
const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

async function findByTag(
  fetcher: typeof fetch,
  token: string,
  key: string,
  value: string,
  extra: string,
): Promise<DriveFile | null | ActionResult> {
  const query = `appProperties has { key=${q(key)} and value=${q(value)} } and trashed=false${extra ? ` and ${extra}` : ""}`;
  const res = await providerCall(
    fetcher,
    `${api()}/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1&spaces=drive`,
    { token },
  );
  if (!res.ok) return res.result;
  return ((res.data as { files?: DriveFile[] }).files ?? [])[0] ?? null;
}

const isResult = (v: unknown): v is ActionResult =>
  !!v && typeof v === "object" && "ok" in (v as object);

async function folderFor(
  fetcher: typeof fetch,
  token: string,
  tag: { key: string; value: string },
  name: string,
  parent?: string,
): Promise<string | ActionResult> {
  const found = await findByTag(
    fetcher,
    token,
    tag.key,
    tag.value,
    `mimeType=${q(FOLDER)}${parent ? ` and ${q(parent)} in parents` : ""}`,
  );
  if (isResult(found)) return found;
  if (found) return found.id;
  const res = await providerCall(fetcher, `${api()}/drive/v3/files?fields=id`, {
    token,
    method: "POST",
    body: JSON.stringify({
      name: safeDriveName(name),
      mimeType: FOLDER,
      ...(parent ? { parents: [parent] } : {}),
      appProperties: { [tag.key]: tag.value },
    }),
  });
  if (!res.ok) return res.result;
  return (res.data as { id: string }).id;
}

/** One file, in two requests (Drive's resumable upload: no 5 MB cap). */
async function upload(
  fetcher: typeof fetch,
  token: string,
  file: {
    name: string;
    mimeType: string;
    parent: string;
    bytes: Uint8Array;
    tags: Record<string, string>;
    description: string;
  },
): Promise<ActionResult | null> {
  let session: string | null = null;
  try {
    const res = await fetcher(
      `${api()}/upload/drive/v3/files?uploadType=resumable&fields=id`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-type": file.mimeType,
          "x-upload-content-length": String(file.bytes.byteLength),
        },
        body: JSON.stringify({
          name: file.name,
          parents: [file.parent],
          appProperties: file.tags,
          description: file.description,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    void res.body?.cancel();
    if (!res.ok) {
      return {
        ok: false,
        retry: res.status === 429 || res.status >= 500,
        error: `HTTP ${res.status} starting the upload of ${file.name}`,
        auth: res.status === 401,
      };
    }
    session = res.headers.get("location");
  } catch (error) {
    return { ok: false, retry: true, error: `Network: ${(error as Error).message}` };
  }
  if (!session) return { ok: false, retry: true, error: "Drive didn't start the upload" };
  try {
    const put = await fetcher(session, {
      method: "PUT",
      headers: { "content-type": file.mimeType },
      body: file.bytes as BodyInit,
      signal: AbortSignal.timeout(60_000),
    });
    void put.body?.cancel();
    if (put.ok) return null;
    return {
      ok: false,
      retry: put.status === 429 || put.status >= 500,
      error: `HTTP ${put.status} uploading ${file.name}`,
      auth: put.status === 401,
    };
  } catch (error) {
    return { ok: false, retry: true, error: `Network: ${(error as Error).message}` };
  }
}

export const googleDrive: ProviderAdapter = {
  async choices(ctx, source) {
    if (source !== "folders") return [];
    // Only folders FormCraft made: drive.file sees nothing else.
    const query = `mimeType=${q(FOLDER)} and trashed=false and appProperties has { key='fc_kind' and value='form_folder' }`;
    const data = await configCall<{ files?: DriveFile[] }>(
      ctx,
      `${api()}/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=100&orderBy=name`,
    );
    return [
      { id: NEW_FOLDER, name: "A new folder for this form" },
      ...(data.files ?? []).map((f) => ({ id: f.id, name: f.name })),
    ];
  },
  // Files have no fields to map.
  async fields() {
    return [];
  },
};

registerAction(
  "google_drive",
  "sync_response",
  async (job, { admin, connection, fetch }) => {
    const loaded = await loadSync(admin, job);
    if (!loaded.ok) return loaded.result;
    const { link, response } = loaded.input;
    const settings = GoogleDriveSettings.safeParse(link.settings);
    if (!settings.success) return mappingProblem("Choose a Drive folder");
    const token = connection.tokens.accessToken;

    // The response's files, in the order of the questions they answer.
    const order = new Map(response.path.map((q, i) => [q.id, i]));
    const files = [...response.uploads.entries()]
      .filter(([, u]) => response.answers[u.questionId] !== undefined)
      .sort(
        ([, a], [, b]) => (order.get(a.questionId) ?? 0) - (order.get(b.questionId) ?? 0),
      );
    if (files.length === 0) return { ok: true, skipped: "No files in this response" };

    // The form's folder: the chosen one, or one made for this form (found
    // again by its tag, so two jobs at once still make only one).
    let folder: string | ActionResult;
    if (settings.data.folderId === NEW_FOLDER) {
      folder = await folderFor(
        fetch,
        token,
        { key: "fc_form", value: response.form.id },
        `FormCraft · ${response.form.title}`,
      );
      if (typeof folder === "string") {
        // Tagged as a form folder, so other forms can choose it too.
        await providerCall(fetch, `${api()}/drive/v3/files/${folder}?fields=id`, {
          token,
          method: "PATCH",
          body: JSON.stringify({ appProperties: { fc_kind: "form_folder" } }),
        });
      }
    } else {
      folder = settings.data.folderId;
    }
    if (isResult(folder)) return folder;

    if (settings.data.perResponseFolder) {
      const when = (response.completedAt ?? new Date().toISOString()).slice(0, 10);
      folder = await folderFor(
        fetch,
        token,
        { key: "fc_response", value: response.id },
        `${when} · response ${response.id.slice(0, 8)}`,
        folder,
      );
      if (isResult(folder)) return folder;
    }

    const { data: rows } = await admin
      .from("uploads")
      .select("id, mime_type")
      .in(
        "id",
        files.map(([id]) => id),
      );
    const types = new Map((rows ?? []).map((r) => [r.id, r.mime_type]));
    let copied = 0;
    let already = 0;
    for (const [uploadId, info] of files) {
      const existing = await findByTag(fetch, token, "fc_upload", uploadId, "");
      if (isResult(existing)) return existing;
      if (existing) {
        already += 1;
        continue;
      }
      const { data: blob, error } = await admin.storage
        .from("response-uploads")
        .download(info.storagePath);
      if (error || !blob) {
        return {
          ok: false,
          retry: true,
          error: `Couldn't read ${info.name} from storage`,
        };
      }
      const question = response.schema.questions.find((q) => q.id === info.questionId);
      const failed = await upload(fetch, token, {
        name: safeDriveName(
          `${question?.label ? `${question.label.slice(0, 60)} - ` : ""}${info.name}`,
        ),
        mimeType: types.get(uploadId) ?? "application/octet-stream",
        parent: folder,
        bytes: new Uint8Array(await blob.arrayBuffer()),
        tags: {
          fc_upload: uploadId,
          fc_response: response.id,
          fc_form: response.form.id,
        },
        description: `From “${response.form.title}”, response ${response.id}${question ? `, question “${question.label.slice(0, 200)}”` : ""}.`,
      });
      if (failed) return failed;
      copied += 1;
    }
    return { ok: true, result: { folderId: folder, copied, alreadyThere: already } };
  },
);
