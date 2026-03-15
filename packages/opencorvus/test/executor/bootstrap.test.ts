import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { ExecutorBootstrap } from "../../src/executor/bootstrap"
import { ExecutorDiscovery } from "../../src/executor/discovery"
import { CodexAppServerClientProcess } from "../../src/executor/codex-app-server-client"
import { ExecutorRegistry } from "../../src/executor/registry"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("executor.bootstrap", () => {
  afterEach(() => {
    mock.restore()
    ExecutorRegistry.reset()
  })

  test("injects OpenCorvus MCP config into codex app-server via -c flags", async () => {
    const seen: Array<{ command: string[] }> = []
    spyOn(ExecutorDiscovery, "scan").mockResolvedValue({
      opencode: {
        name: "opencode",
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
    spyOn(CodexAppServerClientProcess, "create").mockImplementation((input) => {
      seen.push({ command: input.command })
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
      },
    })

    const cmd = seen[0]?.command ?? []
    expect(cmd).toContain("app-server")
    expect(cmd).toContain("-c")
    expect(cmd.some((item) => item === 'mcp_servers.opencorvus.command="bun"' || item.includes("mcp_servers.opencorvus.command"))).toBe(true)
    expect(cmd.some((item) => item.includes("mcp_servers.opencorvus.args"))).toBe(true)
  })

  test("does not override an executor that is already registered", async () => {
    spyOn(ExecutorDiscovery, "scan").mockResolvedValue({
      opencode: {
        name: "opencode",
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
          delivery: true,
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
      async delivery() {
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
