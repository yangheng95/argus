import { describe, expect, test } from "bun:test"
import { spawnSync } from "child_process"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { PassThrough } from "stream"
import { Shell } from "../src/shell/shell"
import { ProcessSupervisor } from "../src/shell/process-supervisor"

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true
    await Bun.sleep(25)
  }
  return !isProcessRunning(pid)
}

function killProcessTreeForTest(pid: number | undefined) {
  if (!pid || !isProcessRunning(pid)) return
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  })
}

describe("shell selection", () => {
  test("ignores powershell from SHELL on windows", () => {
    expect(Shell.fromEnv("C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "win32")).toBeUndefined()
  })

  test("accepts bash from SHELL on windows", () => {
    expect(Shell.fromEnv("C:\\Program Files\\Git\\bin\\bash.exe", "win32")).toBe(
      "C:\\Program Files\\Git\\bin\\bash.exe",
    )
  })

  test("keeps user shell on non-windows platforms", () => {
    expect(Shell.fromEnv("/bin/zsh", "darwin")).toBe("/bin/zsh")
  })
})

describe("shell process supervisor contract", () => {
  test("run disposes supervisor after normal completion", async () => {
    let disposed = 0
    const restore = ProcessSupervisor.setFactoryForTest(async () => {
      const stdout = new PassThrough()
      let resolveExit!: (code: number) => void
      const exited = new Promise<number>((resolve) => {
        resolveExit = resolve
      })
      queueMicrotask(() => {
        stdout.write("ok\n")
        stdout.end()
        setTimeout(() => resolveExit(0), 0)
      })
      return {
        pid: 123,
        stdin: null,
        stdout,
        stderr: new PassThrough(),
        exited,
        terminate: async () => {},
        dispose: async () => {
          disposed++
        },
        unref: () => {},
      }
    })
    try {
      const result = await Shell.run("echo ok")
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("ok")
      expect(disposed).toBe(1)
    } finally {
      restore()
    }
  })

  test("run passes process environment, caller environment, and supervisor guard to the child", async () => {
    const previousProcessEnv = process.env.OPENCORVUS_SHELL_TEST_PROCESS_ENV
    process.env.OPENCORVUS_SHELL_TEST_PROCESS_ENV = "process"
    let capturedEnv: NodeJS.ProcessEnv | undefined
    const restore = ProcessSupervisor.setFactoryForTest(async (opts) => {
      capturedEnv = opts.env
      return {
        pid: 128,
        stdin: null,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exited: Promise.resolve(0),
        terminate: async () => {},
        dispose: async () => {},
        unref: () => {},
      }
    })
    try {
      await Shell.run("env-check", { env: { OPENCORVUS_SHELL_TEST_ENV: "caller" } })
      expect(capturedEnv?.OPENCORVUS_SHELL_TEST_PROCESS_ENV).toBe("process")
      expect(capturedEnv?.OPENCORVUS_SHELL_TEST_ENV).toBe("caller")
      expect(capturedEnv?.OPENCORVUS_PROTECTED_PIDS).toBeTruthy()
    } finally {
      if (previousProcessEnv === undefined) {
        delete process.env.OPENCORVUS_SHELL_TEST_PROCESS_ENV
      } else {
        process.env.OPENCORVUS_SHELL_TEST_PROCESS_ENV = previousProcessEnv
      }
      restore()
    }
  })

  test("run timeout terminates and disposes supervisor once", async () => {
    let terminateCalls = 0
    let disposeCalls = 0
    let resolveExit!: (code: number) => void
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve
    })
    const keepAlive = setInterval(() => {}, 10)
    const restore = ProcessSupervisor.setFactoryForTest(async () => ({
      pid: 124,
      stdin: null,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exited,
      terminate: async () => {
        terminateCalls++
        clearInterval(keepAlive)
        resolveExit(1)
      },
      dispose: async () => {
        disposeCalls++
      },
      unref: () => {},
    }))
    try {
      const result = await Shell.run("sleep", { timeoutMs: 1 })
      expect(result.timedOut).toBe(true)
      expect(terminateCalls).toBe(1)
      expect(disposeCalls).toBe(1)
    } finally {
      clearInterval(keepAlive)
      restore()
    }
  })

  test("run idle timeout terminates silent processes", async () => {
    let terminateCalls = 0
    let resolveExit!: (code: number) => void
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve
    })
    const keepAlive = setInterval(() => {}, 10)
    const restore = ProcessSupervisor.setFactoryForTest(async () => ({
      pid: 126,
      stdin: null,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exited,
      terminate: async () => {
        terminateCalls++
        clearInterval(keepAlive)
        resolveExit(1)
      },
      dispose: async () => {},
      unref: () => {},
    }))
    try {
      const result = await Shell.run("silent", { idleTimeoutMs: 1 })
      expect(result.idleTimedOut).toBe(true)
      expect(result.timedOut).toBe(false)
      expect(terminateCalls).toBe(1)
    } finally {
      clearInterval(keepAlive)
      restore()
    }
  })

  test("run idle timeout refreshes on stdout activity", async () => {
    const stdout = new PassThrough()
    let terminateCalls = 0
    let resolveExit!: (code: number) => void
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve
    })
    const timers: ReturnType<typeof setTimeout>[] = []
    const restore = ProcessSupervisor.setFactoryForTest(async () => {
      timers.push(setTimeout(() => stdout.write("tick1\n"), 5))
      timers.push(setTimeout(() => stdout.write("tick2\n"), 20))
      timers.push(setTimeout(() => resolveExit(0), 35))
      return {
        pid: 127,
        stdin: null,
        stdout,
        stderr: new PassThrough(),
        exited,
        terminate: async () => {
          terminateCalls++
          resolveExit(1)
        },
        dispose: async () => {},
        unref: () => {},
      }
    })
    try {
      const result = await Shell.run("active", { idleTimeoutMs: 25 })
      expect(result.idleTimedOut).toBe(false)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("tick1")
      expect(result.stdout).toContain("tick2")
      expect(terminateCalls).toBe(0)
    } finally {
      timers.forEach((timer) => clearTimeout(timer))
      restore()
    }
  })

  test("launch uses supervisor pid and unreferences the handle", async () => {
    let unrefCalls = 0
    const stdout = new PassThrough()
    const restore = ProcessSupervisor.setFactoryForTest(async () => {
      queueMicrotask(() => stdout.write("http://127.0.0.1:4321\n"))
      return {
        pid: 125,
        stdin: null,
        stdout,
        stderr: new PassThrough(),
        exited: new Promise<number>(() => {}),
        terminate: async () => {},
        dispose: async () => {},
        unref: () => {
          unrefCalls++
        },
      }
    })
    try {
      const result = await Shell.launch("serve", { outputSniffMs: 1 })
      expect(result.pid).toBe(125)
      expect(result.address).toBe("http://127.0.0.1:4321")
      expect(unrefCalls).toBe(1)
    } finally {
      restore()
    }
  })

  test("shell cleanup no longer invokes taskkill or shell killTree", async () => {
    const shellSource = await Bun.file(new URL("../src/shell/shell.ts", import.meta.url)).text()
    expect(shellSource).not.toContain("taskkill")
    expect(shellSource).not.toContain("killTree")
  })

  test("shell execution call sites no longer reference Shell.killTree", async () => {
    const files = ["../src/tool/bash.ts", "../src/session/shell-exec.ts", "../src/orchestrator/tools.ts"]
    for (const file of files) {
      const source = await Bun.file(new URL(file, import.meta.url)).text()
      expect(source).not.toContain("Shell.killTree")
    }
  })

  test("windows helper absence does not make shell commands unavailable", async () => {
    if (process.platform !== "win32") return
    const restore = ProcessSupervisor.setWindowsHelperResolverForTest(async () => undefined)
    try {
      const result = await Shell.run("echo supervisor-fallback-ok", { timeoutMs: 10_000 })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("supervisor-fallback-ok")
      expect(result.stderr).not.toContain("Windows process supervisor helper is unavailable")
    } finally {
      restore()
    }
  })

  test("windows helper dispose terminates the reported child process tree", async () => {
    if (process.platform !== "win32") return

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-supervisor-test-"))
    const cwd = path.join(root, "cwd")
    const helperCmd = path.join(root, "helper.cmd")
    const helperJs = path.join(root, "helper.js")
    const childJs = path.join(root, "child.js")
    await fs.mkdir(cwd)
    await fs.writeFile(childJs, "setInterval(() => {}, 1000)\n", "utf8")
    await fs.writeFile(
      helperJs,
      [
        'const fs = require("fs")',
        'const path = require("path")',
        'const { spawn } = require("child_process")',
        'const requestIndex = process.argv.indexOf("--request")',
        "if (requestIndex < 0) process.exit(2)",
        'const request = JSON.parse(fs.readFileSync(process.argv[requestIndex + 1], "utf8"))',
        'const child = spawn(process.execPath, [path.join(__dirname, "child.js")], {',
        "  cwd: request.cwd,",
        '  stdio: "ignore",',
        "  windowsHide: true,",
        "})",
        "child.unref()",
        'fs.writeFileSync(request.pid_file, String(child.pid), "utf8")',
        "setInterval(() => {}, 1000)",
        "",
      ].join("\n"),
      "utf8",
    )
    await fs.writeFile(helperCmd, `@echo off\r\n"${process.execPath}" "${helperJs}" %*\r\n`, "utf8")

    let childPid: number | undefined
    const restore = ProcessSupervisor.setWindowsHelperResolverForTest(async () => helperCmd)
    try {
      const handle = await ProcessSupervisor.spawnShell({
        command: "ignored-by-fake-helper",
        shell: process.env.COMSPEC ?? "cmd.exe",
        cwd,
      })
      childPid = handle.pid
      expect(isProcessRunning(childPid)).toBe(true)

      await handle.dispose()

      expect(await waitForProcessExit(childPid)).toBe(true)
    } finally {
      restore()
      killProcessTreeForTest(childPid)
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 20_000)
})
