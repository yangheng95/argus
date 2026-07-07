import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ProcessSupervisor } from "../../src/shell/process-supervisor"
import { Process } from "../../src/util/process"

function node(script: string) {
  return [process.execPath, "-e", script]
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

function killProcess(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    process.kill(pid, "SIGKILL")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
  }
}

function spyCleanupFailure(message: string): void {
  if (process.platform === "win32") {
    spyOn(ProcessSupervisor, "terminateProcessTree").mockImplementation(async () => {
      throw new Error(message)
    })
    return
  }
  spyOn(ProcessSupervisor, "terminateProcessGroup").mockImplementation(async () => {
    throw new Error(message)
  })
}

async function waitForDead(pid: number, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  expect(processAlive(pid)).toBe(false)
}

async function waitForPidFile(file: string, timeoutMs = 1_000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const pid = Number((await fs.readFile(file, "utf8")).trim())
      if (Number.isInteger(pid) && pid > 0) return pid
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for pid file ${file}`)
}

describe("util.process", () => {
  afterEach(() => {
    mock.restore()
  })

  test("captures stdout and stderr", async () => {
    const out = await Process.run(node('process.stdout.write("out");process.stderr.write("err")'))
    expect(out.code).toBe(0)
    expect(out.stdout.toString()).toBe("out")
    expect(out.stderr.toString()).toBe("err")
  })

  test("returns code when nothrow is enabled", async () => {
    const out = await Process.run(node("process.exit(7)"), { nothrow: true })
    expect(out.code).toBe(7)
  })

  test("unwraps quoted executable paths before spawning", async () => {
    const [executable, ...args] = node('process.stdout.write("ok")')
    const out = await Process.run([`'"${executable}"'`, ...args])
    expect(out.stdout.toString()).toBe("ok")
  })

  test("spawn exited waits for the process close event", async () => {
    const proc = Process.spawn(node('process.stdout.write("ok")'), { stdout: "pipe" })
    let closeObserved = false
    proc.once("close", () => {
      closeObserved = true
    })

    const code = await proc.exited

    expect(code).toBe(0)
    expect(closeObserved).toBe(true)
  })

  test("throws RunFailedError on non-zero exit", async () => {
    const err = await Process.run(node('process.stderr.write("bad");process.exit(3)')).catch((error) => error)
    expect(err).toBeInstanceOf(Process.RunFailedError)
    if (!(err instanceof Process.RunFailedError)) throw err
    expect(err.code).toBe(3)
    expect(err.stderr.toString()).toBe("bad")
  })

  test("aborts a running process", async () => {
    const abort = new AbortController()
    const started = Date.now()
    setTimeout(() => abort.abort(), 25)

    const out = await Process.run(node("setInterval(() => {}, 1000)"), {
      abort: abort.signal,
      nothrow: true,
    })

    expect(out.code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(2000)
  }, 3000)

  test("abort surfaces cleanup failure without waiting for natural process exit", async () => {
    spyCleanupFailure("forced process cleanup failure")
    const abort = new AbortController()
    const started = Date.now()
    setTimeout(() => abort.abort(), 25)

    await expect(
      Process.run(node("setTimeout(() => {}, 500)"), {
        abort: abort.signal,
        nothrow: true,
      }),
    ).rejects.toThrow("forced process cleanup failure")
    expect(Date.now() - started).toBeLessThan(500)
  }, 3000)

  test("abort surfaces process cleanup failure after root exit but before close", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-process-root-exit-cleanup-failure-"))
    const pidFile = path.join(root, "descendant.pid")
    let descendantPid: number | undefined
    spyCleanupFailure("forced root-exited process cleanup failure")
    const abort = new AbortController()
    try {
      const run = Process.run(
        node(
          [
            "const { spawn } = require('node:child_process')",
            "const fs = require('node:fs')",
            `const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"] })`,
            "child.unref()",
            `fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
            "process.exit(0)",
          ].join(";"),
        ),
        {
          abort: abort.signal,
          nothrow: true,
        },
      ).catch((error) => error)
      descendantPid = await waitForPidFile(pidFile)
      const started = Date.now()
      abort.abort()
      const error = await run
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain("forced root-exited process cleanup failure")
      expect(Date.now() - started).toBeLessThan(500)
    } finally {
      if (descendantPid !== undefined && processAlive(descendantPid)) killProcess(descendantPid)
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 3000)

  test("abort terminates inherited-stdio descendants after root exit", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-process-root-exit-descendant-cleanup-"))
    const pidFile = path.join(root, "descendant.pid")
    let descendantPid: number | undefined
    const abort = new AbortController()
    try {
      const run = Process.run(
          node(
            [
              "const { spawn } = require('node:child_process')",
              "const fs = require('node:fs')",
              `const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"] })`,
              "child.unref()",
              `fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
              "process.exit(0)",
            ].join(";"),
          ),
          {
            abort: abort.signal,
            nothrow: true,
          },
      )
      descendantPid = await waitForPidFile(pidFile)
      abort.abort()
      const out = await run
      expect(typeof out.code).toBe("number")
      await waitForDead(descendantPid)
    } finally {
      if (descendantPid !== undefined && processAlive(descendantPid)) killProcess(descendantPid)
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 3000)

  test("run terminates ignored-stdio descendants after root exit", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-process-root-exit-ignored-descendant-"))
    const pidFile = path.join(root, "descendant.pid")
    let descendantPid: number | undefined
    try {
      const out = await Process.run(
        node(
          [
            "const { spawn } = require('node:child_process')",
            "const fs = require('node:fs')",
            `const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: ["ignore", "ignore", "ignore"] })`,
            "child.unref()",
            `fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
            'process.stdout.write("ready")',
            "process.exit(0)",
          ].join(";"),
        ),
      )
      expect(out.stdout.toString()).toBe("ready")
      descendantPid = Number(await fs.readFile(pidFile, "utf8"))
      await waitForDead(descendantPid)
    } finally {
      if (descendantPid !== undefined && processAlive(descendantPid)) killProcess(descendantPid)
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 3000)

  test("Windows cleanup delegates process tree termination to the native helper", async () => {
    const source = await fs.readFile(path.resolve(import.meta.dir, "../../src/shell/process-supervisor.ts"), "utf8")
    const nativeSource = await fs.readFile(
      path.resolve(import.meta.dir, "../../native/process-supervisor/src/main.rs"),
      "utf8",
    )

    expect(source).toContain('spawn(helper, ["--kill-tree", String(pid)]')
    expect(source).toContain("runWindowsProcessTreeCleanup")
    expect(source).not.toContain("windowsChildPids")
    expect(source).not.toContain("windowsDescendantPids")
    expect(source).not.toContain("wmic")
    expect(source).not.toContain("taskkill.exe")
    expect(nativeSource).toContain("CreateToolhelp32Snapshot")
    expect(nativeSource).toContain("Process32FirstW")
    expect(nativeSource).toContain("Process32NextW")
    expect(nativeSource).toContain("TerminateProcess")
    expect(nativeSource).toContain('--kill-tree')
  })

  test("native Windows cleanup terminates descendants before the requested root pid", async () => {
    const nativeSource = await fs.readFile(
      path.resolve(import.meta.dir, "../../native/process-supervisor/src/main.rs"),
      "utf8",
    )
    const cleanup = nativeSource.slice(nativeSource.indexOf("fn terminate_process_tree"))

    expect(cleanup).toContain("let mut targets = descendant_pids(pid, &processes)")
    expect(cleanup).toContain("targets.reverse()")
    expect(cleanup).toContain("targets.push(pid)")
    expect(cleanup).toContain("for target in targets")
    expect(cleanup).toContain("terminate_pid(target)?")
  })

  test("aborts through supervisor escalation when process ignores terminate signal", async () => {
    if (process.platform === "win32") return

    const abort = new AbortController()
    const started = Date.now()
    setTimeout(() => abort.abort(), 25)

    const out = await Process.run(node('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'), {
      abort: abort.signal,
      nothrow: true,
    })

    expect(out.code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(1000)
  }, 3000)

  test("terminate uses the same escalation path as abort", async () => {
    if (process.platform === "win32") return

    const started = Date.now()
    const proc = Process.spawn(node('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'))
    setTimeout(() => proc.terminate(), 25)

    const code = await proc.exited

    expect(code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(1000)
  }, 3000)
})
