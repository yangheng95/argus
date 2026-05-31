import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { parseDocument } from "htmlparser2"
import {
  WebCloneAssetGraphSchema,
  WebClonePageIrSchema,
  type WebCloneAsset,
  type WebCloneAssetGraph,
  type WebCloneAssetKind,
  type WebCloneNode,
  type WebClonePageIr,
} from "./ir"

interface DomNode {
  type?: string
  name?: string
  data?: string
  attribs?: Record<string, string>
  children?: DomNode[]
}

export interface ExtractArchiveHtmlInput {
  html: string
  url?: string
  title?: string
  longValueThresholdBytes?: number
}

export interface WebCloneArchiveExtraction {
  pageIr: WebClonePageIr
  assetGraph: WebCloneAssetGraph
  assetContents: Record<string, string>
}

interface ExtractionStats {
  nodes: number
  elements: number
  textNodes: number
  comments: number
  directives: number
  attributes: number
}

const DEFAULT_LONG_VALUE_THRESHOLD_BYTES = 512

export function extractArchiveHtml(input: ExtractArchiveHtmlInput): WebCloneArchiveExtraction {
  const threshold = input.longValueThresholdBytes ?? DEFAULT_LONG_VALUE_THRESHOLD_BYTES
  const document = parseDocument(input.html, {
    lowerCaseAttributeNames: false,
    lowerCaseTags: false,
    recognizeSelfClosing: true,
  }) as DomNode
  const assets: WebCloneAsset[] = []
  const assetContents: Record<string, string> = {}
  const stats: ExtractionStats = {
    nodes: 0,
    elements: 0,
    textNodes: 0,
    comments: 0,
    directives: 0,
    attributes: 0,
  }
  let nextNodeIndex = 0

  function nextNodeId(): string {
    return `node_${String(nextNodeIndex++).padStart(6, "0")}`
  }

  function createAsset(inputAsset: {
    kind: WebCloneAssetKind
    value: string
    nodeId: string
    tag?: string
    attribute?: string
    role?: string
    mime?: string
  }): string {
    const id = `asset_${String(assets.length).padStart(6, "0")}`
    const assetPath = assetPathFor(id, inputAsset.kind, inputAsset.mime)
    const bytes = Buffer.byteLength(inputAsset.value, "utf8")
    const asset: WebCloneAsset = {
      id,
      kind: inputAsset.kind,
      path: assetPath,
      sha256: sha256(inputAsset.value),
      bytes,
      chars: inputAsset.value.length,
      mime: inputAsset.mime,
      semanticRole: inputAsset.role ?? inputAsset.kind,
      preview: inputAsset.value.replace(/\s+/g, " ").slice(0, 160),
      usedBy: [{
        nodeId: inputAsset.nodeId,
        tag: inputAsset.tag,
        attribute: inputAsset.attribute,
        role: inputAsset.role,
      }],
    }
    assets.push(asset)
    assetContents[id] = inputAsset.value
    return id
  }

  function encodeAttribute(nodeId: string, tag: string, name: string, rawValue: string) {
    stats.attributes++
    const value = String(rawValue)
    if (name === "class") {
      return {
        name,
        value,
        classTokens: value.trim().length > 0 ? value.trim().split(/\s+/) : [],
      }
    }

    const dataUri = parseDataUri(value)
    if (dataUri && dataUri.body.length > 0) {
      return {
        name,
        value: dataUri.placeholder,
        assetId: createAsset({
          kind: dataUri.mime.startsWith("image/") ? "image-data-uri" : "data-uri",
          value,
          nodeId,
          tag,
          attribute: name,
          role: "attribute-data-uri",
          mime: dataUri.mime,
        }),
      }
    }

    const rewrittenValue = rewriteEmbeddedDataUris(nodeId, tag, name, value)
    const kind = classifyLongAttribute(tag, name, rewrittenValue, threshold)
    if (kind) {
      return {
        name,
        value: `__WEB_CLONE_ASSET_REF_${assets.length}__`,
        assetId: createAsset({
          kind,
          value: rewrittenValue,
          nodeId,
          tag,
          attribute: name,
          role: name === "d" ? "svg-geometry" : "attribute-value",
        }),
      }
    }

    return { name, value: rewrittenValue }
  }

  function rewriteEmbeddedDataUris(nodeId: string, tag: string, name: string, value: string): string {
    return value.replace(/data:([^,;'"()\s]+)(?:;[^,;'"()\s]+)*;base64,([A-Za-z0-9+/=]+)/g, (match, mime: string) => {
      const assetId = createAsset({
        kind: mime.startsWith("image/") ? "image-data-uri" : "data-uri",
        value: match,
        nodeId,
        tag,
        attribute: name,
        role: "embedded-attribute-data-uri",
        mime,
      })
      if (!mime.startsWith("image/")) return `assets/values/${assetId}.data-uri.txt`
      return `assets/${assetId}.${extensionForMime(mime)}`
    })
  }

  function encodeText(node: DomNode, parentTag: string | undefined, sourcePath: string): WebCloneNode {
    const nodeId = nextNodeId()
    const text = node.data ?? ""
    stats.nodes++
    stats.textNodes++

    if ((parentTag ?? "").toLowerCase() === "style") {
      return {
        id: nodeId,
        type: "text",
        sourcePath,
        text: `__WEB_CLONE_CSS_ASSET_${assets.length}__`,
        assetId: createAsset({
          kind: "css",
          value: text,
          nodeId,
          tag: parentTag,
          role: "stylesheet-text",
          mime: "text/css",
        }),
      }
    }

    if ((parentTag ?? "").toLowerCase() === "script") {
      return {
        id: nodeId,
        type: "text",
        sourcePath,
        text: `__WEB_CLONE_SCRIPT_ASSET_${assets.length}__`,
        assetId: createAsset({
          kind: "script",
          value: text,
          nodeId,
          tag: parentTag,
          role: "script-text",
          mime: "application/javascript",
        }),
      }
    }

    if (Buffer.byteLength(text, "utf8") > threshold) {
      return {
        id: nodeId,
        type: "text",
        sourcePath,
        text: text.slice(0, 160),
        assetId: createAsset({
          kind: "large-text",
          value: text,
          nodeId,
          tag: parentTag,
          role: "text-node",
        }),
      }
    }

    return { id: nodeId, type: "text", sourcePath, text }
  }

  function encodeNode(node: DomNode, parentTag: string | undefined, sourcePath: string): WebCloneNode | undefined {
    if (node.type === "root") {
      const id = nextNodeId()
      stats.nodes++
      return {
        id,
        type: "document",
        sourcePath,
        children: encodeChildren(node.children, parentTag, sourcePath),
      }
    }
    if (node.type === "directive") {
      const id = nextNodeId()
      stats.nodes++
      stats.directives++
      return { id, type: "directive", sourcePath, text: node.data ?? "" }
    }
    if (node.type === "comment") {
      const id = nextNodeId()
      stats.nodes++
      stats.comments++
      return { id, type: "comment", sourcePath, text: node.data ?? "" }
    }
    if (node.type === "text") return encodeText(node, parentTag, sourcePath)
    if (node.type !== "tag" && node.type !== "script" && node.type !== "style") return undefined

    const id = nextNodeId()
    const tag = node.name ?? "unknown"
    stats.nodes++
    stats.elements++
    return {
      id,
      type: "element",
      sourcePath,
      tag,
      attrs: Object.entries(node.attribs ?? {}).map(([name, value]) => encodeAttribute(id, tag, name, value)),
      children: encodeChildren(node.children, tag, sourcePath),
    }
  }

  function encodeChildren(nodes: DomNode[] | undefined, parentTag: string | undefined, parentPath: string): WebCloneNode[] {
    return (nodes ?? [])
      .map((child, index) => encodeNode(child, parentTag, `${parentPath}/${sourcePathToken(child, index)}`))
      .filter((child): child is WebCloneNode => Boolean(child))
  }

  const root = encodeNode(document, undefined, "document")
  if (!root) throw new Error("web-clone archive extraction failed to produce a document root")

  const pageIr = WebClonePageIrSchema.parse({
    version: 1,
    purpose: "web-clone-structure-ir",
    source: {
      url: input.url,
      title: input.title,
      inputSha256: sha256(input.html),
    },
    policy: {
      preserved:
        "DOM order, element nesting, tag names, attributes, class tokens, comments, directives, text nodes, style/script element positions, SVG path ownership, and data URI ownership are preserved.",
      sidecar:
        "Dense CSS, script bodies, SVG path data, data URIs, and long text/attribute values are moved to assets and referenced by assetId and sha256.",
    },
    stats: {
      ...stats,
      sidecarAssets: assets.length,
    },
    root,
  })

  const assetGraph = WebCloneAssetGraphSchema.parse({
    version: 1,
    purpose: "web-clone-asset-graph",
    sourceIr: "page.ir.json",
    assets,
  })

  return { pageIr, assetGraph, assetContents }
}

export async function writeWebCloneArchiveExtraction(outputDir: string, extraction: WebCloneArchiveExtraction): Promise<void> {
  await fs.mkdir(path.join(outputDir, "assets"), { recursive: true })
  await fs.writeFile(path.join(outputDir, "page.ir.json"), JSON.stringify(extraction.pageIr, null, 2), "utf8")
  await fs.writeFile(
    path.join(outputDir, "assets", "manifest.json"),
    JSON.stringify(extraction.assetGraph, null, 2),
    "utf8",
  )

  for (const asset of extraction.assetGraph.assets) {
    const content = extraction.assetContents[asset.id]
    if (content === undefined) throw new Error(`Missing content for web-clone asset ${asset.id}`)
    const absolutePath = path.join(outputDir, asset.path)
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, content, "utf8")
  }
}

