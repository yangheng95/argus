import { normalizeAgentRole, type AgentRole } from "./message"
import type { CardNode } from "../store/card-tree"

export const SCREENSHOT_BROWSER_ITEM_LIMIT = 120

export interface ScreenshotBrowserItem {
  id: string
  role: AgentRole
  src: string
  alt: string
  title: string
  detail: string
  time: number
  messageID: string
  partID: string
  source: "file" | "tool-browser-evidence" | "tool-attachment"
}

export interface ScreenshotBrowserGroup {
  role: AgentRole
  items: ScreenshotBrowserItem[]
}

interface ScreenshotPartInput {
  owner: { id: string; messageID?: string; time: number }
  part: Record<string, any>
  role: AgentRole
  index: number
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function cardRole(card: CardNode): AgentRole | undefined {
  const role = firstString(card.stage, card.role)
  return role ? normalizeAgentRole(role) : undefined
}

export function isStoredAttachmentUrl(url: string): boolean {
  return /^\/attachment\/[^/\\?#]+\/[^/\\?#]+$/i.test(url)
}

function isStoredImageReference(input: { url?: unknown; mime?: unknown; mediaType?: unknown }): boolean {
  const mime = firstString(input.mime, input.mediaType).toLowerCase()
  const url = firstString(input.url)
  if (!isStoredAttachmentUrl(url)) return false
  if (mime.startsWith("image/")) return true
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)(\?|$)/i.test(url)
}

function itemKey(item: ScreenshotBrowserItem): string {
  return `${item.role}:${item.src}:${item.messageID}:${item.partID}:${item.source}`
}

function pushUnique(items: ScreenshotBrowserItem[], seen: Set<string>, item: ScreenshotBrowserItem): void {
  if (!item.src) return
  const key = itemKey(item)
  if (seen.has(key)) return
  seen.add(key)
  items.push(item)
}

function browserEvidenceItem(input: ScreenshotPartInput): ScreenshotBrowserItem | undefined {
  const metadata = isRecord(input.part?.state?.metadata) ? input.part.state.metadata : {}
  const browser = isRecord(metadata.browser) ? metadata.browser : undefined
  const screenshot = isRecord(browser?.screenshot) ? browser.screenshot : undefined
  const src = firstString(screenshot?.attachmentUrl)
  if (!isStoredAttachmentUrl(src)) return undefined
  const title = firstString(browser?.title, browser?.url, input.part?.tool, "Browser screenshot")
  const messageID = firstString(input.owner.messageID, input.owner.id)
  const partID = firstString(input.part?.id) || String(input.index)
  const viewport = isRecord(browser?.viewport) ? browser.viewport : {}
  const viewportText =
    typeof viewport.width === "number" && typeof viewport.height === "number"
      ? `${viewport.width}x${viewport.height}`
      : ""
  return {
    id: `tool-browser:${messageID}:${partID}`,
    role: input.role,
    src,
    alt: title,
    title,
    detail: [firstString(browser?.url), viewportText].filter(Boolean).join(" · "),
    time: input.owner.time,
    messageID,
    partID,
    source: "tool-browser-evidence",
  }
}

function fileItem(input: ScreenshotPartInput): ScreenshotBrowserItem | undefined {
  if (!isStoredImageReference(input.part)) return undefined
  const src = firstString(input.part?.url)
  if (!src) return undefined
  const title = firstString(input.part?.filename, input.part?.name, src)
  const messageID = firstString(input.owner.messageID, input.owner.id)
  const partID = firstString(input.part?.id) || String(input.index)
  return {
    id: `file:${messageID}:${partID}`,
    role: input.role,
    src,
    alt: title,
    title,
    detail: firstString(input.part?.mime, input.part?.mediaType),
    time: input.owner.time,
    messageID,
    partID,
    source: "file",
  }
}

function toolAttachmentItems(input: ScreenshotPartInput): ScreenshotBrowserItem[] {
  const attachments = Array.isArray(input.part?.state?.attachments)
    ? input.part.state.attachments
    : Array.isArray(input.part?.attachments)
      ? input.part.attachments
      : []
  const messageID = firstString(input.owner.messageID, input.owner.id)
  const partID = firstString(input.part?.id) || String(input.index)
  return attachments
    .filter((attachment: any) => isStoredImageReference(attachment))
    .map((attachment: any, attachmentIndex: number) => {
      const src = firstString(attachment?.url)
      const title = firstString(attachment?.filename, attachment?.name, input.part?.tool, src)
      return {
        id: `tool-attachment:${messageID}:${partID}:${attachmentIndex}`,
        role: input.role,
        src,
        alt: title,
        title,
        detail: firstString(attachment?.mime, attachment?.mediaType, input.part?.tool),
        time: input.owner.time,
        messageID,
        partID,
        source: "tool-attachment" as const,
      }
    })
    .filter((item) => !!item.src)
}

function collectPartItems(input: {
  items: ScreenshotBrowserItem[]
  seen: Set<string>
  owner: { id: string; messageID?: string; time: number }
  role: AgentRole
  part: unknown
  index: number
}): void {
  if (!isRecord(input.part)) return
  const partInput: ScreenshotPartInput = {
    owner: input.owner,
    role: input.role,
    part: input.part,
    index: input.index,
  }
  if (input.part.type === "file") {
    const item = fileItem(partInput)
    if (item) pushUnique(input.items, input.seen, item)
    return
  }
  if (input.part.type === "tool") {
    const browser = browserEvidenceItem(partInput)
    if (browser) pushUnique(input.items, input.seen, browser)
    for (const attachment of toolAttachmentItems(partInput)) {
      pushUnique(input.items, input.seen, attachment)
    }
  }
}

export function collectScreenshotBrowserItemsFromCards(
  order: readonly string[],
  cards: Readonly<Record<string, CardNode | undefined>>,
): ScreenshotBrowserItem[] {
  const seen = new Set<string>()
  const visitedCards = new Set<string>()
  const items: ScreenshotBrowserItem[] = []

  function visit(cardID: string): void {
    if (!cardID || visitedCards.has(cardID)) return
    visitedCards.add(cardID)
    const card = cards[cardID]
    if (!card) return
    const role = cardRole(card)
    if (role) {
      const owner = { id: card.id, messageID: card.messageID, time: Number(card.time) || 0 }
      const parts = Array.isArray(card.parts) ? card.parts : []
      for (let index = 0; index < parts.length; index += 1) {
        collectPartItems({ items, seen, owner, role, part: parts[index], index })
      }
      if (card.toolPart) {
        collectPartItems({ items, seen, owner, role, part: card.toolPart, index: parts.length })
      }
    }
    for (const childID of Array.isArray(card.childIDs) ? card.childIDs : []) {
      visit(childID)
    }
  }

  for (const cardID of order) visit(cardID)

  return items.sort((a, b) => b.time - a.time).slice(0, SCREENSHOT_BROWSER_ITEM_LIMIT)
}

export function groupScreenshotBrowserItems(items: readonly ScreenshotBrowserItem[]): ScreenshotBrowserGroup[] {
  const groups = new Map<AgentRole, ScreenshotBrowserGroup>()
  for (const item of items) {
    let group = groups.get(item.role)
    if (!group) {
      group = { role: item.role, items: [] }
      groups.set(item.role, group)
    }
    group.items.push(item)
  }
  return [...groups.values()]
}
