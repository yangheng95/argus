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
    try { fs.rmSync(tempHome, { recursive: true, force: true }) } catch {}
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
    fs.writeFileSync(
      handle.file,
      JSON.stringify({ ...info, pid: process.pid + 1 }),
      "utf8",
    )
    handle.release()
    expect(fs.existsSync(handle.file)).toBe(true)
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
})