function sourcePathToken(node: DomNode, index: number): string {
  if (node.type === "tag" || node.type === "script" || node.type === "style") {
    return `${node.name ?? "unknown"}[${index}]`
  }
  return `${node.type ?? "unknown"}[${index}]`
}

function classifyLongAttribute(
  tag: string,
  name: string,
  value: string,
  thresholdBytes: number,
): WebCloneAssetKind | undefined {
  if (tag.toLowerCase() === "path" && name === "d") return "svg-path-data"
  if (Buffer.byteLength(value, "utf8") > thresholdBytes) return "large-attribute"
  return undefined
}

function parseDataUri(value: string): { mime: string; body: string; placeholder: string } | undefined {
  const match = /^data:([^,;]+)(?:;[^,]+)?,(.+)$/s.exec(value)
  if (!match) return undefined
  const mime = match[1] ?? "application/octet-stream"
  const body = match[2] ?? ""
  return {
    mime,
    body,
    placeholder: `data:${mime},__WEB_CLONE_DATA_URI_ASSET__`,
  }
}

function assetPathFor(id: string, kind: WebCloneAssetKind, mime?: string): string {
  if (kind === "css") return `assets/styles/${id}.css`
  if (kind === "script") return `assets/scripts/${id}.js`
  if (kind === "svg-path-data") return `assets/svg/${id}.path.txt`
  if (kind === "image-data-uri") return `assets/images/${id}.${extensionForMime(mime)}.txt`
  if (kind === "data-uri") return `assets/values/${id}.data-uri.txt`
  return `assets/values/${id}.txt`
}

function extensionForMime(mime?: string): string {
  if (!mime) return "bin"
  if (mime.includes("png")) return "png"
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg"
  if (mime.includes("svg")) return "svg"
  if (mime.includes("webp")) return "webp"
  return "bin"
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
