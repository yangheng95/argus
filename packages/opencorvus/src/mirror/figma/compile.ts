/**
 * Deterministic Figma IR → XML compiler.
 *
 * Consumes a `CompressedDesign` (typically produced by `figma/fetch-tree`
 * and optionally cleaned by `figma/graph-analyze`) and emits a compact XML
 * string that codegen agents can read without any LLM round-trip.
 *
 * Ported from `mirror/src/service/figma-compile.ts` + `infra/compile/ir-utils.ts`.
 * The 58-line `ir-utils.ts` is folded in here because its helpers are only
 * meaningful inside this module; keeping a separate file would invite future
 * cross-module calls between compile tools, violating our atomic-tool rule.
 *
 * Zero LLM, pure function. Output string is byte-identical to mirror's
 * `figmaCompileService.execute(input).then(r => r)` — the `.xml` field of
 * the returned `XmlIR` is the parity surface.
 */

import { escapeXmlAttr } from "../shared/xml-escape"
import { estimateTokens } from "../shared/token-estimator"
import type {
  CompressedDesign,
  CompressedNode,
} from "../ir/compressed-design"
import { XmlIRSchema, type XmlIR } from "../ir/xml-ir"

// `mirror/src/infra/config.ts::COMPILE_MAX_TEXT_LEN = Infinity`. Inlined
// because downstream tools never vary this. If a future skill needs text
// truncation it should do so before passing the design in.
const COMPILE_MAX_TEXT_LEN = Infinity

// ─── ir-utils (folded in) ────────────────────────────────────────────────

interface TextStyleInput {
  font?: string
  size?: number
  weight?: number
  color?: string
  lineHeight?: number | string
  letterSpacing?: number | string
  align?: string
  decoration?: string
  textCase?: string
}

interface CompileTextStyleOptions {
  suppressDefaultAlign?: boolean
  lineHeightUnit?: string
}

function joinAttrs(...parts: string[]): string {
  return parts.filter(Boolean).join(" ")
}

function compileSizeAttr(bounds: { w: number; h: number } | undefined): string {
  if (!bounds) return ""
  return `size="${bounds.w}x${bounds.h}"`
}

function compileTextStyle(input: TextStyleInput, options?: CompileTextStyleOptions): string {
  const parts: string[] = []
  if (input.font) parts.push(input.font)
  if (input.size) parts.push(`${input.size}px`)
  if (input.weight) parts.push(String(input.weight))
  if (input.color) parts.push(input.color)
  if (input.lineHeight !== undefined) {
    const unit = options?.lineHeightUnit ?? ""
    parts.push(`lh:${input.lineHeight}${unit}`)
  }
  if (input.letterSpacing) parts.push(`ls:${input.letterSpacing}`)
  if (input.align) {
    if (!(options?.suppressDefaultAlign && input.align === "left")) {
      parts.push(`align:${input.align}`)
    }
  }
  if (input.decoration) parts.push(`decoration:${input.decoration}`)
  if (input.textCase) parts.push(`case:${input.textCase}`)
  return parts.join(" ")
}

// ─── Name sanitisation ───────────────────────────────────────────────────

/**
 * Figma variant names like "State=选中态" contain CJK chars that don't
 * round-trip through the codegen LLM reliably. Replace them with a stable
 * 4-char base36 hash of the CJK segment so variants stay distinguishable.
 */
function sanitizeCJKName(name: string): string {
  if (!/[\u4e00-\u9fff]/.test(name)) return name
  const cjkParts = name.match(/[\u4e00-\u9fff]+/g) || []
  const hash = cjkParts
    .map((p) => {
      let h = 0
      for (let i = 0; i < p.length; i++) h = ((h << 5) - h + p.charCodeAt(i)) | 0
      return Math.abs(h).toString(36).slice(0, 4)
    })
    .join("")
  const base = name
    .replace(/[\u4e00-\u9fff]+/g, "")
    .replace(/[=\-_]+$/, "")
    .replace(/^[=\-_]+/, "")
    .trim()
  return base ? `${base}_${hash}` : `cjk_${hash}`
}

// ─── Attribute builders ──────────────────────────────────────────────────

function styleAttrs(node: CompressedNode): string {
  const s = node.style
  if (!s) return ""
  const parts: string[] = []
  if (s.bg) parts.push(`bg="${s.bg}"`)
  if (s.bgGradient) parts.push(`gradient="${s.bgGradient}"`)
  if (s.border) parts.push(`border="${s.border}"`)
  if (s.borderRadius !== undefined) {
    const r = Array.isArray(s.borderRadius) ? s.borderRadius.join(",") : s.borderRadius
    if (r !== 0) parts.push(`radius="${r}"`)
  }
  if (s.shadow) parts.push(`shadow="${s.shadow}"`)
  if (s.opacity !== undefined && s.opacity < 1) parts.push(`opacity="${s.opacity}"`)
  if (s.blur) parts.push(`blur="${s.blur}"`)
  if (s.clipContent) parts.push(`clip="true"`)
  return parts.join(" ")
}

