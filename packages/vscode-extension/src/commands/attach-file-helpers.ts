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
  // The set covered here is intentionally narrow — files outside it
  // fall back to `text/plain` because the server-side renderer treats
  // `text/*` as raw text and gives back a sensible diff. We pick mimes
  // the overlay's existing chat-attachments rendering already knows
  // about.
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
