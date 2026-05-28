/**
 * `analyzeFigma(CompressedDesign) → ProjectScaffold` — figma2code's analogue
 * of `mirror/url/pattern::analyzePage` and `mirror/image/analyze::analyzeImage`.
 *
 * Pure deterministic transform; zero LLM. The isolated Figma mirror algorithm
 * already produced the structured tree; this stage folds the resulting
 * `CompressedDesign` into the cross-source `ProjectScaffold` contract that
 * the build agent consumes uniformly (rule 22).
 *
 * Mapping summary:
 *   - tokens.colors / fonts / textStyles  → DesignTokenSystem
 *   - node.layout.padding / layout.gap    → spacing aggregation
 *   - node.style.borderRadius / shadow    → radii / shadows aggregation
 *   - top-level frames per page           → semantic visual surface entries
 *
 * What's intentionally absent:
 *   - No fingerprint-based pattern detection. Figma's `components` /
 *     `componentSets` already enumerate explicit reusable units; layering
 *     a heuristic similarity pass on top would be redundant and noisy.
 *     Same first-principles trade-off as image2code's analyze: surface
 *     genuine signal, skip pseudo-patterns. (rule 26 first principles)
 *
 * Input + output are strictly Zod-validated (rule 1).
 */

import { AnalyzeError } from "../errors"
import {
  CompressedDesignSchema,
  type CompressedDesign,
  type CompressedNode,
} from "../ir/compressed-design"
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
  type TokenShadow,
  type TokenSpacing,
} from "../ir/scaffold"
import { DEFAULT_REACT_SOURCE_LAYOUT } from "../shared/scaffold-helpers"
import { escapeXmlAttr, escapeXmlText } from "../shared/xml-escape"

// ─── Public entry ────────────────────────────────────────────────────────

export function analyzeFigma(rawDesign: CompressedDesign): ProjectScaffold {
  const parsed = CompressedDesignSchema.safeParse(rawDesign)
  if (!parsed.success) {
    throw new AnalyzeError({
      reason: `analyzeFigma: CompressedDesignSchema rejected payload — ${parsed.error.message}`,
    })
  }
  const design = parsed.data

  const allFrames = collectAllFrames(design)
  const tokens = synthesiseTokenSystem(design, allFrames)
  const surfaces = synthesiseSurfaces(design)
  const tokensFile = synthesiseTokensFileContract()
  const appFile = synthesiseAppFileContract()
  const catalog = synthesiseCatalog(allFrames)

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

// ─── Token synthesis ─────────────────────────────────────────────────────

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

function synthesiseTokenSystem(
  design: CompressedDesign,
  allFrames: CompressedNode[],
): DesignTokenSystem {
  const colors: TokenColor[] = Object.entries(design.tokens.colors).map(([name, value]) => ({
    value,
    frequency: 1,
    semantic: inferSemantic(name),
  }))

  const fontMap = new Map<string, { weights: Set<number>; sizes: Set<number> }>()
  for (const family of design.tokens.fonts) {
    if (!fontMap.has(family)) fontMap.set(family, { weights: new Set(), sizes: new Set() })
  }
  for (const ts of design.tokens.textStyles) {
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

  const spacing = aggregateSpacing(allFrames)
  const radii = aggregateRadii(allFrames)
  const shadows = aggregateShadows(allFrames)

  const customProperties: Record<string, string> = {}
  for (const effect of design.tokens.effects) {
    customProperties[`--effect-${effect.name.replace(/\s+/g, "-").toLowerCase()}`] = effect.value
  }

  return DesignTokenSystemSchema.parse({
    colors,
    spacing,
    fonts,
    radii,
    shadows,
    customProperties,
  })
}

function aggregateSpacing(frames: CompressedNode[]): TokenSpacing[] {
  const counts = new Map<number, number>()
  walkFrames(frames, (node) => {
    if (node.layout?.padding) {
      for (const v of node.layout.padding) bumpCount(counts, v)
    }
    if (typeof node.layout?.gap === "number") bumpCount(counts, node.layout.gap)
  })
  return [...counts.entries()]
    .filter(([px]) => px > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 16)
    .map(([px, frequency]) => ({ px, frequency }))
}

function aggregateRadii(frames: CompressedNode[]): TokenRadius[] {
  const counts = new Map<number, number>()
  walkFrames(frames, (node) => {
    const r = node.style?.borderRadius
    if (typeof r === "number" && r > 0) bumpCount(counts, r)
    else if (Array.isArray(r)) {
      for (const v of r) if (v > 0) bumpCount(counts, v)
    }
  })
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 8)
    .map(([px, frequency]) => ({ px, frequency }))
}

function aggregateShadows(frames: CompressedNode[]): TokenShadow[] {
  const counts = new Map<string, number>()
  walkFrames(frames, (node) => {
    if (node.style?.shadow) bumpCount(counts, node.style.shadow)
  })
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([value, frequency]) => ({ value, frequency }))
}

function bumpCount<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function walkFrames(frames: CompressedNode[], visit: (node: CompressedNode) => void): void {
  const stack = [...frames]
  while (stack.length > 0) {
    const node = stack.pop()!
    visit(node)
    if (node.children) stack.push(...node.children)
  }
}

function collectAllFrames(design: CompressedDesign): CompressedNode[] {
  const frames: CompressedNode[] = []
  for (const page of design.pages) frames.push(...page.frames)
  return frames
}

