// ── Gateway Service ──
//
// Thin client over the Gateway / Channel / Task server APIs that the
// Gateway page calls. Every helper returns the parsed JSON body and lets
// failures propagate as ApiError; the page renders explicit error states
// (PRD §14 — no silent fallbacks).
//
// The Gateway page reads the same sources as the panel — boardStore for
// tasks, settingsStore for the active directory — so this service does
// not duplicate task storage. It only hosts gateway-specific endpoints.

import { apiJson } from "./api"

// ── Types mirroring server route responses ──

export interface GatewayStatsRecentTask {
  id: string
  title: string
  status: string
  priority?: string
  directory?: string
  updated?: number
}

export interface GatewayStats {
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
    recent: GatewayStatsRecentTask[]
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

// Mission supervisor wake — single endpoint that starts or resumes a
// gateway-master session for one mission. See
// specs/gateway-master-supervisor-2026-05-26.md §2.5.
export interface MasterWakeInput {
  /** Existing missionID to resume. Omit to start a new mission. */
  missionID?: string
  /** User prompt to inject into the supervisor session. */
  text: string
  /** Optional human-readable title for the mission (not yet persisted). */
  title?: string
  signal?: AbortSignal
}

export interface MasterWakeResult {
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

export async function loadGatewayStats(opts: { directory?: string; limit?: number; signal?: AbortSignal } = {}): Promise<GatewayStats> {
  const params = new URLSearchParams()
  if (opts.directory) params.set("directory", opts.directory)
  if (typeof opts.limit === "number") params.set("limit", String(opts.limit))
  const suffix = params.toString() ? `?${params.toString()}` : ""
  return (await apiJson(`gateway/stats${suffix}`, { signal: opts.signal })) as GatewayStats
}

export async function loadChannelList(signal?: AbortSignal): Promise<ChannelInfo[]> {
  const data = await apiJson(`channel`, { signal })
  // Server route declares the response as `ChannelRegistry.Info.array()`.
  // A non-array body means contract drift — surface it so the Gateway's
  // channel-list error block fires (PRD §14, rule 7) instead of silently
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
  // surface it as a loud error so the Gateway error block fires
  // instead of silently rendering an empty list (rule 7).
  if (!Array.isArray(data)) {
    throw new Error(
      `loadTaskBindings: server returned non-array body (got ${typeof data}). Server contract has drifted from TaskBindingList.`,
    )
  }
  return data as ChannelBindingRow[]
}

export async function wakeMaster(input: MasterWakeInput): Promise<MasterWakeResult> {
  const text = input.text.trim()
  if (!text) throw new Error("wakeMaster: text is required")
  const body = JSON.stringify({
    text,
    ...(input.missionID ? { missionID: input.missionID } : {}),
    ...(input.title ? { title: input.title } : {}),
  })
  return (await apiJson(`gateway/master/wake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: input.signal,
  })) as MasterWakeResult
}
