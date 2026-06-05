import { ApiError, apiJson, apiWebSocketUrl } from "../../services/api"

export const TUI_CODING_AGENT = "tui-coding"
const CODING_AGENT_TUI_ENV = {
  OPENCORVUS_OVERLAY_TUI_PLUGIN: "coding-agent-tui",
}

export interface TuiHostInfo {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: "running" | "exited"
  pid: number
}

export interface CodingAgentTuiPanelInfo {
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
  directory: string
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

function requireDirectory(directory: string): string {
  const next = directory.trim()
  if (!next) throw new Error("Coding agent TUI requires an active workspace directory.")
  return next
}

function ptyPath(path: string, directory: string, query?: Record<string, string | number>): string {
  const params = new URLSearchParams()
  params.set("directory", requireDirectory(directory))
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      params.set(key, String(value))
    }
  }
  return `${path}?${params.toString()}`
}

function toPanelInfo(info?: TuiHostInfo | null): CodingAgentTuiPanelInfo {
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

export async function startTuiHost(input: StartTuiHostInput): Promise<CodingAgentTuiPanelInfo> {
  const created = (await apiJson(ptyPath("pty", input.directory), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "OpenCorvus TUI", agent: TUI_CODING_AGENT, env: CODING_AGENT_TUI_ENV }),
  })) as TuiHostInfo
  const resized = await resizeTuiHost({ id: created.id, cols: input.cols, rows: input.rows, directory: input.directory })
  return { ...resized, cols: input.cols, rows: input.rows }
}

export async function loadTuiHostStatus(input: { directory: string }): Promise<CodingAgentTuiPanelInfo> {
  const list = (await apiJson(ptyPath("pty", input.directory))) as TuiHostInfo[]
  return toPanelInfo(list[0])
}

export function buildTuiHostConnectUrl(input: { id: string; cursor?: number; directory: string }): string {
  const query: Record<string, string | number> = {}
  if (typeof input.cursor === "number") query.cursor = input.cursor
  return apiWebSocketUrl(ptyPath(`pty/${encodeURIComponent(input.id)}/connect`, input.directory, query))
}

export async function resizeTuiHost(input: { id: string; cols: number; rows: number; directory: string }): Promise<CodingAgentTuiPanelInfo> {
  const info = (await apiJson(ptyPath(`pty/${encodeURIComponent(input.id)}`, input.directory), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ size: { cols: input.cols, rows: input.rows } }),
  })) as TuiHostInfo
  return { ...toPanelInfo(info), cols: input.cols, rows: input.rows }
}

export async function stopTuiHost(input: { id: string; directory: string }): Promise<boolean> {
  return await apiJson(ptyPath(`pty/${encodeURIComponent(input.id)}`, input.directory), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  })
}
