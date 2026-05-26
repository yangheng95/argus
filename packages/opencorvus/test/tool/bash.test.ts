import { afterEach, describe, expect, mock, test } from "bun:test"
import os from "os"
import path from "path"
import { PassThrough } from "stream"
import { BashTool, DEFAULT_TIMEOUT, disposeSyntaxTree } from "../../src/tool/bash"
import { DEFAULT_BASH_TIMEOUT_MS } from "../../src/shell/timeout"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"
import { Truncate } from "../../src/tool/truncation"
import { Agent } from "../../src/agent/agent"
import { ProcessSupervisor } from "../../src/shell/process-supervisor"

const ctx = {
  sessionID: "ses_test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  extra: {
    taskID: "task_test",
  },
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

const projectRoot = path.join(__dirname, "../..")

afterEach(() => {
  mock.restore()
})

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForPidExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true
    await Bun.sleep(100)
  }
  return !isPidAlive(pid)
}

describe("tool.bash", () => {
  test("disposes parser syntax trees after extracting permission metadata", () => {
    let disposed = false

    disposeSyntaxTree({
      delete() {
        disposed = true
      },
    })

    expect(disposed).toBe(true)
    expect(() => disposeSyntaxTree({})).not.toThrow()
  })

  test("basic", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo 'test'",
            description: "Echo test message",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })

  test("description names the actual shell and avoids POSIX-only chaining guidance", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        expect(bash.description).toContain("The current shell is")
        expect(bash.description).not.toContain("use a single Bash call with '&&'")
        expect(bash.description).toContain("prefer separate terminal tool calls")
        expect(bash.description).toContain("run the command directly or use the test runner's own concise reporter")
      },
    })
  })

  test("defaults commands and background leases to two minutes", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        expect(DEFAULT_BASH_TIMEOUT_MS).toBe(120_000)
        expect(DEFAULT_TIMEOUT).toBe(DEFAULT_BASH_TIMEOUT_MS)
        expect(bash.description).toContain("120000ms (2 minutes)")
        expect(bash.description).toContain("For `background: true`, the same timeout is the process lease")
      },
    })
  })

  test("terminates background process tree when timeout lease expires", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "sleep 30",
            description: "Start sleeping background process",
            background: true,
            timeout: 2_000,
          },
          ctx,
        )
        const pid = result.metadata.pid
        expect(typeof pid).toBe("number")
        expect(result.output).toContain("background process lease timeout: 2000 ms")
        expect(isPidAlive(pid as number)).toBe(true)
        expect(await waitForPidExit(pid as number, 4_000)).toBe(true)
      },
    })
  }, 10_000)

  test("cleans residual process tree after foreground command completes", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let disposeCalls = 0
        const restore = ProcessSupervisor.setFactoryForTest(async () => {
          const stdout = new PassThrough()
          let resolveExit!: (code: number) => void
          const exited = new Promise<number>((resolve) => { resolveExit = resolve })
          queueMicrotask(() => {
            stdout.write("shell-cleanup\n")
            stdout.end()
            setTimeout(() => resolveExit(0), 0)
          })
          return {
            pid: 9001,
            stdout,
            stderr: new PassThrough(),
            exited,
            terminate: async () => {},
            dispose: async () => { disposeCalls++ },
            unref: () => {},
          }
        })
        try {
          const bash = await BashTool.init()
          await bash.execute(
            {
              command: "echo shell-cleanup",
              description: "Echo cleanup marker",
            },
            ctx,
          )
          expect(disposeCalls).toBe(1)
        } finally {
          restore()
        }
      },
    })
  })

  test("background lease survives early shell exit for cleanup", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let disposeCalls = 0
        const restore = ProcessSupervisor.setFactoryForTest(async () => ({
          pid: 9002,
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          exited: Promise.resolve(0),
          terminate: async () => {},
          dispose: async () => { disposeCalls++ },
          unref: () => {},
        }))
        try {
          const bash = await BashTool.init()
          await bash.execute(
            {
              command: "echo background-cleanup",
              description: "Exit quickly in background",
              background: true,
              timeout: 50,
            },
            ctx,
          )
          await Bun.sleep(150)
          expect(disposeCalls).toBe(1)
        } finally {
          restore()
        }
      },
    })
  })
})

