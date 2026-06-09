import type { WebCloneAttribute, WebCloneNode, WebClonePageIr } from "./ir"

export interface WebCloneMockTextBlock {
  id: string
  nodeId: string
  tag?: string
  role?: string
  text: string
}

export interface WebCloneMockLink {
  id: string
  nodeId: string
  text: string
  href: string
}

export interface WebCloneMockControl {
  id: string
  nodeId: string
  tag?: string
  role?: string
  label: string
}

export interface WebCloneMockImage {
  id: string
  nodeId: string
  src?: string
  alt?: string
}

export interface WebCloneMockRepeatedGroup {
  id: string
  nodeId: string
  tag?: string
  itemCount: number
  textItems: string[]
}

export interface WebCloneMockDataContract {
  version: 1
  purpose: "web-clone-mock-data-contract"
  source: WebClonePageIr["source"]
  endpoint: "/api/web-clone/data"
  models: {
    headings: WebCloneMockTextBlock[]
    textBlocks: WebCloneMockTextBlock[]
    links: WebCloneMockLink[]
    controls: WebCloneMockControl[]
    images: WebCloneMockImage[]
    repeatedGroups: WebCloneMockRepeatedGroup[]
  }
}

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"])
const CONTROL_TAGS = new Set(["button", "select", "input", "textarea", "summary"])
const MAX_TEXT_BLOCKS = 500
const MAX_REPEATED_GROUPS = 80

export function buildWebCloneMockDataContract(pageIr: WebClonePageIr): WebCloneMockDataContract {
  const headings: WebCloneMockTextBlock[] = []
  const textBlocks: WebCloneMockTextBlock[] = []
  const links: WebCloneMockLink[] = []
  const controls: WebCloneMockControl[] = []
  const images: WebCloneMockImage[] = []
  const repeatedGroups: WebCloneMockRepeatedGroup[] = []

  walk(pageIr.root, (node) => {
    if (node.type !== "element") return
    const tag = node.tag?.toLowerCase()
    const text = normalizeText(visibleText(node))
    const role = attr(node.attrs, "role")
    if (tag && HEADING_TAGS.has(tag) && text) {
      headings.push({ id: `heading_${headings.length}`, nodeId: node.id, tag, role, text })
    }
    if (text && textBlocks.length < MAX_TEXT_BLOCKS && shouldKeepTextBlock(tag, text)) {
      textBlocks.push({ id: `text_${textBlocks.length}`, nodeId: node.id, tag, role, text })
    }
    if (tag === "a") {
      const href = attr(node.attrs, "href") ?? node.layout?.href
      if (href) links.push({ id: `link_${links.length}`, nodeId: node.id, text: text || href, href })
    }
    if ((tag && CONTROL_TAGS.has(tag)) || role === "button" || role === "tab" || role === "menuitem") {
      controls.push({
        id: `control_${controls.length}`,
        nodeId: node.id,
        tag,
        role,
        label: text || attr(node.attrs, "aria-label") || tag || "control",
      })
    }
    if (tag === "img" || node.layout?.imageSrc) {
      images.push({
        id: `image_${images.length}`,
        nodeId: node.id,
        src: attr(node.attrs, "src") ?? node.layout?.imageSrc,
        alt: attr(node.attrs, "alt") ?? node.layout?.imageAlt,
      })
    }
    const repeated = repeatedTextItems(node)
    if (repeated.length >= 3 && repeatedGroups.length < MAX_REPEATED_GROUPS) {
      repeatedGroups.push({
        id: `group_${repeatedGroups.length}`,
        nodeId: node.id,
        tag,
        itemCount: repeated.length,
        textItems: repeated,
      })
    }
  })

  return {
    version: 1,
    purpose: "web-clone-mock-data-contract",
    source: pageIr.source,
    endpoint: "/api/web-clone/data",
    models: {
      headings,
      textBlocks,
      links,
      controls,
      images,
      repeatedGroups,
    },
  }
}

function walk(node: WebCloneNode, visit: (node: WebCloneNode) => void): void {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

function visibleText(node: WebCloneNode): string {
  if (node.type === "text") return node.text ?? ""
  if (node.type !== "element" && node.type !== "document") return ""
  const tag = node.tag?.toLowerCase()
  if (tag === "script" || tag === "style" || tag === "noscript") return ""
  return (node.children ?? []).map(visibleText).join(" ")
}

function repeatedTextItems(node: WebCloneNode): string[] {
  const children = (node.children ?? []).filter((child) => child.type === "element")
  if (children.length < 3) return []
  const texts = children.map((child) => normalizeText(visibleText(child))).filter(Boolean)
  const unique = new Set(texts)
  if (texts.length < 3 || unique.size < 2) return []
  const medianLength = texts.slice().sort((a, b) => a.length - b.length)[Math.floor(texts.length / 2)]?.length ?? 0
  if (medianLength > 180) return []
  return texts.slice(0, 80)
}

function shouldKeepTextBlock(tag: string | undefined, text: string): boolean {
  if (text.length > 240) return false
  if (!tag) return true
  return tag !== "html" && tag !== "body" && tag !== "head"
}

function attr(attrs: WebCloneAttribute[] | undefined, name: string): string | undefined {
  return attrs?.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())?.value
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}
