/**
 * URL → `ExtractedPage` — Browser Runtime DOM traversal + ~33 CSS computed
 * style fields + optional screenshot + optional image download.
 *
 * Ported from `mirror/src/infra/browser/url-extract-core.ts` (741 lines).
 * Adaptations:
 *   - `findChromePath()` → opencorvus `findBrowserExecutable` (single
 *     browser-lifecycle policy shared with `visual/render.ts`,
 *     `frontend-design/url-screenshot.ts`, `delivery/checks/visual.ts`).
 *   - Silent `catch` → `Log.create({ service: "mirror.url.extract" })`
 *     with structured fields.
 *   - Throws `UrlExtractError` (typed) on 401/403/429 + browser infra failures.
 *   - Image-download constants inlined (mirror imports them from `infra/config.ts`).
 *
 * **Atomic tool guarantee**: this module does not call `url/compile`,
 * `url/pattern`, or `visual/*`. Skills compose them.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import puppeteer, { type Browser, type HTTPResponse } from "puppeteer-core"

import { BrowserRuntime } from "@/browser/runtime"
import { Log } from "@/util/log"
import {
  ExtractedPageSchema,
  type ExtractedPage,
  type ExtractedElement,
  type ExtractedStyles,
} from "../ir/extracted-page"
import { UrlExtractError } from "../errors"

const log = Log.create({ service: "mirror.url.extract" })

// ─── Mirror's `infra/config.ts` image-download constants (inlined) ───────

const IMAGE_DOWNLOAD_MAX_COUNT = 200
const IMAGE_DOWNLOAD_MAX_SIZE_BYTES = 2 * 1024 * 1024
const IMAGE_DOWNLOAD_MAX_TOTAL_BYTES = 20 * 1024 * 1024
const IMAGE_DOWNLOAD_CONCURRENCY = 6
const IMAGE_DOWNLOAD_TIMEOUT_MS = 10_000
const INLINE_IMAGE_DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i
const CSS_URL_RE = /url\(["']?(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)["']?\)/

interface ImageDownloadFailure {
  src: string
  reason: string
}

interface NodeDownloadImagesResult {
  imageMap: Record<string, string>
  failures: ImageDownloadFailure[]
}

// ─── Extraction constants ────────────────────────────────────────────────

const STYLE_PROPERTIES: (keyof ExtractedStyles)[] = [
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
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "color",
  "textAlign",
  "textDecoration",
]

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "LINK", "META", "BR", "WBR", "TEMPLATE"])
const MAX_DEPTH = 50
const MAX_CHILDREN = 200
const MAX_TEXT_LEN = 500

// ─── page.evaluate payload: DOM walker ───────────────────────────────────

/**
 * Runs inside the browser context via `page.evaluate()`. Must be
 * self-contained — NO references to outer scope. Return value must be
 * JSON-serialisable (no `Set`/`Map`).
 *
 * Kept byte-compatible with mirror so screenshots/network-trigger timing
 * are the only places outputs can diverge.
 */
