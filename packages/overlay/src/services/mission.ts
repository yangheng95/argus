// ── Mission Service ──
//
// Thin client over the server APIs the Mission control page calls: the
// Mission agent wake, plus the gateway/channel infrastructure data sources
// it surfaces (stats, channel runtime, task bindings). Every helper returns
// the parsed JSON body and lets failures propagate as ApiError; the page
// renders explicit error states (template §14 — no silent fallbacks).
//
// The Mission page reads the same task sources as the panel — boardStore for
// tasks, settingsStore for the active directory — so this service does not
// duplicate task storage. The stats/channel endpoints it calls
// (`gateway/stats`, `channel/*`) are kept gateway infrastructure routes.

import { apiJson } from "./api"

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

export interface ChannelRuntimeStatus {
  status: string
  detail: string
  channels: string[]
  logs: string[]
  running: boolean
}

export interface ChannelInfo {
  id: string
  name: string
  summary: string
  status: string
  runtime_status?: string
  runtime_detail?: string
  fields?: Array<{ key: string; label: string; type: string; placeholder?: string }>
  bindings_endpoint?: string
}

// Mission wake — single endpoint that starts or resumes the Mission agent
// session for one mission. See specs/gateway-mission-split-2026-05-28.md.
export interface MissionWakeInput {
  /** Existing missionID to resume. Omit to start a new mission. */
  missionID?: string
  /** User prompt to inject into the mission session. */
  text: string
  /** Optional human-readable title for the mission (not yet persisted). */
  title?: string
  signal?: AbortSignal
}

export interface MissionWakeResult {
  missionID: string
  sessionID: string
  /** true when the wake created a fresh session; false when it resumed one. */
  created: boolean
}

export interface ChannelBindingRow {
  id: string
  task_id: string
  platform: string
  channel: string
  thread: string
  payload?: Record<string, unknown>
  time_created?: number
  time_updated?: number
}

// ── API helpers ──

// `gateway/stats` is the kept gateway infrastructure endpoint (operator
// dashboard summary); the Mission page surfaces it as its own stats block.
export async function loadMissionStats(opts: { directory?: string; limit?: number; signal?: AbortSignal } = {}): Promise<MissionStats> {
  const params = new URLSearchParams()
  if (opts.directory) params.set("directory", opts.directory)
  if (typeof opts.limit === "number") params.set("limit", String(opts.limit))
  const suffix = params.toString() ? `?${params.toString()}` : ""
  return (await apiJson(`gateway/stats${suffix}`, { signal: opts.signal })) as MissionStats
}

export async function loadChannelList(signal?: AbortSignal): Promise<ChannelInfo[]> {
  const data = await apiJson(`channel`, { signal })
  // Server route declares the response as `ChannelRegistry.Info.array()`.
  // A non-array body means contract drift — surface it so the Mission page's
  // channel-list error block fires (template §14, rule 7) instead of silently
  // rendering an empty channel list.
  if (!Array.isArray(data)) {
    throw new Error(
      `loadChannelList: server returned non-array body (got ${typeof data}). Server contract has drifted from ChannelRegistry.Info[].`,
    )
  }
  return data as ChannelInfo[]
}

export async function loadChannelRuntime(signal?: AbortSignal): Promise<ChannelRuntimeStatus> {
  return (await apiJson(`channel/runtime`, { signal })) as ChannelRuntimeStatus
}

export async function restartChannelRuntime(signal?: AbortSignal): Promise<ChannelRuntimeStatus> {
  return (await apiJson(`channel/runtime/restart`, {
    method: "POST",
    signal,
  })) as ChannelRuntimeStatus
}

export async function loadTaskBindings(taskID: string, signal?: AbortSignal): Promise<ChannelBindingRow[]> {
  // Guard against an empty taskID at the call site — it's a programmer
  // error, not a server response, so don't even hit the network. Empty
  // bindings for a real task are a legitimate server result and arrive
  // as `[]` from the API.
  if (!taskID) return []
  const data = await apiJson(`task/${encodeURIComponent(taskID)}/bindings`, { signal })
  // The server route declares the response as an array (TaskBindingList
  // in orchestrator.ts). A non-array body means contract drift —
  // surface it as a loud error so the Mission error block fires
  // instead of silently rendering an empty list (rule 7).
  if (!Array.isArray(data)) {
    throw new Error(
      `loadTaskBindings: server returned non-array body (got ${typeof data}). Server contract has drifted from TaskBindingList.`,
    )
  }
  return data as ChannelBindingRow[]
}

export async function wakeMission(input: MissionWakeInput): Promise<MissionWakeResult> {
  const text = input.text.trim()
  if (!text) throw new Error("wakeMission: text is required")
  const body = JSON.stringify({
    text,
    ...(input.missionID ? { missionID: input.missionID } : {}),
    ...(input.title ? { title: input.title } : {}),
  })
  return (await apiJson(`mission/wake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: input.signal,
  })) as MissionWakeResult
}
