import { apiJson } from "./api"

export interface TuiHostInfo {
  id: string | null
  running: boolean
  status: "idle" | "running" | "exited"
  cols: number | null
  rows: number | null
  url: string | null
  directory: string | null
  exitCode: number | null
  createdAt: number | null
  updatedAt: number | null
}

export interface TuiHostSnapshot extends TuiHostInfo {
  buffer: string
}

export interface TuiHostOutput extends TuiHostInfo {
  data: string
  cursor: number
  from: number
  truncated: boolean
}

export interface StartTuiHostInput {
  cols: number
  rows: number
}

export async function startTuiHost(input: StartTuiHostInput): Promise<TuiHostInfo> {
  return await apiJson("tui/host/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

export async function loadTuiHostStatus(): Promise<TuiHostInfo> {
  return await apiJson("tui/host/status")
}

export async function loadTuiHostSnapshot(): Promise<TuiHostSnapshot> {
  return await apiJson("tui/host/snapshot")
}

export async function loadTuiHostOutput(cursor?: number): Promise<TuiHostOutput> {
  const query = typeof cursor === "number" ? `?cursor=${encodeURIComponent(String(cursor))}` : ""
  return await apiJson(`tui/host/output${query}`)
}

export async function sendTuiHostInput(data: string): Promise<boolean> {
  return await apiJson("tui/host/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  })
}

export async function resizeTuiHost(input: { cols: number; rows: number }): Promise<TuiHostInfo> {
  return await apiJson("tui/host/resize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

export async function stopTuiHost(): Promise<boolean> {
  return await apiJson("tui/host/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  })
}
