/**
 * Figma REST → `CompressedDesign`.
 *
 * Ported from `mirror/src/infra/figma/extract-core.ts`. Adaptations:
 *   - URL parsing is local to this isolated mirror algorithm. The product
 *     frontend_design path uses Figma MCP instead of this REST path.
 *   - Token default: `FIGMA_API_TOKEN` env (opencorvus convention), not
 *     mirror's `FIGMA_TOKEN` / `FIGMA_OAUTH_TOKEN`. Callers may pass their
 *     own `token`. OAuth is not yet covered — add later if a skill needs it.
 *   - Failures raise `FigmaFetchError` (typed) instead of `Error`.
 *   - `signal?: AbortSignal` — standard cancellation. Mirror used a 30-min
 *     `Promise.race` timeout at the service layer; we drop that because
 *     this tool is atomic and cancellation is the caller's concern.
 *
 * **Atomic tool guarantee**: this module does not read or write any cache
 * — that's `figma/cache.ts`'s job. Skills compose them:
 *     const hit = getFigmaCached(url, nodeId) ?? await fetchFigmaTree(…)
 */

import { Log } from "@/util/log"
import {
  CompressedDesignSchema,
  type CompressedDesign,
  type CompressedNode,
} from "../ir/compressed-design"
import { FigmaFetchError } from "../errors"

const log = Log.create({ service: "mirror.figma.fetch-tree" })

// `mirror/src/infra/config.ts` pins both at Infinity — no truncation on
// children or text. Inlined because they're effectively constants and
// varying them would break downstream `figma/compile` expectations.
const MAX_CHILDREN = Infinity
const MAX_TEXT_LEN = Infinity

const SKIP_TYPES = new Set([
  "SLICE",
  "GUIDE",
  "STICKY",
  "STAMP",
  "WIDGET",
  "CONNECTOR",
  "SHAPE_WITH_TEXT",
])

// ─── URL helpers ─────────────────────────────────────────────────────────

function extractFileKey(input: string): string {
  const match = input.match(/figma\.com\/(file|design)\/([a-zA-Z0-9]+)/)
  return match ? match[2] : input
}

function extractNodeIdFromUrl(input: string): string | undefined {
  const match = input.match(/node-id=([0-9]+-[0-9]+)/)
  if (match) return match[1].replace("-", ":")
  return undefined
}

// ─── REST transport ──────────────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 5,
  onProgress?: (msg: string) => void,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options)
    if (res.status !== 429) return res
    const retryAfter = res.headers.get("retry-after")
    const parsed = retryAfter ? parseInt(retryAfter, 10) : NaN
    const waitSec = Number.isFinite(parsed) ? Math.min(parsed, 60) : Math.min(2 ** attempt * 2, 60)
    onProgress?.(`Rate limited (429), retrying in ${waitSec}s (attempt ${attempt + 1}/${maxRetries})...`)
    await new Promise((r) => setTimeout(r, waitSec * 1000))
  }
  throw new FigmaFetchError({ status: 429, reason: `rate limit exceeded after ${maxRetries} retries` })
}

function authHeaders(token: string): Record<string, string> {
  return { "X-Figma-Token": token }
}

async function fetchFigmaFile(
  fileKey: string,
  token: string,
  nodeId: string | undefined,
  signal: AbortSignal | undefined,
  onProgress: ((msg: string) => void) | undefined,
) {
  const url = nodeId
    ? `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${nodeId}&geometry=bounds&plugin_data=shared`
    : `https://api.figma.com/v1/files/${fileKey}?geometry=bounds&plugin_data=shared`
  const res = await fetchWithRetry(url, { headers: authHeaders(token), signal }, 5, onProgress)
  if (!res.ok) {
    throw new FigmaFetchError({ figmaUrl: url, status: res.status, reason: res.statusText })
  }
  const data = await res.json()
  if (nodeId && data.nodes) {
    const nodeData = data.nodes[nodeId]
    if (!nodeData) {
      throw new FigmaFetchError({ nodeId, reason: `node ${nodeId} not found in file` })
    }
    return {
      name: data.name || "Untitled",
      lastModified: data.lastModified || "",
      document: { children: [{ type: "CANVAS", name: "Selected Node", children: [nodeData.document] }] },
      components: nodeData.components || {},
      componentSets: nodeData.componentSets || {},
      styles: nodeData.styles || {},
    }
  }
  return data
}

