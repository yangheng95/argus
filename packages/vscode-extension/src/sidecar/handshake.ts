import { SidecarHandshakeTimeoutError, SidecarStartupError } from "./errors"

/**
 * Pure helpers for parsing the sidecar's stdout handshake. Kept
 * dependency-free so they're trivially unit-testable without spawning
 * any process or pulling in the `vscode` API.
 */

const HANDSHAKE_RE = /^OPENCORVUS_LISTEN=([0-9.]+):(\d+)\s*$/

export interface Handshake {
  hostname: string
  port: number
}

export function parseHandshakeLine(line: string): Handshake | null {
  const m = HANDSHAKE_RE.exec(line.trim())
  if (!m) return null
  const port = Number(m[2])
  if (!Number.isFinite(port) || port <= 0 || port >= 65536) return null
  return { hostname: m[1]!, port }
}

/**
 * Stateful line buffer: feed chunks of stdout, get back a handshake on
 * the first matching line. Subsequent lines are ignored (the sidecar
 * may emit log noise after listening succeeds).
 */
export class HandshakeBuffer {
  private buffer = ""
  private resolved: Handshake | null = null

  push(chunk: string): Handshake | null {
    if (this.resolved) return this.resolved
    this.buffer += chunk
    let nl = this.buffer.indexOf("\n")
    while (nl >= 0) {
      const line = this.buffer.slice(0, nl)
      this.buffer = this.buffer.slice(nl + 1)
      const found = parseHandshakeLine(line)
      if (found) {
        this.resolved = found
        return found
      }
      nl = this.buffer.indexOf("\n")
    }
    return null
  }
}

/**
 * Idle-timeout watchdog (plan §16.2: "超时按无活动计时"): refresh on
 * every chunk, fail when no chunk arrives for `idleMs`.
 */
export interface InactivityWatchdog {
  touch: () => void
  cancel: () => void
}

export function startInactivityWatchdog(opts: {
  idleMs: number
  onTimeout: (err: SidecarStartupError) => void
  stderrTailRef: () => string
}): InactivityWatchdog {
  let timer: NodeJS.Timeout | undefined
  let cancelled = false

  const arm = () => {
    if (cancelled) return
    timer = setTimeout(() => {
      if (cancelled) return
      opts.onTimeout(new SidecarHandshakeTimeoutError(opts.idleMs, opts.stderrTailRef()))
    }, opts.idleMs)
    if (timer && typeof timer.unref === "function") timer.unref()
  }

  arm()

  return {
    touch: () => {
      if (cancelled) return
      if (timer) clearTimeout(timer)
      arm()
    },
    cancel: () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    },
  }
}
