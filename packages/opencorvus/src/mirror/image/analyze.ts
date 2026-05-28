/**
 * `analyzeImage(ImageAnalysis) → ProjectScaffold` — image2code's analogue of
 * `mirror/url/pattern::analyzePage`. Pure deterministic transform. Zero LLM
 * (the vision-LLM call already ran in `mirror/image/extract.ts`; this stage
 * just folds its structured output into the cross-source `ProjectScaffold`
 * contract that the build agent consumes uniformly).
 *
 * Why image needs an analyze stage even though the LLM already produced
 * tokens / tree:
 *   - Rule 22 single source. URL & figma flows publish mirror facts plus
 *     generated source paths through a shared ProjectScaffold contract. Image
 *     used to dump only `image-analysis.json` — the build agent had to branch
 *     per source. Producing the same artifacts puts every source on the same
 *     downstream contract.
 *   - Rule 24 abstraction: the `ProjectScaffold` shape is the single
 *     downstream interface. Each upstream source's analyze synthesises
 *     a semantic `ProjectScaffold` from its own native IR.
 *
 * What's intentionally absent vs URL's `analyzePage`:
 *   - No fingerprint-based pattern detection. The vision-LLM tree has no
 *     CSS-grounded similarity signal to cluster on, and forcing a
 *     pseudo-pattern pass over LLM-inferred names invites false matches.
 *     We surface `repeatCount` hints instead via `componentHint` notes.
 *   - No `optimizeTree` pass. The LLM already chose a useful granularity;
 *     an additional collapse pass would erase intent.
 *
 * Inputs / outputs are strictly Zod-validated at the boundary (rule 1: no
 * silent fallback when the upstream payload is shaped wrong).
 */

import { AnalyzeError } from "../errors"
import {
  ImageAnalysisSchema,
  type ImageAnalysis,
  type ImageElement,
} from "../ir/image-analysis"
import {
  ComponentCatalogSchema,
  DesignTokenSystemSchema,
  FileContractSchema,
  ProjectScaffoldSchema,
  type ComponentCatalog,
  type DesignTokenSystem,
  type FileContract,
  type ProjectScaffold,
  type VisualSurfaceContract,
  type TokenColor,
  type TokenFont,
  type TokenRadius,
  type TokenSpacing,
  type TokenShadow,
} from "../ir/scaffold"
import { DEFAULT_REACT_SOURCE_LAYOUT } from "../shared/scaffold-helpers"
import { escapeXmlAttr, escapeXmlText } from "../shared/xml-escape"

// ─── Public entry ────────────────────────────────────────────────────────

export function analyzeImage(rawAnalysis: ImageAnalysis): ProjectScaffold {
  const parsed = ImageAnalysisSchema.safeParse(rawAnalysis)
  if (!parsed.success) {
    throw new AnalyzeError({
      reason: `analyzeImage: ImageAnalysisSchema rejected payload — ${parsed.error.message}`,
    })
  }
  const analysis = parsed.data

  const tokens = synthesiseTokenSystem(analysis)
  const surfaces = synthesiseSurfaces(analysis)
  const tokensFile = synthesiseTokensFileContract()
  const appFile = synthesiseAppFileContract()
  const catalog = synthesiseCatalog(analysis)
  const scaffold: ProjectScaffold = {
    version: 2,
    tokensFile,
    sharedViews: [],
    surfaces,
    appFile,
    tokens,
    catalog,
  }
  return ProjectScaffoldSchema.parse(scaffold)
}

// ─── Token system synthesis ──────────────────────────────────────────────

const SEMANTIC_NAME_HINTS: Record<string, TokenColor["semantic"]> = {
  background: "background",
  bg: "background",
  surface: "surface",
  card: "surface",
  border: "border",
  divider: "border",
  text: "text",
  fg: "text",
  foreground: "text",
  muted: "text-muted",
  secondary: "text-muted",
  caption: "text-muted",
}

function inferSemantic(name: string): TokenColor["semantic"] | undefined {
  const lower = name.toLowerCase()
  for (const [hint, semantic] of Object.entries(SEMANTIC_NAME_HINTS)) {
    if (lower.includes(hint)) return semantic
  }
  return undefined
}