function browserExtract(args: {
  scopeSelector: string | null
  maxDepth: number
  maxChildren: number
  maxTextLen: number
  styleProps: string[]
  skipTags: string[]
}): {
  tree: ExtractedElement[]
  totalElements: number
  extractedElements: number
  colors: Record<string, number>
  fonts: string[]
  customProperties: Record<string, string>
  images: Array<{ src: string; alt?: string }>
  icons: Array<{ src: string; type: "svg" | "icon-font" | "img" }>
} {
  const { scopeSelector, maxDepth, maxChildren, maxTextLen, styleProps, skipTags } = args
  const skipSet = new Set(skipTags)
  let totalElements = 0
  let extractedElements = 0
  const colorFreq: Record<string, number> = {}
  const fontList: string[] = []
  const fontSeen: Record<string, boolean> = {}
  const imageList: Array<{ src: string; alt?: string }> = []
  const iconList: Array<{ src: string; type: "svg" | "icon-font" | "img" }> = []

  function addColor(c: string) {
    if (!c || c === "rgba(0, 0, 0, 0)" || c === "transparent") return
    colorFreq[c] = (colorFreq[c] || 0) + 1
  }

  function inferRole(el: Element): ExtractedElement["role"] | undefined {
    const tag = el.tagName.toLowerCase()
    if (tag === "header") return "header"
    if (tag === "nav") return "nav"
    if (tag === "main") return "main"
    if (tag === "section") return "section"
    if (tag === "aside") return "aside"
    if (tag === "footer") return "footer"
    if (tag === "form") return "form"
    if (tag === "ul" || tag === "ol") return "list"

    const cls = el.className?.toString?.() || ""
    if (/\b(card)\b/i.test(cls)) return "card"
    if (/\b(hero)\b/i.test(cls)) return "hero"
    if (/\b(grid)\b/i.test(cls)) return "grid"
    if (/\b(nav)\b/i.test(cls)) return "nav"
    if (/\b(footer)\b/i.test(cls)) return "footer"
    if (/\b(header)\b/i.test(cls)) return "header"
    if (/\b(form)\b/i.test(cls)) return "form"

    return undefined
  }

  function getSelector(el: Element): string {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ""
    const cls =
      el.className?.toString?.().split(/\s+/).filter(Boolean).slice(0, 2).map((c: string) => `.${c}`).join("") || ""
    return `${tag}${id}${cls}`
  }

  function isVisible(el: Element, cs: CSSStyleDeclaration): boolean {
    if (cs.display === "none") return false
    if (cs.visibility === "hidden") return false
    if (el.getAttribute("aria-hidden") === "true") return false
    const rect = el.getBoundingClientRect()
    const tag = el.tagName
    if (rect.width === 0 && rect.height === 0 && tag !== "PICTURE" && tag !== "SPAN") return false
    return true
  }

  function getDirectText(el: Element): string | undefined {
    let text = ""
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent || ""
      }
    }
    text = text.trim()
    if (!text) return undefined
    return text.length > maxTextLen ? text.slice(0, maxTextLen) + "..." : text
  }

  function extractElement(el: Element, depth: number): ExtractedElement | null {
    totalElements++
    if (depth > maxDepth) return null
    if (skipSet.has(el.tagName)) return null

    const cs = window.getComputedStyle(el)
    if (!isVisible(el, cs)) return null

    extractedElements++
    const rect = el.getBoundingClientRect()
    const selector = getSelector(el)
    const tag = el.tagName.toLowerCase()

    const styles: Record<string, string | undefined> = {}
    for (const prop of styleProps) {
      const val = cs.getPropertyValue(prop.replace(/[A-Z]/g, (m: string) => `-${m.toLowerCase()}`))
      if (val && val !== "" && val !== "normal" && val !== "none" && val !== "auto" && val !== "0px" && val !== "rgba(0, 0, 0, 0)") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(styles as any)[prop] = val
      }
    }

    styles.display = cs.display
    if (cs.backgroundColor !== "rgba(0, 0, 0, 0)") styles.backgroundColor = cs.backgroundColor
    if (cs.color) styles.color = cs.color

    addColor(cs.backgroundColor)
    addColor(cs.color)

    const fontFamily = cs.fontFamily
    if (fontFamily) {
      const primary = fontFamily.split(",")[0].replace(/['"]/g, "").trim()
      if (primary && !fontSeen[primary]) {
        fontSeen[primary] = true
        fontList.push(primary)
      }
    }

    const role = inferRole(el)
    const text = getDirectText(el)

    const classes = el.className?.toString?.().split(/\s+/).filter(Boolean)

    let imageSrc: string | undefined
    let imageAlt: string | undefined
    if (tag === "img") {
      const imgEl = el as HTMLImageElement
      imageSrc =
        (imgEl.currentSrc && imgEl.currentSrc !== window.location.href ? imgEl.currentSrc : undefined) ||
        imgEl.getAttribute("data-src") ||
        imgEl.getAttribute("data-original") ||
        imgEl.getAttribute("data-lazy") ||
        imgEl.getAttribute("data-url") ||
        imgEl.getAttribute("data-img") ||
        imgEl.src ||
        undefined
      imageAlt = imgEl.alt
      if (imageSrc) imageList.push({ src: imageSrc, alt: imageAlt })
    }

    if (tag === "video") {
      const video = el as HTMLVideoElement
      const videoSrc = video.src || video.querySelector("source")?.src || undefined
      const videoPoster = video.poster || undefined
      imageSrc = videoPoster || videoSrc
      imageAlt = videoPoster ? `video: ${videoPoster}` : "video"
      if (videoSrc) imageList.push({ src: videoSrc, alt: imageAlt })
      if (videoPoster && videoPoster !== videoSrc)
        imageList.push({ src: videoPoster, alt: `poster: ${videoPoster}` })
    }

    if (tag === "canvas") {
      const canvas = el as HTMLCanvasElement
      if (canvas.width > 0 && canvas.height > 0) {
        try {
          const canvasUrl = canvas.toDataURL("image/png")
          if (canvasUrl && canvasUrl !== "data:,") {
            imageSrc = canvasUrl
            imageAlt = "canvas capture"
            imageList.push({ src: canvasUrl, alt: imageAlt })
          }
        } catch {
          // Tainted canvas: keep the measured canvas element in the tree.
        }
      }
    }

    if (!imageSrc) {
      const bgImage = cs.backgroundImage
      if (bgImage && bgImage !== "none") {
        const bgUrlMatch = bgImage.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/)
        if (bgUrlMatch) {
          imageSrc = bgUrlMatch[1]
          imageList.push({ src: imageSrc, alt: `bg: ${tag}` })
        }
      }
    }

    if (tag === "svg") {
      iconList.push({ src: selector, type: "svg" })
    }

    if (tag === "i" && classes && classes.length > 0) {
      const iconClass = classes.find((c: string) => /^fa[a-z]?-/.test(c))
      if (iconClass) {
        iconList.push({ src: iconClass, type: "icon-font" })
      }
    }

    let href: string | undefined
    if (tag === "a") {
      href = (el as HTMLAnchorElement).href
    }

    let aria: Record<string, string> | undefined
    const ariaAttrs = Array.from(el.attributes).filter((a) => a.name.startsWith("aria-"))
    if (ariaAttrs.length > 0) {
      aria = {}
      for (const a of ariaAttrs) aria[a.name] = a.value
    }

    let attrs: Record<string, string> | undefined
    for (const a of el.attributes) {
      if (a.name === "class" || a.name === "style" || a.name.startsWith("aria-")) continue
      if (a.value.length > 300) continue
      if (!attrs) attrs = {}
      attrs[a.name] = a.value
    }

    const visibleChildren = Array.from(el.children).filter((c) => !skipSet.has(c.tagName))
    let childElements: ExtractedElement[] | undefined

    if (visibleChildren.length > 0) {
      const processed: ExtractedElement[] = []
      const limit = Math.min(visibleChildren.length, maxChildren)
      for (let i = 0; i < limit; i++) {
        const child = extractElement(visibleChildren[i], depth + 1)
        if (child) processed.push(child)
      }
      if (processed.length > 0) childElements = processed
    }

    return {
      selector,
      tag,
      role: role || undefined,
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
      styles: styles as ExtractedStyles,
      text: text || undefined,
      imageSrc,
      imageAlt,
      href,
      aria,
      attrs,
      classes: classes && classes.length > 0 ? classes : undefined,
      children: childElements,
    }
  }

  const customProperties: Record<string, string> = {}
  try {
    const sheets = document.styleSheets
    for (let i = 0; i < sheets.length; i++) {
      try {
        const rules = sheets[i].cssRules
        for (let j = 0; j < rules.length; j++) {
          const rule = rules[j] as CSSStyleRule
          if (rule.selectorText === ":root" || rule.selectorText === "html") {
            for (let k = 0; k < rule.style.length; k++) {
              const prop = rule.style[k]
              if (prop.startsWith("--")) {
                customProperties[prop] = rule.style.getPropertyValue(prop).trim()
              }
            }
          }
        }
      } catch {
        // Cross-origin stylesheet — skip.
      }
    }
  } catch {
    // Cannot access stylesheets at all.
  }

  const root = scopeSelector ? document.querySelector(scopeSelector) : document.body
  if (!root) {
    return {
      tree: [],
      totalElements,
      extractedElements,
      colors: colorFreq,
      fonts: fontList,
      customProperties,
      images: imageList,
      icons: iconList,
    }
  }

  const tree: ExtractedElement[] = []
  const topChildren = Array.from(root.children)
  for (const child of topChildren) {
    const extracted = extractElement(child, 0)
    if (extracted) tree.push(extracted)
  }

  return {
    tree,
    totalElements,
    extractedElements,
    colors: colorFreq,
    fonts: fontList,
    customProperties,
    images: imageList,
    icons: iconList,
  }
}

