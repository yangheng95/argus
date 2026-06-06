import { fileURLToPath } from "node:url"
import z from "zod"
import { lazyInstanceState } from "@/project/instance"
import { Env } from "@/runtime/env"

const DEFAULT_COLS = 100
const DEFAULT_ROWS = 30
const EmbeddedTuiThemeMode = z.enum(["dark", "light"])

export const EmbeddedTuiStartInput = z.object({
  cols: z.number().int().min(20).max(300).default(DEFAULT_COLS),
  rows: z.number().int().min(5).max(120).default(DEFAULT_ROWS),
  mode: EmbeddedTuiThemeMode.default("dark"),
  agent: z.string().optional(),
  model: z.string().optional(),
  prompt: z.string().optional(),
  sessionID: z.string().optional(),
  continue: z.boolean().optional(),
  fork: z.boolean().optional(),
})

export const EmbeddedTuiResizeInput = z.object({
  cols: z.number().int().min(20).max(300),
  rows: z.number().int().min(5).max(120),
})

export const EmbeddedTuiInput = z
  .object({
    text: z.string().optional(),
    key: z
      .enum(["enter", "escape", "tab", "backspace", "delete", "arrow-up", "arrow-down", "arrow-left", "arrow-right"])
      .optional(),
    ctrl: z.boolean().optional(),
  })
  .refine((value) => value.text !== undefined || value.key !== undefined, {
    message: "text or key is required",
  })

export type EmbeddedTuiStartInput = z.infer<typeof EmbeddedTuiStartInput>
export type EmbeddedTuiResizeInput = z.infer<typeof EmbeddedTuiResizeInput>
export type EmbeddedTuiInput = z.infer<typeof EmbeddedTuiInput>

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

export interface EmbeddedTuiInfo {
  running: boolean
  cols: number | null
  rows: number | null
  mode: "dark" | "light" | null
  directory: string
  frame: EmbeddedTuiFrame | null
  text: string
  createdAt: number | null
  updatedAt: number | null
  diagnostics?: string[]
}

interface WorkerRequest {
  id: string
  op: "start" | "status" | "resize" | "input" | "stop"
  body?: unknown
}

interface WorkerResponse {
  id: string
  ok: boolean
  body?: unknown
  error?: string
}

interface WorkerSession {
  process: Bun.Subprocess<"pipe", "pipe", "pipe">
  pending: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>
  ready: Promise<void>
  closed: boolean
  diagnostics: string[]
  stderrBuffer: string
}

const state = lazyInstanceState(() => ({
  worker: undefined as WorkerSession | undefined,
}))

function workerPath() {
  return fileURLToPath(new URL("./embedded-worker.tsx", import.meta.url))
}

function packageRoot() {
  return fileURLToPath(new URL("../..", import.meta.url))
}

function sendLine(worker: WorkerSession, request: WorkerRequest) {
  worker.process.stdin.write(`${JSON.stringify(request)}\n`)
}

async function readLoop(worker: WorkerSession) {
  const decoder = new TextDecoder()
  let buffer = ""
  const reader = worker.process.stdout.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      while (true) {
        const index = buffer.indexOf("\n")
        if (index < 0) break
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (!line) continue
        let response: WorkerResponse
        try {
          response = JSON.parse(line) as WorkerResponse
        } catch {
          continue
        }
        const pending = worker.pending.get(response.id)
        if (!pending) continue
        worker.pending.delete(response.id)
        if (response.ok) pending.resolve(attachDiagnostics(worker, response.body))
        else pending.reject(new Error(response.error || "Embedded TUI worker failed"))
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function drainErrors(worker: WorkerSession) {
  const reader = worker.process.stderr.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      worker.stderrBuffer += decoder.decode(value, { stream: true })
      while (true) {
        const index = worker.stderrBuffer.indexOf("\n")
        if (index < 0) break
        const line = worker.stderrBuffer.slice(0, index).trim()
        worker.stderrBuffer = worker.stderrBuffer.slice(index + 1)
        if (!line) continue
        worker.diagnostics.push(line)
        if (worker.diagnostics.length > 50) worker.diagnostics.shift()
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function attachDiagnostics(worker: WorkerSession, body: unknown) {
  if (!body || typeof body !== "object") return body
  return { ...(body as Record<string, unknown>), diagnostics: [...worker.diagnostics] }
}

function createWorker() {
  const process = Bun.spawn([processExecPath(), "--preload", "@opentui/solid/preload", "--conditions=browser", workerPath()], {
    cwd: packageRoot(),
    env: Env.snapshot(),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const worker: WorkerSession = {
    process,
    pending: new Map(),
    ready: Promise.resolve(),
    closed: false,
    diagnostics: [],
    stderrBuffer: "",
  }
  worker.ready = Promise.all([readLoop(worker), drainErrors(worker), process.exited.then((code) => {
    worker.closed = true
    for (const pending of worker.pending.values()) pending.reject(new Error(`Embedded TUI worker exited with code ${code}`))
    worker.pending.clear()
  })]).then(() => {})
  return worker
}

function processExecPath() {
  return process.execPath
}

function ensureWorker() {
  const current = state().worker
  if (current && !current.closed) return current
  const next = createWorker()
  state().worker = next
  return next
}

async function callWorker<T>(op: WorkerRequest["op"], body?: unknown): Promise<T> {
  const worker = ensureWorker()
  return callExistingWorker<T>(worker, op, body)
}

async function callExistingWorker<T>(worker: WorkerSession, op: WorkerRequest["op"], body?: unknown): Promise<T> {
  const id = crypto.randomUUID()
  const result = new Promise<unknown>((resolve, reject) => {
    worker.pending.set(id, { resolve, reject })
  })
  sendLine(worker, { id, op, body })
  return (await result) as T
}

export namespace EmbeddedTui {
  export async function start(input: EmbeddedTuiStartInput & { url: string; directory: string }) {
    await stop()
    return callWorker<EmbeddedTuiInfo>("start", input)
  }

  export async function status() {
    return callWorker<EmbeddedTuiInfo>("status")
  }

  export async function resize(input: EmbeddedTuiResizeInput) {
    return callWorker<EmbeddedTuiInfo>("resize", input)
  }

  export async function input(input: EmbeddedTuiInput) {
    return callWorker<EmbeddedTuiInfo>("input", input)
  }

  export async function stop() {
    const worker = state().worker
    state().worker = undefined
    if (!worker) return true
    try {
      await callExistingWorker<boolean>(worker, "stop")
    } catch {
      // The next line force-kills only this sidecar process after the graceful
      // stop protocol failed; no project process is targeted.
    }
    worker.process.kill()
    return true
  }
}