function synthesiseTokenSystem(analysis: ImageAnalysis): DesignTokenSystem {
  const colors: TokenColor[] = Object.entries(analysis.tokens.colors).map(([name, value]) => ({
    value,
    frequency: 1,
    semantic: inferSemantic(name),
  }))

  // Aggregate font weights/sizes from textStyles per family. The LLM lists
  // fonts as a flat string[] separately and may also give per-style font
  // hints in textStyles[].font — both feed into the same TokenFont entry.
  const fontMap = new Map<string, { weights: Set<number>; sizes: Set<number> }>()
  for (const family of analysis.tokens.fonts) {
    if (!fontMap.has(family)) fontMap.set(family, { weights: new Set(), sizes: new Set() })
  }
  for (const ts of analysis.tokens.textStyles) {
    const family = ts.font ?? "default"
    if (!fontMap.has(family)) fontMap.set(family, { weights: new Set(), sizes: new Set() })
    const entry = fontMap.get(family)!
    if (Number.isFinite(ts.weight)) entry.weights.add(ts.weight)
    if (Number.isFinite(ts.size)) entry.sizes.add(ts.size)
  }
  const fonts: TokenFont[] = [...fontMap.entries()].map(([family, agg]) => ({
    family,
    weights: [...agg.weights].sort((a, b) => a - b),
    sizes: [...agg.sizes].sort((a, b) => a - b),
  }))

  const spacing = aggregateSpacing(analysis.tree)
  const radii = aggregateRadii(analysis.tree)
  const shadows = aggregateShadows(analysis.tree)

  return {
    colors,
    spacing,
    fonts,
    radii,
    shadows,
    customProperties: {},
  }
}

function aggregateSpacing(tree: ImageElement[]): TokenSpacing[] {
  const counts = new Map<number, number>()
  walk(tree, (el) => {
    if (el.style?.padding) {
      for (const v of el.style.padding) bumpCount(counts, v)
    }
    if (typeof el.layout?.gap === "number") bumpCount(counts, el.layout.gap)
  })
  return [...counts.entries()]
    .filter(([px]) => px > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 16)
    .map(([px, frequency]) => ({ px, frequency }))
}

function aggregateRadii(tree: ImageElement[]): TokenRadius[] {
  const counts = new Map<number, number>()
  walk(tree, (el) => {
    const r = el.style?.borderRadius
    const px = typeof r === "number" ? r : typeof r === "string" ? parseInt(r, 10) : NaN
    if (Number.isFinite(px) && px > 0) bumpCount(counts, px)
  })
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 8)
    .map(([px, frequency]) => ({ px, frequency }))
}

function aggregateShadows(tree: ImageElement[]): TokenShadow[] {
  const counts = new Map<string, number>()
  walk(tree, (el) => {
    if (el.style?.shadow) bumpCount(counts, el.style.shadow)
  })
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([value, frequency]) => ({ value, frequency }))
}

function bumpCount<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function walk(tree: ImageElement[], visit: (el: ImageElement) => void): void {
  const stack = [...tree]
  while (stack.length > 0) {
    const el = stack.pop()!
    visit(el)
    if (el.children) stack.push(...el.children)
  }
}

// ─── Section + file synthesis ────────────────────────────────────────────

function synthesiseSurfaces(analysis: ImageAnalysis): VisualSurfaceContract[] {
  return analysis.tree.map((el, i) => {
    const name = sanitiseName(el.role || el.name || `section-${i + 1}`)
    const fileName = pascalCase(name)
    const elementCount = countElements(el)
    const file: FileContract = {
      filePath: `${DEFAULT_REACT_SOURCE_LAYOUT.componentsDir}/${fileName}.tsx`,
      exportName: fileName,
      isDefaultExport: false,
      propsInterface: "",
      imports: {},
      patterns: el.componentHint ? [el.componentHint] : [],
      surfaceIR: imageElementToIR(el, 0),
    }
    return {
      id: name,
      name: fileName,
      kind: imageSurfaceKind(el.role),
      role: el.role,
      bounds: el.bounds,
      sourceRefs: [{ source: "image", path: String(i), bounds: el.bounds }],
      view: FileContractSchema.parse(file),
      slots: [],
      repeatedPatterns: el.componentHint ? [{ name: el.componentHint, instanceCount: el.repeatCount ?? 1 }] : [],
      containerContract: {
        owner: "business-container",
        states: ["ready"],
        interactions: [],
        unknowns: ["Image-only evidence cannot prove backend/API behavior."],
      },
    }
  })
}

