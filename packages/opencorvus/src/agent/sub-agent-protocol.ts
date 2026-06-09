/**
 * Sub-agent return protocol.
 *
 * Architecture in one sentence: a sub-agent runs in its own session with
 * its own prompt cache; when it finishes it yields a short structured
 * conclusion back to its caller and its working context is no longer
 * referenced. The caller never sees the sub-agent's transcript, only
 * the conclusion plus pointers to persistent artifacts (DB rows, file
 * paths, deeper-scope tools) where the full work product can be
 * fetched on demand.
 *
 * Practically, this means:
 *
 *   1. Sub-agent INTERNAL session: independent. Its cache, its tool
 *      results, its message history live in its own session row. Once
 *      the sub-agent returns, that session is no longer reused as a
 *      prompt prefix anywhere — the cache budget it consumed is paid
 *      once and discarded.
 *
 *   2. Sub-agent → parent boundary: ONE structured yield. The caller
 *      embeds it in its own conversation as a tool result. The
 *      protocol below provides the canonical shape so callers always
 *      see the same fields and pointers, and authors aren't tempted to
 *      stuff the sub-agent's transcript into the return value.
 *
 *   3. Parent context (orchestrator): persistent across the task
 *      lifecycle. The sequence of sub-agent yields it absorbs is what
 *      its prompt cache covers. Each yield is small by construction
 *      (it's a conclusion, not a transcript), so this works.
 *
 * The protocol is a vocabulary for writing the boundary correctly. It
 * is NOT a runtime policeman — there is no "force-trim if it overflows".
 * If a sub-agent author yields raw transcripts instead of using
 * `yieldResult()`, the bug surfaces in benchmark and code review, not
 * in a silent truncation. That's deliberate: a hard guard would let
 * authors write sloppy returns and assume the guard catches them; the
 * absence of one keeps the responsibility with the author.
 *
 * The cap constants (`HARD_TOKEN_CAP` etc.) are *defaults* used by the
 * helpers when a caller doesn't supply specific limits, plus a target
 * the helpers' default budgets aim to hit. They are not enforced.
 */

export namespace SubAgentProtocol {
  /**
   * Default per-yield budget. ~5K tokens at the conventional 4-char/token
   * estimate. This is the size a well-formed yield should naturally land
   * around: enough room for a structured ack with ~20 list items and
   * paragraph-scale summary text. Helpers' default trim widths are
   * derived from this constant so tuning the architecture-wide budget
   * is a single edit.
   */
  export const HARD_TOKEN_CAP = 5_000
  /** Conservative chars/token approximation; intentionally generous so the
   * char-budget under-counts the token-budget rather than over-counting. */
  export const CHARS_PER_TOKEN = 4
  export const HARD_CHAR_CAP = HARD_TOKEN_CAP * CHARS_PER_TOKEN // 20_000
  /** Default tail bytes reserved for the pointer marker on truncation. */
  export const POINTER_RESERVE = 250
  /** Default body chars helpers aim for after reserving the marker. */
  export const SAFE_BODY_CAP = HARD_CHAR_CAP - POINTER_RESERVE
  /** Headline hard cap. Headlines are status-line text — anything longer is a
   * smell; keep a real ceiling so no caller can sneak a transcript into the
   * headline slot. */
  export const HEADLINE_CAP = 500

  /** Exact marker appended by `trimText` when it truncates. Having the caller
   * account for marker bytes (rather than guessing "~60 chars") is how the
   * yieldResult budget loop below stays honest: we subtract this when sizing
   * a slice so the final line length actually fits in `remaining`. */
  export function truncationMarker(omitted: number, pointer: string): string {
    return `… [+${omitted} chars truncated; full content at ${pointer}]`
  }

  /**
   * Trim a single text body. `pointer` is the human-readable handle the
   * caller can use to fetch the full content (DB row id, file path,
   * "use read_context with scope=X", etc.). Returns the input unchanged
   * if it already fits.
   *
   * `cap` is the target total output length (slice + marker). Callers that
   * pass a pathologically small cap get an empty-ish slice plus the marker
   * — the marker always renders so readers can see truncation happened.
   */
  export function trimText(text: string, pointer: string, cap: number = SAFE_BODY_CAP): string {
    if (text.length <= cap) return text
    // Pick a slice length that leaves room for the marker. For any reasonable
    // cap this is a no-op adjustment; for tiny caps it keeps the output from
    // exceeding `cap` by the full marker width.
    const probeOmitted = text.length - cap
    const markerLen = truncationMarker(probeOmitted, pointer).length
    const sliceLen = Math.max(0, cap - markerLen)
    const omitted = text.length - sliceLen
    return `${text.slice(0, sliceLen)}${truncationMarker(omitted, pointer)}`
  }

