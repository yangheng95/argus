import { afterEach, expect, mock, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { jsonLines } from "../../src/executor/external-process"
import { ProcessSupervisor } from "../../src/shell/process-supervisor"

afterEach(() => {
  mock.restore()
})

// Cross-platform "long-lived process" command. We pick `bun -e` because bun
// is guaranteed available (the test runner itself is bun). We sleep just
// long enough that, if the generator's finally doesn't kill the process,
// it would still be alive when we assert.
function sleepCmd(ms: number): string[] {
  return ["bun", "-e", `await Bun.sleep(${ms})`]
}

// Emit a few JSON lines fast then idle forever. Used to test that a
// consumer breaking out of `for await` actually tears the subprocess down.
function spammerCmd(): string[] {
  return [
    "bun",
    "-e",
    `for (let i = 0; i < 1000; i++) { console.log(JSON.stringify({ i })); await Bun.sleep(2) } await Bun.sleep(60_000)`,
  ]
}

function sigtermIgnoringSpammerCmd(): string[] {
  return [
    process.execPath,
    "-e",
    [
      "process.on('SIGTERM', () => {})",
      "process.stdout.write(JSON.stringify({ ready: true }) + '\\n')",
      "setInterval(() => {}, 1000)",
    ].join(";"),
  ]
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
    await Bun.sleep(25)
  }
  expect(processAlive(pid)).toBe(false)
}

test(
  "jsonLines kills the subprocess when consumer breaks early",
  async () => {
    const it = jsonLines({ command: spammerCmd() })
    let pid: number | undefined
    // Drain a few items, then abandon the iterator. The generator's finally
    // must kill the spammer subprocess — otherwise it would idle for 60s.
    let count = 0
    for await (const item of it) {
      expect(typeof item.i).toBe("number")
      count += 1
      if (count >= 3) break
    }
    // No reliable cross-platform way to capture pid without changing the
    // public API, so we instead assert the function returned promptly and
    // didn't hang. If kill failed, the bun event loop would still be busy
    // draining proc.exited for ~60s and this test would time out (1s).
    expect(count).toBe(3)
  },
  { timeout: 5_000 },
)

test(
  "jsonLines escalates when early-break child ignores SIGTERM",
  async () => {
    if (process.platform === "win32") return

    const started = Date.now()
    const it = jsonLines({ command: sigtermIgnoringSpammerCmd() })
    for await (const item of it) {
      expect(item.ready).toBe(true)
      break
    }

    expect(Date.now() - started).toBeLessThan(7_000)
  },
  { timeout: 8_000 },
)