// ─── Image download ───────────────────────────────────────────────────────

function mimeToExt(mime: string): string {
  if (mime.includes("png")) return "png"
  if (mime.includes("gif")) return "gif"
  if (mime.includes("webp")) return "webp"
  if (mime.includes("svg")) return "svg"
  if (mime.includes("bmp")) return "bmp"
  if (mime.includes("ico")) return "ico"
  if (mime.includes("avif")) return "avif"
  return "jpg"
}

async function nodeDownloadImages(
  urls: string[],
  outputDir: string,
  signal: AbortSignal | undefined,
  onProgress: ((msg: string) => void) | undefined,
): Promise<NodeDownloadImagesResult> {
  const imageMap: Record<string, string> = {}
  const failures: ImageDownloadFailure[] = []
  const imagesDir = resolve(outputDir, "images")
  mkdirSync(imagesDir, { recursive: true })

  let totalBytes = 0
  let downloaded = 0

  for (let i = 0; i < urls.length; i += IMAGE_DOWNLOAD_CONCURRENCY) {
    const batch = urls.slice(i, i + IMAGE_DOWNLOAD_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (url) => {
        try {
          const resp = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            },
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS)])
              : AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS),
          })
          if (!resp.ok) return { url, error: `HTTP ${resp.status}` }
          const contentType = resp.headers.get("content-type") || ""
          if (!contentType.startsWith("image/")) return { url, error: `non-image content-type ${contentType || "(missing)"}` }
          const buf = Buffer.from(await resp.arrayBuffer())
          if (buf.length === 0) return { url, error: "empty image response" }
          if (buf.length > IMAGE_DOWNLOAD_MAX_SIZE_BYTES) {
            return { url, error: `image size ${buf.length} exceeds ${IMAGE_DOWNLOAD_MAX_SIZE_BYTES}` }
          }
          return { url, buf, mime: contentType.split(";")[0] }
        } catch (err) {
          return { url, error: err instanceof Error ? err.message : String(err) }
        }
      }),
    )

    for (const r of results) {
      if ("error" in r) {
        failures.push({ src: r.url, reason: r.error })
        log.warn("image asset download failed", {
          url: r.url,
          error: r.error,
        })
        continue
      }
      if (signal?.aborted) {
        throw new UrlExtractError({
          url: r.url,
          reason: "image download aborted",
          phase: "asset",
        })
      }
      if (totalBytes + r.buf.length > IMAGE_DOWNLOAD_MAX_TOTAL_BYTES) {
        const reason = `image download total bytes would exceed ${IMAGE_DOWNLOAD_MAX_TOTAL_BYTES}`
        failures.push({ src: r.url, reason })
        log.warn("image asset download skipped", {
          url: r.url,
          reason,
        })
        continue
      }
      const ext = mimeToExt(r.mime)
      const fileName = `img-${downloaded}.${ext}`
      writeFileSync(resolve(imagesDir, fileName), r.buf)
      imageMap[r.url] = `images/${fileName}`
      totalBytes += r.buf.length
      downloaded++
    }
  }

  if (downloaded > 0) onProgress?.(`saved ${downloaded} images (${(totalBytes / 1024).toFixed(0)}KB)`)
  if (failures.length > 0) onProgress?.(`recorded ${failures.length} image download failures`)
  return { imageMap, failures }
}

