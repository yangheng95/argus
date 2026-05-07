/**
 * Content comparison utilities — deterministic text overlap and icon count
 * comparison between a design reference and rendered output.
 *
 * Ported from mirror/src/infra/content-compare.ts. Pure functions, zero
 * network / LLM / filesystem.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface TextCompareResult {
  /** Jaccard similarity of token multisets (0-1). */
  jaccardSimilarity: number
  /** Fraction of reference tokens found in rendered (0-1). */
  coverageRate: number
  referenceTokens: number
  renderedTokens: number
  /** Up to 20 reference-unique tokens missing from rendered. */
  missingTokens: string[]
  /** Weighted blend: coverage × 70% + jaccard × 30%, rounded 0-100. */
  score: number
}

export interface IconCompareResult {
  referenceCount: number
  renderedCount: number
  /** `min(ref, ren) / max(ref, ren)`, 1 when both are 0. */
  coverageRate: number
  score: number
}

export interface ContentCompareResult {
  text: TextCompareResult
  icons: IconCompareResult
  /** Weighted overall: text × 70% + icons × 30%. */
  overallScore: number
}

// ─── Tokenization ─────────────────────────────────────────────────────────

const CJK_RANGE =
  /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\u{2b740}-\u{2b81f}\u{2b820}-\u{2ceaf}\u{2ceb0}-\u{2ebef}\u{30000}-\u{3134f}\u3000-\u303f\uff00-\uffef]/u

function splitLatinWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\-_.,;:!?@#$%^&*()[\]{}<>/\\|'"=+`~]+/)
    .filter((w) => w.length > 1 || /[a-z]/.test(w))
    .filter((w) => !/^\d+$/.test(w))
}

/**
 * Tokenise into a normalised sequence:
 *   - CJK characters become individual tokens
 *   - Latin runs are lowercased and split on punctuation/whitespace
 *   - Pure-digit tokens dropped (prices/sizes vary between samples)
 */
export function tokenize(text: string): string[] {
  if (!text) return []

  const tokens: string[] = []
  const segments = text.replace(/\s+/g, " ").trim().split("")
  let latinBuffer = ""

  for (const char of segments) {
    if (CJK_RANGE.test(char)) {
      if (latinBuffer.trim()) {
        tokens.push(...splitLatinWords(latinBuffer))
        latinBuffer = ""
      }
      tokens.push(char)
    } else {
      latinBuffer += char
    }
  }

  if (latinBuffer.trim()) tokens.push(...splitLatinWords(latinBuffer))

  return tokens.filter((t) => t.length > 0)
}

// ─── Text comparison ──────────────────────────────────────────────────────

function buildMultiset(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const t of tokens) map.set(t, (map.get(t) ?? 0) + 1)
  return map
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

export function compareText(referenceText: string, renderedText: string): TextCompareResult {
  const refTokens = tokenize(referenceText)
  const renTokens = tokenize(renderedText)

  if (refTokens.length === 0 && renTokens.length === 0) {
    return {
      jaccardSimilarity: 1,
      coverageRate: 1,
      referenceTokens: 0,
      renderedTokens: 0,
      missingTokens: [],
      score: 100,
    }
  }

  if (refTokens.length === 0) {
    return {
      jaccardSimilarity: 0,
      coverageRate: 1,
      referenceTokens: 0,
      renderedTokens: renTokens.length,
      missingTokens: [],
      score: 100,
    }
  }

  const refCounts = buildMultiset(refTokens)
  const renCounts = buildMultiset(renTokens)

  let intersectionSize = 0
  for (const [token, refCount] of refCounts) {
    intersectionSize += Math.min(refCount, renCounts.get(token) ?? 0)
  }

  const allTokens = new Set([...refCounts.keys(), ...renCounts.keys()])
  let unionSize = 0
  for (const token of allTokens) {
    unionSize += Math.max(refCounts.get(token) ?? 0, renCounts.get(token) ?? 0)
  }

  const jaccardSimilarity = unionSize > 0 ? intersectionSize / unionSize : 0
  const coverageRate = refTokens.length > 0 ? intersectionSize / refTokens.length : 1

  const missingTokens: string[] = []
  for (const [token, refCount] of refCounts) {
    const renCount = renCounts.get(token) ?? 0
    if (renCount < refCount) missingTokens.push(token)
  }

  const score = Math.round(coverageRate * 70 + jaccardSimilarity * 30)

  return {
    jaccardSimilarity: round3(jaccardSimilarity),
    coverageRate: round3(coverageRate),
    referenceTokens: refTokens.length,
    renderedTokens: renTokens.length,
    missingTokens: missingTokens.slice(0, 20),
    score,
  }
}

// ─── Icon comparison ──────────────────────────────────────────────────────

export function compareIcons(referenceCount: number, renderedCount: number): IconCompareResult {
  if (referenceCount === 0 && renderedCount === 0) {
    return { referenceCount: 0, renderedCount: 0, coverageRate: 1, score: 100 }
  }

  const maxCount = Math.max(referenceCount, renderedCount)
  const minCount = Math.min(referenceCount, renderedCount)
  const coverageRate = maxCount > 0 ? minCount / maxCount : 1

  return {
    referenceCount,
    renderedCount,
    coverageRate: round3(coverageRate),
    score: Math.round(coverageRate * 100),
  }
}

// ─── Extract helpers ──────────────────────────────────────────────────────

/** Node shapes covered:
 *    - `{ text?: string, children?: [] }` (ExtractedElement)
 *    - `{ text?: { content: string }, children?: [] }` (CompressedNode / ImageElement)
 */
interface TextNode {
  text?: string | { content?: string }
  children?: TextNode[]
}

/** Recursively join all text content discovered in a heterogeneous element tree. */
export function extractTextFromTree(elements: TextNode[]): string {
  const parts: string[] = []

  function walk(nodes: TextNode[]) {
    for (const node of nodes) {
      if (typeof node.text === "string" && node.text) {
        parts.push(node.text)
      } else if (node.text && typeof node.text === "object" && node.text.content) {
        parts.push(node.text.content)
      }
      if (node.children) walk(node.children)
    }
  }

  walk(elements)
  return parts.join(" ")
}

export function countIcons(icons: Array<{ src: string; type: string }> | undefined): number {
  return icons?.length ?? 0
}

/** Heuristic count — inline `<svg>` + icon-font `<i>`/`<span class="... icon ...">`. */
export function countRenderedIcons(html: string): number {
  let count = 0
  const svgMatches = html.match(/<svg[\s>]/gi)
  count += svgMatches?.length ?? 0
  const iconFontMatches = html.match(
    /<(?:i|span)\s[^>]*class="[^"]*(?:icon|fa-|material-icon|bi-|ri-)[^"]*"[^>]*>/gi,
  )
  count += iconFontMatches?.length ?? 0
  return count
}

// ─── Full content comparison ──────────────────────────────────────────────

export function compareContent(
  referenceText: string,
  renderedText: string,
  referenceIconCount: number,
  renderedIconCount: number,
): ContentCompareResult {
  const text = compareText(referenceText, renderedText)
  const icons = compareIcons(referenceIconCount, renderedIconCount)
  const overallScore = Math.round(text.score * 0.7 + icons.score * 0.3)
  return { text, icons, overallScore }
}
