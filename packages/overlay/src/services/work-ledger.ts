import { apiJson } from "./api"
import type { MissionExecutionStatus, MissionTaskStats, MissionTaskStatus } from "./mission"

export type WorkLedgerKind = "mission" | "task" | "chat"
export type WorkLedgerChatStatus = "active" | "idle" | "terminal"

export interface WorkLedgerTaskRow {
  kind: "task"
  id: string
  title: string
  directory: string
  created: number
  updated: number
  lifecycleStatus: MissionTaskStatus
  executionStatus: MissionExecutionStatus
  priority: "critical" | "high" | "normal" | "low"
  source: string
  missionID?: string
  missionSessionID?: string
}

export interface WorkLedgerMissionRow {
  kind: "mission"
  id: string
  missionID: string
  sessionID: string
  title: string
  directory: string
  created: number
  updated: number
  archived?: number
  interruptible: boolean
  taskStats: MissionTaskStats
  tasks: WorkLedgerTaskRow[]
}

export interface WorkLedgerChatRow {
  kind: "chat"
  id: string
  sessionID: string
  title: string
  directory: string
  created: number
  updated: number
  status: WorkLedgerChatStatus
}

export type WorkLedgerRow = WorkLedgerMissionRow | WorkLedgerTaskRow | WorkLedgerChatRow

export interface WorkLedgerCursor {
  updated: number
  rowKey: string
}

export interface WorkLedgerList {
  rows: WorkLedgerRow[]
  nextCursor: WorkLedgerCursor | null
}

export async function loadWorkLedger(input: {
  search?: string
  limit?: number
  cursor?: WorkLedgerCursor | null
  signal?: AbortSignal
} = {}): Promise<WorkLedgerList> {
  const params = new URLSearchParams()
  const search = input.search?.trim()
  if (search) params.set("search", search)
  if (typeof input.limit === "number") params.set("limit", String(input.limit))
  if (input.cursor) {
    params.set("cursorUpdated", String(input.cursor.updated))
    params.set("cursorRowKey", input.cursor.rowKey)
  }
  const suffix = params.toString() ? `?${params.toString()}` : ""
  return (await apiJson(`work-ledger${suffix}`, { signal: input.signal })) as WorkLedgerList
}
