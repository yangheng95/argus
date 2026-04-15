/**
 * Figma fetch — pull a frame's PNG render and structural metadata for use as
 * a design reference in the design-analyst pipeline.
 *
 * Auth: requires `FIGMA_API_TOKEN` (Figma Personal Access Token) in env.
 *
 * Two REST calls per fetch:
 *   1. `/v1/files/{key}/nodes?ids={id}`  — node metadata (frame name, size,
 *      child structure, basic style hints).
 *   2. `/v1/images/{key}?ids={id}&format=png&scale=2` — temporary CDN URL we
 *      then fetch to get the actual PNG bytes.
 *
 * No fallback: if the URL is malformed, the token is missing, or any request
 * fails we throw a typed error so callers (design-analyst, benchmark CLI)
 * can surface a precise failure instead of silently degrading.
 */

const FIGMA_API_BASE = "https://api.figma.com/v1"

export class FigmaFetchError extends Error {
  override readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = "FigmaFetchError"
    this.cause = cause
  }
}

export interface FigmaFrame {
  /** Figma file key (the bit after `/file/` or `/design/` in the URL). */
  fileKey: string
  /** Node id (`?node-id=...` from the URL, normalized to `1:23` form). */
  nodeId: string
  /** Frame display name from Figma. */
  name: string
  /** Pixel size of the rendered frame, used as the puppeteer viewport. */
  width: number
  height: number
  /** Page name the frame lives on. */
  pageName?: string
  /** PNG bytes (scale=2 by default). */
  png: Buffer
  /** MIME for the png buffer — always `image/png`. */
  mime: "image/png"
  /** Lightweight design context to inject into the design-analyst prompt. */
  designContext: string
}

/**
 * Parse a Figma file URL of the form:
 *   https://www.figma.com/design/<key>/<slug>?node-id=12-34
 *
 * `node-id` may use `-` or `:` as separator; we normalize to `:`.
 */
export function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (e) {
    throw new FigmaFetchError(`invalid Figma URL: ${url}`, e)
  }
  if (!/figma\.com$/i.test(parsed.hostname)) {
    throw new FigmaFetchError(`not a figma.com URL: ${url}`)
  }
  const segments = parsed.pathname.split("/").filter(Boolean)
  const idx = segments.findIndex((s) => s === "design")
  if (idx === -1 || !segments[idx + 1]) {
    throw new FigmaFetchError(`Figma URL missing /design segment: ${url}`)
  }
  const fileKey = segments[idx + 1]
  const rawNode = parsed.searchParams.get("node-id") ?? undefined
  const nodeId = rawNode ? rawNode.replace(/-/g, ":") : undefined
  return { fileKey, nodeId }
}

interface FigmaNode {
  id: string
  name: string
  type: string
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number }
  children?: FigmaNode[]
}

interface FigmaNodesResponse {
  nodes: Record<string, { document: FigmaNode } | null>
}

interface FigmaImagesResponse {
  err?: string | null
  images: Record<string, string | null>
}

async function figmaJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { "X-Figma-Token": token } })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new FigmaFetchError(`Figma API ${res.status} ${res.statusText} for ${url}: ${body.slice(0, 300)}`)
  }
  return (await res.json()) as T
}

function summarizeNode(node: FigmaNode, indent = 0, max = 40): string[] {
  if (max <= 0) return []
  const pad = "  ".repeat(indent)
  const size = node.absoluteBoundingBox
    ? ` ${Math.round(node.absoluteBoundingBox.width)}×${Math.round(node.absoluteBoundingBox.height)}`
    : ""
  const lines = [`${pad}- ${node.type}: ${node.name}${size}`]
  if (node.children) {
    let budget = max - 1
    for (const child of node.children) {
      if (budget <= 0) {
        lines.push(`${pad}  - … (${node.children.length - (max - budget)} more truncated)`)
        break
      }
      const sub = summarizeNode(child, indent + 1, budget)
      lines.push(...sub)
      budget -= sub.length
    }
  }
  return lines
}