  /**
   * Render a string list with both per-item and list-length defaults. The
   * "+N more" tail preserves the count of dropped items and points at
   * the artifact for full enumeration.
   */
  export function trimList(
    items: string[],
    pointer: string,
    opts: { itemCap?: number; listCap?: number; joiner?: string } = {},
  ): string {
    const itemCap = opts.itemCap ?? 200
    const listCap = opts.listCap ?? 20
    const joiner = opts.joiner ?? ", "
    const shown = items.slice(0, listCap).map((s) => (s.length > itemCap ? s.slice(0, itemCap) + "…" : s))
    const more = items.length > listCap ? ` (+${items.length - listCap} more at ${pointer})` : ""
    return shown.join(joiner) + more
  }

  /**
   * Compose a sub-agent yield using the canonical layout:
   *
   *   <headline>
   *   - summary: <trimmed>
   *   - <field>: <trimmed text or list>
   *   - …
   *   [+N chars truncated; full content at <pointer>]
   *
   * Each section is trimmed against a default budget so well-formed
   * inputs yield well-formed outputs. There is no force-trim at the
   * end — a yield that genuinely needs more room (rare, smell-worthy)
   * exceeds the soft target and gets logged for follow-up via
   * `report()`, not silently capped.
   */
  export function yieldResult(input: {
    headline: string
    summary?: string
    fields?: Array<[string, string | string[]]>
    pointer: string
  }): string {
    const lines: string[] = []
    // Headline is status-line text; cap it so a careless caller can't stuff a
    // transcript into the one field yieldResult never trimmed before.
    lines.push(trimText(input.headline, input.pointer, HEADLINE_CAP))

    if (input.summary && input.summary.trim()) {
      // Reserve roughly half the body budget for free-form summary text so
      // structured fields below still have room.
      const SUMMARY_CAP = Math.floor(SAFE_BODY_CAP / 2)
      lines.push(`- summary: ${trimText(input.summary, input.pointer, SUMMARY_CAP)}`)
    }

    let charsUsed = lines.reduce((sum, l) => sum + l.length + 1, 0)
    const fields = input.fields ?? []
    // Minimum width a field line needs to carry real content (key prefix +
    // truncation marker). Below this we stop emitting fields rather than
    // producing marker-only lines that still cost bytes without carrying
    // signal. The "4" is the literal "- " + ": " framing.
    const markerProbe = truncationMarker(0, input.pointer).length
    for (let i = 0; i < fields.length; i++) {
      const [key, value] = fields[i]
      const remaining = SAFE_BODY_CAP - charsUsed
      const minLineWidth = 2 + key.length + 2 + markerProbe
      if (remaining < minLineWidth) {
        const skipped = fields.length - i
        lines.push(`- … [${skipped} more fields omitted; see ${input.pointer}]`)
        break
      }
      const valueCap = remaining - key.length - 4
      const rendered = Array.isArray(value)
        ? trimList(value, input.pointer, { listCap: 10, itemCap: 120 })
        : trimText(value, input.pointer, Math.min(valueCap, 1000))
      const line = `- ${key}: ${rendered}`
      if (line.length > remaining) {
        // Trim once more against the real remaining budget. trimText reserves
        // marker width internally so the result respects `valueCap`.
        lines.push(`- ${key}: ${trimText(rendered, input.pointer, valueCap)}`)
        const skipped = fields.length - i - 1
        if (skipped > 0) lines.push(`- … [${skipped} more fields omitted; see ${input.pointer}]`)
        break
      }
      lines.push(line)
      charsUsed += line.length + 1
    }

    const composed = lines.join("\n")
    report(composed, input.headline)
    return composed
  }

  /**
   * Telemetry hook: surface yields that exceed the soft budget so we
   * can find authors who bypassed the protocol. Logs only — the value
   * is returned (well, the caller's value is returned via yieldResult)
   * unchanged. Use directly when an upstream callsite wants to record
   * its own yield against the protocol budget without going through
   * yieldResult().
   */
  export function report(text: string, label: string): void {
    if (text.length <= HARD_CHAR_CAP) return
    if (typeof console !== "undefined" && console.warn) {
      console.warn(
        `[SubAgentProtocol] ${label} yielded ${text.length} chars (>${HARD_CHAR_CAP} target). ` +
          `Consider routing through yieldResult() / trimText() / trimList() with a real pointer ` +
          `so callers see a conclusion, not a transcript.`,
      )
    }
  }
}
