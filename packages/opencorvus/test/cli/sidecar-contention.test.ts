import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { readSidecarHandshake } from "./sidecar-test-utils"

/**
 * audit-2026-04-29 W2-G5. Locks the F2 fix end-to-end: two managed
 * sidecars launched against the SAME workspace must NOT both succeed.
 *
 * Pre-fix, `SidecarLock.acquire` did a non-atomic write — a second
 * process slipping in between the `detectExisting` precheck and the
 * `acquire` write would happily create a duplicate lock and bind a
 * second port serving the same DB (§19.1.1 failure mode).
 *
 * Post-fix `acquire` uses `fs.openSync(path, "wx")` (O_EXCL); the
 * loser throws `SidecarLockContendedError`, which the CLI maps to
 * exit 3 with a stderr message that the extension's transport layer
 * pattern-matches into `SidecarExistingInstanceError` (single error
 * shape regardless of detect-time vs race-time contention).
 *
 * The integration shape verifies the message contract; a unit-level
 * race is not deterministic enough to lock here, but the existing
 * `sidecar-lock.test.ts` covers the O_EXCL primitive directly.
 */

describe("opencorvus sidecar contention (audit W2-G5 / F2)", () => {
  test("second sidecar on the same workspace exits 3 with the contention message", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-sidecar-contend-home-"))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-sidecar-contend-ws-"))
    const cliEntry = path.resolve(__dirname, "../../src/index.ts")
    const TOKEN = "test-token-" + Math.random().toString(36).slice(2)

    const spawnSidecar = (extra: Record<string, string> = {}) =>
      Bun.spawn(
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
            ...extra,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      )

    const first = spawnSidecar()
    let firstPort: number | undefined
    try {
      // Wait for the first sidecar to publish its handshake — only
      // then is the lock guaranteed-acquired and a second start
      // exercises the contention path. Without the wait, the
      // ordering is racy.
      firstPort = (
        await readSidecarHandshake(first.stdout, {
          idleTimeoutMs: 30_000,
          label: "sidecar contention first stdout handshake",
        })
      ).port
      expect(firstPort).toBeDefined()

      // Second sidecar — must lose the contention.
      const second = spawnSidecar()
      const exit = await Promise.race([second.exited, new Promise<number>((r) => setTimeout(() => r(-1), 30_000))])
      const stderr = await new Response(second.stderr).text()
      expect(exit).toBe(3)
      // Either detectExisting found the live lock first (preferred,
      // happens almost always) or acquire() threw the racy
      // SidecarLockContendedError. Both produce a stderr line that
      // mentions the existing managed sidecar — the extension
      // pattern-matches one shape, so we assert the shared phrase.
      expect(stderr).toMatch(/existing managed sidecar/i)
    } finally {
      // Kill the first sidecar gracefully via /shutdown, falling
      // back to proc.kill() so the test runner doesn't hang.
      try {
        if (firstPort) {
          const auth = Buffer.from(`opencorvus:${TOKEN}`).toString("base64")
          await fetch(`http://127.0.0.1:${firstPort}/shutdown`, {
            method: "POST",
            headers: { Authorization: `Basic ${auth}` },
          }).catch(() => undefined)
        }
      } catch {}
      try {
        await Promise.race([first.exited, new Promise<number>((r) => setTimeout(() => r(-1), 5_000))])
      } catch {}
      try {
        first.kill()
      } catch {}

      try {
        fs.rmSync(tempHome, { recursive: true, force: true })
      } catch {}
      try {
        fs.rmSync(workspace, { recursive: true, force: true })
      } catch {}
    }
  }, 90_000)
})
