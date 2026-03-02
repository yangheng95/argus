import { existsSync } from "fs"
import { join } from "path"
import { fileURLToPath } from "url"
import { Log } from "../util/log"

function resolveBinaryPath() {
  const dir = fileURLToPath(new URL(".", import.meta.url))
  const ext = process.platform === "win32" ? ".exe" : ""
  const names = [`opencorvus-overlay${ext}`, `opencorvus-overlay${ext}`, `openlens-overlay${ext}`]
  for (const name of names) {
    const candidate = join(dir, "..", "..", "..", "overlay", "src-tauri", "target", "release", name)
    if (existsSync(candidate)) return candidate
  }
  return join(dir, "..", "..", "..", "overlay", "src-tauri", "target", "release", names[0])
}

const BINARY_PATH = resolveBinaryPath()
const log = Log.create({ service: "overlay-client" })
const WARN_THROTTLE_MS = 15_000

type ConfirmAnswer = "confirm" | "cancel" | "timeout"
type ConfirmResult = ConfirmAnswer | "unavailable"
type Pending = {
  done: (answer: ConfirmResult) => void
  timer: ReturnType<typeof setTimeout>
}

type OverlayUnavailableReason =
  | "disabled"
  | "binary_missing"
  | "spawn_failed"
  | "process_exited"
  | "stdout_unavailable"
  | "stdout_read_failed"
  | "stdin_unavailable"
  | "write_failed"

type OverlayDiagnostic = {
  available: boolean
  reason?: OverlayUnavailableReason
  updatedAt: number
  path: string
}

type WindowHighlightInput = {
  x: number
  y: number
  width: number
  height: number
  label?: string
  durationMs?: number
}

let proc: ReturnType<typeof Bun.spawn> | null = null
let dead = false
let reading = false
let seq = 0
let last = { x: 240, y: 160 }
let lastWarn = { key: "", time: 0 }
const pending = new Map<string, Pending>()
const diagnostic: OverlayDiagnostic = {
  available: true,
  updatedAt: Date.now(),
  path: BINARY_PATH,
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function warnOnce(key: string, detail?: Record<string, unknown>) {
  const now = Date.now()
  if (lastWarn.key === key && now - lastWarn.time < WARN_THROTTLE_MS) return
  lastWarn = { key, time: now }
  log.warn(key, detail)
}

function markUnavailable(reason: OverlayUnavailableReason, detail?: Record<string, unknown>) {
  diagnostic.available = false
  diagnostic.reason = reason
  diagnostic.updatedAt = Date.now()
  warnOnce(`overlay-unavailable:${reason}`, {
    ...detail,
    path: BINARY_PATH,
  })
}

function markAvailable(detail?: Record<string, unknown>) {
  if (diagnostic.available) return
  diagnostic.available = true
  diagnostic.reason = undefined
  diagnostic.updatedAt = Date.now()
  log.info("overlay-available", {
    ...detail,
    path: BINARY_PATH,
  })
}

function settle(id: string, answer: ConfirmResult) {
  const item = pending.get(id)
  if (!item) return
  clearTimeout(item.timer)
  pending.delete(id)
  item.done(answer)
}

function settleAll(answer: ConfirmResult) {
  for (const key of pending.keys()) settle(key, answer)
}

function parse(line: string): { id: string; answer: ConfirmAnswer } | undefined {
  if (!line.trim()) return
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return
  }
  if (!raw || typeof raw !== "object") return
  const obj = raw as Record<string, unknown>
  if (obj.type !== "confirm-reply") return
  if (typeof obj.id !== "string") return
  if (obj.answer !== "confirm" && obj.answer !== "cancel" && obj.answer !== "timeout") return
  return { id: obj.id, answer: obj.answer }
}

async function watchOutput(target: ReturnType<typeof Bun.spawn>) {
  if (reading) return
  const out = target.stdout
  if (!out || typeof out === "number") {
    markUnavailable("stdout_unavailable")
    return
  }
  reading = true
  const reader = out.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  while (!dead) {
    const chunk = await reader.read().catch((error) => {
      markUnavailable("stdout_read_failed", { error: errorMessage(error) })
      return { done: true, value: undefined as Uint8Array | undefined }
    })
    if (chunk.done) break
    if (!chunk.value) continue
    buf += decoder.decode(chunk.value, { stream: true })
    const lines = buf.split(/\r?\n/)
    buf = lines.pop() ?? ""
    for (const line of lines) {
      const event = parse(line)
      if (!event) continue
      settle(event.id, event.answer)
    }
  }
  reader.releaseLock()
  reading = false
}