// ─── Public API ──────────────────────────────────────────────────────────

function decodeInlineImageDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | undefined {
  const match = INLINE_IMAGE_DATA_URL_RE.exec(dataUrl)
  if (!match) return undefined
  return { mime: match[1]!, bytes: Buffer.from(match[2]!, "base64") }
}

function writeCategorizedInlineImage(input: {
  outputDir: string
  category: "canvas" | "background" | "inline"
  source: string
  index: number
}): string | undefined {
  const decoded = decodeInlineImageDataUrl(input.source)
  if (!decoded || decoded.bytes.length === 0) return undefined
  if (decoded.bytes.length > IMAGE_DOWNLOAD_MAX_SIZE_BYTES) {
    throw new UrlExtractError({
      url: "inline-image",
      reason: `inline image size ${decoded.bytes.length} exceeds ${IMAGE_DOWNLOAD_MAX_SIZE_BYTES}`,
      phase: "asset",
    })
  }
  const ext = mimeToExt(decoded.mime)
  const dir = resolve(input.outputDir, "images", input.category)
  mkdirSync(dir, { recursive: true })
  const fileName = `${input.category}-${input.index}.${ext}`
  writeFileSync(resolve(dir, fileName), decoded.bytes)
  return `images/${input.category}/${fileName}`
}

