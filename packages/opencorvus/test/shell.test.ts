import { describe, expect, test } from "bun:test"
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

function killProcessForTest(pid: number | undefined) {
  if (!pid || !isProcessRunning(pid)) return
  process.kill(pid, "SIGKILL")
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

  test("run timeout fails when supervised cleanup completes without process exit", async () => {
    let terminateCalls = 0
    let disposeCalls = 0
    const keepAlive = setInterval(() => {}, 10)
    const restore = ProcessSupervisor.setFactoryForTest(async () => ({
      pid: 129,
      stdin: null,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exited: new Promise<number>(() => {}),
      terminate: async () => {
        terminateCalls++
        clearInterval(keepAlive)
      },
      dispose: async () => {
        disposeCalls++
      },
      unref: () => {},
    }))
    try {
      await expect(Shell.run("stubborn", { timeoutMs: 1 })).rejects.toThrow(
        "cleanup completed but process did not exit",
      )
      expect(terminateCalls).toBe(1)
      expect(disposeCalls).toBe(1)
    } finally {
      clearInterval(keepAlive)
      restore()
    }
  })

  test("run timeout reports supervised cleanup failures", async () => {
    const keepAlive = setInterval(() => {}, 10)
    const restore = ProcessSupervisor.setFactoryForTest(async () => ({
      pid: 130,
      stdin: null,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exited: new Promise<number>(() => {}),
      terminate: async () => {
        clearInterval(keepAlive)
        throw new Error("synthetic terminate failure")
      },
      dispose: async () => {},
      unref: () => {},
    }))
    try {
      await expect(Shell.run("cleanup-fails", { timeoutMs: 1 })).rejects.toThrow("synthetic terminate failure")
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

  test("disposes live supervised handles under a workspace without touching siblings", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-supervisor-live-"))
    const workspace = path.join(root, "worktree")
    const nested = path.join(workspace, "src")
    const sibling = path.join(root, "sibling")
    await fs.mkdir(nested, { recursive: true })
    await fs.mkdir(sibling, { recursive: true })

    const disposed: number[] = []
    let nextPid = 12_000
    const restore = ProcessSupervisor.setFactoryForTest(async () => {
      const handlePid = nextPid++
      let handleDisposed = false
      return {
        pid: handlePid,
        stdin: null,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exited: new Promise<number>(() => {}),
        terminate: async () => {},
        dispose: async () => {
          if (handleDisposed) return
          handleDisposed = true
          disposed.push(handlePid)
        },
        unref: () => {},
      }
    })

    let workspaceHandle: ProcessSupervisor.Handle | undefined
    let nestedHandle: ProcessSupervisor.Handle | undefined
    let siblingHandle: ProcessSupervisor.Handle | undefined
    try {
      workspaceHandle = await ProcessSupervisor.spawnShell({ command: "serve", shell: "sh", cwd: workspace })
      nestedHandle = await ProcessSupervisor.spawnShell({ command: "serve", shell: "sh", cwd: nested })
      siblingHandle = await ProcessSupervisor.spawnShell({ command: "serve", shell: "sh", cwd: sibling })

      const result = await ProcessSupervisor.disposeLiveProcessesUnder(workspace)

      expect(result.disposed).toBe(2)
      const expectedPids = [workspaceHandle.pid, nestedHandle.pid].sort((a, b) => a - b)
      expect([...result.pids].sort((a, b) => a - b)).toEqual(expectedPids)
      expect([...disposed].sort((a, b) => a - b)).toEqual(expectedPids)
      expect(disposed).not.toContain(siblingHandle.pid)
    } finally {
      await workspaceHandle?.dispose().catch(() => {})
      await nestedHandle?.dispose().catch(() => {})
      await siblingHandle?.dispose().catch(() => {})
      restore()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("disposes supervised handles under a workspace after the root process exits", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-supervisor-exited-live-"))
    const workspace = path.join(root, "worktree")
    await fs.mkdir(workspace, { recursive: true })

    let disposed = 0
    const restore = ProcessSupervisor.setFactoryForTest(async () => ({
      pid: 13_000,
      stdin: null,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exited: Promise.resolve(0),
      terminate: async () => {},
      dispose: async () => {
        disposed++
      },
      unref: () => {},
    }))

    let handle: ProcessSupervisor.Handle | undefined
    try {
      handle = await ProcessSupervisor.spawnShell({ command: "serve", shell: "sh", cwd: workspace })
      await handle.exited
      await Bun.sleep(0)

      const result = await ProcessSupervisor.disposeLiveProcessesUnder(workspace)

      expect(result.disposed).toBe(1)
      expect(result.pids).toEqual([handle.pid])
      expect(disposed).toBe(1)
    } finally {
      await handle?.dispose().catch(() => {})
      restore()
      await fs.rm(root, { recursive: true, force: true })
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

  test("windows shell supervisor does not keep a root-only helper-missing path", async () => {
    const supervisorSource = await Bun.file(new URL("../src/shell/process-supervisor.ts", import.meta.url)).text()
    const shellSource = await Bun.file(new URL("../src/shell/shell.ts", import.meta.url)).text()
    expect(supervisorSource).not.toContain("spawnWindowsManagedShell")
    expect(supervisorSource).not.toContain("return spawnWindowsManagedShell")
    expect(shellSource).toContain("requireProcessTreeCleanup: true")
  })

  test("windows helper absence rejects foreground shell commands instead of downgrading cleanup", async () => {
    if (process.platform !== "win32") return
    const restore = ProcessSupervisor.setWindowsHelperResolverForTest(async () => undefined)
    try {
      await expect(Shell.run("echo missing-foreground-helper", { timeoutMs: 10_000 })).rejects.toThrow(
        "Windows process supervisor helper is required for process-tree cleanup",
      )
    } finally {
      restore()
    }
  })

  test("windows helper absence rejects background launch that requires process-tree cleanup", async () => {
    if (process.platform !== "win32") return
    const restore = ProcessSupervisor.setWindowsHelperResolverForTest(async () => undefined)
    try {
      await expect(Shell.launch("echo missing-background-helper", { outputSniffMs: 1, leaseMs: 1 })).rejects.toThrow(
        "Windows process supervisor helper is required for process-tree cleanup",
      )
    } finally {
      restore()
    }
  })

  test("windows helper startup failure removes the request directory", async () => {
    if (process.platform !== "win32") return

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-supervisor-startup-failure-"))
    const helperCmd = path.join(root, "helper.cmd")
    const helperJs = path.join(root, "helper.js")
    const requestPathRecord = path.join(root, "request-path.txt")
    await fs.writeFile(
      helperJs,
      [
        'const fs = require("fs")',
        'const requestIndex = process.argv.indexOf("--request")',
        "if (requestIndex < 0) process.exit(2)",
        `fs.writeFileSync(${JSON.stringify(requestPathRecord)}, process.argv[requestIndex + 1], "utf8")`,
        "process.exit(3)",
        "",
      ].join("\n"),
      "utf8",
    )
    await fs.writeFile(helperCmd, `@echo off\r\n"${process.execPath}" "${helperJs}" %*\r\n`, "utf8")

    const restore = ProcessSupervisor.setWindowsHelperResolverForTest(async () => helperCmd)
    try {
      await expect(
        ProcessSupervisor.spawnShell({
          command: "helper-exits-before-pid",
          shell: process.env.COMSPEC ?? "cmd.exe",
          cwd: root,
        }),
      ).rejects.toThrow("Windows process supervisor exited before starting command")
      const requestPath = await fs.readFile(requestPathRecord, "utf8")
      await expect(fs.stat(path.dirname(requestPath))).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      restore()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("windows supervised request cleanup uses helper job ownership instead of reported pid kill-tree", async () => {
    const supervisorSource = await Bun.file(new URL("../src/shell/process-supervisor.ts", import.meta.url)).text()
    expect(supervisorSource).toContain("await helperHandle.terminate()")
    expect(supervisorSource).not.toContain("Windows supervised process tree")
    expect(supervisorSource).not.toContain("await terminateProcessTree(pid")
  })

  test("windows helper command mode launches executable args without shell command", async () => {
    if (process.platform !== "win32") return

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-supervisor-command-"))
    const cwd = path.join(root, "cwd")
    const helperCmd = path.join(root, "helper.cmd")
    const helperJs = path.join(root, "helper.js")
    const childJs = path.join(root, "child.js")
    const requestRecord = path.join(root, "request.json")
    await fs.mkdir(cwd)
    await fs.writeFile(childJs, "process.exit(7)\n", "utf8")
    await fs.writeFile(
      helperJs,
      [
        'const fs = require("fs")',
        'const { spawn } = require("child_process")',
        'if (process.argv[2] === "--kill-tree") process.exit(11)',
        'const requestIndex = process.argv.indexOf("--request")',
        "if (requestIndex < 0) process.exit(2)",
        'const request = JSON.parse(fs.readFileSync(process.argv[requestIndex + 1], "utf8"))',
        `fs.writeFileSync(${JSON.stringify(requestRecord)}, JSON.stringify(request), "utf8")`,
        "if (request.kind !== 'command') process.exit(3)",
        "if (Object.prototype.hasOwnProperty.call(request, 'command')) process.exit(4)",
        "if (Object.prototype.hasOwnProperty.call(request, 'shell')) process.exit(5)",
        "const child = spawn(request.executable, request.args, {",
        "  cwd: request.cwd,",
        '  stdio: ["ignore", "inherit", "inherit"],',
        "  windowsHide: true,",
        "})",
        'fs.writeFileSync(request.pid_file, String(child.pid), "utf8")',
        "child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))",
        "",
      ].join("\n"),
      "utf8",
    )
    await fs.writeFile(helperCmd, `@echo off\r\n"${process.execPath}" "${helperJs}" %*\r\n`, "utf8")

    const restore = ProcessSupervisor.setWindowsHelperResolverForTest(async () => helperCmd)
    try {
      const handle = await ProcessSupervisor.spawnCommand({
        executable: process.execPath,
        args: [childJs],
        cwd,
      })
      expect(await handle.exited).toBe(7)
      await handle.dispose()
      const request = JSON.parse(await fs.readFile(requestRecord, "utf8")) as {
        kind: string
        executable: string
        args: string[]
        cwd: string
      }
      expect(request.kind).toBe("command")
      expect(request.executable).toBe(process.execPath)
      expect(request.args).toEqual([childJs])
      expect(request.cwd).toBe(cwd)
    } finally {
      restore()
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 20_000)

  test("windows helper command mode resolves bare executables before the helper request", async () => {
    if (process.platform !== "win32") return

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-supervisor-command-path-"))
    const cwd = path.join(root, "cwd")
    const helperCmd = path.join(root, "helper.cmd")
    const helperJs = path.join(root, "helper.js")
    const childJs = path.join(root, "child.js")
    const requestRecord = path.join(root, "request.json")
    await fs.mkdir(cwd)
    await fs.writeFile(childJs, "process.exit(9)\n", "utf8")
    await fs.writeFile(
      helperJs,
      [
        'const fs = require("fs")',
        'const { spawn } = require("child_process")',
        'if (process.argv[2] === "--kill-tree") process.exit(11)',
        'const requestIndex = process.argv.indexOf("--request")',
        "if (requestIndex < 0) process.exit(2)",
        'const request = JSON.parse(fs.readFileSync(process.argv[requestIndex + 1], "utf8"))',
        `fs.writeFileSync(${JSON.stringify(requestRecord)}, JSON.stringify(request), "utf8")`,
        "if (request.kind !== 'command') process.exit(3)",
        "const child = spawn(request.executable, request.args, {",
        "  cwd: request.cwd,",
        "  env: request.env,",
        '  stdio: ["ignore", "inherit", "inherit"],',
        "  windowsHide: true,",
        "})",
        'fs.writeFileSync(request.pid_file, String(child.pid), "utf8")',
        "child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))",
        "",
      ].join("\n"),
      "utf8",
    )
    await fs.writeFile(helperCmd, `@echo off\r\n"${process.execPath}" "${helperJs}" %*\r\n`, "utf8")

    const executableDir = path.dirname(process.execPath)
    const restore = ProcessSupervisor.setWindowsHelperResolverForTest(async () => helperCmd)
    try {
      const handle = await ProcessSupervisor.spawnCommand({
        executable: path.basename(process.execPath),
        args: [childJs],
        cwd,
        env: {
          ...process.env,
          PATH: executableDir,
          Path: executableDir,
        },
      })
      expect(await handle.exited).toBe(9)
      await handle.dispose()
      const request = JSON.parse(await fs.readFile(requestRecord, "utf8")) as {
        kind: string
        executable: string
        args: string[]
        cwd: string
      }
      expect(request.kind).toBe("command")
      expect(request.executable).toBe(process.execPath)
      expect(request.args).toEqual([childJs])
      expect(request.cwd).toBe(cwd)
    } finally {
      restore()
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 20_000)

  test("windows helper command mode waits briefly for pid files after fast helper exit", async () => {
    if (process.platform !== "win32") return

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-supervisor-command-pid-race-"))
    const helperCmd = path.join(root, "helper.cmd")
    const helperJs = path.join(root, "helper.js")
    const writerJs = path.join(root, "writer.js")
    await fs.writeFile(
      writerJs,
      [
        'const fs = require("fs")',
        "setTimeout(() => {",
        "  fs.writeFileSync(process.argv[2], String(process.pid), 'utf8')",
        "}, 100)",
        "",
      ].join("\n"),
      "utf8",
    )
    await fs.writeFile(
      helperJs,
      [
        'const { spawn } = require("child_process")',
        'const fs = require("fs")',
        'if (process.argv[2] === "--kill-tree") process.exit(0)',
        'const requestIndex = process.argv.indexOf("--request")',
        "if (requestIndex < 0) process.exit(2)",
        'const request = JSON.parse(fs.readFileSync(process.argv[requestIndex + 1], "utf8"))',
        `const writer = spawn(${JSON.stringify(process.execPath)}, [${JSON.stringify(writerJs)}, request.pid_file], {`,
        "  detached: true,",
        "  stdio: 'ignore',",
        "  windowsHide: true,",
        "})",
        "writer.unref()",
        "process.exit(7)",
        "",
      ].join("\n"),
      "utf8",
    )
    await fs.writeFile(helperCmd, `@echo off\r\n"${process.execPath}" "${helperJs}" %*\r\n`, "utf8")

    const restore = ProcessSupervisor.setWindowsHelperResolverForTest(async () => helperCmd)
    try {
      const handle = await ProcessSupervisor.spawnCommand({
        executable: process.execPath,
        args: ["--version"],
      })
      expect(handle.pid).toBeGreaterThan(0)
      expect(await handle.exited).toBe(7)
      await handle.dispose()
    } finally {
      restore()
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 20_000)
})