function synthesiseTokensFileContract(): FileContract {
  return FileContractSchema.parse({
    filePath: DEFAULT_REACT_SOURCE_LAYOUT.tokensFilePath,
    exportName: "designTokens",
    isDefaultExport: false,
    propsInterface: "",
    imports: {},
    patterns: [],
  })
}

function synthesiseAppFileContract(): FileContract {
  return FileContractSchema.parse({
    filePath: DEFAULT_REACT_SOURCE_LAYOUT.appFilePath,
    exportName: "AppView",
    isDefaultExport: false,
    propsInterface: "",
    imports: {},
    patterns: [],
  })
}

function imageSurfaceKind(role: string | undefined): VisualSurfaceContract["kind"] {
  if (role === "header" || role === "nav") return "navigation"
  if (role === "footer") return "footer"
  if (role === "form") return "form"
  if (role === "list") return "list"
  if (role === "hero") return "hero"
  if (role === "grid") return "data-grid"
  if (role === "card") return "detail-card"
  return "content"
}

function imageElementToIR(el: ImageElement, depth: number): string {
  const indent = "  ".repeat(depth)
  const name = escapeXmlAttr(el.role || el.name)
  const size = `size="${el.bounds.w}x${el.bounds.h}"`
  const styleAttrs = imageStyleAttrs(el)
  if (el.text?.content) {
    const textStyle = [
      el.text.font,
      el.text.size ? `${el.text.size}px` : "",
      el.text.weight ? String(el.text.weight) : "",
      el.text.color,
    ].filter(Boolean).join(" ")
    return `${indent}<Text name="${name}" style="${escapeXmlAttr(textStyle)}">${escapeXmlText(el.text.content)}</Text>`
  }
  if (!el.children || el.children.length === 0) {
    return `${indent}<Box name="${name}" ${size}${styleAttrs} />`
  }
  const layout = el.layout?.direction ? ` layout="${escapeXmlAttr(imageLayoutAttr(el))}"` : ""
  const children = el.children.map((child) => imageElementToIR(child, depth + 1)).join("\n")
  return [`${indent}<Container name="${name}" ${size}${layout}${styleAttrs}>`, children, `${indent}</Container>`].join("\n")
}

function imageLayoutAttr(el: ImageElement): string {
  const parts: string[] = []
  if (el.layout?.direction === "vertical") parts.push("VERTICAL")
  if (el.layout?.direction === "horizontal") parts.push("HORIZONTAL")
  if (el.layout?.direction === "grid") parts.push("GRID")
  if (el.layout?.gap) parts.push(`gap:${el.layout.gap}px`)
  if (el.layout?.gridCols) parts.push(`cols:${el.layout.gridCols}`)
  return parts.join(" ")
}

function imageStyleAttrs(el: ImageElement): string {
  const attrs: string[] = []
  if (el.style?.bg) attrs.push(`bg="${escapeXmlAttr(el.style.bg)}"`)
  if (el.style?.borderRadius) attrs.push(`radius="${el.style.borderRadius}px"`)
  if (el.style?.shadow) attrs.push(`shadow="${escapeXmlAttr(el.style.shadow)}"`)
  if (el.style?.padding) attrs.push(`padding="${el.style.padding.map((value) => `${value}px`).join(" ")}"`)
  return attrs.length > 0 ? " " + attrs.join(" ") : ""
}

function synthesiseCatalog(analysis: ImageAnalysis): ComponentCatalog {
  const totalElements = analysis.tree.reduce((sum, el) => sum + countElements(el), 0)
  // Image2code skips fingerprint-based pattern detection — see file header.
  // `componentHint` annotations on individual elements still surface via
  // FileContract.patterns; the catalog itself stays empty so downstream
  // readers (overlay token panel, codegen prompt) don't see fabricated
  // pattern entries that aren't real shared components.
  return ComponentCatalogSchema.parse({
    patterns: [],
    totalElements,
    coveredElements: 0,
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function countElements(el: ImageElement): number {
  let n = 1
  if (el.children) for (const child of el.children) n += countElements(child)
  return n
}

function sanitiseName(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "section"
}

function pascalCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join("")
    || "Section"
}
