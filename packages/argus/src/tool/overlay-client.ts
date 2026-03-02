import { existsSync } from "fs"
import { join } from "path"
import { fileURLToPath } from "url"

function resolveBinaryPath() {
  const dir = fileURLToPath(new URL(".", import.meta.url))
  return join(dir, "..", "..", "..", "overlay", "src-tauri", "target", "release", "argus-overlay.exe")
}

const BINARY_PATH = resolveBinaryPath()

type ConfirmAnswer = "confirm" | "cancel" | "timeout"
type ConfirmResult = ConfirmAnswer | "unavailable"
type Pending = {
  done: (answer: ConfirmResult) => void
  timer: ReturnType<typeof setTimeout>
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
const pending = new Map<string, Pending>()

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
  if (!out || typeof out === "number") return
  reading = true
  const reader = out.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  while (!dead) {
    const chunk = await reader.read().catch(() => ({ done: true, value: undefined as Uint8Array | undefined }))
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
  if (process.env.ARGUS_OVERLAY_DISABLED === "1") return null
  if (!existsSync(BINARY_PATH)) return null
  if (proc && !dead) return proc

  try {
    proc = Bun.spawn([BINARY_PATH], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      env: {
        ...process.env,
        ARGUS_OVERLAY_STDIN_EXIT: "1",
      },
    })
    dead = false
    void watchOutput(proc)
    proc.exited
      .then(() => {
        dead = true
        proc = null
        settleAll("unavailable")
      })
      .catch(() => {
        dead = true
        proc = null
        settleAll("unavailable")
      })
    return proc
  } catch {
    return null
  }
}

async function send(payload: Record<string, unknown>) {
  const current = ensureProcess()
  if (!current) return false
  const input = current.stdin
  if (!input || typeof input === "number") return false
  const line = JSON.stringify(payload) + "\n"
  await input.write(new TextEncoder().encode(line))
  return true
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
      label: input.label ?? "Argus target window",
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

export function parseOverlayReply(line: string) {
  return parse(line)
}
