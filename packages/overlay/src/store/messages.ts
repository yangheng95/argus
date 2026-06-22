// ── Message Store ──
// Solid reactive store for conversation messages, agent events, and SSE state.

import { createStore, produce } from "solid-js/store"
import { batch, createMemo, createRoot, type Accessor } from "solid-js"
import { apiJson } from "../services/api"
import { boardStore, activeTaskID } from "../store/board"
import { clearConversationUiState, loadConversationUiStateForTask } from "./conversation-ui"
import { touchReasoningPart as trackReasoningPart } from "./reasoning"
import { normalizeToolPartRecord } from "../utils/tool"

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

// ── O(1) message lookup ──

const messageIndex = new Map<string, Message>()
// Buffer for parts that arrive before their parent message.updated event.
// Cleared on task switch (clearMessages). No TTL — SSE is meant to deliver
// message.updated first; if it doesn't, that's a backend-ordering bug to fix
// at the source, not a symptom to paper over here.
const _pendingParts = new Map<string, { parts: any[] }>()

function rebuildMessageIndex() {
  messageIndex.clear()
  for (const msg of store.messages) {
    if (msg?.info?.id) messageIndex.set(msg.info.id, msg)
  }
}

function messageById(id: string): Message | undefined {
  return messageIndex.get(id)
}

/**
 * Resolve a message's session bucket key. Messages without an info.sessionID
 * fall into the "" bucket (rare; transcript reconstruction edge cases).
 */
function sessionKeyOf(message: Message | undefined): string {
  const sid = message?.info?.sessionID
  return typeof sid === "string" ? sid : ""
}

/**
 * Locate an already-stored message within its session bucket. Returns -1 if
 * the bucket is empty or the message isn't present. Uses reference equality
 * on Message objects — the flat `messages` array and `messagesBySession`
 * share the same object references.
 */
function sessionBucketIndexOf(sid: string, msg: Message): number {
  const bucket = store.messagesBySession[sid]
  return bucket ? bucket.indexOf(msg) : -1
}

// ── Sorting ──

const UNTIMED_MESSAGE_ORDER = Number.MAX_SAFE_INTEGER

function finiteMessageTime(item: Message | undefined): number | undefined {
  const created = item?.info?.time?.created
  if (Number.isFinite(created)) return Number(created)
  const updated = item?.info?.time?.updated
  if (Number.isFinite(updated)) return Number(updated)
  return undefined
}

function messageOrderTime(item: Message): number {
  return finiteMessageTime(item) ?? UNTIMED_MESSAGE_ORDER
}

function sortMessages(list: Message[]): Message[] {
  // V8 Array.sort is stable since ES2019 — no need for index-based tie-breaking.
  // Single slice instead of slice + 2× map.
  const result = list.slice()
  result.sort((a, b) => messageOrderTime(a) - messageOrderTime(b))
  return result
}

/** Append message in sorted position. Fast path: if newer than last, just push. */
function insertSorted(msgs: Message[], msg: Message): number {
  const t = messageOrderTime(msg)
  // Fast path: normal chronological append (most common case)
  if (msgs.length === 0 || messageOrderTime(msgs[msgs.length - 1]) <= t) {
    msgs.push(msg)
    return msgs.length - 1
  }
  // Slow path: out-of-order arrival (SSE replay, cross-session), binary search
  let lo = 0,
    hi = msgs.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (messageOrderTime(msgs[mid]) <= t) lo = mid + 1
    else hi = mid
  }
  msgs.splice(lo, 0, msg)
  return lo
}