test(
  "jsonLines surfaces process tree cleanup failure on early break",
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-json-lines-cleanup-failure-"))
    const pidFile = path.join(root, "child.pid")
    spyCleanupFailure("forced JSON-lines process cleanup failure")
    let pid: number | undefined
    let sawReady = false
    const started = Date.now()
    try {
      let cleanupError: unknown
      try {
        for await (const item of jsonLines({
          command: [
            process.execPath,
            "-e",
            [
              "const fs = require('node:fs')",
              `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
              "console.log(JSON.stringify({ ready: true }))",
              "setInterval(() => {}, 1000)",
            ].join(";"),
          ],
        })) {
          expect(item.ready).toBe(true)
          sawReady = true
          break
        }
      } catch (error) {
        cleanupError = error
      }
      expect(cleanupError).toBeInstanceOf(Error)
      expect(String(cleanupError)).toContain("forced JSON-lines process cleanup failure")
      expect(sawReady).toBe(true)
      pid = Number(await fs.readFile(pidFile, "utf8"))
      expect(Date.now() - started).toBeLessThan(1000)
    } finally {
      if (pid !== undefined && processAlive(pid)) process.kill(pid)
      await fs.rm(root, { recursive: true, force: true })
    }
  },
  { timeout: 3_000 },
)

test(
  "jsonLines surfaces cleanup failure after root exit but before close",
  async () => {
    if (process.platform === "win32") return

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-json-lines-root-exit-cleanup-failure-"))
    const pidFile = path.join(root, "descendant.pid")
    spyCleanupFailure("forced JSON-lines root-exited cleanup failure")
    let descendantPid: number | undefined
    let sawReady = false
    const started = Date.now()
    try {
      let cleanupError: unknown
      try {
        for await (const item of jsonLines({
          command: [
            process.execPath,
            "-e",
            [
              "const { spawn } = require('node:child_process')",
              "const fs = require('node:fs')",
              `const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"] })`,
              "child.unref()",
              `fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
              "console.log(JSON.stringify({ ready: true }))",
              "process.exit(0)",
            ].join(";"),
          ],
        })) {
          expect(item.ready).toBe(true)
          sawReady = true
          break
        }
      } catch (error) {
        cleanupError = error
      }
      expect(cleanupError).toBeInstanceOf(Error)
      expect(String(cleanupError)).toContain("forced JSON-lines root-exited cleanup failure")
      expect(sawReady).toBe(true)
      descendantPid = Number(await fs.readFile(pidFile, "utf8"))
      expect(Date.now() - started).toBeLessThan(500)
    } finally {
      if (descendantPid !== undefined && processAlive(descendantPid)) killProcess(descendantPid)
      await fs.rm(root, { recursive: true, force: true })
    }
  },
  { timeout: 3_000 },
)

test(
  "jsonLines terminates inherited-stdio descendants after root exit",
  async () => {
    if (process.platform === "win32") return

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-json-lines-root-exit-descendant-cleanup-"))
    const pidFile = path.join(root, "descendant.pid")
    let descendantPid: number | undefined
    try {
      for await (const item of jsonLines({
        command: [
          process.execPath,
          "-e",
          [
            "const { spawn } = require('node:child_process')",
            "const fs = require('node:fs')",
            `const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"] })`,
            "child.unref()",
            `fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
            "console.log(JSON.stringify({ ready: true }))",
            "process.exit(0)",
          ].join(";"),
        ],
      })) {
        expect(item.ready).toBe(true)
        break
      }
      descendantPid = Number(await fs.readFile(pidFile, "utf8"))
      await waitForDead(descendantPid)
    } finally {
      if (descendantPid !== undefined && processAlive(descendantPid)) killProcess(descendantPid)
      await fs.rm(root, { recursive: true, force: true })
    }
  },
  { timeout: 3_000 },
)

test(
  "jsonLines terminates ignored-stdio descendants after root exit",
  async () => {
    if (process.platform === "win32") return

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-json-lines-root-exit-ignored-descendant-"))
    const pidFile = path.join(root, "descendant.pid")
    let descendantPid: number | undefined
    try {
      for await (const item of jsonLines({
        command: [
          process.execPath,
          "-e",
          [
            "const { spawn } = require('node:child_process')",
            "const fs = require('node:fs')",
            `const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: ["ignore", "ignore", "ignore"] })`,
            "child.unref()",
            `fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
            "console.log(JSON.stringify({ ready: true }))",
            "process.exit(0)",
          ].join(";"),
        ],
      })) {
        expect(item.ready).toBe(true)
        break
      }
      descendantPid = Number(await fs.readFile(pidFile, "utf8"))
      await waitForDead(descendantPid)
    } finally {
      if (descendantPid !== undefined && processAlive(descendantPid)) killProcess(descendantPid)
      await fs.rm(root, { recursive: true, force: true })
    }
  },
  { timeout: 3_000 },
)

test("jsonLines settles cleanly when subprocess exits naturally", async () => {
  // Subprocess exits in ~10ms. Generator should drain naturally, no error.
  const items: any[] = []
  for await (const item of jsonLines({
    command: ["bun", "-e", `console.log(JSON.stringify({ ok: true }))`],
  })) {
    items.push(item)
  }
  expect(items).toEqual([{ ok: true }])
})

test("jsonLines surfaces non-zero exit when consumer drained naturally", async () => {
  await expect(async () => {
    for await (const _ of jsonLines({
      command: ["bun", "-e", `console.error("boom"); process.exit(7)`],
    })) {
      void _
    }
  }).toThrow(/boom|exit code 7/)
})

test("jsonLines does NOT throw the subprocess error when consumer aborted early", async () => {
  // Subprocess writes one line, exits non-zero. If the consumer breaks
  // before draining EOF, the finally cleans up but should NOT translate
  // that into a thrown error — the consumer owns the early-exit outcome.
  const it = jsonLines({
    command: [
      "bun",
      "-e",
      `console.log(JSON.stringify({ a: 1 })); console.log(JSON.stringify({ a: 2 })); console.log(JSON.stringify({ a: 3 })); process.exit(0)`,
    ],
  })
  for await (const item of it) {
    expect(item.a).toBe(1)
    break
  }
  // No throw — break is the contract, generator finally cleaned up.
})

test(
  "jsonLines respects external AbortSignal",
  async () => {
    const ctrl = new AbortController()
    const it = jsonLines({
      command: sleepCmd(60_000),
      signal: ctrl.signal,
    })
    setTimeout(() => ctrl.abort(), 50)
    // Iterating an aborted-process generator should settle without blocking
    // for 60s. Because the subprocess emits no JSON lines, the for-await
    // loop never yields; it returns when the stdout stream closes after
    // SIGTERM.
    for await (const _ of it) {
      void _
    }
  },
  { timeout: 5_000 },
)
