// ── Chat attachment size limits ──
//
// audit-2026-04-29 W2-V15. Lifted out of ChatComposer.tsx so the
// aggregate-budget check is pure-function testable. Two ceilings:
//
//   MAX_ATTACHMENT_SIZE       — per-file pre-encoding raw bytes.
//                               Mirrors what the user will see when
//                               picking a single file (the "too
//                               large" toast).
//
//   MAX_TOTAL_ATTACHMENT_SIZE — aggregate post-encoding size of
//                               all currently-staged data URL
//                               strings. Without this a user
//                               could drag N × MAX_ATTACHMENT_SIZE
//                               files; the V8 heap holds every
//                               base64-inflated data URL until
//                               submit, dragging the webview into
//                               GC thrash on as few as 4–5 large
//                               files. The cap is expressed in
//                               POST-encoding bytes because that's
//                               the actual heap footprint.

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024
export const MAX_TOTAL_ATTACHMENT_SIZE = 32 * 1024 * 1024

export interface AttachmentSizeEntry {
  url?: string
}

export function aggregateEncodedSize(entries: ReadonlyArray<AttachmentSizeEntry>): number {
  let sum = 0
  for (const a of entries) sum += a.url?.length ?? 0
  return sum
}

/**
 * True iff appending an attachment with the given encoded size
 * would exceed MAX_TOTAL_ATTACHMENT_SIZE. The caller passes the
 * NEW data URL's `.length`, NOT the raw file size — base64
 * inflates by ~4/3 and the inflated string is what occupies the
 * heap.
 */
export function wouldExceedAggregateLimit(
  current: ReadonlyArray<AttachmentSizeEntry>,
  newEncodedLength: number,
): boolean {
  return aggregateEncodedSize(current) + newEncodedLength > MAX_TOTAL_ATTACHMENT_SIZE
}
