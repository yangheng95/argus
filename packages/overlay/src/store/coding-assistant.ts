import { createStore } from "solid-js/store"

export type CodingAssistantSessionInfo = {
  id: string
  kind: string
  title?: string | null
  directory?: string | null
  metadata?: Record<string, unknown> | null
  time?: {
    created?: number
    updated?: number
    archived?: number
  }
}

export type CodingAssistantSessionCursor = {
  updated: number
  sessionID: string
}

export const [codingAssistantStore, setCodingAssistantStore] = createStore({
  sessions: [] as CodingAssistantSessionInfo[],
  selectedSessionID: "",
  loading: false,
  loadingMore: false,
  error: "",
  searchQuery: "",
  nextCursor: null as CodingAssistantSessionCursor | null,
  actionBusyID: "",
})

export function selectedCodingAssistantSessionID(): string {
  return codingAssistantStore.selectedSessionID
}
