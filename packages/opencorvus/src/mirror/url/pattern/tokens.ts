/**
 * Design-token extraction: `ExtractedPage` → `DesignTokenSystem`.
 *
 * Ported verbatim from `mirror/src/infra/pattern/tokens.ts`. The
 * `DesignTokenSystem` / `TokenColor` / `TokenSpacing` / `TokenFont` types
 * (undeclared in mirror's types.ts) are synthesised in `ir/scaffold.ts`.
 *
 * Pure algorithm, zero LLM, O(N) traversal.
 */

import type { ExtractedElement, ExtractedPage, ExtractedStyles } from "../../ir/extracted-page"
import type {
  DesignTokenSystem,
  TokenColor,
  TokenSpacing,
  TokenFont,
  TokenRadius,
  TokenShadow,
} from "../../ir/scaffold"

// ─── Raw collection ──────────────────────────────────────────────────────

interface RawTokens {
  colors: Map<string, { count: number; contexts: Set<string> }>
  spacings: Map<number, number>
  fonts: Map<string, { weights: Set<number>; sizes: Set<number> }>
  radii: Map<number, number>
  shadows: Map<string, number>
}

function collectRawTokens(page: ExtractedPage): RawTokens {
  const raw: RawTokens = {
    colors: new Map(),
    spacings: new Map(),
    fonts: new Map(),
    radii: new Map(),
    shadows: new Map(),
  }

  function walk(el: ExtractedElement) {
    const s = el.styles
    if (s) {
      collectColors(s, raw.colors)
      collectSpacings(s, raw.spacings)
      collectFont(s, raw.fonts)
      collectRadius(s, raw.radii)
      collectShadow(s, raw.shadows)
    }
    if (el.children) for (const c of el.children) walk(c)
  }

  for (const root of page.tree) walk(root)
  return raw
}

function collectColors(s: ExtractedStyles, map: Map<string, { count: number; contexts: Set<string> }>) {
  const add = (val: string | undefined, context: string) => {
    if (!val || val === "transparent" || val === "rgba(0, 0, 0, 0)") return
    const normalized = normalizeColor(val)
    if (!normalized) return
    const entry = map.get(normalized)
    if (entry) {
      entry.count++
      entry.contexts.add(context)
    } else {
      map.set(normalized, { count: 1, contexts: new Set([context]) })
    }
  }

  add(s.color, "text")
  add(s.backgroundColor, "background")
  if (s.border) {
    const borderColor = extractBorderColor(s.border)
    if (borderColor) add(borderColor, "border")
  }
}

function normalizeColor(val: string): string | null {
  const trimmed = val.trim().toLowerCase()
  if (trimmed === "inherit" || trimmed === "initial" || trimmed === "currentcolor") return null
  return trimmed.replace(/\s+/g, " ")
}

function extractBorderColor(border: string): string | null {
  const match = border.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|\w+)$/i)
  return match ? match[1] : null
}

function collectSpacings(s: ExtractedStyles, map: Map<number, number>) {
  const addSpacing = (val: string | undefined) => {
    if (!val || val === "0px" || /^0px(\s+0px)*$/.test(val)) return
    for (const part of val.split(/\s+/)) {
      const px = parsePx(part)
      if (px !== null && px > 0 && px <= 200) {
        map.set(px, (map.get(px) || 0) + 1)
      }
    }
  }

  addSpacing(s.gap)
  addSpacing(s.padding)
  addSpacing(s.margin)
}

function parsePx(val: string): number | null {
  const match = val.match(/^(-?\d+(?:\.\d+)?)px$/)
  return match ? Math.round(parseFloat(match[1])) : null
}

