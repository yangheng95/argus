/**
 * Deterministic HTML compiler — turns an `ExtractedPage` into a single
 * static `index.html` document with inline styles, no JavaScript.
 *
 * Replaces the LLM-handwritten clone path: the agent no longer rewrites
 * the DOM from a screenshot; instead the mirror toolchain extracts the
 * authoritative DOM tree + computed styles + image map, and this module
 * replays it as inline-styled HTML. The agent's job is only to (a) trigger
 * compilation, (b) render and evaluate, (c) iterate on remaining diffs by
 * editing the compiled `index.html` directly when visual evaluation
 * surfaces specific gaps.
 *
 * Pure function — no I/O, no LLM, no network. Input is an
 * `ExtractedPage`; output is a string ready to write to disk.
 */
import type { ExtractedElement, ExtractedPage, ExtractedStyles } from "../ir/extracted-page"

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
])

const ALLOWED_STYLE_KEYS = [
  "display",
  "flexDirection",
  "flexWrap",
  "justifyContent",
  "alignItems",
  "gap",
  "gridTemplateColumns",
  "gridTemplateRows",
  "position",
  "overflow",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "margin",
  "padding",
  "backgroundColor",
  "backgroundImage",
  "border",
  "borderRadius",
  "boxShadow",
  "opacity",
  "cursor",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "color",
  "textAlign",
  "textDecoration",
] as const

const DROP_ATTRS = new Set([
  "id",
  "class",
  "style",
  "data-reactroot",
  "data-reactid",
])

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
}

function camelToKebab(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

function styleToString(styles: ExtractedStyles | undefined): string {
  if (!styles) return ""
  const parts: string[] = []
  for (const key of ALLOWED_STYLE_KEYS) {
    const value = styles[key]
    if (typeof value !== "string") continue
    const trimmed = value.trim()
    if (!trimmed) continue
    parts.push(`${camelToKebab(key)}: ${trimmed}`)
  }
  return parts.join("; ")
}

function attrsToString(
  attrs: Record<string, string> | undefined,
  extras: Array<[string, string]>,
): string {
  const out: string[] = []
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (DROP_ATTRS.has(k)) continue
      if (typeof v !== "string") continue
      out.push(`${k}="${escapeAttr(v)}"`)
    }
  }
  for (const [k, v] of extras) {
    if (typeof v !== "string" || v.length === 0) continue
    out.push(`${k}="${escapeAttr(v)}"`)
  }
  return out.length > 0 ? " " + out.join(" ") : ""
}

interface CompileContext {
  /** Map from original asset URL to the local path the worktree will serve.
   *  Sourced from `ExtractedPage.assets.imageMap` (set by `webpage_extract`
   *  when `keep_images` is true). Untouched when the URL is not in the map. */
  imageMap: Record<string, string>
}

function remapImageSrc(src: string | undefined, ctx: CompileContext): string | undefined {
  if (!src) return undefined
  return ctx.imageMap[src] ?? src
}

function renderElement(el: ExtractedElement, ctx: CompileContext, depth: number): string {
  const indent = "  ".repeat(depth)
  const tag = el.tag.toLowerCase()
  const style = styleToString(el.styles)
  const isVoid = VOID_TAGS.has(tag)

  const extras: Array<[string, string]> = []
  if (style) extras.push(["style", style])
  if (tag === "a" && el.href) extras.push(["href", el.href])
  if (tag === "img") {
    const remapped = remapImageSrc(el.imageSrc, ctx)
    if (remapped) extras.push(["src", remapped])
    if (el.imageAlt) extras.push(["alt", el.imageAlt])
  }
  if (el.aria) {
    for (const [k, v] of Object.entries(el.aria)) {
      extras.push([`aria-${k}`, v])
    }
  }

  const attrs = attrsToString(el.attrs, extras)

  if (isVoid) {
    return `${indent}<${tag}${attrs} />`
  }

  const text = el.text ? escapeText(el.text) : ""
  const children = el.children ?? []
  if (children.length === 0) {
    return `${indent}<${tag}${attrs}>${text}</${tag}>`
  }
  const inner = children.map((c) => renderElement(c, ctx, depth + 1)).join("\n")
  if (text) {
    return `${indent}<${tag}${attrs}>${text}\n${inner}\n${indent}</${tag}>`
  }
  return `${indent}<${tag}${attrs}>\n${inner}\n${indent}</${tag}>`
}

export interface CompileHtmlOptions {
  /** Override the page title. Defaults to `page.title`. */
  title?: string
  /** Image-asset path remap. Merged on top of `page.assets.imageMap`. */
  imageMap?: Record<string, string>
}

export function compileExtractedPageToHtml(
  page: ExtractedPage,
  options: CompileHtmlOptions = {},
): string {
  const ctx: CompileContext = {
    imageMap: { ...(page.assets.imageMap ?? {}), ...(options.imageMap ?? {}) },
  }
  const body = page.tree.map((el) => renderElement(el, ctx, 2)).join("\n")
  const title = escapeText(options.title ?? page.title ?? "")
  const viewport = `width=${page.viewport.width}, initial-scale=1`
  const fontFaces = page.tokens.fonts
    .map((f) => f.trim())
    .filter(Boolean)
    .join(", ")
  const bodyStyle = fontFaces
    ? `margin: 0; font-family: ${fontFaces}`
    : "margin: 0"

  return `<!doctype html>
<html lang="${escapeAttr(page.url ? "" : "")}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="${escapeAttr(viewport)}" />
  <title>${title}</title>
</head>
<body style="${escapeAttr(bodyStyle)}">
${body}
</body>
</html>
`
}