function layoutAttrs(node: CompressedNode): string {
  const l = node.layout
  if (!l) return ""
  const parts: string[] = []
  if (l.mode) parts.push(l.mode)
  if (l.primaryAlign) parts.push(`align:${l.primaryAlign}`)
  if (l.counterAlign) parts.push(`cross:${l.counterAlign}`)
  if (l.gap) parts.push(`gap:${l.gap}`)
  if (l.sizingH) parts.push(`h:${l.sizingH}`)
  if (l.sizingV) parts.push(`v:${l.sizingV}`)
  if (l.wrap) parts.push(`wrap:${l.wrap}`)
  return parts.length > 0 ? `layout="${parts.join(" ")}"` : ""
}

function paddingAttr(node: CompressedNode): string {
  const p = node.layout?.padding
  if (!p) return ""
  if (p[0] === 0 && p[1] === 0 && p[2] === 0 && p[3] === 0) return ""
  return `padding="${p.join(",")}"`
}

function textStyle(text: CompressedNode["text"]): string {
  if (!text) return ""
  return compileTextStyle(text)
}

// ─── Position detection ──────────────────────────────────────────────────

const BOTTOM_NAMES = /bottom|tab_bar|tabbar|dock|footer_nav/i
const STICKY_NAMES = /sticky|fixed_header|top_bar|topbar/i

function detectPosition(
  node: CompressedNode,
  parent: CompressedNode | undefined,
  isFirst: boolean,
  isLast: boolean,
): string {
  const name = (node.componentName || node.name || "").toLowerCase()

  if (isLast && BOTTOM_NAMES.test(name)) return `position="fixed-bottom"`
  if (isLast && parent?.bounds && node.bounds) {
    const nodeBottom = node.bounds.y + node.bounds.h
    const parentBottom = parent.bounds.h
    if (Math.abs(nodeBottom - parentBottom) < 10) return `position="fixed-bottom"`
  }

  if (isFirst && STICKY_NAMES.test(name)) return `position="sticky-top"`
  if (isFirst && /header/i.test(name) && node.bounds && node.bounds.y < 10) return `position="sticky-top"`

  return ""
}

// ─── Per-node compilation ────────────────────────────────────────────────

function resolveTag(node: CompressedNode): string {
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") return "Component"
  if (node.componentName) return "Component"
  if (node.imageUrl) return "Image"
  if (node.children && node.children.length > 0) return "Container"
  return "Box"
}

function compileNode(
  node: CompressedNode,
  depth: number,
  parentDepth?: number,
  isFirst?: boolean,
  isLast?: boolean,
  parent?: CompressedNode,
): string {
  const indent = "  ".repeat(depth)
  const tag = resolveTag(node)
  const name = sanitizeCJKName(node.componentName || node.name)

  const descAttr = node.description ? `desc="${escapeXmlAttr(node.description)}"` : ""

  const annotations = node.annotations?.length
    ? `\n${indent}  <!-- notes: ${node.annotations.join(" | ")} -->`
    : ""

  // Text node
  if (node.text?.content) {
    const style = textStyle(node.text)
    const bgPart = node.style?.bg ? ` bg="${node.style.bg}"` : ""
    const content =
      node.text.content.length > COMPILE_MAX_TEXT_LEN
        ? node.text.content.slice(0, COMPILE_MAX_TEXT_LEN) + "..."
        : node.text.content
    return `${indent}<Text name="${name}" style="${style}"${bgPart}>${content}</Text>`
  }

  // Image leaf
  if (node.imageUrl && (!node.children || node.children.length === 0)) {
    const attrs = joinAttrs(
      `name="${name}"`,
      compileSizeAttr(node.bounds),
      descAttr,
      `src="${node.imageUrl}"`,
      styleAttrs(node),
    )
    return `${indent}<Image ${attrs} />`
  }

  // Leaf (no children, no text)
  if (!node.children || node.children.length === 0) {
    const attrs = joinAttrs(`name="${name}"`, compileSizeAttr(node.bounds), descAttr, styleAttrs(node))
    const repeatAttr = node.repeatCount ? ` repeat="${node.repeatCount}"` : ""
    return `${indent}<Box ${attrs}${repeatAttr} />`
  }

  // Container / Component
  const posAttr = parentDepth === 0 ? detectPosition(node, parent, Boolean(isFirst), Boolean(isLast)) : ""
  const attrs = joinAttrs(
    `name="${name}"`,
    compileSizeAttr(node.bounds),
    descAttr,
    posAttr,
    layoutAttrs(node),
    paddingAttr(node),
    styleAttrs(node),
  )

  const repeatAttr = node.repeatCount ? ` repeat="${node.repeatCount}"` : ""
  const srcAttr = node.imageUrl ? ` src="${node.imageUrl}"` : ""
  const componentAttr =
    tag === "Component" && node.componentName
      ? ` component="${sanitizeCJKName(node.componentName)}"`
      : ""

  const children = node.children
  const childLines = children
    .map((c, i) => compileNode(c, depth + 1, depth, i === 0, i === children.length - 1, node))
    .join("\n")

  return [
    `${indent}<${tag} ${attrs}${componentAttr}${srcAttr}${repeatAttr}>${annotations}`,
    childLines,
    `${indent}</${tag}>`,
  ].join("\n")
}

