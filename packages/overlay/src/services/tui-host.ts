import { apiJson, apiWebSocketUrl } from "./api"

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

export interface TuiHostConnectToken {
  ticket: string
  expires_in: number
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

export async function createTuiHostConnectToken(): Promise<TuiHostConnectToken> {
  return await apiJson("tui/host/connect-token", {
    method: "POST",
    headers: { "x-opencode-ticket": "1" },
  })
}

export function buildTuiHostConnectUrl(input: { ticket: string; cursor?: number }): string {
  const params = new URLSearchParams()
  params.set("ticket", input.ticket)
  if (typeof input.cursor === "number") params.set("cursor", String(input.cursor))
  return apiWebSocketUrl(`tui/host/connect?${params.toString()}`)
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