function collectFont(s: ExtractedStyles, map: Map<string, { weights: Set<number>; sizes: Set<number> }>) {
  if (!s.fontFamily) return
  const family = s.fontFamily.split(",")[0].replace(/['"]/g, "").trim()
  if (!family) return

  const entry = map.get(family) ?? { weights: new Set<number>(), sizes: new Set<number>() }
  if (s.fontWeight) {
    const w = parseInt(s.fontWeight, 10)
    if (!isNaN(w)) entry.weights.add(w)
  }
  if (s.fontSize) {
    const sz = parsePx(s.fontSize)
    if (sz !== null && sz > 0) entry.sizes.add(sz)
  }
  map.set(family, entry)
}

function collectRadius(s: ExtractedStyles, map: Map<number, number>) {
  if (!s.borderRadius || s.borderRadius === "0px") return
  for (const part of s.borderRadius.split(/\s+/)) {
    const px = parsePx(part)
    if (px !== null && px > 0) {
      map.set(px, (map.get(px) || 0) + 1)
    }
  }
}

function collectShadow(s: ExtractedStyles, map: Map<string, number>) {
  if (!s.boxShadow || s.boxShadow === "none") return
  const normalized = s.boxShadow.trim().toLowerCase()
  map.set(normalized, (map.get(normalized) || 0) + 1)
}

// ─── Tailwind mapping ────────────────────────────────────────────────────

const TAILWIND_SPACING: Record<number, string> = {
  1: "px", 2: "0.5", 4: "1", 6: "1.5", 8: "2", 10: "2.5",
  12: "3", 14: "3.5", 16: "4", 20: "5", 24: "6", 28: "7",
  32: "8", 36: "9", 40: "10", 44: "11", 48: "12", 56: "14",
  64: "16", 80: "20", 96: "24", 112: "28", 128: "32",
  144: "36", 160: "40", 176: "44", 192: "48", 208: "52",
  224: "56", 240: "60", 256: "64", 288: "72", 320: "80", 384: "96",
}

const TAILWIND_RADII: Record<number, string> = {
  2: "sm", 4: "DEFAULT", 6: "md", 8: "lg", 12: "xl", 16: "2xl", 24: "3xl",
}

function nearestTailwindSpacing(px: number): string | undefined {
  const exact = TAILWIND_SPACING[px]
  if (exact) return exact
  let best: string | undefined
  let bestDist = Infinity
  for (const [k, v] of Object.entries(TAILWIND_SPACING)) {
    const dist = Math.abs(px - Number(k))
    if (dist < bestDist && dist <= 2) {
      bestDist = dist
      best = v
    }
  }
  return best
}

function nearestTailwindRadius(px: number): string | undefined {
  const exact = TAILWIND_RADII[px]
  if (exact) return exact
  let best: string | undefined
  let bestDist = Infinity
  for (const [k, v] of Object.entries(TAILWIND_RADII)) {
    const dist = Math.abs(px - Number(k))
    if (dist < bestDist && dist <= 2) {
      bestDist = dist
      best = v
    }
  }
  return best
}

function guessTailwindFont(family: string): string | undefined {
  const lower = family.toLowerCase()
  if (/mono|consolas|courier|menlo|fira\s*code/i.test(lower)) return "mono"
  if (/serif/i.test(lower) && !/sans/i.test(lower)) return "serif"
  return "sans"
}

// ─── Semantic inference ──────────────────────────────────────────────────

function inferColorSemantic(
  contexts: Set<string>,
  frequency: number,
  _allColors: Map<string, { count: number; contexts: Set<string> }>,
): TokenColor["semantic"] | undefined {
  const hasText = contexts.has("text")
  const hasBg = contexts.has("background")
  const hasBorder = contexts.has("border")

  if (hasBg && !hasText && frequency > 5) return "surface"
  if (hasBg && !hasText) return "background"

  if (hasText && !hasBg && frequency > 10) return "text"
  if (hasText && !hasBg && frequency > 2) return "text-muted"

  if (hasBorder && !hasText && !hasBg) return "border"

  return undefined
}

// ─── Public API ──────────────────────────────────────────────────────────

/** Extract a deterministic `DesignTokenSystem` from an `ExtractedPage`. */
export function extractTokenSystem(page: ExtractedPage): DesignTokenSystem {
  const raw = collectRawTokens(page)

  const colors: TokenColor[] = [...raw.colors.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 30)
    .map(([value, { count, contexts }]) => ({
      value,
      frequency: count,
      semantic: inferColorSemantic(contexts, count, raw.colors),
    }))

  const spacing: TokenSpacing[] = [...raw.spacings.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([px, frequency]) => ({
      px,
      frequency,
      tailwind: nearestTailwindSpacing(px),
    }))

  const fonts: TokenFont[] = [...raw.fonts.entries()]
    .map(([family, { weights, sizes }]) => ({
      family,
      weights: [...weights].sort((a, b) => a - b),
      sizes: [...sizes].sort((a, b) => a - b),
      tailwind: guessTailwindFont(family),
    }))
    .sort((a, b) => b.weights.length + b.sizes.length - (a.weights.length + a.sizes.length))

  const radii: TokenRadius[] = [...raw.radii.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([px, frequency]) => ({
      px,
      frequency,
      tailwind: nearestTailwindRadius(px),
    }))

  const shadows: TokenShadow[] = [...raw.shadows.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([value, frequency]) => ({
      value,
      frequency,
    }))

  return {
    colors,
    spacing,
    fonts,
    radii,
    shadows,
    customProperties: { ...page.tokens.customProperties },
  }
}
