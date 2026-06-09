const FIGMA_URL_REGEX = /\bhttps?:\/\/(?:[\w-]+\.)?figma\.com\/(?:file|design|proto|board)(?:\/[^\s<>"'`)\]]*)?/i
const FIGMA_URL_GLOBAL_REGEX =
  /\bhttps?:\/\/(?:[\w-]+\.)?figma\.com\/(?:file|design|proto|board)(?:\/[^\s<>"'`)\]]*)?/gi
const HTTP_URL_REGEX = /\bhttps?:\/\/[^\s<>"'`)\]]+/i

/** Derive URL-shaped task signals in one place. Figma URLs are partitioned
 * off the generic URL signal because they are materialized through the Figma
 * integration rather than webpage-reference flows. */
export function deriveUrlSignals(text: string | undefined): {
  request_contains_url: boolean
  request_contains_figma_url: boolean
} {
  const raw = text ?? ""
  const hasFigma = FIGMA_URL_REGEX.test(raw)
  const stripped = raw.replace(FIGMA_URL_GLOBAL_REGEX, "")
  const hasGeneric = HTTP_URL_REGEX.test(stripped)
  return {
    request_contains_url: hasGeneric,
    request_contains_figma_url: hasFigma,
  }
}
