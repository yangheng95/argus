import { batch } from "solid-js"
import { clearBoard, setBoardStore, boardStore, type BoardSource } from "../store/board"
import { abortChatRequest, clearMessages, setChatAttachments } from "../store/messages"
import {
  codingAssistantStore,
  setCodingAssistantStore,
  selectedCodingAssistantSessionID,
  type CodingAssistantSessionCursor,
  type CodingAssistantSessionInfo,
} from "../store/coding-assistant"
import { cancelConversationReplay, hydrateConversation } from "./conversation"
import { startSSE, stopSSE } from "./sse"
import { resetSelectedLiveCursor } from "./selected-stream-cursor"
import { resetWriter } from "./tree-writer"
import { apiJson } from "./api"

type CodingAssistantSessionResponse = {
  session: CodingAssistantSessionInfo
}

type CodingAssistantSessionsResponse = {
  sessions: CodingAssistantSessionInfo[]
  nextCursor?: CodingAssistantSessionCursor
}

let activation: Promise<string> | null = null
let activationSignal: AbortSignal | undefined
let activationSessionID = ""
let sessionListLoadOwner: symbol | null = null
let sessionListLoadMoreOwner: symbol | null = null

export type SelectCodingAssistantSessionOptions = {
  sessionID: string
  directory: string
  signal?: AbortSignal
}

export type CodingAssistantSessionActionTarget = {
  sessionID: string
  directory: string
}

function assertNotAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException("Coding assistant activation aborted", "AbortError")
}

function sessionIDFromResponse(value: CodingAssistantSessionResponse): string {
  const id = String(value?.session?.id || "").trim()
  if (!id) throw new Error("Coding assistant session response missing session.id")
  return id
}

function normalizeSession(input: CodingAssistantSessionInfo): CodingAssistantSessionInfo {
  return {
    id: String(input.id || ""),
    kind: String(input.kind || ""),
    title: input.title ?? null,
    directory: input.directory ?? null,
    metadata: input.metadata ?? null,
    time: input.time,
  }
}

function sessionUpdated(session: CodingAssistantSessionInfo): number {
  return Number(session.time?.updated || session.time?.created || 0)
}

function mergeSessions(
  current: CodingAssistantSessionInfo[],
  incoming: CodingAssistantSessionInfo[],
): CodingAssistantSessionInfo[] {
  const map = new Map<string, CodingAssistantSessionInfo>()
  for (const session of current) {
    if (session.id) map.set(session.id, session)
  }
  for (const raw of incoming) {
    const session = normalizeSession(raw)
    if (session.id) map.set(session.id, session)
  }
  return [...map.values()].sort((a, b) => sessionUpdated(b) - sessionUpdated(a))
}

function setSessionRow(session: CodingAssistantSessionInfo): void {
  setCodingAssistantStore("sessions", (current) => mergeSessions(current, [session]))
}

function removeSessionRow(sessionID: string): void {
  setCodingAssistantStore("sessions", (current) => current.filter((session) => session.id !== sessionID))
}

function sameCursor(a: CodingAssistantSessionCursor | null | undefined, b: CodingAssistantSessionCursor | null | undefined) {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.updated === b.updated && a.sessionID === b.sessionID
}

function codingAssistantSessionsPath(input: {
  directory: string
  limit: number
  searchQuery: string
  cursor?: CodingAssistantSessionCursor | null
}): string {
  const directory = input.directory.trim()
  if (!directory) throw new Error("codingAssistantSessionsPath: directory is required")
  const params = new URLSearchParams()
  params.set("directory", directory)
  params.set("limit", String(input.limit))
  const search = input.searchQuery.trim()
  if (search) params.set("search", search)
  if (input.cursor) {
    params.set("cursorUpdated", String(input.cursor.updated))
    params.set("cursorSessionID", input.cursor.sessionID)
  }
  return `coding/sessions?${params.toString()}`
}

function codingAssistantSessionPath(target: CodingAssistantSessionActionTarget, suffix = ""): string {
  const sessionID = target.sessionID.trim()
  const directory = target.directory.trim()
  if (!sessionID || !directory) throw new Error("codingAssistantSessionPath: sessionID and directory are required")
  const params = new URLSearchParams({ directory })
  return `coding/session/${encodeURIComponent(sessionID)}${suffix}?${params.toString()}`
}

