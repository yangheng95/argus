// ── composer.attach payload validator ──
//
// audit-2026-04-29 W2-G7. Receiver-side validator for host-driven
// composer.attach ui-commands. Lifted out of composer-attach.ts so
// the test suite can exercise it without booting solid-js's reactive
// store layer (which composer-attach.ts pulls in transitively).
//
// Defends against:
//  - non-data/blob dataUrl schemes (e.g. javascript:, https://evil)
//    — CSP blocks the obvious surfaces today, but hardening here is
//    independent of CSP coverage drift.
//  - control chars / BiDi overrides in filename — would flow into
//    the chat-attachments strip and the outgoing message text,
//    enabling spoofing and breaking sanitisation.
//  - non-integer / negative / non-finite selection fields — would
//    crash row-render code that does selection.startLine.toString().
//  - mime that doesn't match `type/subtype` — would slip into the
//    `mime.startsWith("image/")` branch with surprising values.

export interface ComposerAttachPayload {
  filename: string
  mime: string
  dataUrl: string
  sourcePath: string
  selection?: {
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
  }
}

const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/
// \x00-\x1f: C0 controls (NUL, newlines, etc).
// \x7f:      DEL.
// U+202A-U+202E + U+2066-U+2069: BiDi overrides used for filename
// spoofing (e.g. "rtfo[U+202E]gpj.exe" rendered as "rtfoexe.gpj").
const FILENAME_BAD_CHAR_RE = /[\x00-\x1f\x7f‪-‮⁦-⁩]/u

function isFiniteNonNegativeInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0
}

function isValidSelection(sel: unknown): sel is ComposerAttachPayload["selection"] {
  if (!sel || typeof sel !== "object") return false
  const s = sel as Record<string, unknown>
  return (
    isFiniteNonNegativeInt(s.startLine) &&
    isFiniteNonNegativeInt(s.startColumn) &&
    isFiniteNonNegativeInt(s.endLine) &&
    isFiniteNonNegativeInt(s.endColumn)
  )
}

export function isComposerAttachPayload(x: unknown): x is ComposerAttachPayload {
  if (!x || typeof x !== "object") return false
  const o = x as Record<string, unknown>
  if (
    typeof o.filename !== "string" ||
    typeof o.mime !== "string" ||
    typeof o.dataUrl !== "string" ||
    typeof o.sourcePath !== "string"
  )
    return false
  if (o.filename.length === 0 || FILENAME_BAD_CHAR_RE.test(o.filename)) return false
  if (!MIME_RE.test(o.mime)) return false
  if (!o.dataUrl.startsWith("data:") && !o.dataUrl.startsWith("blob:")) return false
  if (o.selection !== undefined && !isValidSelection(o.selection)) return false
  return true
}
