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

export type ScreenshotBrowserRow =
  | {
      kind: "group"
      key: string
      role: AgentRole
      count: number
    }
  | {
      kind: "items"
      key: string
      role: AgentRole
      items: ScreenshotBrowserItem[]
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

function messageTime(message: any): number {
  const time = message?.info?.time
  const completed = Number(time?.completed)
  if (Number.isFinite(completed) && completed > 0) return completed
  const updated = Number(time?.updated)
  if (Number.isFinite(updated) && updated > 0) return updated
  const created = Number(time?.created)
  if (Number.isFinite(created) && created > 0) return created
  return 0
}

function messageRole(message: any): AgentRole {
  return normalizeAgentRole(
    firstString(message?.info?.resolvedRole, message?.info?.channel, message?.info?.agent, message?.info?.role),
  )
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

function sourceMessageID(message: any, part: any): string {
  return firstString(part?.messageID, message.info?.id)
}

function browserEvidenceItem(input: {
  message: any
  part: any
  role: AgentRole
  time: number
  index: number
}): ScreenshotBrowserItem | undefined {
  const metadata = isRecord(input.part?.state?.metadata) ? input.part.state.metadata : {}
  const browser = isRecord(metadata.browser) ? metadata.browser : undefined
  const screenshot = isRecord(browser?.screenshot) ? browser.screenshot : undefined
  const src = firstString(screenshot?.attachmentUrl)
  if (!isStoredAttachmentUrl(src)) return undefined
  const title = firstString(browser?.title, browser?.url, input.part?.tool, "Browser screenshot")
  const messageID = sourceMessageID(input.message, input.part)
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
    time: input.time,
    messageID,
    partID,
    source: "tool-browser-evidence",
  }
}

function fileItem(input: {
  message: any
  part: any
  role: AgentRole
  time: number
  index: number
}): ScreenshotBrowserItem | undefined {
  if (!isStoredImageReference(input.part)) return undefined
  const src = firstString(input.part?.url)
  if (!src) return undefined
  const title = firstString(input.part?.filename, input.part?.name, src)
  const messageID = sourceMessageID(input.message, input.part)
  const partID = firstString(input.part?.id) || String(input.index)
  return {
    id: `file:${messageID}:${partID}`,
    role: input.role,
    src,
    alt: title,
    title,
    detail: firstString(input.part?.mime, input.part?.mediaType),
    time: input.time,
    messageID,
    partID,
    source: "file",
  }
}

function toolAttachmentItems(input: {
  message: any
  part: any
  role: AgentRole
  time: number
  index: number
}): ScreenshotBrowserItem[] {
  const attachments = Array.isArray(input.part?.state?.attachments)
    ? input.part.state.attachments
    : Array.isArray(input.part?.attachments)
      ? input.part.attachments
      : []
  const messageID = sourceMessageID(input.message, input.part)
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
        time: input.time,
        messageID,
        partID,
        source: "tool-attachment" as const,
      }
    })
    .filter((item) => !!item.src)
}

export function collectScreenshotBrowserItems(messages: readonly any[]): ScreenshotBrowserItem[] {
  const seen = new Set<string>()
  const items: ScreenshotBrowserItem[] = []
  for (const message of messages) {
    const role = messageRole(message)
    const time = messageTime(message)
    const parts = Array.isArray(message?.parts) ? message.parts : []
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]
      if (!isRecord(part)) continue
      if (part.type === "file") {
        const item = fileItem({ message, part, role, time, index })
        if (item) pushUnique(items, seen, item)
        continue
      }
      if (part.type === "tool") {
        const browser = browserEvidenceItem({ message, part, role, time, index })
        if (browser) pushUnique(items, seen, browser)
        for (const attachment of toolAttachmentItems({ message, part, role, time, index })) {
          pushUnique(items, seen, attachment)
        }
      }
    }
  }
  return items.sort((a, b) => b.time - a.time).slice(0, SCREENSHOT_BROWSER_ITEM_LIMIT)
}

function cardMessage(card: CardNode): any {
  const role = firstString(card.role, card.stage)
  const time = Number(card.time)
  const completed = Number(card.timeCompleted)
  return {
    info: {
      id: firstString(card.messageID, card.id),
      sessionID: firstString(card.sessionID, card.phaseSessionID),
      role,
      resolvedRole: role,
      agent: firstString(card.stage, role),
      time: {
        created: Number.isFinite(time) && time > 0 ? time : 0,
        completed: Number.isFinite(completed) && completed > 0 ? completed : undefined,
      },
    },
    parts: Array.isArray(card.parts) ? card.parts : [],
  }
}

function collectCardMessages(
  order: readonly string[],
  cards: Readonly<Record<string, CardNode | undefined>>,
  visited: Set<string>,
  messages: any[],
): void {
  for (const id of order) {
    if (visited.has(id)) continue
    visited.add(id)
    const card = cards[id]
    if (!card) continue
    messages.push(cardMessage(card))
    const childIDs = Array.isArray(card.childIDs) ? card.childIDs : []
    collectCardMessages(childIDs, cards, visited, messages)
  }
}

export function collectScreenshotBrowserItemsFromCardTree(
  order: readonly string[],
  cards: Readonly<Record<string, CardNode | undefined>>,
): ScreenshotBrowserItem[] {
  const messages: any[] = []
  collectCardMessages(Array.isArray(order) ? order : [], cards, new Set<string>(), messages)
  return collectScreenshotBrowserItems(messages)
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

export function buildScreenshotBrowserRows(
  groups: readonly ScreenshotBrowserGroup[],
  columnCount: number,
): ScreenshotBrowserRow[] {
  const columns = Number.isFinite(columnCount) ? Math.max(1, Math.floor(columnCount)) : 1
  const rows: ScreenshotBrowserRow[] = []
  for (const group of groups) {
    rows.push({
      kind: "group",
      key: `group:${group.role}`,
      role: group.role,
      count: group.items.length,
    })
    for (let index = 0; index < group.items.length; index += columns) {
      rows.push({
        kind: "items",
        key: `items:${group.role}:${index}`,
        role: group.role,
        items: group.items.slice(index, index + columns),
      })
    }
  }
  return rows
}
