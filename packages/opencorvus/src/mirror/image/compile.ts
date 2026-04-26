/**
 * Deterministic compiler: `ImageAnalysis` → `XmlIR`.
 *
 * Image2code analogue of `mirror/url/compile.ts` and `mirror/figma/compile.ts`.
 * Pure function, zero LLM, sub-50ms — the SAME XML dialect every compile
 * target produces (rule 22: single XML grammar across sources, downstream
 * codegen does not branch per source).
 *
 * Helpers (`joinAttrs`, `compileSizeAttr`, `compileTextStyle`) live in
 * `mirror/shared/compile-helpers.ts` and are reused by `figma/compile.ts`
 * — extracted from figma/compile when image2code joined as a third compile
 * target so the helpers had a real cross-pipeline reuse case.
 */

import {
  joinAttrs,
  compileSizeAttr,
  compileTextStyle,
} from "../shared/compile-helpers"
import { escapeXmlAttr, escapeXmlText } from "../shared/xml-escape"
import { estimateTokens } from "../shared/token-estimator"
import { CompileError } from "../errors"
import {
  ImageAnalysisSchema,
  type ImageAnalysis,
  type ImageElement,
} from "../ir/image-analysis"
import { XmlIRSchema, type XmlIR } from "../ir/xml-ir"

// `infra/config.ts::COMPILE_MAX_TEXT_LEN = Infinity` upstream — text content
// passes through verbatim. Inlined; if a future caller needs truncation it
// must do so before calling compile (same convention as figma/compile.ts).
const COMPILE_MAX_TEXT_LEN = Infinity

// ─── Attribute builders ──────────────────────────────────────────────────

function styleAttrs(el: ImageElement): string {
  const s = el.style
  if (!s) return ""
  const parts: string[] = []
  if (s.bg) parts.push(`bg="${escapeXmlAttr(s.bg)}"`)
  if (s.bgGradient) parts.push(`gradient="${escapeXmlAttr(s.bgGradient)}"`)
  if (s.border) parts.push(`border="${escapeXmlAttr(s.border)}"`)
  if (s.borderRadius !== undefined) {
    const br = String(s.borderRadius)
    parts.push(`radius="${br.includes("px") ? br : `${br}px`}"`)
  }
  if (s.shadow) parts.push(`shadow="${escapeXmlAttr(s.shadow)}"`)
  if (s.opacity !== undefined && s.opacity !== 1) parts.push(`opacity="${s.opacity}"`)
  if (s.padding) {
    const [t, r, b, l] = s.padding
    parts.push(`padding="${t}px ${r}px ${b}px ${l}px"`)
  }
  return parts.join(" ")
}

function layoutAttr(el: ImageElement): string {
  const lay = el.layout
  if (!lay) return ""
  const parts: string[] = []

  if (lay.direction === "horizontal") parts.push("HORIZONTAL")
  else if (lay.direction === "grid") {
    parts.push("GRID")
    if (lay.gridCols) parts.push(`cols:${lay.gridCols}`)
  } else parts.push("VERTICAL")

  if (lay.align) parts.push(`align:${lay.align}`)
  if (lay.crossAlign) parts.push(`cross:${lay.crossAlign}`)
  if (lay.gap) parts.push(`gap:${lay.gap}px`)
  if (lay.wrap) parts.push("wrap:WRAP")

  return parts.length > 0 ? `layout="${parts.join(" ")}"` : ""
}

function textStyleAttr(el: ImageElement): string {
  if (!el.text) return ""
  return compileTextStyle(el.text, { suppressDefaultAlign: true, lineHeightUnit: "px" })
}

// ─── Element compiler ────────────────────────────────────────────────────

function resolveTag(el: ImageElement): string {
  if (el.text && (!el.children || el.children.length === 0)) return "Text"
  if (el.image && (!el.children || el.children.length === 0)) return "Image"
  if (el.children && el.children.length > 0) return "Container"
  return "Box"
}

