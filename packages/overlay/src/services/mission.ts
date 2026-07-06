// ── Mission Service ──
//
// Thin client over the server APIs the Mission activity calls: the Mission
// agent wake, Mission ledger, and task bindings. Every helper returns
// the parsed JSON body and lets failures propagate as ApiError; the page
// renders explicit error states (template §14 — no silent fallbacks).
//
// The Mission activity reads the same task sources as the panel — boardStore
// for tasks, settingsStore for the active directory — so this service does
// not duplicate task storage.

import { apiJson } from "./api"
import { downloadProjectArchive } from "./project-archive"

// ── Types mirroring server route responses ──

export interface MissionStatsRecentTask {
  id: string
  title: string
  status: string
  priority?: string
  directory?: string
  updated?: number
}

export interface MissionStats {
  generatedAt: number
  project: {
    id: string
    name?: string
    worktree: string
    directory: string
  }
  tasks: {
    total: number
    status: Record<string, number>
    summary: unknown
    recent: MissionStatsRecentTask[]
  }
  capabilities: {
    total: number
    queries: number
    mutations: number
  }
  channelRuntime?: {
    running: boolean
    status: string
    channels: string[]
    detail?: string
  }
}

// Mission wake — single endpoint that starts or resumes the Mission agent
// session for one mission. See mission split contract.
export interface MissionWakeInput {
  /** Existing missionID to resume. Omit to start a new mission. */
  missionID?: string
  /** User prompt to inject into the mission session. */
  text: string
  /** Optional human-readable title for the mission (not yet persisted). */
  title?: string
  /** Explicit OpenCorvus model reference for this wake. */
  model?: string
  /** Prompt profile selected in the shared composer. */
  promptProfile?: string
  signal?: AbortSignal
}

export interface MissionWakeResult {
  missionID: string
  sessionID: string
  /** true when the wake created a fresh session; false when it resumed one. */
  created: boolean
}

export type MissionTaskStatus = "queued" | "active" | "completed" | "failed" | "cancelled"
export type MissionExecutionStatus = "success" | "failed" | "running"

export interface MissionTaskProjection {
  id: string
  title: string
  status: MissionTaskStatus
  executionStatus: MissionExecutionStatus
  priority: "critical" | "high" | "normal" | "low"
  source: string
  directory: string
  created: number
  updated: number
  started?: number
  completed?: number
}

export interface MissionTaskStats {
  total: number
  queued: number
  active: number
  completed: number
  failed: number
  cancelled: number
}

export interface MissionRecord {
  missionID: string
  sessionID: string
  title: string
  directory: string
  created: number
  updated: number
  archived?: number
  interruptible: boolean
  tasks: MissionTaskProjection[]
  taskStats: MissionTaskStats
}

export interface MissionPage {
  records: MissionRecord[]
  hasMore: boolean
  cursor: { updated: number; sessionID: string } | null
}

export interface StatusProgress {
  total: number
  completed: number
  failed: number
  running: number
  pending: number
  percent: number
}

export interface TaskStatusWorkflowStep {
  id: string
  label: string
  scope: "task" | "goal"
  tool: string
  status: MissionExecutionStatus
  rawStatus: "pending" | "running" | "completed" | "skipped" | "failed" | "aborted"
}

export interface TaskStatusGoalStep {
  stepID: string
  label: string
  status: MissionExecutionStatus
  rawStatus: "pending" | "running" | "completed" | "skipped" | "failed" | "aborted"
  startedAt?: number
  completedAt?: number
  summary?: string
  phases?: Array<{
    phaseID: string
    status: MissionExecutionStatus
    rawStatus: "pending" | "running" | "completed" | "skipped" | "failed" | "aborted"
    startedAt?: number
    completedAt?: number
  }>
}

export interface TaskStatusGoalDetail {
  goalID: string
  title: string
  objective?: string
  status: MissionExecutionStatus
  rawStatus: string
  orderIndex: number
  priority: "blocking" | "advisory"
  progress: StatusProgress
  steps: TaskStatusGoalStep[]
}

export interface TaskStatusAgentOutcomeField {
  label: string
  value: string
}

export interface TaskStatusAgentOutcome {
  id: string
  provider: string
  artifactKind: string
  scope: "task" | "goal"
  capabilities?: string[]
  runID?: string
  sessionID?: string
  status: string
  result?: string
  summary?: string
  error?: string
  fields?: TaskStatusAgentOutcomeField[]
  time: {
    created: number
    updated: number
  }
}

export interface TaskStatusDetail {
  taskID: string
  title: string
  status: MissionExecutionStatus
  lifecycleStatus: MissionTaskStatus
  source: string
  priority: "critical" | "high" | "normal" | "low"
  directory?: string
  error?: string
  progress: StatusProgress
  workflow?: {
    id: string
    name: string
    steps: TaskStatusWorkflowStep[]
  }
  goals: TaskStatusGoalDetail[]
  taskAgentOutcomes: TaskStatusAgentOutcome[]
  time: {
    created: number
    updated: number
    started?: number
    completed?: number
  }
}

