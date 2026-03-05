import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { Log } from "../util/log"
import { Global } from "../global"
import { overlayProtocol } from "./overlay-protocol"
import { traceSync } from "../util/debug-trace"

declare const OPENCORVUS_EMBEDDED_OVERLAY_B64: string | undefined
declare const OPENCORVUS_EMBEDDED_OVERLAY_HASH: string | undefined

function binaryNames() {
  const ext = process.platform === "win32" ? ".exe" : ""
  return [`opencorvus-overlay${ext}`, `openlens-overlay${ext}`]
}

function resolveBinaryPath() {
  const names = binaryNames()
  const fromEnv = process.env.OPENCORVUS_OVERLAY_BIN?.trim()
  if (fromEnv) return fromEnv

  const executableDir = dirname(process.execPath)
  for (const name of names) {
    const candidate = join(executableDir, name)
    if (existsSync(candidate)) return candidate
  }

  const cwd = process.cwd()
  for (const name of names) {
    const candidate = join(cwd, name)
    if (existsSync(candidate)) return candidate
  }

  const embedded = embeddedBinaryPath()
  if (embedded) return embedded

  const dir = fileURLToPath(new URL(".", import.meta.url))
  for (const mode of ["release", "debug"] as const) {
    for (const name of names) {
      const candidate = join(dir, "..", "..", "..", "overlay", "src-tauri", "target", mode, name)
      if (existsSync(candidate)) return candidate
    }
  }

  return join(executableDir, names[0])
}

function embeddedBinaryPath() {
  if (typeof OPENCORVUS_EMBEDDED_OVERLAY_B64 !== "string" || !OPENCORVUS_EMBEDDED_OVERLAY_B64) return
  const ext = process.platform === "win32" ? ".exe" : ""
  const hash =
    typeof OPENCORVUS_EMBEDDED_OVERLAY_HASH === "string" && OPENCORVUS_EMBEDDED_OVERLAY_HASH
      ? OPENCORVUS_EMBEDDED_OVERLAY_HASH
      : "embedded"
  const dir = join(Global.Path.bin, "overlay")
  const file = join(dir, `opencorvus-overlay-${hash}${ext}`)
  if (existsSync(file)) return file
  if (materializeEmbedded(file)) return file

  const tempDir = join(tmpdir(), "opencorvus-overlay")
  const tempFile = join(tempDir, `opencorvus-overlay-${hash}${ext}`)
  if (existsSync(tempFile)) return tempFile
  if (materializeEmbedded(tempFile)) return tempFile
}

function materializeEmbedded(file: string) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    if (typeof OPENCORVUS_EMBEDDED_OVERLAY_B64 !== "string" || !OPENCORVUS_EMBEDDED_OVERLAY_B64) return false
    const bytes = Buffer.from(OPENCORVUS_EMBEDDED_OVERLAY_B64, "base64")
    writeFileSync(file, bytes, { mode: 0o755 })
    if (process.platform !== "win32") chmodSync(file, 0o755)
    return true
  } catch {
    return false
  }
}

const BINARY_PATH = resolveBinaryPath()
const log = Log.create({ service: "overlay-client" })
const WARN_THROTTLE_MS = 15_000
const encoder = new TextEncoder()
const msg = overlayProtocol.messages
// Global singleton strategy for overlay subprocess management.
const SINGLETON_MODE = (process.env.OPENCORVUS_OVERLAY_SINGLETON_MODE ?? "reuse").toLowerCase()

function envInt(name: string, fallback: number, min = 1) {
  const value = Number(process.env[name])
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.round(value))
}

