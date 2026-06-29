// ── Message Store ──
// Solid reactive store for conversation messages, agent events, and SSE state.

import { createStore, produce } from "solid-js/store"
import { batch, createMemo, createRoot, type Accessor } from "solid-js"
import { apiJson } from "../services/api"
import { boardStore, activeTaskID } from "../store/board"
import { clearConversationUiState, loadConversationUiStateForTask } from "./conversation-ui"
import { touchReasoningPart as trackReasoningPart } from "./reasoning"
import { normalizeToolPartRecord } from "../utils/tool"
import { compareTimelineOrderKeys, requireTimelineOrderKeyDomain } from "../utils/timeline-order"

// ── Types ──

export interface MessageInfo {
  id: string
  sessionID: string
  role: string
  agent?: string
  time?: { created?: number; updated?: number; completed?: number }
  [key: string]: any
}

export interface Part {
  id: string
  type: string
  text?: string
  tool?: string
  state?: any
  sessionID?: string
  messageID?: string
  [key: string]: any
}

export interface Message {
  info: MessageInfo
  parts: Part[]
}

// ── Store ──

const [store, setStore] = createStore({
  /**
   * Chronologically sorted flat list of all messages. Primary source of truth
   * for message content. Consumers that need all messages read this.
   */
  messages: [] as Message[],
  /**
   * Parallel session-indexed view into `messages` — values are references to
   * the same Message objects, grouped and sorted per sessionID. Maintained
   * alongside the flat array.
   *
   * Why both: the flat list supports "show me everything" consumers; the
   * per-session view is what unlocks Solid's fine-grained reactivity. When
   * a memo reads `messagesBySession[sid]`, Solid tracks only that key's
   * sub-tree — a part delta on session A does not fan out to session B's
   * downstream work. The old single-array iteration model re-ran every
   * card memo on every SSE delta; this shape is the structural fix.
   */
  messagesBySession: {} as Record<string, Message[]>,
  selectedTaskID: "" as string,
  sseConnected: false,
  // ── Chat request / attachments (mirrors state.chatRequest / state.chatAttachments) ──
  /** AbortController for the active chat HTTP request; null when idle */
  chatRequest: null as AbortController | null,
  /** File attachments staged for the next chat message */
  chatAttachments: [] as any[],
})

export { store as messageStore }

/**
 * Resolve a message's session bucket key. Messages without an info.sessionID
 * fall into the "" bucket (rare; transcript reconstruction edge cases).
 */
function sessionKeyOf(message: Message | undefined): string {
  const sid = message?.info?.sessionID
  return typeof sid === "string" ? sid : ""
}

// ── Sorting ──

function messageOrderKey(item: Message): string {
  const id = typeof item?.info?.id === "string" && item.info.id ? item.info.id : "<unknown>"
  return requireTimelineOrderKeyDomain(item?.info?.orderKey, `loaded conversation message ${id}`, "message")
}

function sortMessages(list: Message[]): Message[] {
  // V8 Array.sort is stable since ES2019 — no need for index-based tie-breaking.
  // Single slice instead of slice + 2× map.
  const result = list.slice()
  result.sort((a, b) => compareTimelineOrderKeys(messageOrderKey(a), messageOrderKey(b), "loaded conversation message"))
  return result
}

function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function requireLoadedString(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : ""
  if (!text) throw new Error(`${label} missing`)
  return text
}

function normalizeLoadedPart(
  input: any,
  messageID: string,
  sessionID: string,
  index: number,
): Part {
  if (!record(input)) throw new Error(`loaded conversation message ${messageID} part[${index}] must be an object`)
  const raw = input as Record<string, any>
  const id = requireLoadedString(raw.id, `loaded conversation message ${messageID} part[${index}] id`)
  const partMessageID = requireLoadedString(
    raw.messageID,
    `loaded conversation message ${messageID} part ${id} messageID`,
  )
  const partSessionID = requireLoadedString(
    raw.sessionID,
    `loaded conversation message ${messageID} part ${id} sessionID`,
  )
  if (partMessageID !== messageID) {
    throw new Error(`loaded conversation part ${id} messageID drift: ${partMessageID} !== ${messageID}`)
  }
  if (partSessionID !== sessionID) {
    throw new Error(`loaded conversation part ${id} sessionID drift: ${partSessionID} !== ${sessionID}`)
  }
  const type = requireLoadedString(raw.type, `loaded conversation part ${id} type`)
  const orderKey = requireTimelineOrderKeyDomain(raw.orderKey, `loaded conversation part ${id}`, "part")
  const normalized = normalizeToolPartRecord(raw)
  const part: Record<string, any> = record(normalized) ? { ...normalized } : { ...raw }
  return {
    ...part,
    id,
    type,
    messageID,
    sessionID,
    orderKey,
  }
}

