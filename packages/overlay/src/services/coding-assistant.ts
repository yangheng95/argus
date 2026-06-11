import { batch } from "solid-js"
import { clearBoard, setBoardStore, boardStore, type BoardSource } from "../store/board"
import { abortChatRequest, clearMessages, setChatAttachments } from "../store/messages"
import { cancelConversationReplay, hydrateConversation } from "./conversation"
import { startSSE, stopSSE } from "./sse"
import { resetSelectedLiveCursor } from "./selected-stream-cursor"
import { resetWriter } from "./tree-writer"
import { apiJson } from "./api"

type CodingAssistantSessionResponse = {
  session: {
    id: string
    kind: string
    title?: string | null
    directory?: string | null
    metadata?: Record<string, unknown> | null
  }
}

type CodingAssistantSessionsResponse = {
  sessions: CodingAssistantSessionResponse["session"][]
}

let activation: Promise<string> | null = null
let activationSignal: AbortSignal | undefined
let selectedCodingAssistantSessionID = ""

type SelectCodingAssistantSessionOptions = {
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

async function resolveCodingAssistantSessionID(signal?: AbortSignal): Promise<string> {
  assertNotAborted(signal)
  const listed = (await apiJson("coding/sessions?limit=1", { signal })) as CodingAssistantSessionsResponse
  assertNotAborted(signal)
  const existingID = String(listed?.sessions?.[0]?.id || "").trim()
  if (existingID) return existingID
  return sessionIDFromResponse(
    (await apiJson("coding/session", { method: "POST", signal })) as CodingAssistantSessionResponse,
  )
}

export function isCodingAssistantSource(source: BoardSource | null = boardStore.selectedSource): boolean {
  return (
    source?.kind === "session" && !!selectedCodingAssistantSessionID && source.id === selectedCodingAssistantSessionID
  )
}

export async function selectCodingAssistantSession(options: SelectCodingAssistantSessionOptions = {}): Promise<string> {
  if (activation && !activationSignal?.aborted) return activation
  const currentActivation = (async () => {
    const sessionID = await resolveCodingAssistantSessionID(options.signal)
    assertNotAborted(options.signal)
    selectedCodingAssistantSessionID = sessionID
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
  try {
    return await currentActivation
  } finally {
    if (activation === currentActivation) {
      activation = null
      activationSignal = undefined
    }
  }
}
