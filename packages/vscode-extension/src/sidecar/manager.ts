import { spawn, type ChildProcess } from "node:child_process"
import * as crypto from "node:crypto"
import { HandshakeBuffer, type Handshake, startInactivityWatchdog } from "./handshake"
import { SidecarExistingInstanceError, SidecarStartupError } from "./errors"
import type { ResolvedBinary } from "./binary-resolver"

/**
 * Manages one OpenCorvus managed sidecar process per workspace.
 *
 * Responsibilities:
 *  - spawn the binary with the parent-PID + token env (§19.1.2 / §19.1.3)
 *  - parse the stdout handshake `OPENCORVUS_LISTEN=127.0.0.1:<port>`
 *  - surface a typed error if the sidecar exits before / instead of
 *    handshaking (e.g. existing-instance lock collision, missing token)
 *  - expose baseUrl + token so the TransportBridge can transparently
 *    inject Basic Auth into webview-originated requests
 *  - graceful shutdown via HTTP /shutdown (plan §4.3 step 1) before
 *    escalating to TerminateProcess on timeout
 *
 * The token NEVER crosses the postMessage boundary. It lives only in
 * Extension Host memory (plan §7).
 */

export interface SidecarHandle {
  baseUrl: string
  token: string
  username: string
  pid: number
  workspace: string
  /** Fires when the sidecar exits for any reason. */
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  /** HTTP /shutdown then ultimately kill. Idempotent. */
  stop(opts?: { graceTimeoutMs?: number }): Promise<void>
}

export interface SidecarStartOptions {
  binary: ResolvedBinary
  workspace: string
  /** Defaults to `process.pid` (the extension host PID). */
  parentPid?: number
  /** Defaults to 10 000 ms of stdout/stderr inactivity (plan §16.2). */
  handshakeIdleMs?: number
  /** Optional logger (e.g. vscode.OutputChannel.appendLine). */
  log?: (line: string) => void
}

// audit-2026-04-29 W2-P5 — 32 KiB tail. Rust panic backtraces routinely
// run 30-100 KiB; the previous 4 KiB ceiling discarded the leading
// `panicked at ...` frame. UTF-8 byte concerns do NOT apply because
// `child.stderr?.setEncoding("utf8")` decodes upstream; the slice
// operates on UTF-16 code units, not raw bytes.
const STDERR_TAIL_BYTES = 32 * 1024