export async function loadCodingAssistantSessions(options: {
  directory: string
  signal?: AbortSignal
  append?: boolean
  searchQuery?: string
  cursor?: CodingAssistantSessionCursor | null
  isCurrentSource?: () => boolean
}): Promise<void> {
  assertNotAborted(options.signal)
  const directory = String(options.directory || "").trim()
  if (!directory) throw new Error("loadCodingAssistantSessions: directory is required")
  const append = options.append === true
  const searchQuery = String(options.searchQuery ?? codingAssistantStore.searchQuery).trim()
  const cursor = append ? (options.cursor ?? codingAssistantStore.nextCursor) : null
  const token = Symbol("coding-assistant-session-list")
  if (append) sessionListLoadMoreOwner = token
  else sessionListLoadOwner = token
  const ownsOwner = () => (append ? sessionListLoadMoreOwner === token : sessionListLoadOwner === token)
  const ownsRequest = () => {
    if (!ownsOwner()) return false
    if (codingAssistantStore.searchQuery.trim() !== searchQuery) return false
    if (append && !sameCursor(codingAssistantStore.nextCursor, cursor)) return false
    return options.isCurrentSource?.() ?? true
  }
  setCodingAssistantStore(append ? "loadingMore" : "loading", true)
  setCodingAssistantStore("error", "")
  try {
    const listed = (await apiJson(codingAssistantSessionsPath({ directory, limit: 30, searchQuery, cursor }), {
      signal: options.signal,
    })) as CodingAssistantSessionsResponse
    assertNotAborted(options.signal)
    if (!ownsRequest()) return
    setCodingAssistantStore("sessions", (current) =>
      append ? mergeSessions(current, listed.sessions || []) : (listed.sessions || []).map(normalizeSession),
    )
    setCodingAssistantStore("nextCursor", listed.nextCursor ?? null)
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error
    if (!ownsRequest()) return
    setCodingAssistantStore("error", error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    if (ownsOwner()) {
      setCodingAssistantStore(append ? "loadingMore" : "loading", false)
      if (append) sessionListLoadMoreOwner = null
      else sessionListLoadOwner = null
    }
  }
}

export function isCodingAssistantSource(source: BoardSource | null = boardStore.selectedSource): boolean {
  const sessionID = selectedCodingAssistantSessionID()
  return source?.kind === "session" && !!sessionID && source.id === sessionID
}

export function setCodingAssistantSearchQuery(query: string): void {
  setCodingAssistantStore("searchQuery", query)
}

export async function createCodingAssistantSession(options: {
  directory: string
  signal?: AbortSignal
}): Promise<string> {
  const directory = options.directory.trim()
  if (!directory) throw new Error("createCodingAssistantSession: directory is required")
  assertNotAborted(options.signal)
  const params = new URLSearchParams({ directory })
  const response = (await apiJson(`coding/session?${params.toString()}`, {
    method: "POST",
    signal: options.signal,
  })) as CodingAssistantSessionResponse
  assertNotAborted(options.signal)
  setSessionRow(response.session)
  return selectCodingAssistantSession({
    sessionID: sessionIDFromResponse(response),
    directory: String(response.session.directory || ""),
    signal: options.signal,
  })
}

export async function selectCodingAssistantSession(options: SelectCodingAssistantSessionOptions): Promise<string> {
  const requestedSessionID = String(options.sessionID || "").trim()
  if (activation && activationSessionID === requestedSessionID && !activationSignal?.aborted) return activation
  const currentActivation = (async () => {
    const sessionID = requestedSessionID
    if (!sessionID) throw new Error("selectCodingAssistantSession: sessionID is required")
    const inputDirectory = String(options.directory || "").trim()
    if (!inputDirectory) throw new Error("selectCodingAssistantSession: session directory is required")
    assertNotAborted(options.signal)
    const claimed = (await apiJson(codingAssistantSessionPath({ sessionID, directory: inputDirectory }), {
      signal: options.signal,
    })) as CodingAssistantSessionResponse | undefined
    if (claimed?.session) setSessionRow(claimed.session)
    const directory = String(claimed?.session?.directory || "").trim()
    if (!directory) throw new Error("selectCodingAssistantSession: session directory is required")
    assertNotAborted(options.signal)
    setCodingAssistantStore("selectedSessionID", sessionID)
    const source: BoardSource = { kind: "session", id: sessionID }
    abortChatRequest()
    cancelConversationReplay()
    setChatAttachments([])
    stopSSE()
    resetSelectedLiveCursor()
    batch(() => {
      clearBoard()
      clearMessages()
      resetWriter({ scrollIntent: "bottom", cause: "coding-assistant-switch" })
      setBoardStore("selectedSource", source)
      setBoardStore("selectEpoch", (value: number) => value + 1)
      setBoardStore("taskSwitching", true)
    })
    const epoch = boardStore.selectEpoch
    try {
      await hydrateConversation(source, {
        signal: options.signal,
        scrollIntent: "bottom",
        resetCause: "coding-assistant-hydrate",
        directory,
      })
      assertNotAborted(options.signal)
      if (boardStore.selectEpoch === epoch && isCodingAssistantSource(source)) {
        startSSE(source, 0, { directory })
      }
      return sessionID
    } finally {
      if (boardStore.selectEpoch === epoch) setBoardStore("taskSwitching", false)
    }
  })()
  activation = currentActivation
  activationSignal = options.signal
  activationSessionID = requestedSessionID
  try {
    return await currentActivation
  } finally {
    if (activation === currentActivation) {
      activation = null
      activationSignal = undefined
      activationSessionID = ""
    }
  }
}

export async function renameCodingAssistantSession(
  target: CodingAssistantSessionActionTarget,
  title: string,
): Promise<boolean> {
  const id = target.sessionID.trim()
  const trimmed = title.trim()
  if (!id || !target.directory.trim() || !trimmed || trimmed.length > 200) {
    throw new Error("renameCodingAssistantSession: sessionID, directory, and 1-200 character title are required")
  }
  setCodingAssistantStore("actionBusyID", id)
  try {
    const response = (await apiJson(codingAssistantSessionPath(target), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    })) as CodingAssistantSessionResponse
    setSessionRow(response.session)
    if (selectedCodingAssistantSessionID() === id && boardStore.board) {
      setBoardStore("board", "title", response.session.title || trimmed)
    }
    return true
  } catch (error) {
    console.error("[coding-assistant] rename failed", { sessionID: id, error })
    throw error
  } finally {
    setCodingAssistantStore("actionBusyID", "")
  }
}