function normalizeLoadedMessage(input: any): Message {
  if (!record(input)) throw new Error("loaded conversation message must be an object")
  const message = input as Record<string, any>
  if (!record(message.info)) throw new Error("loaded conversation message missing info")
  const info = message.info as Record<string, any>
  const id = requireLoadedString(info.id, "loaded conversation message id")
  const sessionID = requireLoadedString(info.sessionID, `loaded conversation message ${id} sessionID`)
  const role = requireLoadedString(info.role, `loaded conversation message ${id} role`)
  const channel = requireLoadedString(info.channel, `loaded conversation message ${id} channel`)
  const resolvedRole = requireLoadedString(info.resolvedRole, `loaded conversation message ${id} resolvedRole`)
  const orderKey = requireTimelineOrderKeyDomain(info.orderKey, `loaded conversation message ${id}`, "message")
  if (!Array.isArray(message.parts)) throw new Error(`loaded conversation message ${id} missing parts array`)
  const partsSource = message.parts
  const parts: Part[] = []
  const partIndex = new Map<string, number>()
  for (let index = 0; index < partsSource.length; index += 1) {
    const rawPart = partsSource[index]
    const normalizedPart = normalizeLoadedPart(rawPart, id, sessionID, index)
    const existingIndex = partIndex.get(normalizedPart.id)
    if (existingIndex !== undefined) {
      throw new Error(`loaded conversation message ${id} has duplicate part ${normalizedPart.id}`)
    }
    partIndex.set(normalizedPart.id, parts.length)
    parts.push(normalizedPart)
  }
  return {
    ...message,
    info: {
      ...info,
      id,
      sessionID,
      role,
      channel,
      resolvedRole,
      orderKey,
    },
    parts,
  }
}

export function mergeLoadedConversationMessages(left: any[], right: any[]): Message[] {
  const seen = new Set<string>()
  const result: Message[] = []
  for (const item of [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]) {
    const message = normalizeLoadedMessage(item)
    const key = message.info.id
    if (seen.has(key)) continue
    seen.add(key)
    result.push(message)
  }
  return result
}

// ── Full load from transcript ──

export async function syncTask(taskID: string) {
  if (!taskID) {
    clearMessages()
    return
  }
  const transcript = await apiJson(`task/${encodeURIComponent(taskID)}/transcript`)
  const messages = mergeLoadedConversationMessages([], Array.isArray(transcript) ? transcript : [])
  setMessages(messages)
}

// ── Conversation loading (.ts) ──

let _convLoading: Promise<void> | null = null
let _convQueued = false

function touchReasoningPart(part: any): any {
  if (!part || part.type !== "reasoning") return part
  if (typeof part.text !== "string") part.text = ""
  trackReasoningPart(part)
  return part
}

