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

export type SelectCodingAssistantSessionOptions = {
  sessionID: string
  signal?: AbortSignal
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

function codingAssistantSessionsPath(input: { limit: number; append?: boolean }): string {
  const params = new URLSearchParams()
  params.set("limit", String(input.limit))
  const search = codingAssistantStore.searchQuery.trim()
  if (search) params.set("search", search)
  if (input.append && codingAssistantStore.nextCursor) {
    params.set("cursorUpdated", String(codingAssistantStore.nextCursor.updated))
    params.set("cursorSessionID", codingAssistantStore.nextCursor.sessionID)
  }
  return `coding/sessions?${params.toString()}`
}

export async function loadCodingAssistantSessions(options: { signal?: AbortSignal; append?: boolean } = {}): Promise<void> {
  assertNotAborted(options.signal)
  const append = options.append === true
  setCodingAssistantStore(append ? "loadingMore" : "loading", true)
  setCodingAssistantStore("error", "")
  try {
    const listed = (await apiJson(codingAssistantSessionsPath({ limit: 30, append }), {
      signal: options.signal,
    })) as CodingAssistantSessionsResponse
    assertNotAborted(options.signal)
    setCodingAssistantStore("sessions", (current) =>
      append ? mergeSessions(current, listed.sessions || []) : (listed.sessions || []).map(normalizeSession),
    )
    setCodingAssistantStore("nextCursor", listed.nextCursor ?? null)
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error
    setCodingAssistantStore("error", error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    setCodingAssistantStore(append ? "loadingMore" : "loading", false)
  }
}

export function isCodingAssistantSource(source: BoardSource | null = boardStore.selectedSource): boolean {
  const sessionID = selectedCodingAssistantSessionID()
  return source?.kind === "session" && !!sessionID && source.id === sessionID
}

export function setCodingAssistantSearchQuery(query: string): void {
  setCodingAssistantStore("searchQuery", query)
}

export async function createCodingAssistantSession(options: { signal?: AbortSignal } = {}): Promise<string> {
  assertNotAborted(options.signal)
  const response = (await apiJson("coding/session", {
    method: "POST",
    signal: options.signal,
  })) as CodingAssistantSessionResponse
  assertNotAborted(options.signal)
  setSessionRow(response.session)
  return selectCodingAssistantSession({ sessionID: sessionIDFromResponse(response), signal: options.signal })
}

export async function selectCodingAssistantSession(options: SelectCodingAssistantSessionOptions): Promise<string> {
  const requestedSessionID = String(options.sessionID || "").trim()
  if (activation && activationSessionID === requestedSessionID && !activationSignal?.aborted) return activation
  const currentActivation = (async () => {
    const sessionID = requestedSessionID
    if (!sessionID) throw new Error("selectCodingAssistantSession: sessionID is required")
    assertNotAborted(options.signal)
    const claimed = (await apiJson(`coding/session/${encodeURIComponent(sessionID)}`, { signal: options.signal })) as
      | CodingAssistantSessionResponse
      | undefined
    if (claimed?.session) setSessionRow(claimed.session)
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
      })
      assertNotAborted(options.signal)
      if (boardStore.selectEpoch === epoch && isCodingAssistantSource(source)) {
        startSSE(source)
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

export async function renameCodingAssistantSession(sessionID: string, title: string): Promise<boolean> {
  const id = sessionID.trim()
  const trimmed = title.trim()
  if (!id || !trimmed || trimmed.length > 200) return false
  setCodingAssistantStore("actionBusyID", id)
  try {
    const response = (await apiJson(`coding/session/${encodeURIComponent(id)}`, {
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
    return false
  } finally {
    setCodingAssistantStore("actionBusyID", "")
  }
}

export async function stopCodingAssistantSession(sessionID: string): Promise<boolean> {
  const id = sessionID.trim()
  if (!id) return false
  setCodingAssistantStore("actionBusyID", id)
  try {
    if (selectedCodingAssistantSessionID() === id) abortChatRequest()
    await apiJson(`coding/session/${encodeURIComponent(id)}/abort`, { method: "POST" })
    return true
  } catch (error) {
    console.error("[coding-assistant] stop failed", { sessionID: id, error })
    return false
  } finally {
    setCodingAssistantStore("actionBusyID", "")
  }
}

export async function deleteCodingAssistantSession(sessionID: string): Promise<boolean> {
  const id = sessionID.trim()
  if (!id) return false
  setCodingAssistantStore("actionBusyID", id)
  const wasSelected = selectedCodingAssistantSessionID() === id
  try {
    await apiJson(`coding/session/${encodeURIComponent(id)}`, { method: "DELETE" })
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
    return false
  } finally {
    setCodingAssistantStore("actionBusyID", "")
  }
}