export interface MissionStatusSnapshot {
  missionID: string
  sessionID: string
  title: string
  directory: string
  status: MissionExecutionStatus
  taskCounts: {
    total: number
    success: number
    failed: number
    running: number
  }
  progress: StatusProgress
  tasks: TaskStatusDetail[]
  generatedAt: number
}

export function missionPage(records: MissionRecord[], visibleLimit: number): MissionPage {
  const visible = records.slice(0, visibleLimit)
  const last = visible.at(-1)
  return {
    records: visible,
    hasMore: records.length > visibleLimit,
    cursor: last ? { updated: last.updated, sessionID: last.sessionID } : null,
  }
}

export interface MissionActionTarget {
  missionID: string
  directory: string
}

export interface MissionStatusRequest {
  missionID: string
  directory: string
  signal?: AbortSignal
}

export interface TaskStatusRequest {
  taskID: string
  directory: string
  signal?: AbortSignal
}

// ── API helpers ──

export async function loadMissionStats(
  opts: { directory?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<MissionStats> {
  const params = new URLSearchParams()
  if (opts.directory) params.set("directory", opts.directory)
  if (typeof opts.limit === "number") params.set("limit", String(opts.limit))
  const suffix = params.toString() ? `?${params.toString()}` : ""
  return (await apiJson(`gateway/stats${suffix}`, { signal: opts.signal })) as MissionStats
}

export async function loadMissions(
  opts: {
    directory?: string
    search?: string
    limit?: number
    cursorUpdated?: number
    cursorSessionID?: string
    archived?: boolean
    signal?: AbortSignal
  } = {},
): Promise<MissionRecord[]> {
  const params = new URLSearchParams()
  if (opts.directory) params.set("directory", opts.directory)
  if (opts.search) params.set("search", opts.search)
  if (typeof opts.limit === "number") params.set("limit", String(opts.limit))
  if (typeof opts.cursorUpdated === "number") params.set("cursorUpdated", String(opts.cursorUpdated))
  if (opts.cursorSessionID) params.set("cursorSessionID", opts.cursorSessionID)
  if (typeof opts.archived === "boolean") params.set("archived", String(opts.archived))
  const suffix = params.toString() ? `?${params.toString()}` : ""
  const data = await apiJson(`mission${suffix}`, { signal: opts.signal })
  if (!Array.isArray(data)) {
    throw new Error(
      `loadMissions: server returned non-array body (got ${typeof data}). Server contract has drifted from MissionRecord[].`,
    )
  }
  return data as MissionRecord[]
}

export async function loadMissionStatus(input: MissionStatusRequest): Promise<MissionStatusSnapshot> {
  const missionID = input.missionID.trim()
  const directory = input.directory.trim()
  if (!missionID || !directory) throw new Error("loadMissionStatus: missionID and directory are required")
  const params = new URLSearchParams({ directory })
  return (await apiJson(`mission/${encodeURIComponent(missionID)}/status?${params.toString()}`, {
    signal: input.signal,
  })) as MissionStatusSnapshot
}

export async function loadTaskStatus(input: TaskStatusRequest): Promise<TaskStatusDetail> {
  const taskID = input.taskID.trim()
  const directory = input.directory.trim()
  if (!taskID || !directory) throw new Error("loadTaskStatus: taskID and directory are required")
  const params = new URLSearchParams({ directory })
  return (await apiJson(`task/${encodeURIComponent(taskID)}/status?${params.toString()}`, {
    signal: input.signal,
  })) as TaskStatusDetail
}

export async function wakeMission(input: MissionWakeInput): Promise<MissionWakeResult> {
  const text = input.text.trim()
  if (!text) throw new Error("wakeMission: text is required")
  const body = JSON.stringify({
    text,
    ...(input.missionID ? { missionID: input.missionID } : {}),
    ...(input.title ? { title: input.title } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.promptProfile ? { promptProfile: input.promptProfile } : {}),
  })
  return (await apiJson(`mission/wake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: input.signal,
  })) as MissionWakeResult
}

function missionActionPath(target: MissionActionTarget, suffix = ""): string {
  const missionID = target.missionID.trim()
  const directory = target.directory.trim()
  if (!missionID || !directory) {
    throw new Error("missionActionPath: missionID and directory are required")
  }
  const params = new URLSearchParams({ directory })
  return `mission/${encodeURIComponent(missionID)}${suffix}?${params.toString()}`
}

export async function renameMission(target: MissionActionTarget, title: string): Promise<MissionRecord> {
  const trimmed = title.trim()
  if (!trimmed || trimmed.length > 200) {
    throw new Error("renameMission: missionID, directory, and 1-200 character title are required")
  }
  return (await apiJson(missionActionPath(target, "/title"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: trimmed }),
  })) as MissionRecord
}

export async function abortMission(target: MissionActionTarget): Promise<boolean> {
  return (await apiJson(missionActionPath(target, "/abort"), {
    method: "POST",
  })) as boolean
}

export async function deleteMission(target: MissionActionTarget): Promise<boolean> {
  return (await apiJson(missionActionPath(target), {
    method: "DELETE",
  })) as boolean
}

export async function downloadMissionProjectArchive(target: MissionActionTarget): Promise<boolean> {
  return downloadProjectArchive({
    path: missionActionPath(target, "/project-archive"),
  })
}
