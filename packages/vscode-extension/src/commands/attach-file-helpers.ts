import * as path from "node:path"

/**
 * Pure helpers extracted from attach-file.ts so they remain
 * unit-testable without needing the `vscode` module (which is only
 * available at extension-host runtime).
 */

/** Maximum byte length for an attachment — mirrors the overlay's
 *  services/chat.ts MAX_ATTACHMENT_SIZE (4 MiB). */
export const MAX_ATTACH_BYTES = 4 * 1024 * 1024

export function guessMime(filename: string, languageId: string): string {
  const ext = path.extname(filename).toLowerCase()
  // The command reads VS Code text documents, so unlisted source files
  // are represented as text/plain. Binary attachments must be added
  // through an explicit binary-capable path, not inferred here.
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".gif") return "image/gif"
  if (ext === ".webp") return "image/webp"
  if (ext === ".svg") return "image/svg+xml"
  if (ext === ".pdf") return "application/pdf"
  if (ext === ".json" || languageId === "json") return "application/json"
  if (ext === ".html" || ext === ".htm") return "text/html"
  if (ext === ".css") return "text/css"
  if (ext === ".md" || ext === ".markdown") return "text/markdown"
  return "text/plain"
}
