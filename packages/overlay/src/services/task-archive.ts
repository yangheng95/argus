// ── Task Archive (export / import) ──
// Browser-side glue around the server's `GET /export/task/{id}/archive` and
// `POST /export/import` endpoints. Export streams the zip back as binary
// and triggers a browser download; import POSTs a user-selected zip and
// returns the new task id created on the server.

import { apiRequest, apiHeaders, apiUrl } from "./api";

export interface ImportTaskArchiveResult {
  taskID: string;
  importedFromTaskID?: string;
  restoredFiles: number;
  skippedFiles: string[];
  directory: string;
}

/**
 * Trigger a browser download of the task's archive. The server emits
 * `Content-Disposition: attachment; filename=...` so we only have to
 * stream the bytes into a Blob URL and click a transient anchor.
 *
 * Errors surface as thrown ApiError (re-using the api.ts pipeline);
 * callers wrap with try/catch + toast.
 */
export async function exportTaskArchive(input: {
  taskID: string;
  directory?: string;
}): Promise<{ filename: string; size: number }> {
  const { taskID, directory } = input;
  if (!taskID) throw new Error("exportTaskArchive: taskID required");

  // We can't use apiJson — it forces JSON parsing. apiRequest with
  // responseKind:"binary" gives us bytes + headers.
  const path = directory
    ? `export/task/${encodeURIComponent(taskID)}/archive?directory=${encodeURIComponent(directory)}`
    : `export/task/${encodeURIComponent(taskID)}/archive`;
  const res = await apiRequest<Uint8Array | ArrayBuffer | Blob>(path, {
    method: "GET",
    responseKind: "binary",
  });
  if (!res.ok) {
    // Body for binary errors will be empty — parse status into an Error.
    throw new Error(`Export failed (HTTP ${res.status})`);
  }

  const filename =
    parseAttachmentFilename(res.headers["content-disposition"] ?? "") ||
    `task-${taskID}.zip`;
  const blob = toBlob(res.body);
  triggerBrowserDownload(blob, filename);
  return { filename, size: blob.size };
}

/**
 * POST a user-selected zip file to `/export/import`. The caller must pass
 * the overwrite policy from the visible Overlay control; importing archives
 * has no hidden default at the product entry.
 */
export async function importTaskArchive(input: {
  file: File | Blob;
  directory: string;
  overwrite: boolean;
}): Promise<ImportTaskArchiveResult> {
  const { file, directory } = input;
  if (!directory) throw new Error("importTaskArchive: directory required");
  if (!file) throw new Error("importTaskArchive: file required");

  // The server reads the request body as raw zip bytes. Use the Blob/File
  // body directly so the browser can stream it instead of duplicating large
  // archives into an ArrayBuffer first.
  const overwrite = input.overwrite;
  const params = new URLSearchParams({ directory, overwrite: overwrite ? "true" : "false" });
  const url = apiUrl(`export/import?${params.toString()}`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...apiHeaders(),
      "content-type": "application/zip",
    },
    body: file,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { data?: { message?: string }; message?: string };
      detail = body?.data?.message || body?.message || "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`Import failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as ImportTaskArchiveResult;
}

// Parses RFC 5987 / 6266 Content-Disposition. We only need the basic
// `attachment; filename="…"` form the server emits — full RFC parsing
// would be overkill.
function parseAttachmentFilename(header: string): string | undefined {
  const match = header.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]!.trim());
  } catch {
    return match[1]!.trim();
  }
}

function toBlob(body: Uint8Array | ArrayBuffer | Blob | unknown): Blob {
  if (body instanceof Blob) return body;
  if (body instanceof Uint8Array) return new Blob([body], { type: "application/zip" });
  if (body instanceof ArrayBuffer) return new Blob([body], { type: "application/zip" });
  // Last-resort: stringify anything unexpected so the user at least gets
  // a downloadable file rather than a silent crash.
  return new Blob([String(body)], { type: "application/octet-stream" });
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  // Some browsers (and the Tauri webview) require the anchor to be in
  // the DOM before .click() honors the download attribute.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Defer revoke so the browser has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 4_000);
}
