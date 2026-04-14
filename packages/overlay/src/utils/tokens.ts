// Token estimation for card-local content.
//
// Each card shows its own token count so operators can see the per-card cost
// at every nesting level. Two sources:
//
//   - provider-reported: for completed assistant turns we have real usage
//     numbers on `message.info.tokens` (output + reasoning). These are this
//     turn's new tokens, not cumulative context, so they sum meaningfully
//     when a parent aggregates its children.
//   - local estimate: for user bubbles, synthetic / system messages, and
//     in-flight assistant turns we have no provider number. We approximate
//     from the rendered text. The tooltip is marked "estimate" so the number
//     is never mistaken for a billing figure.
//
// The estimator is intentionally crude — we only need enough accuracy for
// operators to gauge "big vs small" at a glance, not billing precision.

/** Rough char→token estimate.
 *  - CJK ideographs / kana / hangul: ~1 token per character.
 *  - Everything else (Latin, code, punctuation): ~4 characters per token.
 *  The ratio tracks OpenAI / Anthropic tokenisers to within ±30% on mixed
 *  content, which is enough for a low-contrast corner hint.
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (
      (code >= 0x3040 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x20000 && code <= 0x2a6df) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++
    } else {
      other++
    }
  }
  return Math.ceil(cjk + other / 4)
}

function partText(part: any): string {
  if (!part) return ""
  if (typeof part === "string") return part
  if (typeof part.text === "string") return part.text
  return ""
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Estimate tokens for a single message by scanning its rendered parts.
 *  Covers text, reasoning, and tool-call input/output bodies — everything
 *  the card actually shows. */
export function estimateMessageTokens(msg: any): number {
  const parts = msg?.parts
  if (!Array.isArray(parts)) return 0
  let total = 0
  for (const p of parts) {
    total += estimateTextTokens(partText(p))
    if (p && typeof p === "object") {
      if (p.input !== undefined) total += estimateTextTokens(asText(p.input))
      if (p.output !== undefined) total += estimateTextTokens(asText(p.output))
      if (typeof p.title === "string") total += estimateTextTokens(p.title)
    }
  }
  return total
}

/** Best-available token count for a message:
 *   - completed assistant turn with real usage → output + reasoning
 *     (the *new* tokens this turn produced; input is cumulative context and
 *     would double-count when summed across turns)
 *   - otherwise → text estimate
 *
 *  Returns `{ tokens, estimated }` so the caller can render an "est." tag
 *  only when we fell back. Aggregates mark themselves estimated if any leaf
 *  was estimated — a sum is no more precise than its worst input.
 */
export function messageTokens(msg: any): { tokens: number; estimated: boolean } {
  const info = msg?.info
  if (info?.role === "assistant") {
    const t = info.tokens
    if (t && typeof t === "object") {
      const output = typeof t.output === "number" ? t.output : 0
      const reasoning = typeof t.reasoning === "number" ? t.reasoning : 0
      if (output > 0 || reasoning > 0) {
        return { tokens: output + reasoning, estimated: false }
      }
    }
  }
  return { tokens: estimateMessageTokens(msg), estimated: true }
}

/** Sum token counts across a message list, propagating the estimated flag. */
export function sumMessageTokens(messages: any[] | undefined): { tokens: number; estimated: boolean } {
  if (!Array.isArray(messages)) return { tokens: 0, estimated: false }
  let tokens = 0
  let estimated = false
  for (const m of messages) {
    const t = messageTokens(m)
    tokens += t.tokens
    if (t.estimated) estimated = true
  }
  return { tokens, estimated }
}
