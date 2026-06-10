import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"

/**
 * Chaos integration tests for `opencorvus sidecar` (plan
 * §19.3.5 / M8.B). Complements the happy-path
 * `sidecar-smoke.test.ts` by exercising failure modes that the unit
 * tests for SidecarLock / ParentWatchdog cover only at the helper
 * level.
 *
 * Scenarios covered here:
 *   1. existing-instance lock collision (§19.1.1) — second managed
 *      sidecar on the same workspace must exit 3 with an actionable
 *      stderr message that the extension's TransportBridge maps to
 *      SidecarExistingInstanceError.
 *   2. parent-PID watchdog end-to-end (§19.1.2) — pass a parent PID
 *      that is already dead at spawn time; the watchdog must observe
 *      it and self-shutdown within one polling interval.
 */

const CLI_ENTRY = path.resolve(__dirname, "../../src/index.ts")

interface SpawnedSidecar {
  proc: ReturnType<typeof Bun.spawn>
  port: number | undefined
  /** Live accumulator for the child's stderr. Updated by the
   *  background reader; readers can poll it after `proc.exited`. */
  getStderr: () => string
}

async function spawnSidecar(opts: {
  tempHome: string
  workspace: string
  parentPid: number
  watchdogIntervalMs?: number
  token?: string
  awaitHandshake?: boolean
  handshakeTimeoutMs?: number
}): Promise<SpawnedSidecar> {
  const proc = Bun.spawn(
    [
      "bun",
      CLI_ENTRY,
      "sidecar",
      "--project-dir",
      opts.workspace,
      "--parent-pid",
      String(opts.parentPid),
      "--watchdog-interval-ms",
      String(opts.watchdogIntervalMs ?? 500),
    ],
    {
      env: {
        ...process.env,
        OPENCORVUS_HOME: opts.tempHome,
        OPENCORVUS_SERVER_PASSWORD: opts.token ?? `chaos-token-${Math.random().toString(36).slice(2)}`,
        OPENCORVUS_SERVER_USERNAME: "opencorvus",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )

  let port: number | undefined
  let stderrTail = ""

  // Stderr drain lives for the lifetime of the child so EPIPE never
  // kills it; the test reads the accumulator post-exit via getStderr().
  const stderrDone = (async () => {
    const reader = proc.stderr.getReader()
    const decoder = new TextDecoder()
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        stderrTail = (stderrTail + decoder.decode(value)).slice(-8192)
      }
    } catch {
    } finally {
      try {
        reader.releaseLock()
      } catch {}
    }
  })()
  // Hold a reference so the drain never GC'd; we await it indirectly
  // via process.exited later if a test wants to.
  void stderrDone

  if (opts.awaitHandshake) {
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    const deadline = Date.now() + (opts.handshakeTimeoutMs ?? 30_000)
    while (Date.now() < deadline) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value)
      const m = buf.match(/^OPENCORVUS_LISTEN=127\.0\.0\.1:(\d+)$/m)
      if (m) {
        port = Number(m[1])
        break
      }
    }
    try {
      reader.releaseLock()
    } catch {}
  }

  return {
    proc,
    port,
    getStderr: () => stderrTail,
  }
}

describe("opencorvus sidecar (chaos)", () => {
  const cleanups: Array<() => void> = []

  afterEach(async () => {
    while (cleanups.length) {
      try {
        cleanups.pop()!()
      } catch {}
    }
  })

  test("second managed sidecar on the same workspace exits 3 (existing-instance lock §19.1.1)", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-chaos-"))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-chaos-ws-"))
    cleanups.push(() => {
      try {
        fs.rmSync(tempHome, { recursive: true, force: true })
      } catch {}
      try {
        fs.rmSync(workspace, { recursive: true, force: true })
      } catch {}
    })

    // First sidecar — should reach handshake and own the lock.
    const TOKEN = `chaos-token-${Math.random().toString(36).slice(2)}`
    const first = await spawnSidecar({
      tempHome,
      workspace,
      parentPid: process.pid,
      token: TOKEN,
      awaitHandshake: true,
      handshakeTimeoutMs: 30_000,
    })
    cleanups.push(() => {
      try {
        first.proc.kill()
      } catch {}
    })
    expect(first.port).toBeDefined()
    expect(first.port).toBeGreaterThan(0)

    // Second sidecar — same workspace, different token. The lock
    // file written by `first` should make detectExisting() fail
    // and the sidecar must exit with code 3.
    const second = await spawnSidecar({
      tempHome,
      workspace,
      parentPid: process.pid,
      // No awaitHandshake — second never reaches handshake.
    })
    const exitCode = await Promise.race([
      second.proc.exited,
      new Promise<number>((r) => setTimeout(() => r(-1), 10_000)),
    ])
    // Allow the stderr drain to flush after exit before reading.
    await new Promise((r) => setTimeout(r, 50))
    const stderr = second.getStderr()
    expect(exitCode).toBe(3)
    expect(stderr).toContain("existing managed sidecar")

    // Graceful shutdown of the first via HTTP /shutdown.
    try {
      const auth = Buffer.from(`opencorvus:${TOKEN}`).toString("base64")
      await fetch(`http://127.0.0.1:${first.port}/shutdown`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}` },
      }).catch(() => undefined)
    } catch {}
    await Promise.race([first.proc.exited, new Promise<number>((r) => setTimeout(() => r(-1), 10_000))])
  }, 90_000)

  test("parent watchdog self-shuts when parent PID is already dead at spawn time (§19.1.2)", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-chaos-"))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-chaos-ws-"))
    cleanups.push(() => {
      try {
        fs.rmSync(tempHome, { recursive: true, force: true })
      } catch {}
      try {
        fs.rmSync(workspace, { recursive: true, force: true })
      } catch {}
    })

    // Spawn a short-lived dummy bun that we kill BEFORE the sidecar
    // starts; its PID will already be free by the time the
    // watchdog's first poll runs. We still pass a real-looking PID
    // value rather than a literally-impossible one so the resolver
    // sees the same shape as a real workflow.
    const dummy = Bun.spawn(["bun", "-e", "process.exit(0)"], { stdout: "ignore", stderr: "ignore" })
    const deadPid = dummy.pid!
    await dummy.exited

    const sidecar = await spawnSidecar({
      tempHome,
      workspace,
      parentPid: deadPid,
      watchdogIntervalMs: 200,
      awaitHandshake: true,
      handshakeTimeoutMs: 30_000,
    })
    cleanups.push(() => {
      try {
        sidecar.proc.kill()
      } catch {}
    })
    // Even if the handshake landed, the watchdog should fire
    // within the next polling interval and the sidecar must exit
    // on its own. Allow generous slack for slow CI runners.
    const exitCode = await Promise.race([
      sidecar.proc.exited,
      new Promise<number>((r) => setTimeout(() => r(-1), 15_000)),
    ])
    expect(exitCode).not.toBe(-1)
  }, 60_000)
})