function compileElement(el: ImageElement, depth: number): string {
  const indent = "  ".repeat(depth)
  const tag = resolveTag(el)
  const name = escapeXmlAttr(el.role || el.name || "element")

  // Text leaf
  if (el.text && (!el.children || el.children.length === 0)) {
    const style = textStyleAttr(el)
    const bgPart = el.style?.bg ? ` bg="${escapeXmlAttr(el.style.bg)}"` : ""
    const raw = el.text.content ?? ""
    const truncated = raw.length > COMPILE_MAX_TEXT_LEN
      ? `${raw.slice(0, COMPILE_MAX_TEXT_LEN)}...`
      : raw
    return `${indent}<Text name="${name}" style="${style}"${bgPart}>${escapeXmlText(truncated)}</Text>`
  }

  // Image leaf
  if (el.image && (!el.children || el.children.length === 0)) {
    const attrs = joinAttrs(
      `name="${name}"`,
      compileSizeAttr(el.bounds),
      el.image.alt ? `alt="${escapeXmlAttr(el.image.alt)}"` : "",
      el.image.aspectRatio ? `aspect="${escapeXmlAttr(el.image.aspectRatio)}"` : "",
      styleAttrs(el),
    )
    return `${indent}<Image ${attrs} />`
  }

  // Empty leaf (no text, no image, no children)
  if (!el.children || el.children.length === 0) {
    const attrs = joinAttrs(
      `name="${name}"`,
      compileSizeAttr(el.bounds),
      styleAttrs(el),
    )
    const repeatAttr = el.repeatCount ? ` repeat="${el.repeatCount}"` : ""
    const hintAttr = el.componentHint ? ` component="${escapeXmlAttr(el.componentHint)}"` : ""
    return `${indent}<Box ${attrs}${repeatAttr}${hintAttr} />`
  }

  // Container with children
  const attrs = joinAttrs(
    `name="${name}"`,
    compileSizeAttr(el.bounds),
    layoutAttr(el),
    styleAttrs(el),
  )
  const roleAttr = el.role ? ` role="${escapeXmlAttr(el.role)}"` : ""
  const repeatAttr = el.repeatCount ? ` repeat="${el.repeatCount}"` : ""
  const hintAttr = el.componentHint ? ` component="${escapeXmlAttr(el.componentHint)}"` : ""
  const childLines = el.children.map((c) => compileElement(c, depth + 1)).join("\n")
  return [
    `${indent}<${tag} ${attrs}${roleAttr}${repeatAttr}${hintAttr}>`,
    childLines,
    `${indent}</${tag}>`,
  ].join("\n")
}

// ─── Tokens compiler ─────────────────────────────────────────────────────

function compileTokens(analysis: ImageAnalysis): string {
  const lines: string[] = []
  const t = analysis.tokens

  const colorEntries = Object.entries(t.colors)
  if (colorEntries.length > 0) {
    lines.push("<!-- Design Tokens: Colors")
    for (const [name, value] of colorEntries) lines.push(`  ${name}: ${value}`)
    lines.push("-->")
  }

  if (t.fonts.length > 0) {
    lines.push(`<!-- Design Tokens: Fonts: ${t.fonts.join(", ")} -->`)
  }

  if (t.textStyles.length > 0) {
    lines.push("<!-- Design Tokens: Text Styles")
    for (const ts of t.textStyles) {
      const parts = [ts.name, ts.font ?? "", `${ts.size}px`, `w${ts.weight}`, ts.color]
      if (ts.lineHeight) parts.push(`lh:${ts.lineHeight}px`)
      lines.push(`  ${parts.filter(Boolean).join(" ")}`)
    }
    lines.push("-->")
  }

  return lines.join("\n")
}

// ─── Public entry ────────────────────────────────────────────────────────

export function compileImageAnalysisToXML(analysis: ImageAnalysis): XmlIR {
  // Strict boundary validation. The skill / tool wrapper hands raw JSON
  // through; we refuse malformed input here so callers see a typed
  // failure instead of a half-formed XML payload (rule 1).
  const parsed = ImageAnalysisSchema.safeParse(analysis)
  if (!parsed.success) {
    throw new CompileError({
      source: "image",
      reason: `ImageAnalysisSchema rejected payload: ${parsed.error.message}`,
    })
  }
  const norm = parsed.data

  const sections: string[] = []
  sections.push(
    `<!-- Image Analysis: ${escapeXmlText(norm.description)} | ` +
      `Viewport: ${norm.viewport.width}x${norm.viewport.height} | ` +
      `Confidence: ${(norm.confidence * 100).toFixed(0)}% -->`,
  )

  const tokens = compileTokens(norm)
  if (tokens) sections.push(tokens)

  sections.push("\n<!-- Page Structure -->")
  for (const el of norm.tree) sections.push(compileElement(el, 0))

  const xml = sections.join("\n")
  const bytes = Buffer.byteLength(xml, "utf8")
  const ir: XmlIR = {
    source: "image",
    xml,
    bytes,
    estimatedTokens: estimateTokens(xml),
  }

  // Round-trip the result through Zod so XmlIR shape changes (e.g. a new
  // mandatory field) catch image/compile alongside its sibling compilers.
  return XmlIRSchema.parse(ir)
}

// Re-export internal helpers for test introspection.
export { compileElement, compileTokens, styleAttrs, layoutAttr, textStyleAttr, resolveTag }
