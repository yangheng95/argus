import { describe, expect, test } from "bun:test"
import type { CodingEventInfo } from "../../src/executor/contract"
import { CodexAppServerExecutor, type CodexAppServerClient } from "../../src/executor/codex-app-server"

describe("codex app server executor", () => {
  test("uses full-access sandbox defaults for coding tasks", async () => {
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
    // The thread-level sandbox sent via threadStart is authoritative — the
    // app-server ignores config-toml sandbox_mode at the thread layer, so a
    // conservative client default silently re-imposes the FS+net sandbox.
    // Default to danger-full-access; bench is externally sandboxed.
    expect(started?.["sandbox"] as string | undefined).toBe("danger-full-access")
  })

  test("maps structured Codex plan updates to update_plan todo tool events", async () => {
    const provider = CodexAppServerExecutor.create(
      client([
        {
          type: "notification",
          method: "turn/plan/updated",
          params: {
            threadId: "thr_1",
            turnId: "turn_1",
            explanation: "working plan",
            plan: [
              { step: "Inspect executor plan payload", status: "completed" },
              { step: "Normalize Codex plan into checklist state", status: "inProgress" },
              { step: "Verify overlay summary", status: "pending" },
            ],
          },
        },
        {
          type: "notification",
          method: "turn/completed",
          params: {
            threadId: "thr_1",
            turn: { id: "turn_1", items: [], status: "completed", error: null },
          },
        },
      ]),
    )

    const result = await collect(provider.run({ prompt: "test" }))
    const toolCall = result.find(
      (item): item is Extract<CodingEventInfo, { type: "tool_call" }> => item.type === "tool_call",
    )
    const toolResult = result.find(
      (item): item is Extract<CodingEventInfo, { type: "tool_result" }> => item.type === "tool_result",
    )

    expect(result.find((item) => item.type === "plan_delta")).toBeUndefined()
    expect(toolCall?.name).toBe("update_plan")
    expect(toolResult?.name).toBe("update_plan")
    expect(toolResult?.id).toBe(toolCall?.id)
    expect(toolCall?.input).toEqual({
      todos: [
        { content: "Inspect executor plan payload", status: "completed" },
        { content: "Normalize Codex plan into checklist state", status: "in_progress" },
        { content: "Verify overlay summary", status: "pending" },
      ],
    })
    expect(toolResult?.meta?.["todos"]).toEqual((toolCall?.input as { todos: unknown[] }).todos)
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
    const provider = CodexAppServerExecutor.create(
      client([
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
      ]),
    )

    const result = await collect(provider.run({ prompt: "test" }))
    expect(result.some((item) => item.type === "approval_request")).toBe(true)
    expect(result.filter((item) => item.type === "input_request").length).toBe(2)
  })

  test("leaves server requests pending until the owner responds", async () => {
    const responses: Array<{ id: string | number; result?: Record<string, unknown>; error?: Record<string, unknown> }> =
      []
    let release: (() => void) | undefined
    const provider = CodexAppServerExecutor.create({
      async initialize() {
        return {}
      },
      async threadStart() {
        return {
          thread: {
            id: "thr_hold",
          },
        }
      },
      async threadResume() {
        return {
          thread: {
            id: "thr_hold",
          },
        }
      },
      async turnStart() {
        return {
          turn: {
            id: "turn_hold",
          },
        }
      },
      async turnInterrupt() {
        return true
      },
      async respond(input) {
        responses.push(input)
      },
      async *events() {
        yield {
          type: "request",
          id: 7,
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thr_hold",
            turnId: "turn_hold",
            command: "git status",
          },
        }
        await new Promise<void>((resolve) => {
          release = resolve
        })
        yield {
          type: "notification",
          method: "turn/completed",
          params: {
            threadId: "thr_hold",
            turn: {
              id: "turn_hold",
              items: [],
              status: "completed",
              error: null,
            },
          },
        }
      },
    })

    const iterator = provider.run({ sessionID: "ses_build", prompt: "test" })[Symbol.asyncIterator]()
    expect((await iterator.next()).value?.type).toBe("progress")
    expect((await iterator.next()).value).toMatchObject({
      type: "approval_request",
      id: "7",
    })
    expect(responses).toEqual([])

    await provider.respond?.({
      sessionID: "ses_build",
      requestID: "7",
      kind: "approval",
      response: {
        decision: "accept",
      },
    })
    expect(responses).toEqual([
      {
        id: 7,
        result: {
          decision: "accept",
        },
        error: undefined,
      },
    ])
    const done = iterator.next()
    await Bun.sleep(0)
    release?.()
    expect((await done).value?.type).toBe("done")
  })

  test("keeps dynamic tool call and result IDs aligned", async () => {
    const provider = CodexAppServerExecutor.create(
      client([
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
      ]),
    )

    const result = await collect(provider.run({ prompt: "test" }))
    const toolCall = result.find(
      (item): item is Extract<CodingEventInfo, { type: "tool_call" }> => item.type === "tool_call",
    )
    const toolResult = result.find(
      (item): item is Extract<CodingEventInfo, { type: "tool_result" }> => item.type === "tool_result",
    )

    expect(toolCall?.id).toBe("call_write")
    expect(toolCall?.meta?.["call_id"]).toBe("call_write")
    expect(toolResult?.id).toBe("call_write")
    expect(toolResult?.meta?.["call_id"]).toBe("call_write")
    expect(toolResult?.meta?.["item_id"]).toBe("item_write")
  })

  test("keeps completed command execution details on tool results", async () => {
    const provider = CodexAppServerExecutor.create(
      client([
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
      ]),
    )

    const result = await collect(provider.run({ prompt: "test" }))
    const toolResult = result.find(
      (item): item is Extract<CodingEventInfo, { type: "tool_result" }> => item.type === "tool_result",
    )

    expect(toolResult?.id).toBe("cmd_1")
    expect(toolResult?.name).toBe("Bash")
    expect(toolResult?.input).toEqual({ command: "bun test test/executor/codex-app-server.test.ts" })
    expect(toolResult?.output).toBe("ok")
    expect(toolResult?.meta?.["item_type"]).toBe("commandExecution")
  })

  test("pairs item/started tool_call with item/completed tool_result on commandExecution", async () => {
    // Codex 0.125 with --dangerously-bypass-approvals-and-sandbox skips the
    // exec approval JSON-RPC request and goes item/started → item/completed
    // for commandExecution. Without an item/started handler the host emitted
    // only tool_result, so build/agent.ts flagged it as
    // `tool_result ... arrived without a prior tool_call` and refused to
    // run host merge_back. The pair must share the item id so the tools map
    // in build/agent.ts correlates them.
    const provider = CodexAppServerExecutor.create(
      client([
        {
          type: "notification",
          method: "item/started",
          params: {
            threadId: "thr_1",
            turnId: "turn_1",
            item: {
              id: "call_xyz",
              type: "commandExecution",
              command: "ls",
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
              id: "call_xyz",
              type: "commandExecution",
              command: "ls",
              output: "README.md",
              status: "completed",
            },
          },
        },
        {
          type: "notification",
          method: "turn/completed",
          params: {
            threadId: "thr_1",
            turn: { id: "turn_1", items: [], status: "completed", error: null },
          },
        },
      ]),
    )

    const result = await collect(provider.run({ prompt: "test" }))
    const toolCall = result.find(
      (item): item is Extract<CodingEventInfo, { type: "tool_call" }> => item.type === "tool_call",
    )
    const toolResult = result.find(
      (item): item is Extract<CodingEventInfo, { type: "tool_result" }> => item.type === "tool_result",
    )

    expect(toolCall?.id).toBe("call_xyz")
    expect(toolCall?.name).toBe("Bash")
    expect(toolCall?.input).toBe("ls")
    expect(toolResult?.id).toBe("call_xyz") // same id ⇒ paired
    expect(toolResult?.name).toBe("Bash")
    expect(toolResult?.output).toBe("README.md")
  })

  test("suppresses empty turn/diff/updated notifications (no Diff updated placeholder)", async () => {
    const provider = CodexAppServerExecutor.create(
      client([
        {
          type: "notification",
          method: "turn/diff/updated",
          params: {
            threadId: "thr_1",
            turnId: "turn_1",
            // No delta and no summary — codex emits this on every diff write.
          },
        },
        {
          type: "notification",
          method: "turn/diff/updated",
          params: {
            threadId: "thr_1",
            turnId: "turn_1",
            summary: "Success. Updated the following files: M package.json",
          },
        },
        {
          type: "notification",
          method: "turn/completed",
          params: {
            threadId: "thr_1",
            turn: { id: "turn_1", items: [], status: "completed", error: null },
          },
        },
      ]),
    )

    const result = await collect(provider.run({ prompt: "test" }))
    const diffEvents = result.filter(
      (item): item is Extract<CodingEventInfo, { type: "diff_delta" }> => item.type === "diff_delta",
    )
    expect(diffEvents).toHaveLength(1)
    expect(diffEvents[0].summary).toContain("package.json")
    expect(result.find((item) => item.type === "diff_delta" && item.summary === "Diff updated")).toBeUndefined()
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

    const result = await Promise.race([collect(provider.run({ prompt: "test" })), Bun.sleep(100).then(() => "timeout")])

    expect(result).not.toBe("timeout")
    expect(Array.isArray(result)).toBe(true)
    if (Array.isArray(result)) {
      expect(result.at(-1)?.type).toBe("done")
    }
  })

  test("closes the client when run initialization fails before thread start", async () => {
    let closed = false
    const provider = CodexAppServerExecutor.create({
      async initialize() {
        throw new Error("forced initialize failure")
      },
      async threadStart() {
        throw new Error("threadStart should not run")
      },
      async threadResume() {
        throw new Error("threadResume should not run")
      },
      async turnStart() {
        throw new Error("turnStart should not run")
      },
      async turnInterrupt() {
        return true
      },
      async *events() {},
      close() {
        closed = true
      },
    })

    await expect(collect(provider.run({ prompt: "test" }))).rejects.toThrow("forced initialize failure")
    expect(closed).toBe(true)
  })

  test("run initialization requests honor caller abort and close the client", async () => {
    const controller = new AbortController()
    let initializedWithCallerSignal = false
    let closed = false
    const provider = CodexAppServerExecutor.create({
      initialize(_input, options) {
        initializedWithCallerSignal = options?.signal === controller.signal
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true })
        })
      },
      async threadStart() {
        throw new Error("threadStart should not run")
      },
      async threadResume() {
        throw new Error("threadResume should not run")
      },
      async turnStart() {
        throw new Error("turnStart should not run")
      },
      async turnInterrupt() {
        return true
      },
      async *events() {},
      close() {
        closed = true
      },
    })

    const pending = collect(provider.run({ prompt: "test", signal: controller.signal }))
    await Bun.sleep(0)
    controller.abort(new DOMException("forced startup abort", "AbortError"))

    await expect(pending).rejects.toThrow("forced startup abort")
    expect(initializedWithCallerSignal).toBe(true)
    expect(closed).toBe(true)
  })

  test("closes the client when resume initialization fails before thread resume", async () => {
    let closed = false
    const provider = CodexAppServerExecutor.create({
      async initialize() {
        throw new Error("forced resume initialize failure")
      },
      async threadStart() {
        throw new Error("threadStart should not run")
      },
      async threadResume() {
        throw new Error("threadResume should not run")
      },
      async turnStart() {
        throw new Error("turnStart should not run")
      },
      async turnInterrupt() {
        return true
      },
      async *events() {},
      close() {
        closed = true
      },
    })

    await expect(collect(provider.resume({ sessionID: "thr_old:turn_old", prompt: "test" }))).rejects.toThrow(
      "forced resume initialize failure",
    )
    expect(closed).toBe(true)
  })
})

function client(
  events: Array<{
    type: "notification" | "request"
    method: string
    params?: Record<string, unknown>
    id?: string | number
  }>,
): CodexAppServerClient {
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
      return feed(
        events.map((item) =>
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
              },
        ),
      )
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