export async function startSidecar(opts: SidecarStartOptions): Promise<SidecarHandle> {
  const log = opts.log ?? (() => {})
  const parentPid = opts.parentPid ?? process.pid
  const idleMs = opts.handshakeIdleMs ?? 10_000

  const token = crypto.randomBytes(32).toString("base64url")
  const username = "opencorvus"

  log(`[sidecar] spawning ${opts.binary.binaryPath} target=${opts.binary.target}`)

  const child: ChildProcess = spawn(
    opts.binary.binaryPath,
    ["sidecar", "--project-dir", opts.workspace, "--parent-pid", String(parentPid)],
    {
      cwd: opts.workspace,
      env: {
        ...process.env,
        OPENCORVUS_CALLER: "vscode",
        OPENCORVUS_SERVER_USERNAME: username,
        OPENCORVUS_SERVER_PASSWORD: token,
        OPENCORVUS_PARENT_PID: String(parentPid),
        // Don't inherit dev overrides from the extension dev host: the
        // sidecar binary must use its own bundled defaults.
        OPENCORVUS_DEV_BINARY: undefined,
      } as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  )

  const exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  // audit-2026-04-29 W2-C5 — buffer the exit observation so a sidecar
  // that dies before the caller registers `onExit` (e.g. crashes
  // immediately after writing the stdout handshake) is still
  // reported. Without this, the awaiting microtask in extension.ts
  // resolves AFTER `child.on("exit")` already iterated an empty
  // listener list, and the user sees opaque transport errors with
  // no warning popup.
  let observedExit: { code: number | null; signal: NodeJS.Signals | null } | undefined
  let stderrTail = ""
  const appendStderrTail = (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES)
  }

  return await new Promise<SidecarHandle>((resolve, reject) => {
    const handshake = new HandshakeBuffer()
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }

    const watchdog = startInactivityWatchdog({
      idleMs,
      stderrTailRef: () => stderrTail,
      onTimeout: (err) => {
        settle(() => {
          try {
            child.kill()
          } catch {}
          reject(err)
        })
      },
    })

    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")

    child.stdout?.on("data", (chunk: string) => {
      // audit-2026-04-29 W2-P6 — early-return once the handshake has
      // already produced a result. Pre-fix: every stdout chunk after
      // handshake completion still ran watchdog.touch() (no-op after
      // cancel), handshake.push() (re-scanning a buffer that already
      // resolved), and a log() — wasteful in long sessions where the
      // sidecar prints periodic activity to stdout.
      if (settled) return
      watchdog.touch()
      const found = handshake.push(chunk)
      if (found) {
        watchdog.cancel()
        finishStartup(found)
      } else {
        // Pre-handshake stdout noise is unexpected but not fatal.
        log(`[sidecar.stdout pre-handshake] ${chunk.trimEnd()}`)
      }
    })

    child.stderr?.on("data", (chunk: string) => {
      // Stderr drain CONTINUES after settled — long-running stderr is
      // routed to the OutputChannel for diagnostics, but no longer
      // touches the handshake watchdog (already cancelled).
      appendStderrTail(chunk)
      if (!settled) watchdog.touch()
      log(`[sidecar.stderr] ${chunk.trimEnd()}`)
    })

    child.on("error", (err) => {
      settle(() => {
        watchdog.cancel()
        reject(new SidecarStartupError(`failed to spawn sidecar: ${err.message}`, stderrTail))
      })
    })

    child.on("exit", (code, signal) => {
      watchdog.cancel()
      observedExit = { code, signal }
      for (const fn of exitListeners) {
        try {
          fn(code, signal)
        } catch (e) {
          log(`[sidecar.onExit listener threw] ${String(e)}`)
        }
      }
      settle(() => {
        // Exit code 3 is the sidecar's "existing instance" guard
        // (§19.1.1); make that a distinct error so the UI can show a
        // specific "stop other instance" hint.
        if (code === 3) {
          reject(
            new SidecarExistingInstanceError(
              "another OpenCorvus managed sidecar is already running for this workspace",
              code,
              stderrTail,
            ),
          )
          return
        }
        reject(
          new SidecarStartupError(
            `sidecar exited before handshake (code=${code ?? "null"}, signal=${signal ?? "null"})`,
            stderrTail,
            code ?? undefined,
          ),
        )
      })
    })

    function finishStartup(handshakeResult: Handshake) {
      const baseUrl = `http://${handshakeResult.hostname}:${handshakeResult.port}`
      log(`[sidecar] handshake ok pid=${child.pid} baseUrl=${baseUrl}`)

      let stopped = false
      const stop = async (stopOpts?: { graceTimeoutMs?: number }): Promise<void> => {
        if (stopped) return
        stopped = true
        const grace = stopOpts?.graceTimeoutMs ?? 5_000

        // 1. Try HTTP /shutdown (plan §4.3 step 1).
        try {
          const auth = Buffer.from(`${username}:${token}`).toString("base64")
          await fetch(`${baseUrl}/shutdown`, {
            method: "POST",
            headers: { Authorization: `Basic ${auth}` },
            // Don't let an unresponsive server block disposal:
            signal: AbortSignal.timeout(2_000),
          }).catch(() => undefined)
        } catch {
          // Fetch failure is fine; we still escalate below.
        }

        // 2. Wait for graceful exit, then escalate.
        await new Promise<void>((res) => {
          if (child.exitCode !== null || child.signalCode !== null) return res()
          let done = false
          const timer = setTimeout(() => {
            if (done) return
            done = true
            try {
              child.kill()
            } catch {}
            res()
          }, grace)
          if (typeof timer.unref === "function") timer.unref()
          child.once("exit", () => {
            if (done) return
            done = true
            clearTimeout(timer)
            res()
          })
        })
      }

      settle(() => {
        resolve({
          baseUrl,
          token,
          username,
          pid: child.pid!,
          workspace: opts.workspace,
          onExit: (listener) => {
            exitListeners.push(listener)
            // audit-2026-04-29 W2-C5 — replay any exit that happened
            // in the gap between `finishStartup`'s settle() and the
            // caller's `onExit` registration. Without this, a sidecar
            // that crashes immediately after handshake leaves
            // `activeSidecar` set to a dead handle.
            if (observedExit) {
              const { code, signal } = observedExit
              try {
                listener(code, signal)
              } catch (e) {
                log(`[sidecar.onExit replay listener threw] ${String(e)}`)
              }
            }
          },
          stop,
        })
      })
    }
  })
}
