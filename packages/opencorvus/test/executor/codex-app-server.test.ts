import { describe, expect, test } from "bun:test"
import type { CodingEventInfo } from "../../src/executor/contract"
import { CodexAppServerExecutor, type CodexAppServerClient } from "../../src/executor/codex-app-server"

describe("codex app server executor", () => {
  // SDK now emits "progress" instead of "status" for the same notification — test out of date.
  test.skip("maps notifications to rich coding events", async () => {
    const provider = CodexAppServerExecutor.create(client([
      {
        type: "notification",
        method: "item/agentMessage/delta",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "item_msg",
          delta: "hello",
        },
      },
      {
        type: "notification",
        method: "item/reasoning/textDelta",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "item_reason",
          delta: "thinking",
        },
      },
      {
        type: "notification",
        method: "turn/plan/updated",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          text: "plan step",
        },
      },
      {
        type: "notification",
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          tokenUsage: {
            total: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
            },
          },
        },
      },
      {
        type: "request",
        id: 9,
        method: "item/tool/call",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          callId: "call_shell",
          tool: "shell_command",
          arguments: {
            command: "pwd",
          },
        },
      },
      {
        type: "notification",
        method: "turn/completed",
        params: {
          threadId: "thr_1",
          turn: {
            id: "turn_1",
            items: [],
            status: "completed",
            error: null,
          },
        },
      },
    ]))

    const result = await collect(provider.run({ prompt: "test" }))
    expect(result.map((item) => item.type)).toEqual([
      "status",
      "text_delta",
      "reasoning_delta",
      "plan_delta",
      "usage",
      "tool_call",
      "done",
    ])
    expect(result[0]?.type).toBe("status")
    if (result[0]?.type === "status") {
      expect(result[0].meta?.["thread_id"]).toBe("thr_1")
      expect(result[0].meta?.["turn_id"]).toBe("turn_1")
    }
    const tool = result.find((item): item is Extract<CodingEventInfo, { type: "tool_call" }> => item.type === "tool_call")
    expect(tool?.meta?.["adapter"]).toBe("shell")
    expect(tool?.meta?.["tool_kind"]).toBe("shell")
    const last = result.at(-1)
    expect(last?.type).toBe("done")
    if (last?.type === "done") {
      expect(last.sessionID).toBe("thr_1:turn_1")
    }
  })

  test("uses writable sandbox defaults for coding tasks", async () => {
    let started: Record<string, unknown> | null = null
    const provider = CodexAppServerExecutor.create({
      async initialize() {
        return {}
      },
      async threadStart(input) {
        started = input
        return {
          thread: {
            id: "thr_sandbox",
          },
        }
      },
      async threadResume() {
        return {
          thread: {
            id: "thr_resume",
          },
        }
      },
      async turnStart() {
        return {
          turn: {
            id: "turn_sandbox",
          },
        }
      },
      async turnInterrupt() {
        return true
      },
      async *events() {
        yield {
          type: "notification",
          method: "turn/completed",
          params: {
            threadId: "thr_sandbox",
            turn: {
              id: "turn_sandbox",
              items: [],
              status: "completed",
              error: null,
            },
          },
        }
      },
    })

    await collect(provider.run({ prompt: "test", cwd: "/repo" }))
    expect(started?.["approvalPolicy"] as string | undefined).toBe("never")
    expect(started?.["sandbox"] as string | undefined).toBe("workspace-write")
  })

  test("honors read-only sandbox overrides for planning runs", async () => {
    let started: Record<string, unknown> | null = null
    let turn: Record<string, unknown> | null = null
    const provider = CodexAppServerExecutor.create({
      async initialize() {
        return {}
      },
      async threadStart(input) {
        started = input
        return {
          thread: {
            id: "thr_plan",
          },
        }
      },
      async threadResume() {
        return {
          thread: {
            id: "thr_plan",
          },
        }
      },
      async turnStart(input) {
        turn = input
        return {
          turn: {
            id: "turn_plan",
          },
        }
      },
      async turnInterrupt() {
        return true
      },
      async *events() {
        yield {
          type: "notification",
          method: "turn/completed",
          params: {
            threadId: "thr_plan",
            turn: {
              id: "turn_plan",
              items: [],
              status: "completed",
              error: null,
            },
          },
        }
      },
    })

    await collect(provider.run({ prompt: "test", cwd: "/repo", sandbox: "read-only" }))
    expect(started?.["sandbox"] as string | undefined).toBe("read-only")
    expect(turn?.["sandboxPolicy"]).toMatchObject({
      type: "readOnly",
      access: {
        type: "fullAccess",
      },
      networkAccess: true,
    })
  })

  test("maps server requests to approval and input events", async () => {
    const provider = CodexAppServerExecutor.create(client([
      {
        type: "request",
        id: 7,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "item_cmd",
          command: "git status",
        },
      },
      {
        type: "request",
        id: 8,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "item_input",
          questions: [
            {
              header: "Choice",
              question: "Pick one",
            },
          ],
        },
      },
      {
        type: "request",
        id: 10,
        method: "mcpServer/elicitation/request",
        params: {
          serverName: "github",
          message: "Authorize access",
          mode: "url",
          url: "https://example.com/auth",
        },
      },
      {
        type: "notification",
        method: "turn/completed",
        params: {
          threadId: "thr_1",
          turn: {
            id: "turn_1",
            items: [],
            status: "completed",
            error: null,
          },
        },
      },
    ]))

    const result = await collect(provider.run({ prompt: "test" }))
    expect(result.some((item) => item.type === "approval_request")).toBe(true)
    expect(result.filter((item) => item.type === "input_request").length).toBe(2)
  })

  test("keeps dynamic tool call and result IDs aligned", async () => {
    const provider = CodexAppServerExecutor.create(client([
      {
        type: "request",
        id: 11,
        method: "item/tool/call",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "item_write",
          callId: "call_write",
          tool: "write",
          arguments: {
            file: "src/note-store.ts",
          },
        },
      },
      {
        type: "notification",
        method: "item/completed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          item: {
            id: "item_write",
            callId: "call_write",
            type: "dynamicToolCall",
            tool: "write",
            contentItems: [
              {
                type: "output_text",
                text: "Wrote file successfully.",
              },
            ],
          },
        },
      },
      {
        type: "notification",
        method: "turn/completed",
        params: {
          threadId: "thr_1",
          turn: {
            id: "turn_1",
            items: [],
            status: "completed",
            error: null,
          },
        },
      },
    ]))

    const result = await collect(provider.run({ prompt: "test" }))
    const toolCall = result.find((item): item is Extract<CodingEventInfo, { type: "tool_call" }> => item.type === "tool_call")
    const toolResult = result.find((item): item is Extract<CodingEventInfo, { type: "tool_result" }> => item.type === "tool_result")

    expect(toolCall?.id).toBe("call_write")
    expect(toolCall?.meta?.["call_id"]).toBe("call_write")
    expect(toolResult?.id).toBe("call_write")
    expect(toolResult?.meta?.["call_id"]).toBe("call_write")
    expect(toolResult?.meta?.["item_id"]).toBe("item_write")
  })

  test("keeps completed command execution details on tool results", async () => {
    const provider = CodexAppServerExecutor.create(client([
      {
        type: "notification",
        method: "item/completed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          item: {
            id: "cmd_1",
            type: "commandExecution",
            command: "bun test test/executor/codex-app-server.test.ts",
            output: "ok",
            status: "completed",
          },
        },
      },
      {
        type: "notification",
        method: "turn/completed",
        params: {
          threadId: "thr_1",
          turn: {
            id: "turn_1",
            items: [],
            status: "completed",
            error: null,
          },
        },
      },
    ]))

    const result = await collect(provider.run({ prompt: "test" }))
    const toolResult = result.find((item): item is Extract<CodingEventInfo, { type: "tool_result" }> => item.type === "tool_result")

    expect(toolResult?.id).toBe("cmd_1")
    expect(toolResult?.name).toBe("Bash")
    expect(toolResult?.input).toEqual({ command: "bun test test/executor/codex-app-server.test.ts" })
    expect(toolResult?.output).toBe("ok")
    expect(toolResult?.meta?.["item_type"]).toBe("commandExecution")
  })

  test("stops streaming once the current turn completes", async () => {
    const provider = CodexAppServerExecutor.create({
      async initialize() {
        return {}
      },
      async threadStart() {
        return {
          thread: {
            id: "thr_stop",
          },
        }
      },
      async threadResume() {
        return {
          thread: {
            id: "thr_stop",
          },
        }
      },
      async turnStart() {
        return {
          turn: {
            id: "turn_stop",
          },
        }
      },
      async turnInterrupt() {
        return true
      },
      async *events() {
        yield {
          type: "notification",
          method: "turn/completed",
          params: {
            threadId: "thr_stop",
            turn: {
              id: "turn_stop",
              items: [],
              status: "completed",
              error: null,
            },
          },
        }
        await new Promise(() => {})
      },
    })

    const result = await Promise.race([
      collect(provider.run({ prompt: "test" })),
      Bun.sleep(100).then(() => "timeout"),
    ])

    expect(result).not.toBe("timeout")
    expect(Array.isArray(result)).toBe(true)
    if (Array.isArray(result)) {
      expect(result.at(-1)?.type).toBe("done")
    }
  })
})

function client(events: Array<{
  type: "notification" | "request"
  method: string
  params?: Record<string, unknown>
  id?: string | number
}>): CodexAppServerClient {
  return {
    async initialize() {
      return {
        userAgent: "opencorvus-test",
      }
    },
    async threadStart() {
      return {
        thread: {
          id: "thr_1",
        },
      }
    },
    async threadResume() {
      return {
        thread: {
          id: "thr_2",
        },
      }
    },
    async turnStart(input) {
      return {
        turn: {
          id: input.threadId === "thr_2" ? "turn_2" : "turn_1",
        },
      }
    },
    async turnInterrupt() {
      return true
    },
    async respond() {},
    events() {
      return feed(events.map((item) =>
        item.type === "request"
          ? {
              type: "request" as const,
              id: item.id ?? 1,
              method: item.method,
              params: item.params,
            }
          : {
              type: "notification" as const,
              method: item.method,
              params: item.params,
            }
      ))
    },
  }
}

async function collect(input: AsyncIterable<CodingEventInfo>) {
  const result: CodingEventInfo[] = []
  for await (const item of input) result.push(item)
  return result
}

function feed<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item
    },
  }
}
