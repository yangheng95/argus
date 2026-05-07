/**
 * Character-ratio Token estimation — used by URL/Figma compile for bounded
 * section IR (budget-aware truncation of element/node subtrees).
 *
 * Ported from mirror/src/infra/llm/token-estimator.ts, pruned to the pure
 * text path. Message/context-fit variants are LLM-shape coupled (they took
 * mirror's `ChatMessage` and `getContextLimit` from mirror's model registry)
 * — those will come back in Phase 2 through the AI SDK rather than a
 * hand-rolled estimator, so we do not re-host the coupling here.
 *
 *   ASCII: ~4 chars/token
 *   CJK:   ~1.5 chars/token
 *   + 15% safety margin
 */

const CHARS_PER_TOKEN_ASCII = 4
const CHARS_PER_TOKEN_CJK = 1.5
const SAFETY_MARGIN = 0.15

/** Unicode ranges covering CJK Unified/Extension, Compatibility, Hiragana, Katakana, Hangul. */
const CJK_REGEX =
  /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\uf900-\ufaff\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/gu

/** Rough token estimate for `text`, safe for budget-aware truncation. */
export function estimateTokens(text: string): number {
  if (!text) return 0

  const cjkMatches = text.match(CJK_REGEX)
  const cjkCharCount = cjkMatches ? cjkMatches.length : 0
  const asciiCharCount = text.length - cjkCharCount

  const rawTokens = asciiCharCount / CHARS_PER_TOKEN_ASCII + cjkCharCount / CHARS_PER_TOKEN_CJK

  return Math.ceil(rawTokens * (1 + SAFETY_MARGIN))
}