// ─── Section + file synthesis ────────────────────────────────────────────

function synthesiseSurfaces(design: CompressedDesign): VisualSurfaceContract[] {
  const surfaces: VisualSurfaceContract[] = []
  for (const page of design.pages) {
    for (let i = 0; i < page.frames.length; i++) {
      const frame = page.frames[i]
      const sectionName = sanitiseName(`${page.name}-${frame.name || `frame-${i + 1}`}`)
      const fileName = pascalCase(sectionName)
      const file: FileContract = {
        filePath: `${DEFAULT_REACT_SOURCE_LAYOUT.componentsDir}/${fileName}.tsx`,
        exportName: fileName,
        isDefaultExport: false,
        propsInterface: "",
        imports: {},
        patterns: frame.componentName ? [frame.componentName] : [],
        surfaceIR: figmaNodeToIR(frame, 0),
      }
      const bounds = frame.bounds ?? { x: 0, y: 0, w: 0, h: 0 }
      surfaces.push({
        id: sectionName,
        name: fileName,
        kind: figmaSurfaceKind(frame.name || page.name),
        bounds,
        sourceRefs: [{ source: "figma", path: `${page.name}/${frame.name || `frame-${i + 1}`}`, bounds }],
        view: FileContractSchema.parse(file),
        slots: [],
        repeatedPatterns: frame.componentName ? [{ name: frame.componentName, instanceCount: 1 }] : [],
        containerContract: {
          owner: "business-container",
          states: ["ready"],
          interactions: [],
          unknowns: ["Figma evidence cannot prove backend/API behavior."],
        },
      })
    }
  }
  return surfaces
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

function figmaSurfaceKind(name: string): VisualSurfaceContract["kind"] {
  const lower = name.toLowerCase()
  if (/nav|header|menu/.test(lower)) return "navigation"
  if (/footer/.test(lower)) return "footer"
  if (/search/.test(lower)) return "search"
  if (/form/.test(lower)) return "form"
  if (/list|feed/.test(lower)) return "list"
  if (/table|grid/.test(lower)) return "data-grid"
  if (/chart/.test(lower)) return "chart-panel"
  if (/hero/.test(lower)) return "hero"
  if (/modal|dialog/.test(lower)) return "modal"
  return "content"
}

function figmaNodeToIR(node: CompressedNode, depth: number): string {
  const indent = "  ".repeat(depth)
  const name = escapeXmlAttr(node.name || node.type)
  const bounds = node.bounds ?? { w: 0, h: 0 }
  const size = `size="${bounds.w}x${bounds.h}"`
  const styleAttrs = figmaStyleAttrs(node)
  if (node.text?.content) {
    const textStyle = [
      node.text.font,
      node.text.size ? `${node.text.size}px` : "",
      node.text.weight ? String(node.text.weight) : "",
      node.text.color,
    ].filter(Boolean).join(" ")
    return `${indent}<Text name="${name}" style="${escapeXmlAttr(textStyle)}">${escapeXmlText(node.text.content)}</Text>`
  }
  if (!node.children || node.children.length === 0) {
    return `${indent}<Box name="${name}" ${size}${styleAttrs} />`
  }
  const layout = node.layout?.mode ? ` layout="${escapeXmlAttr(figmaLayoutAttr(node))}"` : ""
  const children = node.children.map((child) => figmaNodeToIR(child, depth + 1)).join("\n")
  return [`${indent}<Container name="${name}" ${size}${layout}${styleAttrs}>`, children, `${indent}</Container>`].join("\n")
}

function figmaLayoutAttr(node: CompressedNode): string {
  const parts: string[] = []
  if (node.layout?.mode === "VERTICAL") parts.push("VERTICAL")
  if (node.layout?.mode === "HORIZONTAL") parts.push("HORIZONTAL")
  if (node.layout?.mode === "GRID") parts.push("GRID")
  if (node.layout?.gap) parts.push(`gap:${node.layout.gap}px`)
  return parts.join(" ")
}

function figmaStyleAttrs(node: CompressedNode): string {
  const attrs: string[] = []
  if (node.style?.bg) attrs.push(`bg="${escapeXmlAttr(node.style.bg)}"`)
  if (node.style?.border) attrs.push(`border="${escapeXmlAttr(node.style.border)}"`)
  if (typeof node.style?.borderRadius === "number") attrs.push(`radius="${node.style.borderRadius}px"`)
  if (node.style?.shadow) attrs.push(`shadow="${escapeXmlAttr(node.style.shadow)}"`)
  if (node.layout?.padding) attrs.push(`padding="${node.layout.padding.map((value) => `${value}px`).join(" ")}"`)
  return attrs.length > 0 ? " " + attrs.join(" ") : ""
}

function synthesiseCatalog(frames: CompressedNode[]): ComponentCatalog {
  let totalElements = 0
  walkFrames(frames, () => {
    totalElements += 1
  })
  return ComponentCatalogSchema.parse({
    patterns: [],
    totalElements,
    coveredElements: 0,
  })
}

function countNodes(node: CompressedNode): number {
  let n = 1
  if (node.children) for (const child of node.children) n += countNodes(child)
  return n
}

function sanitiseName(raw: string): string {
  return (
    raw
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "section"
  )
}

function pascalCase(slug: string): string {
  return (
    slug
      .split("-")
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
      .join("") || "Section"
  )
}
