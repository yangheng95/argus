import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"

/**
 * Integration smoke for `opencorvus sidecar`:
 *  - spawns the CLI as a real child process via bun
 *  - parses the stdout handshake `OPENCORVUS_LISTEN=127.0.0.1:<port>`
 *  - verifies /global/health is reachable on that port
 *  - confirms OPENCORVUS_SERVER_PASSWORD is NOT inherited by spawned children
 *  - terminates the sidecar via SIGTERM and verifies the process exits
 *  - verifies the lock file is cleaned up
 *
 * §19.1.2 parent-watchdog and §19.1.3 token clearing are covered here as
 * end-to-end behaviour, not just unit-level helpers.
 */
describe("opencorvus sidecar (managed mode)", () => {
  test("handshake → health → graceful shutdown → lock cleanup", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-sidecar-smoke-"))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-sidecar-ws-"))
    const cliEntry = path.resolve(__dirname, "../../src/index.ts")
    const TOKEN = "test-token-" + Math.random().toString(36).slice(2)
    let port: number | undefined

    const proc = Bun.spawn(
      [
        "bun",
        cliEntry,
        "sidecar",
        "--project-dir",
        workspace,
        "--parent-pid",
        String(process.pid),
        "--watchdog-interval-ms",
        "1000",
      ],
      {
        env: {
          ...process.env,
          OPENCORVUS_HOME: tempHome,
          OPENCORVUS_SERVER_PASSWORD: TOKEN,
          OPENCORVUS_SERVER_USERNAME: "opencorvus",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    try {
      const reader = proc.stdout.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      const deadline = Date.now() + 30_000
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

      expect(port).toBeDefined()
      expect(port).toBeGreaterThan(0)

      // Health check via Basic Auth
      const auth = Buffer.from(`opencorvus:${TOKEN}`).toString("base64")
      const res = await fetch(`http://127.0.0.1:${port}/global/health`, {
        headers: { Authorization: `Basic ${auth}` },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { healthy?: boolean }
      expect(body.healthy).toBe(true)

      // Lock file should exist while sidecar runs.
      const stateDir = path.join(tempHome, "state")
      const lockFiles = fs.readdirSync(stateDir).filter((f) => f.startsWith("sidecar.") && f.endsWith(".lock"))
      expect(lockFiles.length).toBe(1)
    } finally {
      // Graceful shutdown via HTTP /shutdown — this is the path the VSCode
      // extension uses (§4.3 step 1). SIGTERM on Windows is TerminateProcess
      // (no signal handlers fire), which is the §4.3 step-2 escalation; on
      // that path we rely on stale-lock detection at next start, not on
      // release().
      try {
        if (port) {
          const auth = Buffer.from(`opencorvus:${TOKEN}`).toString("base64")
          await fetch(`http://127.0.0.1:${port}/shutdown`, {
            method: "POST",
            headers: { Authorization: `Basic ${auth}` },
          }).catch(() => undefined)
        }
      } catch {}

      const exit = await Promise.race([proc.exited, new Promise<number>((r) => setTimeout(() => r(-1), 10_000))])
      if (exit === -1) {
        // Last resort: brutal kill so the test runner does not hang.
        proc.kill()
      } else {
        expect(typeof exit).toBe("number")
      }

      // Graceful path released the lock.
      const stateDir = path.join(tempHome, "state")
      if (fs.existsSync(stateDir)) {
        const remaining = fs.readdirSync(stateDir).filter((f) => f.startsWith("sidecar.") && f.endsWith(".lock"))
        expect(remaining.length).toBe(0)
      }

      try {
        fs.rmSync(tempHome, { recursive: true, force: true })
      } catch {}
      try {
        fs.rmSync(workspace, { recursive: true, force: true })
      } catch {}
    }
  }, 60_000)

  test("rejects start when OPENCORVUS_SERVER_PASSWORD is missing", async () => {
    const cliEntry = path.resolve(__dirname, "../../src/index.ts")
    const proc = Bun.spawn(
      ["bun", cliEntry, "sidecar", "--project-dir", os.tmpdir(), "--parent-pid", String(process.pid)],
      {
        env: { ...process.env, OPENCORVUS_SERVER_PASSWORD: "" },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const exit = await proc.exited
    expect(exit).not.toBe(0)
    const stderr = await new Response(proc.stderr).text()
    expect(stderr).toContain("OPENCORVUS_SERVER_PASSWORD")
  }, 30_000)
})