export async function loadConversation(): Promise<void> {
  if (!activeTaskID()) {
    setMessages([])
    return
  }
  if (_convLoading) {
    _convQueued = true
    await _convLoading
    return
  }
  const loading = (async () => {
    // audit-2026-04-29 W2-V16 — pre-fix the loop condition was
    // `_convQueued && requestTaskID === activeTaskID()`,
    // where `requestTaskID` was the task at the FIRST call's entry.
    // Concurrent scenario: user on task A → loadConversation runs;
    // user switches to B mid-fetch and a second loadConversation
    // bumps `_convQueued = true`. The first loop's iteration finds
    // taskID !== selectedTaskID and `continue`s — but the outer
    // condition's stale `requestTaskID === "A"` check is now false
    // against selectedTaskID="B", so the loop exits and B's queued
    // load is silently dropped. The conversation panel then shows
    // whatever was set last (empty / stale A messages). The inner
    // `taskID` re-read on every iteration plus the post-await
    // identity check already handle the within-iteration race; the
    // loop just needs `while (_convQueued)`.
    do {
      _convQueued = false
      const taskID = String(activeTaskID() || "")
      if (!taskID) {
        setMessages([])
        return
      }
      const transcript = await apiJson(`task/${encodeURIComponent(taskID)}/transcript`)
      if (taskID !== activeTaskID()) continue
      const merged = mergeLoadedConversationMessages([], Array.isArray(transcript) ? transcript : []).map((message: any) => ({
        ...message,
        parts: Array.isArray(message?.parts) ? message.parts.map((part: any) => touchReasoningPart(part)) : [],
      }))
      setMessages(merged)
    } while (_convQueued)
  })()
  _convLoading = loading
  try {
    await loading
  } finally {
    if (_convLoading === loading) {
      _convLoading = null
    }
  }
}

// ── Retired live message ingestion ──

function retiredMessageStoreIngestion(event: any): never {
  const type = String(event?.type || "<missing>")
  throw new Error(
    `messageStore live ingestion is retired for ${type}; visible message events must route through tree-writer`,
  )
}

export function enqueueEvent(event: any) {
  retiredMessageStoreIngestion(event)
}

/**
 * Retired legacy entry point. Persisted visible messages now enter the UI
 * through tree-writer/cardTreeStore; this store only owns chat request,
 * attachment, connection, and legacy transcript read state.
 */
export function ingestPersistedMessage(input: { info: any; parts: any[] }): void {
  retiredMessageStoreIngestion({ type: "persisted.message", payload: input })
}

export function clearEventQueue() {
  return
}

export function setMessages(messages: any[]) {
  const source = Array.isArray(messages) ? messages : []
  const next = sortMessages(source.map((message) => normalizeLoadedMessage(message)))
  setStore(
    "messages",
    produce((msgs: Message[]) => {
      // Build lookup for new messages
      const nextById = new Map<string, Message>()
      for (const m of next) {
        const id = m?.info?.id
        if (id) nextById.set(id, m)
      }

      // Remove messages no longer present
      for (let i = msgs.length - 1; i >= 0; i--) {
        const id = msgs[i]?.info?.id
        if (!id || !nextById.has(id)) msgs.splice(i, 1)
      }

      // Build existing index
      const existingIdx = new Map<string, number>()
      for (let i = 0; i < msgs.length; i++) {
        const id = msgs[i]?.info?.id
        if (id) existingIdx.set(id, i)
      }

      // Update existing or append new
      for (const m of next) {
        const id = m?.info?.id
        if (!id) {
          msgs.push(m)
          continue
        }
        const idx = existingIdx.get(id)
        if (idx !== undefined) {
          // Surgical update: only write changed properties
          const existing = msgs[idx]
          if (existing.info) Object.assign(existing.info, m.info)
          if (m.parts) {
            existing.parts.length = 0
            existing.parts.push(...m.parts)
          }
        } else {
          msgs.push(m)
        }
      }

      // Re-sort in place
    msgs.sort((a, b) => compareTimelineOrderKeys(messageOrderKey(a), messageOrderKey(b), "loaded conversation message"))
    }),
  )
  // Rebuild the per-session view from scratch — bulk transcript loads are
  // infrequent (task switch, resume) so the full rebuild is acceptable, and
  // the alternative (incrementally reconciling every session bucket) is
  // brittle. Same Message refs as `store.messages` so sub-path reactivity
  // via either view stays consistent afterwards.
  //
  // IMPORTANT: `setStore("messagesBySession", newObj)` performs a STRUCTURAL
  // MERGE in Solid, not a replace — keys that exist in the current value but
  // not in `newObj` survive, so the naive assignment leaks stale buckets
  // from a previous task. Use `produce` to delete old keys explicitly, then
  // assign the new ones. Verified by test/store/messages-bucket-clear.test.ts.
  const nextBySession: Record<string, Message[]> = {}
  for (const m of store.messages) {
    const sid = sessionKeyOf(m)
    ;(nextBySession[sid] ??= []).push(m)
  }
  setStore(
    "messagesBySession",
    produce((current: Record<string, Message[]>) => {
      for (const key of Object.keys(current)) {
        if (!(key in nextBySession)) delete current[key]
      }
      for (const [key, value] of Object.entries(nextBySession)) {
        current[key] = value
      }
    }),
  )
}