const RETRY_BASE_MS = envInt("OPENCORVUS_OVERLAY_RETRY_BASE_MS", 250)
const RETRY_MAX_MS = Math.max(RETRY_BASE_MS, envInt("OPENCORVUS_OVERLAY_RETRY_MAX_MS", 5000))
const CIRCUIT_WINDOW_MS = envInt("OPENCORVUS_OVERLAY_CIRCUIT_WINDOW_MS", 30_000)
const CIRCUIT_THRESHOLD = envInt("OPENCORVUS_OVERLAY_CIRCUIT_THRESHOLD", 6)
const CIRCUIT_COOLDOWN_MS = envInt("OPENCORVUS_OVERLAY_CIRCUIT_COOLDOWN_MS", 30_000)
const BINARY_CHECK_INTERVAL_MS = envInt("OPENCORVUS_OVERLAY_BINARY_CHECK_INTERVAL_MS", 1500)

type OverlayStatus = "start" | "running" | "done" | "error"
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
  | "retry_backoff"
  | "circuit_open"
  | "stdout_unavailable"
  | "stdout_read_failed"
  | "stdin_unavailable"
  | "write_failed"

type OverlayDiagnostic = {
  available: boolean
  reason?: OverlayUnavailableReason
  updatedAt: number
  path: string
  failures: number
  consecutiveFailures: number
  nextRetryAt?: number
  circuitOpenUntil?: number
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
let seq = 0
let last = { x: 240, y: 160 }
let lastWarn = { key: "", time: 0 }
let binaryMtime = 0
let binaryCheckedAt = 0
let failures = 0
let consecutiveFailures = 0
let nextRetryAt = 0
let circuitOpenUntil = 0
let recentFailures: number[] = []
const pending = new Map<string, Pending>()
const diagnostic: OverlayDiagnostic = {
  available: true,
  updatedAt: Date.now(),
  path: BINARY_PATH,
  failures: 0,
  consecutiveFailures: 0,
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function binaryName() {
  return BINARY_PATH.split(/[\\/]/).at(-1) ?? "opencorvus-overlay"
}

function binaryStem() {
  return binaryName().replace(/\.exe$/i, "")
}

function binaryMtimeMs() {
  traceSync("overlay.binary.statSync", {
    path_len: BINARY_PATH.length,
  })
  try {
    return statSync(BINARY_PATH).mtimeMs
  } catch {
    return 0
  }
}

function stopOverlay(reason: string, detail?: Record<string, unknown>) {
  const current = proc
  if (!current) return
  proc = null
  binaryMtime = 0
  binaryCheckedAt = 0
  settleAll("unavailable")
  log.info("overlay-restart", {
    reason,
    pid: current.pid,
    path: BINARY_PATH,
    ...detail,
  })
  Promise.resolve(current.kill()).catch(() => {})
}

function clearOldOverlayProcesses() {
  if (SINGLETON_MODE === "reuse") return
  if (process.platform === "win32") {
    const taskkill = Bun.which("taskkill")
    if (!taskkill) return
    Bun.spawnSync([taskkill, "/im", binaryName(), "/f"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
    return
  }

  const pkill = Bun.which("pkill")
  if (!pkill) return
  Bun.spawnSync([pkill, "-x", binaryStem()], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
}

function warnOnce(key: string, detail?: Record<string, unknown>) {
  const now = Date.now()
  if (lastWarn.key === key && now - lastWarn.time < WARN_THROTTLE_MS) return
  lastWarn = { key, time: now }
  log.warn(key, detail)
}

function pushDiagnostic(event: string, detail?: Record<string, unknown>) {
  const current = proc
  if (!current) return
  const input = current.stdin
  if (!input || typeof input === "number") return
  const line =
    JSON.stringify({
      type: msg.diagnostic,
      event,
      ts: Date.now(),
      available: diagnostic.available,
      reason: diagnostic.reason,
      path: diagnostic.path,
      failures: diagnostic.failures,
      consecutive_failures: diagnostic.consecutiveFailures,
      next_retry_at: diagnostic.nextRetryAt,
      circuit_open_until: diagnostic.circuitOpenUntil,
      detail,
    }) + "\n"
  void Promise.resolve(input.write(encoder.encode(line))).catch(() => {})
}

function syncDiagnostic(now = Date.now()) {
  diagnostic.failures = failures
  diagnostic.consecutiveFailures = consecutiveFailures
  diagnostic.nextRetryAt = nextRetryAt > now ? nextRetryAt : undefined
  diagnostic.circuitOpenUntil = circuitOpenUntil > now ? circuitOpenUntil : undefined
}

function markUnavailable(reason: OverlayUnavailableReason, detail?: Record<string, unknown>) {
  const now = Date.now()
  diagnostic.available = false
  diagnostic.reason = reason
  diagnostic.updatedAt = now
  syncDiagnostic(now)
  pushDiagnostic("overlay-unavailable", { reason, ...detail })
  warnOnce(`overlay-unavailable:${reason}`, {
    ...detail,
    path: BINARY_PATH,
  })
}

function markAvailable(detail?: Record<string, unknown>) {
  const now = Date.now()
  const changed = !diagnostic.available || Boolean(diagnostic.reason)
  diagnostic.available = true
  diagnostic.reason = undefined
  diagnostic.updatedAt = now
  syncDiagnostic(now)
  if (!changed) return
  pushDiagnostic("overlay-available", detail)
  log.info("overlay-available", {
    ...detail,
    path: BINARY_PATH,
  })
}

function registerFailure(reason: OverlayUnavailableReason, detail?: Record<string, unknown>) {
  const now = Date.now()
  failures += 1
  consecutiveFailures += 1
  recentFailures = recentFailures.filter((item) => now - item <= CIRCUIT_WINDOW_MS)
  recentFailures.push(now)
  nextRetryAt = now + Math.min(RETRY_BASE_MS * 2 ** Math.max(0, consecutiveFailures - 1), RETRY_MAX_MS)
  if (recentFailures.length >= CIRCUIT_THRESHOLD) {
    circuitOpenUntil = now + CIRCUIT_COOLDOWN_MS
    recentFailures = []
  }
  markUnavailable(reason, {
    ...detail,
    failures,
    consecutiveFailures,
    nextRetryAt,
    circuitOpenUntil: circuitOpenUntil > now ? circuitOpenUntil : undefined,
  })
}

function registerSuccess(detail?: Record<string, unknown>) {
  consecutiveFailures = 0
  nextRetryAt = 0
  circuitOpenUntil = 0
  recentFailures = []
  markAvailable(detail)
}

function clearCurrent(target: ReturnType<typeof Bun.spawn>) {
  if (proc !== target) return false
  proc = null
  binaryMtime = 0
  binaryCheckedAt = 0
  settleAll("unavailable")
  return true
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
  if (obj.type !== msg.confirmReply) return
  if (typeof obj.id !== "string") return
  if (obj.answer !== "confirm" && obj.answer !== "cancel" && obj.answer !== "timeout") return
  return { id: obj.id, answer: obj.answer }
}

async function watchOutput(target: ReturnType<typeof Bun.spawn>) {
  const out = target.stdout
  if (!out || typeof out === "number") {
    if (clearCurrent(target)) {
      registerFailure("stdout_unavailable")
      Promise.resolve(target.kill()).catch(() => {})
    }
    return
  }
  const reader = out.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  while (proc === target) {
    const chunk = await reader.read().catch((error) => {
      if (clearCurrent(target)) {
        registerFailure("stdout_read_failed", { error: errorMessage(error) })
        Promise.resolve(target.kill()).catch(() => {})
      }
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
}

function ensureProcess() {
  if (process.env.OPENCORVUS_OVERLAY_DISABLED === "1") {
    markUnavailable("disabled", { env: "OPENCORVUS_OVERLAY_DISABLED=1" })
    return null
  }
  if (proc) {
    const now = Date.now()
    if (binaryMtime <= 0 || now - binaryCheckedAt < BINARY_CHECK_INTERVAL_MS) {
      return proc
    }
    binaryCheckedAt = now
    const nextMtime = binaryMtimeMs()
    if (nextMtime <= 0 || nextMtime === binaryMtime) {
      return proc
    }
    stopOverlay("binary_changed", {
      previousMtime: binaryMtime,
      nextMtime,
    })
  }
  traceSync("overlay.binary.existsSync", {
    path_len: BINARY_PATH.length,
  })
  if (!existsSync(BINARY_PATH)) {
    markUnavailable("binary_missing")
    return null
  }

  const now = Date.now()
  if (nextRetryAt > 0 && nextRetryAt <= now) nextRetryAt = 0
  if (circuitOpenUntil > 0 && circuitOpenUntil <= now) circuitOpenUntil = 0
  if (recentFailures.length) recentFailures = recentFailures.filter((item) => now - item <= CIRCUIT_WINDOW_MS)
  if (circuitOpenUntil > now) {
    markUnavailable("circuit_open", { retryInMs: circuitOpenUntil - now, circuitOpenUntil })
    return null
  }
  if (nextRetryAt > now) {
    markUnavailable("retry_backoff", { retryInMs: nextRetryAt - now, nextRetryAt })
    return null
  }
  syncDiagnostic(now)

  try {
    clearOldOverlayProcesses()
    const spawned = Bun.spawn([BINARY_PATH], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      env: {
        ...process.env,
        OPENCORVUS_OVERLAY_MODE: "sidecar",
        OPENCORVUS_OVERLAY_STDIN_EXIT: "1",
      },
    })
    proc = spawned
    binaryMtime = binaryMtimeMs()
    binaryCheckedAt = Date.now()
    markAvailable({ pid: spawned.pid })
    void watchOutput(spawned)
    spawned.exited
      .then((code) => {
        if (!clearCurrent(spawned)) return
        registerFailure("process_exited", { code })
      })
      .catch((error) => {
        if (!clearCurrent(spawned)) return
        registerFailure("process_exited", { error: errorMessage(error) })
      })
    return spawned
  } catch (error) {
    registerFailure("spawn_failed", { error: errorMessage(error) })
    return null
  }
}

async function send(payload: Record<string, unknown>) {
  const current = ensureProcess()
  if (!current) return false
  const input = current.stdin
  if (!input || typeof input === "number") {
    if (clearCurrent(current)) Promise.resolve(current.kill()).catch(() => {})
    registerFailure("stdin_unavailable", { type: payload.type })
    return false
  }
  const line = JSON.stringify(payload) + "\n"
  const ok = await Promise.resolve(input.write(encoder.encode(line))).then(
    () => true,
    (error: unknown) => {
      if (clearCurrent(current)) Promise.resolve(current.kill()).catch(() => {})
      registerFailure("write_failed", { type: payload.type, error: errorMessage(error) })
      return false
    },
  )
  if (ok) registerSuccess()
  return ok
}

export function resolveOverlayCoord(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.round(value)
}

export function showOverlay(
  screenX: number | undefined,
  screenY: number | undefined,
  action: string,
  label: string,
  status: OverlayStatus = "start",
) {
  void (async () => {
    const x = resolveOverlayCoord(screenX, last.x)
    const y = resolveOverlayCoord(screenY, last.y)
    last = { x, y }
    await send({ type: msg.hint, x, y, action, label, status })
  })()
}

export function showWindowHighlight(input: WindowHighlightInput) {
  void (async () => {
    const width = Number.isFinite(input.width) ? Math.round(input.width) : 0
    const height = Number.isFinite(input.height) ? Math.round(input.height) : 0
    if (width < 20 || height < 20) return
    const duration = Number.isFinite(input.durationMs) ? Math.round(input.durationMs!) : 1400
    await send({
      type: msg.windowHighlight,
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
  const x = resolveOverlayCoord(input.x, last.x)
  const y = resolveOverlayCoord(input.y, last.y)
  const id = `confirm_${Date.now()}_${++seq}`

  return new Promise<ConfirmResult>((done) => {
    const timer = setTimeout(() => {
      settle(id, "timeout")
    }, timeout + 250)
    pending.set(id, { done, timer })

    void send({
      type: msg.confirm,
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

/**
 * Eagerly start the overlay process.
 * Returns true if the process is running after this call.
 */
export function startOverlay(): boolean {
  return ensureProcess() !== null
}