export async function stopCodingAssistantSession(target: CodingAssistantSessionActionTarget): Promise<boolean> {
  const id = target.sessionID.trim()
  if (!id || !target.directory.trim())
    throw new Error("stopCodingAssistantSession: sessionID and directory are required")
  setCodingAssistantStore("actionBusyID", id)
  try {
    if (selectedCodingAssistantSessionID() === id) abortChatRequest()
    await apiJson(codingAssistantSessionPath(target, "/abort"), { method: "POST" })
    return true
  } catch (error) {
    console.error("[coding-assistant] stop failed", { sessionID: id, error })
    throw error
  } finally {
    setCodingAssistantStore("actionBusyID", "")
  }
}

export async function deleteCodingAssistantSession(target: CodingAssistantSessionActionTarget): Promise<boolean> {
  const id = target.sessionID.trim()
  if (!id || !target.directory.trim()) {
    throw new Error("deleteCodingAssistantSession: sessionID and directory are required")
  }
  setCodingAssistantStore("actionBusyID", id)
  const wasSelected = selectedCodingAssistantSessionID() === id
  try {
    await apiJson(codingAssistantSessionPath(target), { method: "DELETE" })
    if (wasSelected) {
      abortChatRequest()
      cancelConversationReplay()
      stopSSE()
      resetSelectedLiveCursor()
      batch(() => {
        clearBoard()
        clearMessages()
        resetWriter({ scrollIntent: "bottom", cause: "coding-assistant-delete" })
        setBoardStore("selectedSource", null)
        setBoardStore("selectEpoch", (value: number) => value + 1)
        setBoardStore("taskSwitching", false)
        setCodingAssistantStore("selectedSessionID", "")
      })
    }
    removeSessionRow(id)
    return true
  } catch (error) {
    console.error("[coding-assistant] delete failed", { sessionID: id, error })
    throw error
  } finally {
    setCodingAssistantStore("actionBusyID", "")
  }
}