export function setSelectedTaskID(taskID: string) {
  if (store.selectedTaskID !== taskID) {
    // Hand the new task to conversation-ui so it can swap the persisted
    // collapse map — old behavior cleared, new behavior loads from
    // localStorage so refresh / overlay restart preserves the operator's
    // review state per task. Empty taskID still clears.
    if (taskID) loadConversationUiStateForTask(taskID)
    else clearConversationUiState()
    clearKnownChildSessions()
  }
  setStore("selectedTaskID", taskID)
}

export function setSseConnected(connected: boolean) {
  setStore("sseConnected", connected)
}

export function clearMessages() {
  // batch coalesces both setStore writes into a single reactivity round —
  // without it, every effect that subscribes to either `messages` or
  // `messagesBySession` runs twice on a clear.
  batch(() => {
    setStore("messages", [])
    setStore(
      "messagesBySession",
      produce((current: Record<string, Message[]>) => {
        for (const key of Object.keys(current)) delete current[key]
      }),
    )
  })
}

// ── Chat request helpers ──

/** Store the AbortController for an in-flight chat request. */
export function setChatRequest(req: AbortController | null): void {
  setStore("chatRequest", req ?? null)
}

/** Abort any active chat request and clear the stored controller. */
export function abortChatRequest(): void {
  const req = store.chatRequest
  if (req) {
    try {
      req.abort()
    } catch (_) {
      // ignore abort errors
    }
  }
  setStore("chatRequest", null)
}

// ── Chat attachments helpers ──

export function setChatAttachments(attachments: any[]): void {
  setStore("chatAttachments", Array.isArray(attachments) ? attachments : [])
}

// ── Session helpers ──

/**
 * Returns the sessionID of the currently selected task, preferring the board
 * task's sessionID and falling back to the task list entry for selectedTaskID.
 */
export function currentTaskSessionID(): string {
  const boardSession = boardStore.board?.task?.sessionID
  if (typeof boardSession === "string" && boardSession) return boardSession
  const taskID = store.selectedTaskID
  if (!taskID) return ""
  const entry = boardStore.tasks.find((item: any) => item?.task?.id === taskID)
  return typeof entry?.task?.sessionID === "string" ? entry.task.sessionID : ""
}

function messageEventSessionID(event: any): string {
  const properties =
    typeof event?.properties === "object" && event.properties && !Array.isArray(event.properties)
      ? event.properties
      : typeof event?.payload === "object" && event.payload && !Array.isArray(event.payload)
        ? event.payload
        : {}
  if (typeof properties?.info?.sessionID === "string") {
    return properties.info.sessionID
  }
  if (typeof properties?.part?.sessionID === "string") {
    return properties.part.sessionID
  }
  return typeof properties?.sessionID === "string" ? properties.sessionID : ""
}

/**
 * Message deltas are only safe to apply incrementally once the selected task's
 * root session is known. Before that, the authoritative transcript + timeline
 * load must establish the conversation shape first.
 */
export function shouldReloadConversationForMessageEvent(event: any): boolean {
  const type = String(event?.type || "").trim()
  if (type !== "message.updated" && type !== "message.part.updated" && type !== "message.part.delta") {
    return false
  }
  if (!store.selectedTaskID) return false
  if (currentTaskSessionID()) return false
  return !!messageEventSessionID(event)
}

// Module-private set to cache known child session IDs for O(1) lookup.
let _knownChildSessions: Set<string> | null = null

/** Clear the known-child-sessions cache (call when task selection changes). */
function clearKnownChildSessions(): void {
  _knownChildSessions = null
}
