/**
 * Deterministic URL IR → XML compiler.
 *
 * Consumes an `ExtractedPage` (typically produced by `url/extract`) and
 * emits the same compact XML dialect used by the Figma pipeline. Zero LLM
 * calls. Output is byte-identical to mirror's `urlCompileService.execute(...)`.
 *
 * Ported from `mirror/src/service/url-compile.ts`. Inlines `joinAttrs`,
 * `compileSizeAttr`, and the three `URL_COMPILE_*` config constants so the
 * tool is self-contained (no cross-module cache of helpers).
 *
 * **Public surface**: `compilePageToXML(page) → XmlIR` wraps the byte-parity
 * string form. `compileElement` is exported because `url/pattern/contract`
 * (Phase F5) consumes it to turn subtrees into section-IR snippets.
 */

import { escapeXmlAttr, escapeXmlText } from "../shared/xml-escape"
import { estimateTokens } from "../shared/token-estimator"
import type { ExtractedElement, ExtractedPage, ExtractedStyles } from "../ir/extracted-page"
import { XmlIRSchema, type XmlIR } from "../ir/xml-ir"

// Mirror `infra/config.ts` constants. Repeat folding (`<Repeat count=N>`)
// disabled by default — the LLM hand-write path needs the full DOM tree to
// reproduce per-item structure (e.g. each Baidu hot-search row's text + tag).
// Folding loses per-instance attributes the codegen agent then cannot recover.
const URL_COMPILE_MAX_SIBLINGS = 30
const URL_COMPILE_REPEAT_THRESHOLD = Infinity
const URL_COMPILE_MAX_REPEAT_DATA_ITEMS = 20

// ─── ir-utils (inlined from mirror/infra/compile/ir-utils.ts) ────────────

function joinAttrs(...parts: string[]): string {
  return parts.filter(Boolean).join(" ")
}

function compileSizeAttr(bounds: { w: number; h: number } | undefined): string {
  if (!bounds) return ""
  return `size="${bounds.w}x${bounds.h}"`
}

// ─── URL normalisation ───────────────────────────────────────────────────

export function normalizeUrl(url: string): string {
  if (!url) return ""
  if (url.startsWith("blob:")) return ""
  if (url.startsWith("//")) return `https:${url}`
  return url
}

// ─── Style → attribute helpers ───────────────────────────────────────────

