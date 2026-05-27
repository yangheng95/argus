import { describe, expect, test } from "bun:test"
import { PassThrough } from "stream"
import { Shell } from "../src/shell/shell"
import { ProcessSupervisor } from "../src/shell/process-supervisor"

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
      const exited = new Promise<number>((resolve) => { resolveExit = resolve })
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
        dispose: async () => { disposed++ },
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

  test("run timeout terminates and disposes supervisor once", async () => {
    let terminateCalls = 0
    let disposeCalls = 0
    let resolveExit!: (code: number) => void
    const exited = new Promise<number>((resolve) => { resolveExit = resolve })
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
      dispose: async () => { disposeCalls++ },
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
        unref: () => { unrefCalls++ },
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
    const files = [
      "../src/tool/bash.ts",
      "../src/session/shell-exec.ts",
      "../src/orchestrator/tools.ts",
    ]
    for (const file of files) {
      const source = await Bun.file(new URL(file, import.meta.url)).text()
      expect(source).not.toContain("Shell.killTree")
    }
  })

  test("delivery run_command no longer gives taskkill cleanup guidance", async () => {
    const source = await Bun.file(new URL("../src/delivery/tools.ts", import.meta.url)).text()
    expect(source).not.toContain("taskkill /F /T /PID")
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
})
