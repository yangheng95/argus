import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { runProcessWithInactivityTimeout } from "../../src/acceptance/checks/inactivity-timeout-process"

describe("acceptance inactivity timeout process runner", () => {
  test("windows inactivity cleanup uses task tree termination before root-only signals", async () => {
    const source = await Bun.file(
      new URL("../../src/acceptance/checks/inactivity-timeout-process.ts", import.meta.url),
    ).text()
    const timeoutBlock = source.slice(source.indexOf("const terminateTimedOutProcessTree"), source.indexOf("const refreshTimer"))

    expect(source).toContain('import { ProcessSupervisor } from "@/shell/process-supervisor"')
    expect(timeoutBlock).toContain('if (process.platform === "win32")')
    expect(timeoutBlock).toContain('await signalProcessTree(proc, "SIGKILL")')
    expect(timeoutBlock).not.toContain('proc.kill("SIGTERM")')
    expect(source).toContain("Timeout cleanup failed")
    expect(source).toContain("ProcessSupervisor.terminateProcessTree")
    expect(source).not.toContain("taskkill.exe")
    expect(source).not.toContain('void signalProcessTree(proc, "SIGKILL")\n')
  })

  test("does not kill a process that keeps emitting output past the timeout window", async () => {
    const result = await runProcessWithInactivityTimeout({
      executable: process.execPath,
      args: [
        "-e",
        [
          "console.log('tick 0');",
          "let count = 0;",
          "const timer = setInterval(() => {",
          "  count += 1;",
          "  console.log(`tick ${count}`);",
          "  if (count === 5) {",
          "    clearInterval(timer);",
          "    process.exit(0);",
          "  }",
          "}, 150);",
        ].join("\n"),
      ],
      cwd: process.cwd(),
      timeoutMs: 500,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("tick 5")
    expect(result.stderr).not.toContain("timed out")
  })

  test("kills a silent process after one inactive timeout window", async () => {
    const result = await runProcessWithInactivityTimeout({
      executable: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 250);"],
      cwd: process.cwd(),
      timeoutMs: 80,
    })

    expect(result.exitCode).toBeUndefined()
    expect(result.stderr).toContain("Command timed out after 80ms without stdout/stderr activity.")
  })

  test("returns after timing out a process tree with inherited stdio", async () => {
    const started = Date.now()
    const result = await runProcessWithInactivityTimeout({
      executable: process.execPath,
      args: [
        "-e",
        [
          "const { spawn } = require('node:child_process');",
          "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] });",
          "process.on('SIGTERM', () => {});",
          "setInterval(() => {}, 1000);",
        ].join("\n"),
      ],
      cwd: process.cwd(),
      timeoutMs: 80,
    })

    expect(result.exitCode).toBeUndefined()
    expect(result.stderr).toContain("Command timed out after 80ms without stdout/stderr activity.")
    expect(Date.now() - started).toBeLessThan(4_000)
  })

  test("returns after process handles release the working directory", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "oc-inactivity-close-"))
    const result = await runProcessWithInactivityTimeout({
      executable: process.execPath,
      args: ["-e", "process.exit(0)"],
      cwd,
      timeoutMs: 500,
    })

    expect(result.exitCode).toBe(0)
    await expect(fs.rm(cwd, { recursive: true, force: true })).resolves.toBeUndefined()
  })
})
