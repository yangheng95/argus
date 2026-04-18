/**
 * Structural fingerprinting for `ExtractedElement` trees.
 *
 * Ported verbatim from `mirror/src/infra/pattern/fingerprint.ts`. Pure
 * algorithm — no opencorvus integrations needed. Used internally by
 * `pattern/detect` (clustering) and `pattern/contract` (variant matching).
 *
 * Complexity: O(N) fingerprint, O(m·n) similarity with short-circuit.
 */

import type { ExtractedElement, ExtractedStyles } from "../../ir/extracted-page"

function layoutMode(styles: ExtractedStyles): string {
  const d = styles.display
  if (d === "flex" || d === "inline-flex") {
    return styles.flexDirection === "column" || styles.flexDirection === "column-reverse" ? "V" : "H"
  }
  if (d === "grid" || d === "inline-grid") return "G"
  return "_"
}

function leafType(el: ExtractedElement): string {
  if (el.tag === "svg") return "I"
  if (el.tag === "canvas") return "C"
  if (el.tag === "video") return "V"
  if (el.imageSrc) return "M"
  if (el.text) return "T"
  return "E"
}

function normalizeTag(tag: string): string {
  if (/^h[1-6]$/.test(tag)) return "h"
  if (tag === "span" || tag === "p" || tag === "label") return "t"
  if (tag === "a") return "a"
  if (tag === "img") return "m"
  if (tag === "svg") return "i"
  if (tag === "button") return "b"
  if (tag === "input" || tag === "textarea" || tag === "select") return "f"
  if (tag === "ul" || tag === "ol") return "l"
  if (tag === "li") return "li"
  if (
    tag === "nav" ||
    tag === "header" ||
    tag === "footer" ||
    tag === "main" ||
    tag === "aside" ||
    tag === "section" ||
    tag === "article"
  ) {
    return tag[0]
  }
  return "d"
}

function summarizeChildren(children: ExtractedElement[]): string {
  const counts: Record<string, number> = {}
  for (const c of children) {
    const key = c.children && c.children.length > 0 ? "N" : leafType(c)
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}${v}`)
    .join("")
}

/** Unbounded canonical structural fingerprint. */
export function fingerprint(el: ExtractedElement): string {
  const tag = normalizeTag(el.tag)
  const layout = layoutMode(el.styles)

  if (!el.children || el.children.length === 0) {
    return `${tag}:${layout}:${leafType(el)}`
  }

  const childPrints = el.children.map(fingerprint)
  return `${tag}:${layout}:[${childPrints.join(",")}]`
}

/** Depth-bounded fingerprint — beyond `maxDepth` children are counted, not recursed. */
export function fingerprintBounded(el: ExtractedElement, maxDepth = 6, depth = 0): string {
  const tag = normalizeTag(el.tag)
  const layout = layoutMode(el.styles)

  if (!el.children || el.children.length === 0) {
    return `${tag}:${layout}:${leafType(el)}`
  }

  if (depth >= maxDepth) {
    const childSummary = summarizeChildren(el.children)
    return `${tag}:${layout}:{${childSummary}}`
  }

  const childPrints = el.children.map((c) => fingerprintBounded(c, maxDepth, depth + 1))
  return `${tag}:${layout}:[${childPrints.join(",")}]`
}

function tokenize(fp: string): string[] {
  return fp.split(/([,\[\]\{\}:])/).filter(Boolean)
}

function tokenEditDistance(a: string[], b: string[]): number {
  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > Math.max(m, n) * 0.5) return Math.max(m, n)

  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const curr = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = curr
  }
  return prev[n]
}

/** Similarity in [0,1] — token-level edit distance normalised by longer tokens. */
export function fingerprintSimilarity(a: string, b: string): number {
  if (a === b) return 1.0
  if (a.length === 0 || b.length === 0) return 0

  const tokensA = tokenize(a)
  const tokensB = tokenize(b)
  const maxLen = Math.max(tokensA.length, tokensB.length)
  if (maxLen === 0) return 1.0

  const distance = tokenEditDistance(tokensA, tokensB)
  return 1 - distance / maxLen
}

/** Total element count in a subtree (including root). */
export function countElements(el: ExtractedElement): number {
  let count = 1
  if (el.children) {
    for (const c of el.children) count += countElements(c)
  }
  return count
}

export interface FingerprintEntry {
  element: ExtractedElement
  fingerprint: string
  depth: number
  elementCount: number
}

/** Pre-order DFS collecting `(element, fingerprint, depth, count)` pairs. */
export function collectFingerprints(root: ExtractedElement, maxDepth = 6): FingerprintEntry[] {
  const results: FingerprintEntry[] = []

  function walk(el: ExtractedElement, depth: number) {
    const fp = fingerprintBounded(el, maxDepth)
    results.push({ element: el, fingerprint: fp, depth, elementCount: countElements(el) })
    if (el.children) {
      for (const c of el.children) walk(c, depth + 1)
    }
  }

  walk(root, 0)
  return results
}