function classifyInlineImage(alt?: string): "canvas" | "background" | "inline" {
  if (alt === "canvas capture") return "canvas"
  if (alt?.startsWith("bg:")) return "background"
  return "inline"
}

function mapInlineImage(input: {
  source: string
  alt?: string
  outputDir: string
  imageMap: Record<string, string>
  counters: Record<"canvas" | "background" | "inline", number>
}): string | undefined {
  if (!INLINE_IMAGE_DATA_URL_RE.test(input.source)) return undefined
  const category = classifyInlineImage(input.alt)
  const key = `${category}:${input.source}`
  if (input.imageMap[key]) return input.imageMap[key]
  const rel = writeCategorizedInlineImage({
    outputDir: input.outputDir,
    category,
    source: input.source,
    index: input.counters[category]++,
  })
  if (rel) input.imageMap[key] = rel
  return rel
}

function materializeScreenshot(input: {
  outputDir: string
  dataUrl: string | undefined
  relPath: string
}): string | undefined {
  if (!input.dataUrl) return undefined
  const decoded = decodeInlineImageDataUrl(input.dataUrl)
  if (!decoded) return input.dataUrl
  const abs = resolve(input.outputDir, input.relPath)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, decoded.bytes)
  return input.relPath.replace(/\\/g, "/")
}