function cssToStyleAttrs(styles: ExtractedStyles, imageMap?: Record<string, string>): string {
  const parts: string[] = []
  if (
    styles.backgroundColor &&
    styles.backgroundColor !== "rgba(0, 0, 0, 0)" &&
    styles.backgroundColor !== "transparent"
  ) {
    parts.push(`bg="${escapeXmlAttr(styles.backgroundColor)}"`)
  }
  if (styles.backgroundImage && styles.backgroundImage !== "none") {
    const bgVal = styles.backgroundImage
    const urlMatch = bgVal.match(/url\(["']?(.*?)["']?\)/)
    if (urlMatch && !/gradient\(/.test(bgVal)) {
      const raw = urlMatch[1] ?? ""
      const resolved = normalizeUrl((imageMap && imageMap[raw]) || raw)
      if (resolved) parts.push(`bg-image="${escapeXmlAttr(resolved)}"`)
    } else if (/gradient\(/.test(bgVal)) {
      parts.push(`gradient="${escapeXmlAttr(bgVal)}"`)
    } else {
      parts.push(`bg-image="${escapeXmlAttr(bgVal)}"`)
    }
  }
  if (styles.border && styles.border !== "none" && !/^0px\s+none\b/.test(styles.border)) {
    parts.push(`border="${escapeXmlAttr(styles.border)}"`)
  }
  if (styles.borderRadius && styles.borderRadius !== "0px") {
    parts.push(`radius="${escapeXmlAttr(styles.borderRadius)}"`)
  }
  if (styles.boxShadow && styles.boxShadow !== "none") {
    parts.push(`shadow="${escapeXmlAttr(styles.boxShadow)}"`)
  }
  if (styles.opacity && styles.opacity !== "1" && styles.opacity !== "0") {
    parts.push(`opacity="${escapeXmlAttr(styles.opacity)}"`)
  }
  if (styles.padding && styles.padding !== "0px" && !/^0px(\s+0px)*$/.test(styles.padding)) {
    parts.push(`padding="${escapeXmlAttr(styles.padding)}"`)
  }
  if (styles.margin && styles.margin !== "0px" && !/^0px(\s+0px)*$/.test(styles.margin)) {
    parts.push(`margin="${escapeXmlAttr(styles.margin)}"`)
  }
  if (styles.position && styles.position !== "static") {
    parts.push(`position="${escapeXmlAttr(styles.position)}"`)
  }
  const skipSize = new Set(["", "none", "auto", "0px"])
  if (styles.maxWidth && !skipSize.has(styles.maxWidth)) parts.push(`max-w="${escapeXmlAttr(styles.maxWidth)}"`)
  if (styles.minWidth && !skipSize.has(styles.minWidth)) parts.push(`min-w="${escapeXmlAttr(styles.minWidth)}"`)
  if (styles.maxHeight && !skipSize.has(styles.maxHeight)) parts.push(`max-h="${escapeXmlAttr(styles.maxHeight)}"`)
  if (styles.minHeight && !skipSize.has(styles.minHeight)) parts.push(`min-h="${escapeXmlAttr(styles.minHeight)}"`)
  return parts.join(" ")
}

function cssToLayoutAttr(styles: ExtractedStyles): string {
  const parts: string[] = []
  const display = styles.display

  if (display === "flex" || display === "inline-flex") {
    const dir = styles.flexDirection
    if (dir === "column" || dir === "column-reverse") parts.push("VERTICAL")
    else parts.push("HORIZONTAL")
    if (styles.justifyContent) parts.push(`align:${styles.justifyContent}`)
    if (styles.alignItems) parts.push(`cross:${styles.alignItems}`)
    if (styles.gap && styles.gap !== "normal" && styles.gap !== "0px") parts.push(`gap:${styles.gap}`)
    if (styles.flexWrap === "wrap" || styles.flexWrap === "wrap-reverse") parts.push("wrap:WRAP")
  } else if (display === "grid" || display === "inline-grid") {
    parts.push("GRID")
    if (styles.gridTemplateColumns) parts.push(`cols:${styles.gridTemplateColumns}`)
    if (styles.gridTemplateRows) parts.push(`rows:${styles.gridTemplateRows}`)
    if (styles.gap && styles.gap !== "normal" && styles.gap !== "0px") parts.push(`gap:${styles.gap}`)
  }

  if (styles.overflow && styles.overflow !== "visible") {
    parts.push(`overflow:${styles.overflow}`)
  }

  return parts.length > 0 ? `layout="${escapeXmlAttr(parts.join(" "))}"` : ""
}

const ICON_FONT_RE =
  /^(c?iconfont|cos-icon|fontawesome|material[- ]?icons?|glyphicons|ionicons|feather|remixicon|bootstrap-icons|anticon)/i

function cssToTextStyle(styles: ExtractedStyles): string {
  const parts: string[] = []
  if (styles.fontFamily) {
    const families = styles.fontFamily
      .split(",")
      .map((f) => f.replace(/['"]/g, "").trim())
      .filter(Boolean)
    const textFont = families.find((f) => !ICON_FONT_RE.test(f))
    if (textFont) parts.push(textFont)
  }
  if (styles.fontSize) parts.push(styles.fontSize)
  if (styles.fontWeight) parts.push(styles.fontWeight)
  if (styles.color) parts.push(styles.color)
  if (styles.lineHeight && styles.lineHeight !== "normal") parts.push(`lh:${styles.lineHeight}`)
  if (styles.letterSpacing && styles.letterSpacing !== "normal" && styles.letterSpacing !== "0px") {
    parts.push(`ls:${styles.letterSpacing}`)
  }
  if (styles.textAlign && styles.textAlign !== "start") parts.push(`align:${styles.textAlign}`)
  if (styles.textDecoration && styles.textDecoration !== "none" && !styles.textDecoration.startsWith("none")) {
    parts.push(`decoration:${styles.textDecoration}`)
  }
  return parts.join(" ")
}

// ─── HTML attribute compilation ──────────────────────────────────────────

const USEFUL_HTML_ATTRS = new Set([
  "type", "placeholder", "value", "name", "required", "disabled", "readonly",
  "min", "max", "step", "pattern", "maxlength", "minlength", "checked",
  "multiple", "accept", "for", "action", "method",
  "src", "srcset", "poster", "loading", "decoding",
  "autoplay", "muted", "loop", "controls", "playsinline", "preload",
  "href", "target", "rel", "download",
  "role", "tabindex", "title", "lang",
  "sandbox", "allow", "allowfullscreen",
  "data-state", "data-tab", "data-index", "data-active", "data-selected",
  "data-value", "data-type", "data-id",
])

function compileHtmlAttrs(el: ExtractedElement): string {
  if (!el.attrs) return ""
  const parts: string[] = []
  for (const [key, val] of Object.entries(el.attrs)) {
    if (key === "href" || key === "id" || key === "src" || key === "alt") continue
    if (USEFUL_HTML_ATTRS.has(key)) {
      parts.push(val === "" ? key : `${key}="${escapeXmlAttr(val)}"`)
    }
  }
  return parts.join(" ")
}

// ─── Repeat-group detection ──────────────────────────────────────────────

function heightTier(el: ExtractedElement): string {
  const h = el.bounds?.h ?? 0
  if (h < 50) return "xs"
  if (h < 200) return "sm"
  if (h < 500) return "md"
  if (h < 2000) return "lg"
  return "xl"
}

export function siblingFingerprint(el: ExtractedElement): string {
  const tag = resolveTag(el)
  const name = el.role || el.tag
  const children = el.children || []
  const childCount = children.length
  const childTags = children.map((c) => c.role || c.tag).join(",")
  const grandchildShape = children
    .slice(0, 3)
    .map((c) => (c.children || []).length)
    .join("-")
  const layout = cssToLayoutAttr(el.styles)
  const ht = heightTier(el)
  return `${tag}:${name}:${childCount}:${childTags}:${grandchildShape}:${layout}:${ht}`
}

export interface RepeatItem {
  texts: string[]
  images: string[]
  hrefs: string[]
}

export interface RepeatGroup {
  template: ExtractedElement
  count: number
  items: RepeatItem[]
}

export function extractRepeatItem(el: ExtractedElement): RepeatItem {
  const texts: string[] = []
  const images: string[] = []
  const hrefs: string[] = []
  function walk(node: ExtractedElement): void {
    if (node.text) texts.push(node.text.length > 100 ? node.text.slice(0, 100) + "..." : node.text)
    if (node.imageSrc) {
      const normalized = normalizeUrl(node.imageSrc)
      if (normalized) images.push(normalized)
    }
    if (node.href) {
      const normalized = normalizeUrl(node.href)
      if (normalized) hrefs.push(normalized)
    }
    if (node.children) for (const c of node.children) walk(c)
  }
  walk(el)
  return { texts, images, hrefs }
}

export function hasVariedContent(items: RepeatItem[]): boolean {
  if (items.length <= 1) return false
  const first = items[0]
  const key = (it: RepeatItem) => [...it.texts, "|", ...it.images, "|", ...it.hrefs].join("\0")
  const firstKey = key(first)
  return items.some((it) => key(it) !== firstKey)
}

export function buildRepeatDataComment(items: RepeatItem[], depth: number): string {
  if (!hasVariedContent(items)) return ""
  const indent = "  ".repeat(depth)
  const maxItems = URL_COMPILE_MAX_REPEAT_DATA_ITEMS
  const displayItems = items.slice(0, maxItems)

  const data = displayItems.map((it) => {
    const obj: Record<string, string[]> = {}
    if (it.texts.length) obj.texts = it.texts
    if (it.images.length) obj.images = it.images
    if (it.hrefs.length) obj.hrefs = it.hrefs
    return obj
  })

  const truncationNote = items.length > maxItems ? ` (+${items.length - maxItems} more)` : ""
  return `${indent}<!-- REPEAT_DATA:${JSON.stringify(data)}${truncationNote} -->`
}

export function adaptiveRepeatThreshold(siblingCount: number, configThreshold: number): number {
  if (siblingCount > 15) return configThreshold + 1
  return configThreshold
}

export function detectRepeats(
  children: ExtractedElement[],
  threshold: number,
): Array<ExtractedElement | RepeatGroup> {
  const result: Array<ExtractedElement | RepeatGroup> = []
  const effectiveThreshold = adaptiveRepeatThreshold(children.length, threshold)
  let i = 0
  while (i < children.length) {
    const fp = siblingFingerprint(children[i])
    let j = i + 1
    while (j < children.length && siblingFingerprint(children[j]) === fp) j++
    if (j - i >= effectiveThreshold) {
      const items = children.slice(i, j).map(extractRepeatItem)
      result.push({ template: children[i], count: j - i, items })
      i = j
    } else {
      for (let k = i; k < j; k++) result.push(children[k])
      i = j
    }
  }
  return result
}

function isRepeatGroup(item: ExtractedElement | RepeatGroup): item is RepeatGroup {
  return "template" in item && "count" in item
}

// ─── Element compiler ────────────────────────────────────────────────────

export function resolveTag(el: ExtractedElement): string {
  if (el.text && (!el.children || el.children.length === 0)) return "Text"
  if (el.imageSrc && (!el.children || el.children.length === 0)) return "Image"
  if (el.children && el.children.length > 0) return "Container"
  return "Box"
}

export function countDescendants(el: ExtractedElement): number {
  if (!el.children) return 0
  let count = el.children.length
  for (const c of el.children) count += countDescendants(c)
  return count
}

function summarizeChildren(el: ExtractedElement): string {
  if (!el.children || el.children.length === 0) return ""
  const texts = el.children.filter((c) => c.text).length
  const containers = el.children.filter((c) => c.children?.length).length
  const images = el.children.filter((c) => c.imageSrc).length
  const parts: string[] = []
  if (texts) parts.push(`${texts} text`)
  if (containers) parts.push(`${containers} containers`)
  if (images) parts.push(`${images} images`)
  const total = countDescendants(el)
  return parts.length > 0 ? `${parts.join(", ")} (${total} total descendants)` : `${total} descendants`
}

export interface CompileOptions {
  maxSiblings?: number
  repeatThreshold?: number
  maxTokens?: number
  tokenCounter?: { current: number }
  imageRegistry?: Map<string, number>
}

/**
 * Compile a single `ExtractedElement` subtree to XML. Exposed because
 * `url/pattern/contract` (Phase F5) uses it to turn section subtrees into
 * per-section IR snippets.
 */
export function compileElement(
  el: ExtractedElement,
  depth: number,
  maxCompileDepth = 99,
  imageMap?: Record<string, string>,
  options?: CompileOptions,
): string {
  if (options?.tokenCounter && options.maxTokens && options.tokenCounter.current >= options.maxTokens) {
    const summary = el.children?.length ? summarizeChildren(el) : el.text ? "text" : el.tag
    return `${"  ".repeat(depth)}<!-- budget exceeded: ${el.role || el.tag} (${summary}) -->`
  }

  if (el.bounds && el.bounds.w < 8 && el.bounds.h < 8 && !el.text && !el.imageSrc && !el.children?.length) {
    return `${"  ".repeat(depth)}<!-- decorative ${el.tag} -->`
  }

  const indent = "  ".repeat(depth)
  const tag = resolveTag(el)
  const name = el.role || el.tag
  const eName = escapeXmlAttr(name)
  const htmlAttrs = compileHtmlAttrs(el)

  // Text leaf
  if (el.text && (!el.children || el.children.length === 0)) {
    const style = escapeXmlAttr(cssToTextStyle(el.styles))
    const bgPart =
      el.styles.backgroundColor &&
      el.styles.backgroundColor !== "rgba(0, 0, 0, 0)" &&
      el.styles.backgroundColor !== "transparent"
        ? ` bg="${escapeXmlAttr(el.styles.backgroundColor)}"`
        : ""
    const htmlPart = htmlAttrs ? ` ${htmlAttrs}` : ""
    const rawContent = el.text.length > 300 ? el.text.slice(0, 300) + "..." : el.text
    const content = escapeXmlText(rawContent)
    const output = `${indent}<Text name="${eName}" style="${style}"${bgPart}${htmlPart}>${content}</Text>`
    if (options?.tokenCounter) options.tokenCounter.current += estimateTokens(output)
    return output
  }

  // Mixed-content text + inline spans
  if (
    el.text &&
    el.children &&
    el.children.length > 0 &&
    el.children.every(
      (c) =>
        c.text &&
        (!c.children || c.children.length === 0) &&
        (c.styles?.display === "inline" || c.styles?.display === "inline-block"),
    )
  ) {
    const parentStyle = escapeXmlAttr(cssToTextStyle(el.styles))
    const htmlPart = htmlAttrs ? ` ${htmlAttrs}` : ""

    const pieces: string[] = []
    let remaining = el.text
    for (const child of el.children) {
      const childAttrs: string[] = []
      const childStyleStr = cssToTextStyle(child.styles)
      const parentStyleStr = cssToTextStyle(el.styles)
      if (childStyleStr !== parentStyleStr) childAttrs.push(`style="${escapeXmlAttr(childStyleStr)}"`)
      if (child.styles?.backgroundImage?.includes("gradient"))
        childAttrs.push(`gradient="${escapeXmlAttr(child.styles.backgroundImage)}"`)
      const attrStr = childAttrs.length > 0 ? " " + childAttrs.join(" ") : ""

      const gapIdx = remaining.indexOf("  ")
      if (gapIdx >= 0) {
        pieces.push(escapeXmlText(remaining.slice(0, gapIdx)))
        pieces.push(` <Inline${attrStr}>${escapeXmlText(child.text!)}</Inline> `)
        remaining = remaining.slice(gapIdx + 2)
      } else {
        pieces.push(escapeXmlText(remaining))
        pieces.push(` <Inline${attrStr}>${escapeXmlText(child.text!)}</Inline>`)
        remaining = ""
      }
    }
    if (remaining) pieces.push(escapeXmlText(remaining))

    const content = pieces.join("").trim()
    const output = `${indent}<Text name="${eName}" style="${parentStyle}"${htmlPart}>${content}</Text>`
    if (options?.tokenCounter) options.tokenCounter.current += estimateTokens(output)
    return output
  }

  // Image leaf
  if (el.imageSrc && (!el.children || el.children.length === 0)) {
    const rawSrc = (imageMap && imageMap[el.imageSrc]) || el.imageSrc
    const resolvedSrc = normalizeUrl(rawSrc)
    const registry = options?.imageRegistry

    let srcAttr: string
    if (registry) {
      const existingId = registry.get(resolvedSrc)
      if (existingId != null) {
        srcAttr = `src-ref="img-${existingId}"`
      } else {
        const newId = registry.size
        registry.set(resolvedSrc, newId)
        srcAttr = `src="${escapeXmlAttr(resolvedSrc)}" src-id="img-${newId}"`
      }
    } else {
      srcAttr = `src="${escapeXmlAttr(resolvedSrc)}"`
    }

    const attrs = joinAttrs(
      `name="${eName}"`,
      compileSizeAttr(el.bounds),
      srcAttr,
      el.imageAlt ? `alt="${escapeXmlAttr(el.imageAlt)}"` : "",
      cssToStyleAttrs(el.styles, imageMap),
      htmlAttrs,
    )
    const output = `${indent}<Image ${attrs} />`
    if (options?.tokenCounter) options.tokenCounter.current += estimateTokens(output)
    return output
  }

  // Icon-font leaf
  if (el.tag === "i" && (!el.children || el.children.length === 0)) {
    const iconClass = el.classes?.find((c) => /^fa[a-z]?-/.test(c))
    if (iconClass) {
      return `${indent}<Icon name="${escapeXmlAttr(iconClass)}" ${compileSizeAttr(el.bounds)} />`
    }
    const attrs = joinAttrs(`name="${eName}"`, compileSizeAttr(el.bounds), cssToStyleAttrs(el.styles, imageMap))
    return `${indent}<Box ${attrs} />`
  }

  // Leaf
  if (!el.children || el.children.length === 0) {
    const attrs = joinAttrs(`name="${eName}"`, compileSizeAttr(el.bounds), cssToStyleAttrs(el.styles, imageMap), htmlAttrs)
    return `${indent}<Box ${attrs} />`
  }

  // Container
  const layoutAttr = cssToLayoutAttr(el.styles)
  const effectiveLayout = layoutAttr || (el.children && el.children.length > 1 ? 'layout="BLOCK"' : "")

  const attrs = joinAttrs(
    `name="${eName}"`,
    compileSizeAttr(el.bounds),
    effectiveLayout,
    cssToStyleAttrs(el.styles, imageMap),
    htmlAttrs,
  )

  const roleAttr = el.role ? ` role="${escapeXmlAttr(el.role)}"` : ""
  const normalizedHref = el.href ? normalizeUrl(el.href) : ""
  const hrefAttr = normalizedHref ? ` href="${escapeXmlAttr(normalizedHref)}"` : ""

  if (depth >= maxCompileDepth) {
    const summary = summarizeChildren(el)
    return [
      `${indent}<${tag} ${attrs}${roleAttr}${hrefAttr}>`,
      `${indent}  <!-- ${summary} -->`,
      `${indent}</${tag}>`,
    ].join("\n")
  }

  const maxSiblings = options?.maxSiblings ?? Infinity
  const repeatThreshold = options?.repeatThreshold ?? Infinity

  const grouped =
    repeatThreshold < Infinity
      ? detectRepeats(el.children, repeatThreshold)
      : (el.children as Array<ExtractedElement | RepeatGroup>)

  let effective = grouped
  let omittedCount = 0
  if (grouped.length > maxSiblings) {
    effective = grouped.slice(0, maxSiblings)
    omittedCount = grouped.length - maxSiblings
  }

  const childParts: string[] = []
  for (const item of effective) {
    if (isRepeatGroup(item)) {
      const templateLine = compileElement(item.template, depth + 2, maxCompileDepth, imageMap, options)
      childParts.push(`${indent}  <Repeat count="${item.count}">`)
      childParts.push(templateLine)
      childParts.push(`${indent}  </Repeat>`)
      const dataComment = buildRepeatDataComment(item.items, depth + 1)
      if (dataComment) childParts.push(dataComment)
    } else {
      childParts.push(compileElement(item, depth + 1, maxCompileDepth, imageMap, options))
    }
  }

  if (omittedCount > 0) {
    childParts.push(`${indent}  <!-- +${omittedCount} more siblings (similar structure) -->`)
  }

  const childLines = childParts.join("\n")

  const textLine = el.text
    ? `\n${indent}  <Text name="label" style="${escapeXmlAttr(cssToTextStyle(el.styles))}">${escapeXmlText(
        el.text.length > 200 ? el.text.slice(0, 200) + "..." : el.text,
      )}</Text>`
    : ""

  const output = [
    `${indent}<${tag} ${attrs}${roleAttr}${hrefAttr}>`,
    childLines + textLine,
    `${indent}</${tag}>`,
  ].join("\n")

  if (options?.tokenCounter) options.tokenCounter.current += estimateTokens(output)
  return output
}

// ─── Page-level compilation ──────────────────────────────────────────────

function compileTokens(page: ExtractedPage): string {
  const lines: string[] = []
  const t = page.tokens

  const colorEntries = Object.entries(t.colors)
  if (colorEntries.length > 0) {
    lines.push("<!-- Design Tokens: Colors")
    for (const [name, value] of colorEntries) lines.push(`  ${name}: ${value}`)
    lines.push("-->")
  }

  if (t.fonts.length > 0) {
    lines.push(`<!-- Design Tokens: Fonts: ${t.fonts.join(", ")} -->`)
  }

  const propEntries = Object.entries(t.customProperties)
  if (propEntries.length > 0) {
    lines.push("<!-- CSS Custom Properties")
    for (const [name, value] of propEntries) lines.push(`  ${name}: ${value}`)
    lines.push("-->")
  }

  return lines.join("\n")
}

function compileAssets(
  page: ExtractedPage,
  imageMap?: Record<string, string>,
  imageRegistry?: Map<string, number>,
): string {
  const images = page.assets.images.filter((img) => Boolean(img.src))
  if (images.length === 0) return ""

  const seen = new Map<string, { alt?: string; localPath?: string; id: number }>()
  let nextId = imageRegistry?.size ?? 0
  for (const img of images) {
    const normalizedSrc = normalizeUrl(img.src)
    if (!normalizedSrc) continue
    if (!seen.has(normalizedSrc)) {
      let assignedId: number
      if (imageRegistry) {
        if (!imageRegistry.has(normalizedSrc)) {
          assignedId = nextId
          imageRegistry.set(normalizedSrc, assignedId)
          nextId++
        } else {
          assignedId = imageRegistry.get(normalizedSrc)!
        }
      } else {
        assignedId = nextId
        nextId++
      }
      seen.set(normalizedSrc, { alt: img.alt, localPath: imageMap?.[img.src], id: assignedId })
    }
  }

  const unique = seen.size
  const total = images.length
  const hasLocal = [...seen.values()].some((v) => v.localPath)
  const lines = [
    `<!-- Image Assets (${unique} unique / ${total} total)${hasLocal ? " — USE LOCAL PATHS (images/img-N.ext) as src, NOT external URLs" : ""}`,
  ]
  for (const [src, info] of seen) {
    const alt = info.alt ? ` (${info.alt})` : ""
    if (info.localPath) {
      lines.push(`  img-${info.id}: ${info.localPath}${alt}`)
    } else {
      lines.push(`  img-${info.id}: ${src}${alt}`)
    }
  }
  lines.push("-->")
  return lines.join("\n")
}

// ─── Public API ──────────────────────────────────────────────────────────

export interface CompilePageInput {
  page: ExtractedPage
  /** Max depth — deeper subtrees get summarised as comments. Default 4. */
  maxDepth?: number
  /** Image map: original URL → local path; overrides `page.assets.imageMap`. */
  imageMap?: Record<string, string>
  /** Compression knobs (sibling cap, repeat threshold, token budget). */
  compileOptions?: CompileOptions
}

/** Byte-parity string form — mirrors `urlCompileService.execute({page}).then(r=>r)`. */
export function compilePageToXmlString(input: CompilePageInput): string {
  const { page, maxDepth = 4, imageMap } = input
  const effectiveImageMap = imageMap ?? page.assets.imageMap

  const opts: CompileOptions = {
    maxSiblings: input.compileOptions?.maxSiblings ?? URL_COMPILE_MAX_SIBLINGS,
    repeatThreshold: input.compileOptions?.repeatThreshold ?? URL_COMPILE_REPEAT_THRESHOLD,
    maxTokens: input.compileOptions?.maxTokens,
    tokenCounter: input.compileOptions?.maxTokens ? { current: 0 } : undefined,
    imageRegistry: new Map(),
  }

  const sections: string[] = []

  sections.push(
    `<!-- Page: ${escapeXmlText(page.title)} | URL: ${escapeXmlText(page.url)} | Viewport: ${page.viewport.width}x${page.viewport.height} -->`,
  )

  const tokens = compileTokens(page)
  if (tokens) sections.push(tokens)

  const assets = compileAssets(page, effectiveImageMap, opts.imageRegistry)
  if (assets) sections.push(assets)

  sections.push("\n<!-- Page Structure -->")
  for (const element of page.tree) {
    sections.push(compileElement(element, 0, maxDepth, effectiveImageMap, opts))
  }

  return sections.join("\n")
}

/** Wrap the byte-parity string form as `XmlIR(source="url")`. */
export function compilePageToXML(input: CompilePageInput): XmlIR {
  const xml = compilePageToXmlString(input)
  return XmlIRSchema.parse({
    source: "url",
    xml,
    bytes: Buffer.byteLength(xml, "utf8"),
    estimatedTokens: estimateTokens(xml),
  })
}