// ─── Design-level sections ───────────────────────────────────────────────

function compileTokens(design: CompressedDesign): string {
  const lines: string[] = []
  const t = design.tokens

  const colorEntries = Object.entries(t.colors)
  if (colorEntries.length > 0) {
    lines.push("<!-- Design Tokens: Colors")
    for (const [name, value] of colorEntries) lines.push(`  ${name}: ${value}`)
    lines.push("-->")
  }

  if (t.fonts.length > 0) {
    lines.push(`<!-- Design Tokens: Fonts: ${t.fonts.join(", ")} -->`)
  }

  if (t.gradients.length > 0) {
    lines.push("<!-- Design Tokens: Gradients")
    for (const g of t.gradients) lines.push(`  ${g}`)
    lines.push("-->")
  }

  if (t.textStyles.length > 0) {
    lines.push("<!-- Design Tokens: Text Styles")
    for (const s of t.textStyles) {
      const parts: Array<string | number | undefined> = [s.font, `${s.size}px`, s.weight, s.color]
      if (s.lineHeight !== undefined) parts.push(`lh:${s.lineHeight}`)
      if (s.letterSpacing) parts.push(`ls:${s.letterSpacing}`)
      lines.push(`  ${s.name}: ${parts.join(" ")}`)
    }
    lines.push("-->")
  }

  if (t.effects.length > 0) {
    lines.push("<!-- Design Tokens: Effects")
    for (const e of t.effects) lines.push(`  ${e.name} (${e.type}): ${e.value}`)
    lines.push("-->")
  }

  return lines.join("\n")
}

function compileComponents(design: CompressedDesign): string {
  const entries = Object.entries(design.components)
  if (entries.length === 0) return ""
  const lines = ["<!-- Component Definitions"]
  for (const [id, comp] of entries) {
    const desc = comp.description ? ` — ${comp.description}` : ""
    lines.push(`  ${sanitizeCJKName(comp.name)} (${id})${desc}`)
  }
  lines.push("-->")
  return lines.join("\n")
}

function compileImages(design: CompressedDesign): string {
  const entries = Object.entries(design.images).filter(([, url]) => Boolean(url))
  if (entries.length === 0) return ""
  const lines = ["<!-- Image Assets"]
  for (const [nodeId, url] of entries) lines.push(`  ${nodeId}: ${url}`)
  lines.push("-->")
  return lines.join("\n")
}

// ─── Public API ──────────────────────────────────────────────────────────

/** Byte-parity string form — exposed for golden-parity testing only. */
export function compileDesignToXmlString(design: CompressedDesign): string {
  const sections: string[] = []

  sections.push(`<!-- Design: ${design.fileName} | Modified: ${design.lastModified} -->`)

  const tokens = compileTokens(design)
  if (tokens) sections.push(tokens)

  const components = compileComponents(design)
  if (components) sections.push(components)

  const images = compileImages(design)
  if (images) sections.push(images)

  for (const page of design.pages) {
    sections.push(`\n<!-- Page: ${page.name} -->`)
    for (const frame of page.frames) {
      if (frame.bounds && frame.bounds.w <= 768) {
        sections.push(
          `<!-- VIEWPORT: mobile ${frame.bounds.w}x${frame.bounds.h} — use max-w-[${frame.bounds.w}px] mx-auto on root container -->`,
        )
      }
      sections.push(compileNode(frame, 0))
    }
  }

  return sections.join("\n")
}

/**
 * Compile a `CompressedDesign` to `XmlIR` — wraps the byte-parity string
 * form with byte count and estimated token count so skill callers can
 * budget before feeding into a codegen agent.
 */
export function compileDesignToXML(design: CompressedDesign): XmlIR {
  const xml = compileDesignToXmlString(design)
  const ir: XmlIR = {
    source: "figma",
    xml,
    bytes: Buffer.byteLength(xml, "utf8"),
    estimatedTokens: estimateTokens(xml),
  }
  return XmlIRSchema.parse(ir)
}