function localizeElementInlineImages(
  element: ExtractedElement,
  outputDir: string,
  imageMap: Record<string, string>,
  counters: Record<"canvas" | "background" | "inline", number>,
): ExtractedElement {
  const next: ExtractedElement = {
    ...element,
    styles: { ...element.styles },
    attrs: element.attrs ? { ...element.attrs } : undefined,
    aria: element.aria ? { ...element.aria } : undefined,
    classes: element.classes ? [...element.classes] : undefined,
  }

  if (next.imageSrc) {
    const rel = mapInlineImage({
      source: next.imageSrc,
      alt: next.imageAlt,
      outputDir,
      imageMap,
      counters,
    })
    if (rel) next.imageSrc = rel
  }

  const bgMatch = next.styles.backgroundImage ? CSS_URL_RE.exec(next.styles.backgroundImage) : undefined
  if (bgMatch) {
    const source = bgMatch[1]!
    const rel = mapInlineImage({
      source,
      alt: `bg: ${next.tag}`,
      outputDir,
      imageMap,
      counters,
    })
    if (rel) next.styles.backgroundImage = next.styles.backgroundImage!.replace(source, rel)
  }

  if (next.children) {
    next.children = next.children.map((child) => localizeElementInlineImages(child, outputDir, imageMap, counters))
  }
  return next
}

export function materializeInlineExtractedPageAssets(page: ExtractedPage, outputDir: string): ExtractedPage {
  const imageMap: Record<string, string> = { ...(page.assets.imageMap ?? {}) }
  const counters = { canvas: 0, background: 0, inline: 0 }

  for (const image of page.assets.images) {
    mapInlineImage({
      source: image.src,
      alt: image.alt,
      outputDir,
      imageMap,
      counters,
    })
  }

  const tree = page.tree.map((element) => localizeElementInlineImages(element, outputDir, imageMap, counters))
  const images = page.assets.images.map((image) => ({
    ...image,
    src: imageMap[`${classifyInlineImage(image.alt)}:${image.src}`] ?? imageMap[image.src] ?? image.src,
  }))
  const persistedImageMap = Object.fromEntries(
    Object.entries(imageMap).filter(([source, target]) =>
      !source.includes("data:image/") && !target.includes("data:image/"),
    ),
  )

  return ExtractedPageSchema.parse({
    ...page,
    screenshotUrl: materializeScreenshot({
      outputDir,
      dataUrl: page.screenshotUrl,
      relPath: "screenshots/full.png",
    }) ?? page.screenshotUrl,
    screenshotAboveFold: materializeScreenshot({
      outputDir,
      dataUrl: page.screenshotAboveFold,
      relPath: "screenshots/above-fold.png",
    }) ?? page.screenshotAboveFold,
    tree,
    assets: {
      ...page.assets,
      images,
      imageMap: persistedImageMap,
      imageDownloadFailures: page.assets.imageDownloadFailures,
    },
  })
}

export interface ExtractPageInput {
  url: string
  viewport?: { width: number; height: number }
  /** CSS selector scoping the extraction; default body. */
  scopeSelector?: string | null
  /** Settle wait after `networkidle0` (ms), default 2000. */
  waitMs?: number
  /** Skip the full-page + above-fold screenshots (non-deterministic). */
  noScreenshots?: boolean
  /** When provided, downloads referenced images into `<dir>/images/` and populates `assets.imageMap`. */
  outputDir?: string
  /** When provided, writes the post-load archive HTML snapshot for canonical structure IR compilation. */
  captureHtmlPath?: string
  /** When false, only screenshots and inline images are materialized under outputDir. */
  downloadImages?: boolean
  onProgress?: (msg: string) => void
  signal?: AbortSignal
}

/**
 * Launch a headless browser, navigate to `url`, extract the DOM + computed
 * styles + token inventory + assets into a validated `ExtractedPage`.
 *
 * @throws {UrlExtractError} when browser launch fails, navigation fails,
 * the target returns HTTP 401/403/429, or the evaluate/screenshot step
 * throws.
 */