/**
 * Fetch a Figma frame's metadata and PNG render.
 *
 * @param url     Figma file URL with optional `?node-id=…`. When `node-id` is
 *                missing we render the file's first canvas page top frame.
 * @param token   Figma Personal Access Token. Defaults to `FIGMA_API_TOKEN`.
 * @param scale   PNG render scale (1, 2, 3, 4). Default 2 for crisp visual
 *                reference; downstream puppeteer SSIM viewport will downsample
 *                to the frame's logical size.
 */
export async function fetchFigmaFrame(input: {
  url: string
  token?: string
  scale?: 1 | 2 | 3 | 4
}): Promise<FigmaFrame> {
  const token = input.token ?? process.env.FIGMA_API_TOKEN
  if (!token) {
    throw new FigmaFetchError(
      "FIGMA_API_TOKEN env var not set. Generate one at https://www.figma.com/developers/api#access-tokens",
    )
  }
  const { fileKey, nodeId } = parseFigmaUrl(input.url)
  const scale = input.scale ?? 2

  // 1. Resolve node id when not supplied: fetch file head, pick first frame.
  let resolvedNodeId = nodeId
  let pageName: string | undefined
  if (!resolvedNodeId) {
    const file = await figmaJson<{ document: FigmaNode }>(`${FIGMA_API_BASE}/files/${fileKey}?depth=2`, token)
    const firstPage = file.document.children?.[0]
    const firstFrame = firstPage?.children?.find((c) => c.type === "FRAME" || c.type === "COMPONENT")
    if (!firstFrame) {
      throw new FigmaFetchError(`Figma file ${fileKey} has no frame to render and no node-id was supplied`)
    }
    resolvedNodeId = firstFrame.id
    pageName = firstPage?.name
  }

  // 2. Pull node metadata (name, size, child structure).
  const nodes = await figmaJson<FigmaNodesResponse>(
    `${FIGMA_API_BASE}/files/${fileKey}/nodes?ids=${encodeURIComponent(resolvedNodeId)}`,
    token,
  )
  const entry = nodes.nodes[resolvedNodeId]
  if (!entry || !entry.document) {
    throw new FigmaFetchError(`Figma node ${resolvedNodeId} not found in file ${fileKey}`)
  }
  const doc = entry.document
  const box = doc.absoluteBoundingBox
  if (!box) {
    throw new FigmaFetchError(`Figma node ${resolvedNodeId} has no absoluteBoundingBox (cannot render)`)
  }

  // 3. Request a PNG render. The API returns a CDN URL; fetch it to get bytes.
  const images = await figmaJson<FigmaImagesResponse>(
    `${FIGMA_API_BASE}/images/${fileKey}?ids=${encodeURIComponent(resolvedNodeId)}&format=png&scale=${scale}`,
    token,
  )
  if (images.err) {
    throw new FigmaFetchError(`Figma /images error: ${images.err}`)
  }
  const cdnUrl = images.images[resolvedNodeId]
  if (!cdnUrl) {
    throw new FigmaFetchError(`Figma did not return a render URL for node ${resolvedNodeId}`)
  }
  const pngRes = await fetch(cdnUrl)
  if (!pngRes.ok) {
    throw new FigmaFetchError(`Figma CDN ${pngRes.status} ${pngRes.statusText} for ${cdnUrl}`)
  }
  const png = Buffer.from(await pngRes.arrayBuffer())

  const designContext = [
    `# Figma reference frame`,
    `- File: ${fileKey}`,
    `- Node: ${resolvedNodeId}`,
    `- Page: ${pageName ?? "(unknown)"}`,
    `- Frame: ${doc.name}`,
    `- Size: ${Math.round(box.width)}×${Math.round(box.height)} (logical)`,
    ``,
    `## Structure (truncated)`,
    ...summarizeNode(doc),
  ].join("\n")

  return {
    fileKey,
    nodeId: resolvedNodeId,
    name: doc.name,
    width: Math.round(box.width),
    height: Math.round(box.height),
    pageName,
    png,
    mime: "image/png",
    designContext,
  }
}