function mergeMessageInfo(existing: MessageInfo | undefined, next: MessageInfo): MessageInfo {
  const existingTime = existing?.time
  const nextTime = next?.time
  const createdCandidates = [existingTime?.created, nextTime?.created].filter((value): value is number =>
    Number.isFinite(value),
  )
  const updatedCandidates = [existingTime?.updated, nextTime?.updated].filter((value): value is number =>
    Number.isFinite(value),
  )
  const completedCandidates = [existingTime?.completed, nextTime?.completed].filter((value): value is number =>
    Number.isFinite(value),
  )

  const time: MessageInfo["time"] = {}
  if (createdCandidates.length > 0) time.created = Math.min(...createdCandidates)
  if (updatedCandidates.length > 0) time.updated = Math.max(...updatedCandidates)
  if (completedCandidates.length > 0) time.completed = Math.max(...completedCandidates)

  return {
    ...(existing || {}),
    ...next,
    time,
  }
}

function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function stableStringify(value: unknown): string {
  if (value == null) return "null"
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`
  }
  if (!record(value)) return JSON.stringify(String(value))
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`
}

function hashText(value: string): string {
  const text = String(value || "")
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function partSignature(part: any): string {
  return stableStringify({
    type: part?.type || "",
    text: part?.text || "",
    tool: part?.tool || "",
    kind: part?.kind || "",
    source: part?.source || "",
    filename: part?.filename || "",
    url: part?.url || "",
    mime: part?.mime || part?.mediaType || "",
    callID: part?.callID || "",
    description: part?.description || "",
    prompt: part?.prompt || "",
    state: record(part?.state) ? part.state : (part?.state ?? null),
    files: Array.isArray(part?.files) ? part.files : [],
    process: record(part?.process) ? part.process : null,
  })
}

function messageSignature(message: any): string {
  const info = record(message?.info) ? message.info : {}
  return stableStringify({
    role: info.role || "",
    agent: info.agent || "",
    sessionID: info.sessionID || "",
    taskID: info.taskID || "",
    time: {
      created: info.time?.created || 0,
      updated: info.time?.updated || 0,
      completed: info.time?.completed || 0,
    },
    parts: Array.isArray(message?.parts) ? message.parts.map((part: any) => partSignature(part)) : [],
  })
}

function normalizeLoadedPart(
  input: any,
  messageID: string,
  sessionID: string,
  index: number,
  previousPart?: Part,
): Part {
  const seed: Record<string, any> = record(input) ? { ...input } : { type: "text", text: String(input || "") }
  const normalized = normalizeToolPartRecord(seed, previousPart)
  const part: Record<string, any> = record(normalized) ? { ...normalized } : seed
  const id =
    typeof part.id === "string" && part.id.trim()
      ? part.id.trim()
      : `loaded-part:${messageID}:${index}:${hashText(partSignature(part))}`
  return {
    ...part,
    id,
    messageID: typeof part.messageID === "string" && part.messageID.trim() ? part.messageID.trim() : messageID,
    sessionID: typeof part.sessionID === "string" && part.sessionID.trim() ? part.sessionID.trim() : sessionID,
  } as Part
}

function normalizeLoadedMessage(input: any): Message {
  const message = record(input) ? input : {}
  const info = record(message.info) ? message.info : {}
  const explicitID = typeof info.id === "string" && info.id.trim() ? info.id.trim() : ""
  const id = explicitID || `loaded-msg:${hashText(messageSignature(message))}`
  const sessionID = typeof info.sessionID === "string" && info.sessionID.trim() ? info.sessionID.trim() : ""
  const partsSource = Array.isArray(message.parts) ? message.parts : []
  const parts: Part[] = []
  const partIndex = new Map<string, number>()
  for (let index = 0; index < partsSource.length; index += 1) {
    const rawPart = partsSource[index]
    const rawID = typeof rawPart?.id === "string" && rawPart.id.trim() ? rawPart.id.trim() : ""
    const previous = rawID ? parts[partIndex.get(rawID) ?? -1] : undefined
    const normalizedPart = normalizeLoadedPart(rawPart, id, sessionID, index, previous)
    const existingIndex = partIndex.get(normalizedPart.id)
    if (existingIndex !== undefined) {
      parts[existingIndex] = normalizedPart
      continue
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
      role: typeof info.role === "string" && info.role.trim() ? info.role.trim() : "assistant",
    },
    parts,
  }
}

function normalizeLoadedMessages(messages: any[]): Message[] {
  return (Array.isArray(messages) ? messages : []).map((message) => normalizeLoadedMessage(message))
}

export function mergeLoadedConversationMessages(left: any[], right: any[]): Message[] {
  const seen = new Set<string>()
  const result: any[] = []
  for (const item of [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]) {
    const info = record(item?.info) ? item.info : {}
    const key = typeof info.id === "string" && info.id.trim() ? `id:${info.id.trim()}` : `sig:${messageSignature(item)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return normalizeLoadedMessages(result)
}

// ── Full load from transcript ──

export async function syncTask(taskID: string) {
  if (!taskID) {
    clearMessages()
    return
  }
  const [transcript, timeline] = await Promise.all([
    apiJson(`task/${encodeURIComponent(taskID)}/transcript`),
    apiJson(`control/timeline?taskID=${encodeURIComponent(taskID)}`),
  ])
  const messages = mergeLoadedConversationMessages(
    Array.isArray(timeline) ? timeline : [],
    Array.isArray(transcript) ? transcript : [],
  )
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
      const timeline = await apiJson(`control/timeline?taskID=${encodeURIComponent(taskID)}`)
      if (taskID !== activeTaskID()) continue
      const merged = mergeLoadedConversationMessages(
        Array.isArray(timeline) ? timeline : [],
        Array.isArray(transcript) ? transcript : [],
      ).map((message: any) => ({
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

// ── Apply SSE events ──

function applyMessageEvent(event: any): boolean {
  const type = event.type || ""
  const properties =
    typeof event?.properties === "object" && event.properties && !Array.isArray(event.properties)
      ? event.properties
      : typeof event?.payload === "object" && event.payload && !Array.isArray(event.payload)
        ? event.payload
        : {}

  // All mutation branches below touch two reactive views in lock-step:
  //   1. `store.messages` — flat chronological transcript consumers
  //   2. `store.messagesBySession[sid]` — per-session bucket consumers
  // Both hold references to the SAME Message objects, but Solid tracks
  // them as independent reactive slots. Writing only one side leaves the
  // other's subscribers unnotified, so every mutation updates both views.

  if (type === "message.updated") {
    const info = properties.info
    if (!info?.id) return false
    const existing = messageById(info.id)
    if (existing) {
      const merged = mergeMessageInfo(existing.info, info)
      const idx = store.messages.indexOf(existing)
      if (idx >= 0) setStore("messages", idx, "info", merged)
      const sid = sessionKeyOf(existing)
      const sIdx = sessionBucketIndexOf(sid, existing)
      if (sIdx >= 0) setStore("messagesBySession", sid, sIdx, "info", merged)
      return true
    }
    // Flush any parts that arrived before this message
    const bufferedEntry = _pendingParts.get(info.id)
    if (bufferedEntry) _pendingParts.delete(info.id)
    const msg: Message = { info: mergeMessageInfo(undefined, info), parts: bufferedEntry?.parts ?? [] }
    let insertIdx = 0
    setStore(
      "messages",
      produce((msgs: Message[]) => {
        insertIdx = insertSorted(msgs, msg)
      }),
    )
    // The object we put into the session bucket must be the SAME reference
    // Solid wrapped in the flat array — otherwise sub-path updates on either
    // side won't propagate to the other.
    const stored = store.messages[insertIdx]
    messageIndex.set(info.id, stored)
    const sid = sessionKeyOf(stored)
    const existingBucket = store.messagesBySession[sid]
    if (!existingBucket) {
      setStore("messagesBySession", sid, [stored])
    } else {
      setStore(
        "messagesBySession",
        sid,
        produce((arr: Message[]) => {
          insertSorted(arr, stored)
        }),
      )
    }
    return true
  }

  if (type === "message.part.updated") {
    const incomingPart = properties.part
    if (!incomingPart?.id || !incomingPart?.messageID) return false
    let message = messageById(incomingPart.messageID)
    if (!message) {
      // Buffer: message.updated hasn't arrived yet. Store part for later.
      const normalizedPendingPart = normalizeToolPartRecord(incomingPart) as any
      const existing = _pendingParts.get(incomingPart.messageID)
      if (existing) {
        const partIdx = existing.parts.findIndex((item: any) => item?.id === normalizedPendingPart?.id)
        if (partIdx >= 0) {
          existing.parts[partIdx] = normalizeToolPartRecord(normalizedPendingPart, existing.parts[partIdx])
        } else {
          existing.parts.push(normalizedPendingPart)
        }
      } else {
        _pendingParts.set(incomingPart.messageID, { parts: [normalizedPendingPart] })
      }
      return true
    }
    const idx = store.messages.indexOf(message)
    const sid = sessionKeyOf(message)
    const sIdx = sessionBucketIndexOf(sid, message)
    const partIdx = message.parts.findIndex((p: Part) => p.id === incomingPart.id)
    const part = normalizeToolPartRecord(incomingPart, partIdx >= 0 ? message.parts[partIdx] : undefined) as Part
    if (partIdx >= 0) {
      setStore("messages", idx, "parts", partIdx, part)
      if (sIdx >= 0) setStore("messagesBySession", sid, sIdx, "parts", partIdx, part)
    } else {
      // CRITICAL: messages[idx] and messagesBySession[sid][sIdx] share the same
      // Message reference — so `.parts` is a single JS array. Using `produce`
      // with push() twice would push the new part ONCE into that shared array
      // (via the first setStore), then push it AGAIN on the second setStore
      // (because produce reads the now-modified array). That is how users saw
      // every tool card appearing in duplicate.
      //
      // Compute the new array ONCE and assign it as a value to both reactive
      // paths. Value assignment is idempotent — the second setStore sees the
      // same target and re-emits the same reference without mutating.
      const nextParts = [...message.parts, part]
      setStore("messages", idx, "parts", nextParts)
      if (sIdx >= 0) setStore("messagesBySession", sid, sIdx, "parts", nextParts)
    }
    return true
  }

  if (type === "message.part.delta") {
    if (typeof properties.delta !== "string") return false
    if (properties.field !== "text" && properties.field !== "raw") return false

    let message = messageById(properties.messageID)
    if (!message) {
      // Delta for unknown message — drop silently. The full part will arrive
      // via message.part.updated (persisted) when SSE reconnects or transcript loads.
      return false
    }

    const msgIdx = store.messages.indexOf(message)
    const sid = sessionKeyOf(message)
    const sIdx = sessionBucketIndexOf(sid, message)
    const partIdx = message.parts.findIndex((p: Part) => p.id === properties.partID)

    if (properties.field === "raw") {
      if (partIdx < 0) return false
      const part = message.parts[partIdx]
      if (part.type !== "tool" || !part.state) return false
      // CRITICAL: messages and messagesBySession hold the SAME Message object
      // refs. If we used a functional updater `(prev) => prev + delta` and ran
      // it twice (once per mirrored setStore), the second call would read the
      // already-appended value and double the delta — producing "aa bb cc" for
      // each streamed token. Resolve the new value ONCE, then write it as a
      // plain value to both reactive paths.
      const nextRaw = ((part.state as any).raw || "") + properties.delta
      setStore("messages", msgIdx, "parts", partIdx, "state", "raw", nextRaw)
      if (sIdx >= 0) setStore("messagesBySession", sid, sIdx, "parts", partIdx, "state", "raw", nextRaw)
      return true
    }

    // text delta
    if (partIdx < 0) {
      // Create placeholder part on both views. Same shared-array gotcha as in
      // message.part.updated's push branch — assign a freshly-built array to
      // both reactive paths instead of running `produce(push)` twice, which
      // would otherwise duplicate the placeholder in the shared parts array.
      const newPart: Part = {
        id: properties.partID,
        type: "text",
        text: properties.delta,
        sessionID: properties.sessionID,
        messageID: properties.messageID,
      }
      const nextParts = [...message.parts, newPart]
      setStore("messages", msgIdx, "parts", nextParts)
      if (sIdx >= 0) setStore("messagesBySession", sid, sIdx, "parts", nextParts)
      return true
    }

    // CRITICAL: compute next text ONCE — see the raw-field branch above for
    // the full explanation. Using a functional updater twice across mirrored
    // setStore calls reads the already-appended value on the second pass and
    // doubles every delta.
    const existingText = (message.parts[partIdx] as any).text || ""
    const nextText = existingText + properties.delta
    setStore("messages", msgIdx, "parts", partIdx, "text", nextText)
    if (sIdx >= 0) setStore("messagesBySession", sid, sIdx, "parts", partIdx, "text", nextText)
    return true
  }

  return false
}

// ── 16ms event batching ──

const FLUSH_INTERVAL = 50
let eventQueue: any[] = []
let flushTimer: any = null
let lastFlushTime = 0

export function enqueueEvent(event: any) {
  eventQueue.push(event)
  if (flushTimer) return
  if (Date.now() - lastFlushTime < FLUSH_INTERVAL) {
    flushTimer = setTimeout(flushEvents, FLUSH_INTERVAL)
    return
  }
  flushEvents()
}

/** Coalesce consecutive delta events for the same part before applying. */
function coalesceDeltas(events: any[]): any[] {
  if (events.length <= 1) return events
  const out: any[] = []
  for (const ev of events) {
    const p = ev?.properties
    if (
      ev?.type === "message.part.delta" &&
      (p?.field === "text" || p?.field === "raw") &&
      typeof p?.delta === "string" &&
      out.length > 0
    ) {
      const prev = out[out.length - 1]
      const pp = prev?.properties
      if (
        prev?.type === "message.part.delta" &&
        pp?.field === p.field &&
        pp?.partID === p.partID &&
        pp?.messageID === p.messageID
      ) {
        pp.delta += p.delta
        continue
      }
    }
    out.push(ev)
  }
  return out
}

function flushEvents() {
  if (eventQueue.length === 0) return
  const events = coalesceDeltas(eventQueue)
  eventQueue = []
  flushTimer = null
  lastFlushTime = Date.now()
  batch(() => {
    for (const event of events) {
      applyMessageEvent(event)
    }
  })
}

/**
 * Ingest a persisted real Message + parts the server returned synchronously
 * from a POST (e.g. /task/:id/message). Replays the same `message.updated`
 * + `message.part.updated` shapes the SSE bridge would deliver, so the
 * subsequent SSE event for the same id idempotently no-ops via the by-id
 * merge in applyMessageEvent. Single source: one ingestion path for the
 * real backend message, no placeholder, no double-write.
 */
export function ingestPersistedMessage(input: { info: any; parts: any[] }): void {
  if (!input?.info?.id) return
  batch(() => {
    applyMessageEvent({
      type: "message.updated",
      properties: { info: input.info },
    })
    for (const part of input.parts ?? []) {
      if (!part) continue
      applyMessageEvent({
        type: "message.part.updated",
        properties: { part },
      })
    }
  })
}

export function clearEventQueue() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  eventQueue = []
}

export function setMessages(messages: any[]) {
  const next = sortMessages(Array.isArray(messages) ? messages : [])
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
      msgs.sort((a, b) => messageOrderTime(a) - messageOrderTime(b))
    }),
  )
  rebuildMessageIndex()
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
  messageIndex.clear()
  _pendingParts.clear()
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