export async function extractPage(input: ExtractPageInput): Promise<ExtractedPage> {
  const {
    url,
    viewport = { width: 1440, height: 900 },
    scopeSelector = null,
    waitMs = 2000,
    noScreenshots = false,
    outputDir,
    captureHtmlPath,
    downloadImages = true,
    onProgress,
    signal,
  } = input

  onProgress?.(`Extracting URL: ${url}`)
  onProgress?.(`Viewport: ${viewport.width}x${viewport.height}`)
  if (scopeSelector) onProgress?.(`Scope: ${scopeSelector}`)

  const startTime = Date.now()

  const chromePath = await BrowserRuntime.findBrowserExecutable()
  onProgress?.(`Browser: ${chromePath}`)

  let browser: Browser
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
      timeout: BrowserRuntime.resolveBrowserLaunchTimeoutMs(),
    })
  } catch (err) {
    throw new UrlExtractError(
      { url, reason: err instanceof Error ? err.message : String(err), phase: "launch" },
      { cause: err },
    )
  }

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: viewport.width, height: viewport.height })
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
    await page.setExtraHTTPHeaders({ "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" })

    onProgress?.("Loading page...")

    let response: HTTPResponse | null = null
    try {
      response = await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 })
    } catch (err) {
      throw new UrlExtractError(
        { url, reason: err instanceof Error ? err.message : String(err), phase: "navigate" },
        { cause: err },
      )
    }

    const status = response?.status() ?? 0
    if (status === 401 || status === 403) {
      throw new UrlExtractError({
        url,
        status,
        reason: `HTTP ${status}: site denied access — provide a pre-extracted url-data.json instead`,
        phase: "navigate",
      } as never)
    }
    if (status === 429) {
      throw new UrlExtractError({
        url,
        status,
        reason: "HTTP 429: site is throttling — retry later",
        phase: "navigate",
      } as never)
    }
    if (status >= 400 && status < 500) {
      throw new UrlExtractError({
        url,
        reason: `HTTP ${status}: URL extraction requires a successful page response`,
        phase: "navigate",
      })
    }

    await new Promise((r) => setTimeout(r, waitMs))

    const title = await page.title()
    onProgress?.(`Title: ${title}`)

    onProgress?.("Scrolling page to trigger lazy image loading...")
    try {
      await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
          const distance = 400
          const delay = 80
          const timer = setInterval(() => {
            window.scrollBy(0, distance)
            if (window.scrollY + window.innerHeight >= document.body.scrollHeight) {
              clearInterval(timer)
              window.scrollTo(0, 0)
              resolve()
            }
          }, delay)
          setTimeout(() => {
            clearInterval(timer)
            window.scrollTo(0, 0)
            resolve()
          }, 8000)
        })
      })
    } catch (err) {
      log.warn("auto-scroll failed, continuing", {
        url,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    await new Promise((r) => setTimeout(r, 800))

    if (captureHtmlPath) {
      try {
        const html = await page.content()
        mkdirSync(dirname(captureHtmlPath), { recursive: true })
        writeFileSync(captureHtmlPath, html, "utf8")
        onProgress?.(`Captured HTML snapshot (${(Buffer.byteLength(html, "utf8") / 1024).toFixed(0)}KB)`)
      } catch (err) {
        throw new UrlExtractError(
          { url, reason: err instanceof Error ? err.message : String(err), phase: "evaluate" },
          { cause: err },
        )
      }
    }

    let screenshotUrl = ""
    let screenshotAboveFold: string | undefined

    if (!noScreenshots) {
      onProgress?.("Capturing screenshots...")
      try {
        const fullScreenshot = Buffer.from(await page.screenshot({ fullPage: true, type: "png" }))
        screenshotUrl = `data:image/png;base64,${Buffer.from(fullScreenshot).toString("base64")}`

        const foldScreenshot = Buffer.from(await page.screenshot({ type: "png" }))
        screenshotAboveFold = `data:image/png;base64,${Buffer.from(foldScreenshot).toString("base64")}`
        onProgress?.(
          `Screenshots captured (full: ${(fullScreenshot.length / 1024).toFixed(0)}KB, fold: ${(foldScreenshot.length / 1024).toFixed(0)}KB)`,
        )
      } catch (err) {
        throw new UrlExtractError(
          { url, reason: err instanceof Error ? err.message : String(err), phase: "screenshot" },
          { cause: err },
        )
      }
    }

    onProgress?.("Extracting DOM structure...")
    let result: ReturnType<typeof browserExtract>
    try {
      result = (await page.evaluate(browserExtract as unknown as string, {
        scopeSelector,
        maxDepth: MAX_DEPTH,
        maxChildren: MAX_CHILDREN,
        maxTextLen: MAX_TEXT_LEN,
        styleProps: STYLE_PROPERTIES as string[],
        skipTags: Array.from(SKIP_TAGS),
      })) as ReturnType<typeof browserExtract>
    } catch (err) {
      throw new UrlExtractError(
        { url, reason: err instanceof Error ? err.message : String(err), phase: "evaluate" },
        { cause: err },
      )
    }

    const extractionTimeMs = Date.now() - startTime

    const colorEntries = Object.entries(result.colors as Record<string, number>)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
    const colors: Record<string, string> = {}
    for (const [color, count] of colorEntries) colors[color] = `${count}x`

    let imageMap: Record<string, string> | undefined
    let imageDownloadFailures: ImageDownloadFailure[] | undefined
    if (outputDir && downloadImages) {
      const allImages = result.images
      const seen = new Set<string>()
      const downloadUrls: string[] = []
      for (const img of allImages) {
        if (!img.src || seen.has(img.src)) continue
        if (!img.src.startsWith("http://") && !img.src.startsWith("https://")) continue
        seen.add(img.src)
        downloadUrls.push(img.src)
        if (downloadUrls.length >= IMAGE_DOWNLOAD_MAX_COUNT) break
      }

      if (downloadUrls.length > 0) {
        onProgress?.(`Downloading ${downloadUrls.length} images (Node-side)...`)
        try {
          const downloadResult = await nodeDownloadImages(downloadUrls, outputDir, signal, onProgress)
          imageMap = downloadResult.imageMap
          imageDownloadFailures = downloadResult.failures.length > 0 ? downloadResult.failures : undefined
          onProgress?.(`Downloaded ${Object.keys(imageMap).length}/${downloadUrls.length} images`)
        } catch (err) {
          if (UrlExtractError.isInstance(err)) throw err
          throw new UrlExtractError(
            {
              url,
              reason: err instanceof Error ? err.message : String(err),
              phase: "asset",
            },
            { cause: err },
          )
        }
      }
    }

    const extractedPage: ExtractedPage = {
      url,
      title,
      viewport,
      screenshotUrl,
      screenshotAboveFold,
      tree: result.tree,
      tokens: {
        colors,
        fonts: result.fonts,
        customProperties: result.customProperties,
      },
      assets: {
        images: result.images,
        icons: result.icons,
        imageMap,
        imageDownloadFailures,
      },
      stats: {
        totalElements: result.totalElements,
        extractedElements: result.extractedElements,
        imageCount: result.images.length,
        extractionTimeMs,
      },
    }

    const materializedPage = outputDir
      ? materializeInlineExtractedPageAssets(extractedPage, outputDir)
      : extractedPage

    onProgress?.(`Extracted: ${result.extractedElements}/${result.totalElements} elements`)
    onProgress?.(`Colors: ${colorEntries.length}, Fonts: ${result.fonts.length}`)
    onProgress?.(`Images: ${result.images.length}, Icons: ${result.icons.length}`)
    onProgress?.(`Time: ${extractionTimeMs}ms`)

    return ExtractedPageSchema.parse(materializedPage)
  } finally {
    try {
      await browser.close()
    } catch (err) {
      log.warn("browser close failed", { error: err instanceof Error ? err.message : String(err) })
    }
  }
}

export const MirrorUrlExtractTestHooks = {
  nodeDownloadImages,
}
