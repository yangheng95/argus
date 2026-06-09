import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import os from "os"
import { SidecarLock } from "../../src/server/sidecar-lock"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("SidecarLock", () => {
  let prevHome: string | undefined
  let tempHome: string

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-sidecar-lock-"))
    prevHome = process.env.OPENCORVUS_HOME
    process.env.OPENCORVUS_HOME = tempHome
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.OPENCORVUS_HOME
    else process.env.OPENCORVUS_HOME = prevHome
    try {
      fs.rmSync(tempHome, { recursive: true, force: true })
    } catch {}
  })

  test("detectExisting returns null when no lock file exists", () => {
    expect(SidecarLock.detectExisting("/tmp/nowhere")).toBeNull()
  })

  test("acquire writes a lock file and detectExisting returns matching info", () => {
    const info: SidecarLock.LockInfo = {
      pid: process.pid,
      port: 12345,
      hostname: "127.0.0.1",
      parentPid: process.pid,
      workspace: "/tmp/ws-acquire",
      startedAt: Date.now(),
    }
    const handle = SidecarLock.acquire(info)
    expect(fs.existsSync(handle.file)).toBe(true)
    const detected = SidecarLock.detectExisting("/tmp/ws-acquire")
    expect(detected).not.toBeNull()
    expect(detected?.pid).toBe(process.pid)
    expect(detected?.port).toBe(12345)
    handle.release()
    expect(fs.existsSync(handle.file)).toBe(false)
  })

  test("detectExisting removes stale lock for dead PID and returns null", () => {
    // Write a lock file pointing to a PID that does not exist.
    // Use 999_999_999 which is far above max PID on Linux/mac/win in practice
    // for unit-test purposes.
    const info: SidecarLock.LockInfo = {
      pid: 999_999_999,
      port: 1,
      hostname: "127.0.0.1",
      parentPid: process.pid,
      workspace: "/tmp/ws-stale",
      startedAt: Date.now(),
    }
    const handle = SidecarLock.acquire(info)
    expect(fs.existsSync(handle.file)).toBe(true)
    const detected = SidecarLock.detectExisting("/tmp/ws-stale")
    expect(detected).toBeNull()
    expect(fs.existsSync(handle.file)).toBe(false)
  })

  test("malformed lock file is treated as stale", () => {
    // Acquire then corrupt
    const info: SidecarLock.LockInfo = {
      pid: process.pid,
      port: 1,
      hostname: "127.0.0.1",
      parentPid: process.pid,
      workspace: "/tmp/ws-malformed",
      startedAt: Date.now(),
    }
    const handle = SidecarLock.acquire(info)
    fs.writeFileSync(handle.file, "{not json", "utf8")
    expect(SidecarLock.detectExisting("/tmp/ws-malformed")).toBeNull()
    expect(fs.existsSync(handle.file)).toBe(false)
  })

  test("release does not delete a lock file owned by another PID", () => {
    const info: SidecarLock.LockInfo = {
      pid: process.pid,
      port: 1,
      hostname: "127.0.0.1",
      parentPid: process.pid,
      workspace: "/tmp/ws-other-owner",
      startedAt: Date.now(),
    }
    const handle = SidecarLock.acquire(info)
    // Simulate ownership change.
    fs.writeFileSync(handle.file, JSON.stringify({ ...info, pid: process.pid + 1 }), "utf8")
    handle.release()
    expect(fs.existsSync(handle.file)).toBe(true)
  })

  test("acquire is atomic — second concurrent caller throws SidecarLockContendedError (audit opencorvus F2)", () => {
    // First sidecar wins.
    const winner: SidecarLock.LockInfo = {
      pid: process.pid,
      port: 1,
      hostname: "127.0.0.1",
      parentPid: process.pid,
      workspace: "/tmp/ws-toctou",
      startedAt: Date.now(),
    }
    const winnerHandle = SidecarLock.acquire(winner)

    // Second sidecar (different PID — must use a value the OS still
    // considers "alive" so detectExisting doesn't auto-prune; but we
    // never call detectExisting here, we exercise raw acquire which
    // must EEXIST against the existing lock atomically).
    const loser: SidecarLock.LockInfo = {
      ...winner,
      pid: process.pid + 1,
      port: 2,
    }
    let caught: unknown
    try {
      SidecarLock.acquire(loser)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SidecarLock.SidecarLockContendedError)
    if (caught instanceof SidecarLock.SidecarLockContendedError) {
      expect(caught.existing?.pid).toBe(winner.pid)
      expect(caught.existing?.port).toBe(winner.port)
    }
    winnerHandle.release()
  })

  test("two distinct workspaces use distinct lock files", () => {
    const info1: SidecarLock.LockInfo = {
      pid: process.pid,
      port: 1,
      hostname: "127.0.0.1",
      parentPid: process.pid,
      workspace: "/tmp/ws-A",
      startedAt: Date.now(),
    }
    const info2: SidecarLock.LockInfo = { ...info1, port: 2, workspace: "/tmp/ws-B" }
    const h1 = SidecarLock.acquire(info1)
    const h2 = SidecarLock.acquire(info2)
    expect(h1.file).not.toBe(h2.file)
    expect(SidecarLock.detectExisting("/tmp/ws-A")?.port).toBe(1)
    expect(SidecarLock.detectExisting("/tmp/ws-B")?.port).toBe(2)
    h1.release()
    h2.release()
  })

  // ── audit-2026-04-29 W2-V7: shape-validate parsed lock ──────────

  test("detectExisting treats `{}` as stale (not as live lock with undefined PID)", () => {
    // A lock file containing valid JSON but missing the required
    // fields would, pre-V7, slip past JSON.parse and surface as a
    // LockInfo with `pid === undefined`. The downstream
    // `isProcessAlive(undefined)` then returns false (process.kill
    // throws) → the file is auto-deleted, BUT the parallel release()
    // path on a live sidecar would treat the same shape as "not
    // mine" and refuse to delete the OWN lock. Lock the strict
    // shape gate.
    const workspace = "/tmp/ws-empty-json"
    const info: SidecarLock.LockInfo = {
      pid: process.pid,
      port: 1,
      hostname: "127.0.0.1",
      parentPid: process.pid,
      workspace,
      startedAt: Date.now(),
    }
    const handle = SidecarLock.acquire(info)
    fs.writeFileSync(handle.file, "{}", "utf8")
    expect(SidecarLock.detectExisting(workspace)).toBeNull()
    expect(fs.existsSync(handle.file)).toBe(false)
  })

  test("detectExisting treats wrong-typed fields (`pid: 'abc'`, negative pid) as stale", () => {
    const workspace = "/tmp/ws-bad-types"
    const info: SidecarLock.LockInfo = {
      pid: process.pid,
      port: 1,
      hostname: "127.0.0.1",
      parentPid: process.pid,
      workspace,
      startedAt: Date.now(),
    }
    for (const malformed of [
      { ...info, pid: "abc" },
      { ...info, pid: -1 },
      { ...info, pid: 1.5 },
      { ...info, port: "x" },
      { ...info, hostname: 123 },
      { ...info, startedAt: "yesterday" },
    ]) {
      const handle = SidecarLock.acquire(info)
      fs.writeFileSync(handle.file, JSON.stringify(malformed), "utf8")
      expect(SidecarLock.detectExisting(workspace)).toBeNull()
      expect(fs.existsSync(handle.file)).toBe(false)
    }
  })

  test("release refuses to delete a malformed lock (does not stomp foreign data)", () => {
    // Pre-V7: release reads {}, current.pid is undefined,
    // `undefined !== info.pid` is truthy → unlinkSync fires →
    // foreign data (or empty stub belonging to another sidecar's
    // partial write) gets deleted. Post-V7: refuse and warn.
    const workspace = "/tmp/ws-malformed-release"
    const info: SidecarLock.LockInfo = {
      pid: process.pid,
      port: 1,
      hostname: "127.0.0.1",
      parentPid: process.pid,
      workspace,
      startedAt: Date.now(),
    }
    const handle = SidecarLock.acquire(info)
    fs.writeFileSync(handle.file, "{}", "utf8")
    handle.release()
    // Stub still there — refusing to delete is the correct
    // fail-safe; the next start's `detectExisting` will prune it
    // via the malformed-shape branch above.
    expect(fs.existsSync(handle.file)).toBe(true)
    // Cleanup
    try {
      fs.unlinkSync(handle.file)
    } catch {}
  })

  // ── audit-2026-04-29 W2-V8: workspace fingerprint collisions ────

  test("two paths that resolve identically share the same lock (case-insensitive FS)", () => {
    // On Windows NTFS / macOS HFS+, /Users/Foo/Bar and /users/foo/bar
    // are the same on-disk dir. Pre-V8, the safe-name was case-
    // sensitive and produced two different lock files; both
    // sidecars happily ran. Post-V8 the path is normalised before
    // hashing.
    if (process.platform !== "win32" && process.platform !== "darwin") {
      // POSIX is case-sensitive — two literally-different paths ARE
      // different workspaces. Skip on Linux: the V8 fix is a no-op
      // here by design.
      return
    }
    const winner: SidecarLock.LockInfo = {
      pid: process.pid,
      port: 1,
      hostname: "127.0.0.1",
      parentPid: process.pid,
      workspace: "/tmp/Workspace-Mixed-Case",
      startedAt: Date.now(),
    }
    const handle = SidecarLock.acquire(winner)
    let caught: unknown
    try {
      SidecarLock.acquire({ ...winner, pid: process.pid + 1, port: 2, workspace: "/tmp/workspace-mixed-case" })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SidecarLock.SidecarLockContendedError)
    handle.release()
  })

  test("very long workspace paths whose safe-name truncates identically still get distinct lock files", () => {
    // Pre-V8: safe-name truncated at 80 chars; two paths sharing
    // the same first-80 chars after replace() collided. Post-V8 the
    // SHA-256 prefix in the filename disambiguates.
    const prefix = "/tmp/" + "a".repeat(120) + "-"
    const wsA = prefix + "alpha"
    const wsB = prefix + "beta"
    const baseInfo = {
      pid: process.pid,
      port: 1,
      hostname: "127.0.0.1",
      parentPid: process.pid,
      startedAt: Date.now(),
    }
    const hA = SidecarLock.acquire({ ...baseInfo, workspace: wsA })
    const hB = SidecarLock.acquire({ ...baseInfo, port: 2, workspace: wsB })
    expect(hA.file).not.toBe(hB.file)
    hA.release()
    hB.release()
  })
})
