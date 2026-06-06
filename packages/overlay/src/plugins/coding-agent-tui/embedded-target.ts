import { ApiError, apiJson } from "../../services/api"

export const TUI_CODING_AGENT = "tui-coding"
export const TUI_EMBED_START_TIMEOUT_MILLISECONDS = 60_000

export interface EmbeddedTuiSpan {
  text: string
  fg: string
  bg: string
  attributes: number
  width: number
}

export interface EmbeddedTuiLine {
  spans: EmbeddedTuiSpan[]
}

export interface EmbeddedTuiFrame {
  cols: number
  rows: number
  cursor: [number, number]
  lines: EmbeddedTuiLine[]
}

export interface CodingAgentTuiPanelInfo {
  running: boolean
  status: "idle" | "running"
  cols: number | null
  rows: number | null
  mode: "dark" | "light" | null
  directory: string | null
  frame: EmbeddedTuiFrame | null
  text: string
  createdAt: number | null
  updatedAt: number | null
}

export interface StartTuiEmbedInput {
  cols: number
  rows: number
  mode: "dark" | "light"
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

export function formatTuiEmbedError(error: unknown): string {
  if (error instanceof ApiError) {
    const named = namedErrorData(error.body)
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

function tuiPath(path: string, directory: string): string {
  const params = new URLSearchParams()
  params.set("directory", requireDirectory(directory))
  return `${path}?${params.toString()}`
}

function toPanelInfo(info: Omit<CodingAgentTuiPanelInfo, "status">): CodingAgentTuiPanelInfo {
  return {
    ...info,
    status: info.running ? "running" : "idle",
  }
}

export async function startTuiEmbed(input: StartTuiEmbedInput): Promise<CodingAgentTuiPanelInfo> {
  const info = (await apiJson(tuiPath("tui/embed/start", input.directory), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(TUI_EMBED_START_TIMEOUT_MILLISECONDS),
    body: JSON.stringify({ cols: input.cols, rows: input.rows, mode: input.mode, agent: TUI_CODING_AGENT }),
  })) as Omit<CodingAgentTuiPanelInfo, "status">
  return toPanelInfo(info)
}

export async function loadTuiEmbedStatus(input: { directory: string }): Promise<CodingAgentTuiPanelInfo> {
  const info = (await apiJson(tuiPath("tui/embed/status", input.directory))) as Omit<CodingAgentTuiPanelInfo, "status">
  return toPanelInfo(info)
}

export async function sendTuiEmbedInput(input: {
  directory: string
  text?: string
  key?: "enter" | "escape" | "tab" | "backspace" | "delete" | "arrow-up" | "arrow-down" | "arrow-left" | "arrow-right"
  ctrl?: boolean
}): Promise<CodingAgentTuiPanelInfo> {
  const info = (await apiJson(tuiPath("tui/embed/input", input.directory), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: input.text, key: input.key, ctrl: input.ctrl }),
  })) as Omit<CodingAgentTuiPanelInfo, "status">
  return toPanelInfo(info)
}

export async function resizeTuiEmbed(input: { cols: number; rows: number; directory: string }): Promise<CodingAgentTuiPanelInfo> {
  const info = (await apiJson(tuiPath("tui/embed/resize", input.directory), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cols: input.cols, rows: input.rows }),
  })) as Omit<CodingAgentTuiPanelInfo, "status">
  return toPanelInfo(info)
}

export async function stopTuiEmbed(input: { directory: string }): Promise<boolean> {
  return await apiJson(tuiPath("tui/embed/stop", input.directory), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  })
}