function ensureProcess() {
  if (process.env.OPENCORVUS_OVERLAY_DISABLED === "1") {
    markUnavailable("disabled", { env: "OPENCORVUS_OVERLAY_DISABLED=1" })
    return null
  }
  if (!existsSync(BINARY_PATH)) {
    markUnavailable("binary_missing")
    return null
  }
  if (proc && !dead) return proc

  try {
    proc = Bun.spawn([BINARY_PATH], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      env: {
        ...process.env,
        OPENCORVUS_OVERLAY_STDIN_EXIT: "1",
      },
    })
    dead = false
    markAvailable({ pid: proc.pid })
    void watchOutput(proc)
    proc.exited
      .then((code) => {
        dead = true
        proc = null
        markUnavailable("process_exited", { code })
        settleAll("unavailable")
      })
      .catch((error) => {
        dead = true
        proc = null
        markUnavailable("process_exited", { error: errorMessage(error) })
        settleAll("unavailable")
      })
    return proc
  } catch (error) {
    markUnavailable("spawn_failed", { error: errorMessage(error) })
    return null
  }
}

async function send(payload: Record<string, unknown>) {
  const current = ensureProcess()
  if (!current) return false
  const input = current.stdin
  if (!input || typeof input === "number") {
    markUnavailable("stdin_unavailable", { type: payload.type })
    return false
  }
  const line = JSON.stringify(payload) + "\n"
  const ok = await Promise.resolve(input.write(new TextEncoder().encode(line))).then(
    () => true,
    (error: unknown) => {
      dead = true
      proc = null
      markUnavailable("write_failed", { type: payload.type, error: errorMessage(error) })
      settleAll("unavailable")
      return false
    },
  )
  if (ok) markAvailable()
  return ok
}

export function showOverlay(screenX: number, screenY: number, action: string, label: string, status: "start" | "done" = "start") {
  void (async () => {
    const x = Number.isFinite(screenX) && screenX > 0 ? Math.round(screenX) : last.x
    const y = Number.isFinite(screenY) && screenY > 0 ? Math.round(screenY) : last.y
    last = { x, y }
    await send({ type: "hint", x, y, action, label, status })
  })()
}

export function showWindowHighlight(input: WindowHighlightInput) {
  void (async () => {
    const width = Number.isFinite(input.width) ? Math.round(input.width) : 0
    const height = Number.isFinite(input.height) ? Math.round(input.height) : 0
    if (width < 20 || height < 20) return
    const duration = Number.isFinite(input.durationMs) ? Math.round(input.durationMs!) : 1400
    await send({
      type: "window-highlight",
      x: Number.isFinite(input.x) ? Math.round(input.x) : 0,
      y: Number.isFinite(input.y) ? Math.round(input.y) : 0,
      width,
      height,
      label: input.label ?? "OpenCorvus target window",
      duration_ms: Math.max(300, Math.min(duration, 10000)),
    })
  })()
}

export async function requestOverlayConfirm(input: {
  x?: number
  y?: number
  title: string
  message: string
  confirm?: string
  cancel?: string
  timeoutMs?: number
}) {
  const timeout = Math.max(1000, Math.min(input.timeoutMs ?? 30000, 120000))
  const x = Number.isFinite(input.x) && (input.x ?? 0) > 0 ? Math.round(input.x!) : last.x
  const y = Number.isFinite(input.y) && (input.y ?? 0) > 0 ? Math.round(input.y!) : last.y
  const id = `confirm_${Date.now()}_${++seq}`

  return new Promise<ConfirmResult>((done) => {
    const timer = setTimeout(() => {
      settle(id, "timeout")
    }, timeout + 250)
    pending.set(id, { done, timer })

    void send({
      type: "confirm",
      id,
      x,
      y,
      title: input.title,
      message: input.message,
      confirm: input.confirm ?? "Confirm",
      cancel: input.cancel ?? "Cancel",
      timeout_ms: timeout,
    }).then((ok) => {
      if (ok) return
      settle(id, "unavailable")
    })
  })
}

export function overlayDiagnostic() {
  return {
    ...diagnostic,
  }
}

export function parseOverlayReply(line: string) {
  return parse(line)
}