async function fetchFigmaComments(
  fileKey: string,
  token: string,
  signal: AbortSignal | undefined,
  onProgress: ((msg: string) => void) | undefined,
) {
  const res = await fetchWithRetry(
    `https://api.figma.com/v1/files/${fileKey}/comments`,
    { headers: authHeaders(token), signal },
    5,
    onProgress,
  )
  if (!res.ok) return { comments: [] }
  return res.json()
}

async function fetchNodeImages(
  fileKey: string,
  token: string,
  nodeIds: string[],
  signal: AbortSignal | undefined,
  format: "png" | "svg" | "jpg",
  scale: number,
  onProgress: ((msg: string) => void) | undefined,
): Promise<Record<string, string>> {
  if (nodeIds.length === 0) return {}

  const batchSize = 80
  const result: Record<string, string> = {}

  for (let i = 0; i < nodeIds.length; i += batchSize) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1000))
    const batch = nodeIds.slice(i, i + batchSize)
    const ids = batch.join(",")
    const url = `https://api.figma.com/v1/images/${fileKey}?ids=${ids}&format=${format}&scale=${scale}`
    const res = await fetchWithRetry(url, { headers: authHeaders(token), signal }, 5, onProgress)
    if (!res.ok) {
      log.warn("image export batch failed", { batch: i / batchSize + 1, status: res.status })
      continue
    }
    const data = await res.json()
    if (data.images) {
      for (const [id, imageUrl] of Object.entries(data.images)) {
        if (imageUrl) result[id] = imageUrl as string
      }
    }
  }
  return result
}

// ─── Colour helpers ──────────────────────────────────────────────────────

