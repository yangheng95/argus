import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { ExecutorBootstrap } from "../../src/executor/bootstrap"
import { ExecutorDiscovery } from "../../src/executor/discovery"
import { CodexAppServerClientProcess } from "../../src/executor/codex-app-server-client"
import { ExecutorRegistry } from "../../src/executor/registry"
import { Instance } from "../../src/project/instance"
import { MCPServe } from "../../src/mcp/serve"
import { EngineConfig } from "../../src/engine/config"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

describe("executor.bootstrap", () => {
  afterEach(() => {
    mock.restore()
    ExecutorRegistry.reset()
  })

  test("injects OpenCorvus MCP config into codex app-server via -c flags", async () => {
    const seen: Array<{ command: string[]; requestIdleMs: number }> = []
    spyOn(EngineConfig, "get").mockResolvedValue({
      ...EngineConfig.defaults,
      activity: {
        ...EngineConfig.defaults.activity,
        executor_events_idle_ms: 12_345,
      },
    })
    spyOn(ExecutorDiscovery, "scan").mockResolvedValue({
      opencorvus: {
        name: "opencorvus",
        available: true,
        source: "builtin",
        detail: "builtin",
      },
      codex: {
        name: "codex",
        available: true,
        source: "path",
        command: ["codex"],
        path: "codex",
        version: "test",
        detail: "codex",
      },
      "claude-code": {
        name: "claude-code",
        available: false,
        source: "missing",
        detail: "missing",
      },
    })
    const mcpCommand = "C:\\Program Files\\OpenCorvus\\opencorvus.exe"
    spyOn(MCPServe, "command").mockReturnValue({
      name: "opencorvus",
      command: mcpCommand,
      args: ["mcp", "serve", "--cwd", "D:\\repo\\worktree", "--toolset", "executor"],
    })
    spyOn(MCPServe, "toolDefinitions").mockResolvedValue([
      {
        name: "memory",
        description: "Memory",
        inputSchema: { type: "object", properties: {} },
        metadata: { surface: "mcp" },
      },
      {
        name: "fixture_magic_lookup",
        description: "Fixture lookup",
        inputSchema: { type: "object", properties: {} },
        metadata: { surface: "mcp" },
      },
    ])
    spyOn(CodexAppServerClientProcess, "create").mockImplementation((input) => {
      seen.push({ command: input.command, requestIdleMs: input.requestIdleMs })
      return {
        async initialize() {
          return {}
        },
        async threadStart() {
          return {
            thread: {
              id: "thr_bootstrap",
            },
          }
        },
        async threadResume() {
          return {
            thread: {
              id: "thr_bootstrap",
            },
          }
        },
        async turnStart() {
          return {
            turn: {
              id: "turn_bootstrap",
            },
          }
        },
        async turnInterrupt() {
          return true
        },
        async *events() {
          yield {
            type: "notification" as const,
            method: "turn/completed",
            params: {
              threadId: "thr_bootstrap",
              turn: {
                id: "turn_bootstrap",
                items: [],
                status: "completed",
                error: null,
              },
            },
          }
        },
      }
    })

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ExecutorBootstrap.autoRegister(true)
        const executor = ExecutorRegistry.require("codex")
        await executor.generatePlanning?.({
          stage: "spec",
          prompt: "spec",
          outputSchema: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
            },
          },
        })
        const session = await Session.create({ kind: "assistant", title: "codex bootstrap runtime env" })
        const submitted = await executor.submit({
          sessionID: session.id,
          prompt: "run",
          taskID: "tsk_bootstrap",
          runtimeDir: "C:\\runtime\\dir",
          worktreeDir: "D:\\repo\\worktree",
        })
        await waitForCompleted(executor, submitted.queueTaskID)
      },
    })

    const cmd = seen[0]?.command ?? []
    const runCmd = seen[1]?.command ?? []
    expect(cmd).toContain("app-server")
    expect(cmd).toContain("-c")
    expect(cmd).toContain(`mcp_servers.opencorvus.command=${JSON.stringify(mcpCommand)}`)
    expect(cmd.some((item) => item.includes("mcp_servers.opencorvus.args"))).toBe(true)
    expect(cmd).toContain(`mcp_servers.opencorvus.env={}`)
    const runEnv = runCmd.find((item) => item.startsWith("mcp_servers.opencorvus.env=")) ?? ""
    expect(runEnv).toContain(`"OPENCORVUS_RUNTIME_DIR" = "C:\\\\runtime\\\\dir"`)
    expect(runEnv).toContain(`"OPENCORVUS_SESSION_ID" = "ses_`)
    expect(runEnv).toContain(`"OPENCORVUS_TASK_ID" = "tsk_bootstrap"`)
    expect(runEnv).toContain(`"OPENCORVUS_WORKTREE_DIR" = "D:\\\\repo\\\\worktree"`)
    // Full-permission overrides — the app-server ignores
    // --dangerously-bypass-approvals-and-sandbox, so config keys are the
    // only authoritative path. Without these, sandbox stays workspace-write
    // and our own MCP server hits per-call approval popups.
    expect(cmd).toContain('sandbox_mode="danger-full-access"')
    expect(cmd).toContain('approval_policy="never"')
    expect(cmd).toContain('mcp_servers.opencorvus.enabled_tools=["fixture_magic_lookup", "memory"]')
    expect(cmd).toContain('mcp_servers.opencorvus.default_tools_approval_mode="approve"')
    expect(cmd.includes("--dangerously-bypass-approvals-and-sandbox")).toBe(false)
    expect(seen[0]?.requestIdleMs).toBe(12_345)
  })

  test("does not override an executor that is already registered", async () => {
    spyOn(ExecutorDiscovery, "scan").mockResolvedValue({
      opencorvus: {
        name: "opencorvus",
        available: true,
        source: "builtin",
        detail: "builtin",
      },
      codex: {
        name: "codex",
        available: true,
        source: "path",
        command: ["codex"],
        path: "codex",
        version: "test",
        detail: "codex",
      },
      "claude-code": {
        name: "claude-code",
        available: false,
        source: "missing",
        detail: "missing",
      },
    })
    const custom = {
      capabilities() {
        return {
          submit: true,
          status: true,
          abort: true,
          acceptance: true,
          resume: true,
          events: true,
        }
      },
      async submit(input: { sessionID: string }) {
        return {
          sessionID: input.sessionID,
          queueTaskID: "task_custom",
        }
      },
      async status(queueTaskID: string) {
        return {
          queueTaskID,
          status: "queued" as const,
          error: null,
        }
      },
      async abort() {
        return true
      },
      async acceptance() {
        return {
          summary: "",
          diffs: [],
        }
      },
      async resume(input: { sessionID: string }) {
        return {
          sessionID: input.sessionID,
          queueTaskID: "task_custom",
        }
      },
      async *events() {},
      planningCapabilities() {
        return {
          spec: true,
          plan: true,
        }
      },
      async generatePlanning() {
        return {
          output: "{}",
        }
      },
    }
    ExecutorRegistry.register("codex", custom)
    const create = spyOn(CodexAppServerClientProcess, "create")

    await ExecutorBootstrap.autoRegister(true)

    expect(ExecutorRegistry.require("codex")).toBe(custom)
    expect(create).not.toHaveBeenCalled()
  })
})

async function waitForCompleted(executor: ReturnType<typeof ExecutorRegistry.require>, queueTaskID: string) {
  for (let index = 0; index < 50; index++) {
    const status = await executor.status(queueTaskID)
    if (status.status === "completed") return
    await Bun.sleep(10)
  }
  expect(await executor.status(queueTaskID)).toMatchObject({ status: "completed" })
}