describe("tool.bash permissions", () => {
  test("asks for bash permission with correct pattern", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "echo hello",
            description: "Echo hello",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("bash")
        expect(requests[0].patterns).toContain("echo hello")
      },
    })
  })

  test("asks for bash permission with multiple commands", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "echo foo && echo bar",
            description: "Echo twice",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("bash")
        expect(requests[0].patterns).toContain("echo foo")
        expect(requests[0].patterns).toContain("echo bar")
      },
    })
  })

  test("asks for external_directory permission when cd to parent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "cd ../",
            description: "Change to parent directory",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
      },
    })
  })

  test("asks for external_directory permission when workdir is outside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // V31: agent required so Truncate.output can verify recovery
        // path (build agent has the `task` tool). Pre-fix the
        // command's `ls` over os.tmpdir() produced ~2 MB of
        // output and Truncate threw because the test passed no
        // agent.
        const agent = await Agent.get("build")
        const bash = await BashTool.init({ agent })
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "ls",
            workdir: os.tmpdir(),
            description: "List temp dir",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(path.join(os.tmpdir(), "*"))
      },
    })
  })

  // Hard-codes "C:\\Program Files\\Git\\bin\\bash.exe" — fails on dev boxes without that exact path.
  // Path normalization for /c/-prefixed paths also still produces "C:\\c\\Users\\..." duplication.
  test.skip("does not ask for external_directory permission for git bash workdir inside project on windows", async () => {
    if (process.platform !== "win32") return
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        const cwd = `/${tmp.path[0].toLowerCase()}${tmp.path.slice(2).replace(/\\/g, "/")}`
        await bash.execute(
          {
            command: "pwd",
            workdir: cwd,
            description: "Print working directory",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeUndefined()
      },
    })
  })

  test("asks for external_directory permission when file arg is outside project", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "outside.txt"), "x")
      },
    })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        const filepath = path.join(outerTmp.path, "outside.txt")
        await bash.execute(
          {
            command: `cat ${filepath}`,
            description: "Read external file",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        const expected = path.join(outerTmp.path, "*")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(expected)
        expect(extDirReq!.always).toContain(expected)
      },
    })
  })

  // Same Windows /c/ path normalization issue as the workdir variant above.
  test.skip("does not ask for external_directory permission for git bash file path inside project on windows", async () => {
    if (process.platform !== "win32") return
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "inside.txt"), "x")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        const filepath = `/${tmp.path[0].toLowerCase()}${path.join(tmp.path.slice(2), "inside.txt").replace(/\\/g, "/")}`
        await bash.execute(
          {
            command: `cat ${filepath}`,
            description: "Read internal file via git bash path",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeUndefined()
      },
    })
  })

  test("does not ask for external_directory permission when rm inside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }

        await Bun.write(path.join(tmp.path, "tmpfile"), "x")

        await bash.execute(
          {
            command: `rm -rf ${path.join(tmp.path, "nested")}`,
            description: "remove nested dir",
          },
          testCtx,
        )

        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeUndefined()
      },
    })
  })

  test("includes always patterns for persistent approval", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "git log --oneline -5",
            description: "Git log",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].always.length).toBeGreaterThan(0)
        expect(requests[0].always.some((p) => p.endsWith("*"))).toBe(true)
      },
    })
  })

  test("does not ask for bash permission when command is cd only", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "cd .",
            description: "Stay in current directory",
          },
          testCtx,
        )
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeUndefined()
      },
    })
  })

  test("matches redirects in permission pattern", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute({ command: "cat > /tmp/output.txt", description: "Redirect ls output" }, testCtx)
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeDefined()
        expect(bashReq!.patterns).toContain("cat > /tmp/output.txt")
      },
    })
  })

  test("always pattern has space before wildcard to not include different commands", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute({ command: "ls -la", description: "List" }, testCtx)
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeDefined()
        const pattern = bashReq!.always[0]
        expect(pattern).toBe("ls *")
      },
    })
  })
})

describe("tool.bash truncation", () => {
  test("truncates output exceeding line limit", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // audit-2026-04-29 W2-V31 — Truncate.output now requires
        // the calling agent to have either `task` or `read+search_code`
        // tools so a truncated payload can be re-read (no silent
        // info loss, CLAUDE.md rule #1). Pre-fix the test called
        // BashTool.init() without an agent; truncate threw instead
        // of truncating. Pass the build agent (which has `task`).
        const agent = await Agent.get("build")
        const bash = await BashTool.init({ agent })
        const lineCount = Truncate.MAX_LINES + 500
        const result = await bash.execute(
          {
            command: `seq 1 ${lineCount}`,
            description: "Generate lines exceeding limit",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)
        expect(result.output).toContain("truncated")
        expect(result.output).toContain("The tool call succeeded but the output was truncated")
      },
    })
  })

  test("truncates output exceeding byte limit", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const agent = await Agent.get("build")
        const bash = await BashTool.init({ agent })
        const byteCount = Truncate.MAX_BYTES + 10000
        const result = await bash.execute(
          {
            command: `head -c ${byteCount} /dev/zero | tr '\\0' 'a'`,
            description: "Generate bytes exceeding limit",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)
        expect(result.output).toContain("truncated")
        expect(result.output).toContain("The tool call succeeded but the output was truncated")
      },
    })
  })

  test("does not truncate small output", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo hello",
            description: "Echo hello",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(false)
        // MSYS/Git Bash on Windows outputs LF, not CRLF
        expect(result.output.trim()).toBe("hello")
      },
    })
  })

  test("full output is saved to file when truncated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const agent = await Agent.get("build")
        const bash = await BashTool.init({ agent })
        const lineCount = Truncate.MAX_LINES + 100
        const result = await bash.execute(
          {
            command: `seq 1 ${lineCount}`,
            description: "Generate lines for file check",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)

        const filepath = (result.metadata as any).outputPath
        expect(filepath).toBeTruthy()

        const saved = await Filesystem.readText(filepath)
        const lines = saved.trim().split("\n")
        expect(lines.length).toBe(lineCount)
        expect(lines[0]).toBe("1")
        expect(lines[lineCount - 1]).toBe(String(lineCount))
      },
    })
  })
})