function rgbaToHex(r: number, g: number, b: number, a?: number): string {
  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0")
  const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`
  if (a !== undefined && a < 1) return `${hex}${toHex(a)}`
  return hex
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractColor(fills: any[]): string | undefined {
  if (!fills?.length) return undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const solid = fills.find((f: any) => f.type === "SOLID" && f.visible !== false)
  if (!solid?.color) return undefined
  return rgbaToHex(solid.color.r, solid.color.g, solid.color.b, solid.opacity)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractGradient(fills: any[]): string | undefined {
  if (!fills?.length) return undefined
  const grad = fills.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (f: any) =>
      ["GRADIENT_LINEAR", "GRADIENT_RADIAL", "GRADIENT_ANGULAR"].includes(f.type) && f.visible !== false,
  )
  if (!grad) return undefined
  const stops = (grad.gradientStops || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((s: any) => `${rgbaToHex(s.color.r, s.color.g, s.color.b, s.color.a)} ${Math.round(s.position * 100)}%`)
    .join(", ")
  const type =
    grad.type === "GRADIENT_LINEAR" ? "linear" : grad.type === "GRADIENT_RADIAL" ? "radial" : "conic"

  let anglePrefix = ""
  if (type === "linear" && grad.gradientHandlePositions?.length >= 2) {
    const [p0, p1] = grad.gradientHandlePositions
    const dx = p1.x - p0.x
    const dy = p1.y - p0.y
    const radians = Math.atan2(dx, -dy)
    let degrees = Math.round((radians * 180) / Math.PI)
    if (degrees < 0) degrees += 360
    if (degrees !== 180) anglePrefix = `${degrees}deg, `
  }

  return `${type}-gradient(${anglePrefix}${stops})`
}

// ─── Node compression ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectNodeText(node: any): string {
  let text = ""
  if (node.characters) text += node.characters
  if (node.children) for (const child of node.children) text += collectNodeText(child)
  return text
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectRepeatGroups(children: any[]): Map<number, { count: number; isSample: boolean }> {
  const result = new Map<number, { count: number; isSample: boolean }>()
  if (children.length < 3) return result

  const groups = new Map<string, number[]>()
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const prefix = child.name?.replace(/[\d\s]+$/, "").trim() || ""
    const childCount = child.children?.length || 0
    const fillSig = childCount === 0 ? extractColor(child.fills) || "none" : ""
    const childTypes =
      childCount > 0
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          child.children.slice(0, 5).map((c: any) => c.type).join(",")
        : ""
    const sig = `${child.type}|${prefix}|${childCount}|${fillSig}|${childTypes}`
    const arr = groups.get(sig) || []
    arr.push(i)
    groups.set(sig, arr)
  }

  for (const [, indices] of groups) {
    if (indices.length >= 3) {
      const texts = indices.map((idx) => collectNodeText(children[idx]).trim())
      const uniqueTexts = new Set(texts)
      if (uniqueTexts.size > Math.max(2, indices.length * 0.4)) continue

      indices.forEach((idx, i) => {
        result.set(idx, { count: indices.length, isSample: i < 2 })
      })
    }
  }
  return result
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function compressNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  depth: number,
  maxDepth: number,
  parentBounds: { x: number; y: number } | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components: Record<string, any> | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  componentSets: Record<string, any> | undefined,
  counters: { total: number; compressed: number },
): CompressedNode | null {
  if (!node) return null
  if (SKIP_TYPES.has(node.type)) return null
  if (node.visible === false) return null

  counters.total++
  if (depth > maxDepth) return null
  counters.compressed++

  const result: CompressedNode = {
    id: node.id || "",
    name: node.name,
    type: node.type,
  }

  // Layout
  if (node.layoutMode && node.layoutMode !== "NONE") {
    result.layout = {
      mode: node.layoutMode,
      primaryAlign: node.primaryAxisAlignItems,
      counterAlign: node.counterAxisAlignItems,
      gap: node.itemSpacing,
    }
    if (node.layoutWrap === "WRAP") result.layout.wrap = "WRAP"
    if (node.paddingTop || node.paddingRight || node.paddingBottom || node.paddingLeft) {
      result.layout.padding = [
        node.paddingTop || 0,
        node.paddingRight || 0,
        node.paddingBottom || 0,
        node.paddingLeft || 0,
      ]
    }
    if (node.layoutSizingHorizontal) result.layout.sizingH = node.layoutSizingHorizontal
    if (node.layoutSizingVertical) result.layout.sizingV = node.layoutSizingVertical
  }

  // Constraints
  if (node.constraints) {
    const h = node.constraints.horizontal
    const v = node.constraints.vertical
    if ((h && h !== "LEFT") || (v && v !== "TOP")) {
      result.constraints = {}
      if (h && h !== "LEFT") result.constraints.horizontal = h
      if (v && v !== "TOP") result.constraints.vertical = v
    }
  }

  // Bounds
  if (node.absoluteBoundingBox) {
    const { x, y, width, height } = node.absoluteBoundingBox
    if (width && height) {
      const relX = parentBounds ? Math.round(x - parentBounds.x) : 0
      const relY = parentBounds ? Math.round(y - parentBounds.y) : 0
      result.bounds = { x: relX, y: relY, w: Math.round(width), h: Math.round(height) }
    }
  }

  // Style
  const bg = extractColor(node.fills)
  const bgGradient = extractGradient(node.fills)
  const border = extractColor(node.strokes)
  const borderWidth = node.strokeWeight
  const opacity =
    node.opacity !== undefined && node.opacity < 1 ? Math.round(node.opacity * 100) / 100 : undefined
  const clipContent = node.clipsContent === true ? true : undefined

  let borderRadius: number | number[] | undefined
  if (node.rectangleCornerRadii) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii
    if (tl === tr && tr === br && br === bl) {
      borderRadius = tl || undefined
    } else {
      borderRadius = [tl, tr, br, bl]
    }
  } else if (node.cornerRadius) {
    borderRadius = node.cornerRadius
  }

  if (bg || bgGradient || border || borderRadius || opacity || clipContent || borderWidth) {
    result.style = {}
    if (bg) result.style.bg = bg
    if (bgGradient) result.style.bgGradient = bgGradient
    if (border) result.style.border = border
    if (borderWidth && borderWidth > 0) result.style.borderWidth = borderWidth
    if (borderRadius) result.style.borderRadius = borderRadius
    if (opacity !== undefined) result.style.opacity = opacity
    if (clipContent) result.style.clipContent = true
  }

  // Image fill marker
  if (node.fills?.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imageFill = node.fills.find((f: any) => f.type === "IMAGE" && f.visible !== false)
    if (imageFill) {
      result.annotations = result.annotations || []
      result.annotations.push("[has-image-fill]")
    }
  }

  // Effects
  if (node.effects?.length) {
    for (const e of node.effects) {
      if (e.visible === false) continue
      if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
        const c = e.color
        const hex = c ? rgbaToHex(c.r, c.g, c.b, c.a) : "#000"
        const prefix = e.type === "INNER_SHADOW" ? "inset " : ""
        if (!result.style) result.style = {}
        result.style.shadow = `${prefix}${e.offset?.x || 0}px ${e.offset?.y || 0}px ${e.radius || 0}px ${e.spread || 0}px ${hex}`
      }
      if (e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") {
        if (!result.style) result.style = {}
        result.style.blur = e.radius
      }
    }
  }

  // Text
  if (node.type === "TEXT" && node.characters) {
    const content =
      node.characters.length > MAX_TEXT_LEN ? node.characters.slice(0, MAX_TEXT_LEN) + "..." : node.characters
    result.text = { content }
    if (node.style) {
      const s = node.style
      if (s.fontFamily) result.text.font = s.fontFamily
      if (s.fontSize) result.text.size = s.fontSize
      if (s.fontWeight) result.text.weight = s.fontWeight
      if (s.lineHeightPx) result.text.lineHeight = Math.round(s.lineHeightPx * 10) / 10
      if (s.letterSpacing) result.text.letterSpacing = Math.round(s.letterSpacing * 100) / 100
      if (s.textAlignHorizontal) result.text.align = s.textAlignHorizontal
      if (s.textAlignVertical && s.textAlignVertical !== "TOP") result.text.verticalAlign = s.textAlignVertical
      if (s.textDecoration && s.textDecoration !== "NONE") result.text.decoration = s.textDecoration
      if (s.textCase && s.textCase !== "ORIGINAL") result.text.textCase = s.textCase
    }
    const textColor = extractColor(node.fills)
    if (textColor) result.text.color = textColor
  }

  // Component refs
  if (node.componentId) {
    result.componentId = node.componentId
    if (components?.[node.componentId]) {
      result.componentName = components[node.componentId].name
      const desc = components[node.componentId].description
      if (desc) result.description = desc
    }
  }
  if (node.type === "COMPONENT" && !node.componentId && components?.[node.id]) {
    const desc = components[node.id].description
    if (desc) result.description = desc
  }
  if (node.type === "COMPONENT_SET" && componentSets?.[node.id]) {
    const desc = componentSets[node.id].description
    if (desc) result.description = desc
  }

  // Children (with repeat detection)
  const currentBounds = node.absoluteBoundingBox
    ? { x: node.absoluteBoundingBox.x, y: node.absoluteBoundingBox.y }
    : parentBounds

  if (node.children?.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const visibleChildren = node.children.filter((c: any) => c.visible !== false)
    const repeatMap = detectRepeatGroups(visibleChildren)

    const children: CompressedNode[] = []
    let skippedRepeat = 0

    for (let i = 0; i < Math.min(visibleChildren.length, MAX_CHILDREN); i++) {
      const child = visibleChildren[i]
      const repeatInfo = repeatMap.get(i)

      if (repeatInfo && !repeatInfo.isSample) {
        skippedRepeat++
        continue
      }

      const compressed = compressNode(child, depth + 1, maxDepth, currentBounds, components, componentSets, counters)
      if (compressed) {
        if (repeatInfo) {
          compressed.repeatCount = repeatInfo.count
          compressed.repeatSample = true
          compressed.category = "repeat"
        }
        children.push(compressed)
      }
    }

    if (children.length) result.children = children

    const totalSkipped = Math.max(0, visibleChildren.length - MAX_CHILDREN) + skippedRepeat
    if (totalSkipped > 0) {
      result.annotations = result.annotations || []
      if (skippedRepeat > 0) {
        result.annotations.push(`[${skippedRepeat} repeat items collapsed, 2 samples preserved per group]`)
      }
      if (visibleChildren.length > MAX_CHILDREN) {
        result.annotations.push(`[truncated: ${visibleChildren.length - MAX_CHILDREN} more children]`)
      }
    }
  }

  // Category
  if (!result.category) {
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      result.category = "key"
    } else if (node.type === "INSTANCE") {
      result.category = "key"
    } else if (result.annotations?.length) {
      result.category = "mark"
    } else if (!result.children?.length) {
      result.category = "leaf"
    }
  }

  return result
}

// ─── Token extraction ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTokens(figmaFile: any): CompressedDesign["tokens"] {
  const colors = new Map<string, string>()
  const gradients: string[] = []
  const fonts = new Set<string>()
  const textStyles: CompressedDesign["tokens"]["textStyles"] = []
  const effects: CompressedDesign["tokens"]["effects"] = []
  const styles = figmaFile.styles || {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(node: any) {
    if (!node) return

    if (node.fills) {
      for (const fill of node.fills) {
        if (fill.type === "SOLID" && fill.color && fill.visible !== false) {
          const hex = rgbaToHex(fill.color.r, fill.color.g, fill.color.b)
          const styleName = node.styles?.fill ? styles[node.styles.fill]?.name || hex : hex
          colors.set(styleName, hex)
        }
        if (fill.type?.startsWith("GRADIENT_") && fill.visible !== false) {
          const g = extractGradient([fill])
          if (g && !gradients.includes(g)) gradients.push(g)
        }
      }
    }

    if (node.style?.fontFamily) fonts.add(node.style.fontFamily)

    if (node.type === "TEXT" && node.style) {
      const styleDef = node.styles?.text ? styles[node.styles.text] : null
      const name = styleDef?.name || `${node.style.fontFamily || ""}/${node.style.fontSize || 0}/${node.style.fontWeight || 400}`
      const existing = textStyles.find((ts) => ts.name === name)
      if (!existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ts: any = {
          name,
          font: node.style.fontFamily || "",
          size: node.style.fontSize || 0,
          weight: node.style.fontWeight || 400,
          color: extractColor(node.fills) || "#000",
        }
        if (node.style.lineHeightPx) ts.lineHeight = Math.round(node.style.lineHeightPx * 10) / 10
        if (node.style.letterSpacing) ts.letterSpacing = Math.round(node.style.letterSpacing * 100) / 100
        textStyles.push(ts)
      }
    }

    if (node.effects?.length && node.styles?.effect) {
      const effectStyle = styles[node.styles.effect]
      if (effectStyle?.name) {
        const existing = effects.find((e) => e.name === effectStyle.name)
        if (!existing) {
          for (const eff of node.effects) {
            if (eff.visible === false) continue
            let value = ""
            if (eff.type === "DROP_SHADOW" || eff.type === "INNER_SHADOW") {
              const c = eff.color
              const hex = c ? rgbaToHex(c.r, c.g, c.b, c.a) : "#000"
              value = `${eff.offset?.x || 0}px ${eff.offset?.y || 0}px ${eff.radius || 0}px ${hex}`
            } else if (eff.type === "LAYER_BLUR") {
              value = `blur(${eff.radius}px)`
            }
            effects.push({ name: effectStyle.name, type: eff.type, value })
          }
        }
      }
    }

    if (node.children) node.children.forEach(walk)
  }

  if (figmaFile.document) walk(figmaFile.document)

  const namedColors: Record<string, string> = {}
  const allHexColors = new Map<string, number>()

  for (const [name, value] of colors) {
    if (!name.startsWith("#")) namedColors[name] = value
    else allHexColors.set(value, (allHexColors.get(value) || 0) + 1)
  }

  const sorted = [...allHexColors.entries()].sort((a, b) => b[1] - a[1])
  for (const [hex] of sorted) {
    if (!Object.values(namedColors).includes(hex)) namedColors[hex] = hex
  }

  return {
    colors: namedColors,
    gradients,
    fonts: [...fonts],
    textStyles,
    effects,
  }
}

function selectImageNodes(pages: CompressedDesign["pages"], maxImages = 60): string[] {
  const idSet = new Set<string>()

  for (const page of pages) {
    for (const frame of page.frames) idSet.add(frame.id)
  }

  function collectImageFillNodes(node: CompressedNode) {
    if (node.annotations?.includes("[has-image-fill]") && node.id) idSet.add(node.id)
    node.children?.forEach(collectImageFillNodes)
  }
  for (const page of pages) {
    for (const frame of page.frames) collectImageFillNodes(frame)
  }

  return [...idSet].slice(0, maxImages)
}

// ─── Design assembly (pure — no network) ─────────────────────────────────

/** Pure: compile a raw Figma file + comments payload into `CompressedDesign`. */
export function buildDesignFromRaw(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  figmaFile: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  comments: any[],
  maxDepth: number,
  figmaUrl: string,
): CompressedDesign {
  const counters = { total: 0, compressed: 0 }
  const components = figmaFile.components || {}
  const componentSets = figmaFile.componentSets || {}
  const pages: CompressedDesign["pages"] = []

  for (const page of figmaFile.document?.children || []) {
    if (page.type !== "CANVAS") continue
    const frames = (page.children || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((node: any) => node.visible !== false)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((node: any) => compressNode(node, 0, maxDepth, undefined, components, componentSets, counters))
      .filter(Boolean) as CompressedNode[]
    pages.push({ name: page.name, frames })
  }

  const compressedComponents: CompressedDesign["components"] = {}
  for (const [id, comp] of Object.entries(components) as [string, { name: string; description?: string; key?: string }][]) {
    compressedComponents[id] = {
      name: comp.name,
      description: comp.description || "",
      key: comp.key || "",
    }
  }

  const compressedSets: CompressedDesign["componentSets"] = {}
  for (const [id, set] of Object.entries(componentSets) as [string, { name: string; description?: string }][]) {
    compressedSets[id] = {
      name: set.name,
      description: set.description || "",
    }
  }

  const tokens = extractTokens(figmaFile)

  const compressedComments = (comments || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((c: any) => c.message)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((c: any) => ({
      text: c.message,
      nodeId: c.client_meta?.node_id,
      author: c.user?.handle,
    }))

  return {
    fileName: figmaFile.name || "Untitled",
    lastModified: figmaFile.lastModified || "",
    figmaUrl,
    pages,
    components: compressedComponents,
    componentSets: compressedSets,
    tokens,
    images: {},
    comments: compressedComments,
    stats: {
      totalNodes: counters.total,
      compressedNodes: counters.compressed,
      imageCount: 0,
      compressionRatio: "",
    },
  }
}

// ─── Public API ──────────────────────────────────────────────────────────

export interface FetchFigmaTreeInput {
  /** Figma file URL or raw file key. */
  figmaUrl: string
  /** Explicit node id (overrides one parsed from URL). */
  nodeId?: string
  /** Figma Personal Access Token. Defaults to `FIGMA_API_TOKEN`. */
  token?: string
  /** Max compression depth. */
  depth?: number
  /** Skip image export. */
  noImages?: boolean
  /** Max image exports. */
  maxImages?: number
  /** PNG render scale 1-4. */
  imageScale?: number
  /** Progress hook. */
  onProgress?: (msg: string) => void
  /** Cancellation. */
  signal?: AbortSignal
}

/**
 * Fetch a Figma file (or sub-tree via `nodeId`) and return a validated
 * `CompressedDesign`.
 *
 * @throws {FigmaFetchError} when the URL is malformed, the token is missing,
 * the node does not exist, or the Figma API fails after retries.
 */
export async function fetchFigmaTree(input: FetchFigmaTreeInput): Promise<CompressedDesign> {
  const token = input.token ?? process.env.FIGMA_API_TOKEN
  if (!token) {
    throw new FigmaFetchError({
      reason: "missing Figma token — pass `token` or set FIGMA_API_TOKEN env var",
    })
  }

  const depth = input.depth ?? 15
  const noImages = input.noImages ?? false
  const maxImages = input.maxImages ?? 60
  const imageScale = input.imageScale ?? 2
  const { figmaUrl, onProgress, signal } = input

  const fileKey = extractFileKey(figmaUrl)
  const nodeId = input.nodeId || extractNodeIdFromUrl(figmaUrl)

  onProgress?.(`Extracting Figma file: ${fileKey}${nodeId ? ` (node=${nodeId})` : ""} (depth=${depth})`)

  const figmaFile = await fetchFigmaFile(fileKey, token, nodeId, signal, onProgress)
  const commentsData = await fetchFigmaComments(fileKey, token, signal, onProgress)

  onProgress?.(`File: ${figmaFile.name}, Last modified: ${figmaFile.lastModified}`)
  onProgress?.(`Pages: ${figmaFile.document?.children?.length || 0}`)
  onProgress?.(`Components: ${Object.keys(figmaFile.components || {}).length}`)
  onProgress?.(`Comments: ${commentsData.comments?.length || 0}`)

  const rawSize = JSON.stringify(figmaFile).length

  const compressed = buildDesignFromRaw(figmaFile, commentsData.comments || [], depth, figmaUrl)

  if (!noImages) {
    onProgress?.("Exporting node images...")
    const imageNodeIds = selectImageNodes(compressed.pages, maxImages)
    onProgress?.(`Selected ${imageNodeIds.length} nodes for image export`)

    if (imageNodeIds.length > 0) {
      const images = await fetchNodeImages(fileKey, token, imageNodeIds, signal, "png", imageScale, onProgress)
      compressed.images = images
      compressed.stats.imageCount = Object.keys(images).length

      function propagateImageUrls(node: CompressedNode) {
        if (images[node.id]) node.imageUrl = images[node.id]
        node.children?.forEach(propagateImageUrls)
      }
      for (const page of compressed.pages) {
        for (const frame of page.frames) propagateImageUrls(frame)
      }

      onProgress?.(`Exported ${compressed.stats.imageCount} node images`)
    }
  }

  compressed.stats.compressionRatio = `${(rawSize / 1024).toFixed(0)}KB → ${(JSON.stringify(compressed).length / 1024).toFixed(1)}KB`

  onProgress?.(
    `Compressed: ${(JSON.stringify(compressed).length / 1024).toFixed(1)}KB (from ~${(rawSize / 1024).toFixed(0)}KB raw)`,
  )
  onProgress?.(`Nodes: ${compressed.stats.totalNodes} total → ${compressed.stats.compressedNodes} compressed`)

  return CompressedDesignSchema.parse(compressed)
}
