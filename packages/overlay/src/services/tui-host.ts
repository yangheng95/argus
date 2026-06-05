import { ApiError, apiJson, apiWebSocketUrl } from "./api"

export const TUI_CODING_AGENT = "tui-coding"

export interface TuiHostInfo {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: "running" | "exited"
  pid: number
}

export interface TuiHostPanelInfo {
  id: string | null
  running: boolean
  status: "idle" | TuiHostInfo["status"]
  cols: number | null
  rows: number | null
  url: null
  directory: string | null
  exitCode: number | null
  createdAt: number | null
  updatedAt: number | null
}

export interface StartTuiHostInput {
  cols: number
  rows: number
}

type NamedErrorBody = {
  name?: unknown
  data?: unknown
}

function namedErrorData(body: unknown): { name: string; data: Record<string, unknown> } | undefined {
  if (!body || typeof body !== "object") return
  const candidate = body as NamedErrorBody
  if (typeof candidate.name !== "string") return
  if (!candidate.data || typeof candidate.data !== "object") return { name: candidate.name, data: {} }
  return { name: candidate.name, data: candidate.data as Record<string, unknown> }
}

export function formatTuiHostError(error: unknown): string {
  if (error instanceof ApiError) {
    const named = namedErrorData(error.body)
    if (named?.name === "PtyCreateFailedError") {
      const message = typeof named.data.message === "string" && named.data.message.trim() ? named.data.message.trim() : error.message
      const command = typeof named.data.command === "string" && named.data.command.trim() ? ` (${named.data.command.trim()})` : ""
      return `TUI host failed to start${command}: ${message}`
    }
    if (named) {
      const message = typeof named.data.message === "string" && named.data.message.trim() ? named.data.message.trim() : error.message
      return `${named.name}: ${message}`
    }
  }
  return error instanceof Error ? error.message : String(error)
}

function toPanelInfo(info?: TuiHostInfo | null): TuiHostPanelInfo {
  if (!info) {
    return {
      id: null,
      running: false,
      status: "idle",
      cols: null,
      rows: null,
      url: null,
      directory: null,
      exitCode: null,
      createdAt: null,
      updatedAt: null,
    }
  }
  return {
    id: info.id,
    running: info.status === "running",
    status: info.status,
    cols: null,
    rows: null,
    url: null,
    directory: info.cwd,
    exitCode: null,
    createdAt: null,
    updatedAt: null,
  }
}

export async function startTuiHost(input: StartTuiHostInput): Promise<TuiHostPanelInfo> {
  const created = (await apiJson("pty", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "OpenCorvus TUI", agent: TUI_CODING_AGENT }),
  })) as TuiHostInfo
  const resized = await resizeTuiHost({ id: created.id, cols: input.cols, rows: input.rows })
  return { ...resized, cols: input.cols, rows: input.rows }
}

export async function loadTuiHostStatus(): Promise<TuiHostPanelInfo> {
  const list = (await apiJson("pty")) as TuiHostInfo[]
  return toPanelInfo(list[0])
}

export function buildTuiHostConnectUrl(input: { id: string; cursor?: number }): string {
  const params = new URLSearchParams()
  if (typeof input.cursor === "number") params.set("cursor", String(input.cursor))
  const query = params.toString()
  return apiWebSocketUrl(`pty/${encodeURIComponent(input.id)}/connect${query ? `?${query}` : ""}`)
}

export async function resizeTuiHost(input: { id: string; cols: number; rows: number }): Promise<TuiHostPanelInfo> {
  const info = (await apiJson(`pty/${encodeURIComponent(input.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ size: { cols: input.cols, rows: input.rows } }),
  })) as TuiHostInfo
  return { ...toPanelInfo(info), cols: input.cols, rows: input.rows }
}

export async function stopTuiHost(input: { id: string }): Promise<boolean> {
  return await apiJson(`pty/${encodeURIComponent(input.id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  })
}
