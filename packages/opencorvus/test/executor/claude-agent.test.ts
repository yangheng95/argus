import { describe, expect, test } from "bun:test"
import type { ClaudeAgentClient, ClaudeAgentHandle } from "../../src/executor/claude-agent"
import { ClaudeAgentExecutor } from "../../src/executor/claude-agent"
import { ManagedCodingExecutor } from "../../src/executor/managed"

describe("claude agent executor", () => {
  test("maps sdk messages to coding events", async () => {
    const provider = ClaudeAgentExecutor.create(client([
      {
        type: "system",
        subtype: "init",
        session_id: "claude_session",
        model: "claude-sonnet-4-6",
      },
      {
        type: "assistant",
        session_id: "claude_session",
        message: {
          content: [
            { type: "text", text: "hello" },
            { type: "tool_use", id: "tool_1", name: "Bash", input: { command: "pwd" } },
          ],
        },
      },
      {
        type: "stream_event",
        session_id: "claude_session",
        event: {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "reasoning" },
          index: 0,
        },
      },
      {
        type: "result",
        subtype: "success",
        session_id: "claude_session",
        result: "done",
        total_cost_usd: 0.02,
        num_turns: 1,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      },
    ]))

    const events = await collect(provider.run({ prompt: "test" }))
    expect(events.some((item) => item.type === "text_delta")).toBe(true)
    const tool = events.find((item) => item.type === "tool_call")
    expect(tool?.type).toBe("tool_call")
    expect(tool?.meta?.adapter).toBe("shell")
    expect(tool?.meta?.tool_kind).toBe("shell")
    expect(events.some((item) => item.type === "reasoning_delta")).toBe(true)
    expect(events.some((item) => item.type === "usage")).toBe(true)
    expect(events.at(-1)?.type).toBe("done")
  })

  test("respond resolves pending approval callbacks", async () => {
    const requests: Array<{ id: string }> = []
    const adapter = ManagedCodingExecutor.create(ClaudeAgentExecutor.create({
      run(input) {
        return handle(async function* () {
          yield {
            type: "system",
            subtype: "init",
            session_id: "claude_session",
          }
          if (input.onApproval) {
            requests.push({ id: "permission:tool_1" })
            const result = await input.onApproval({
              id: "permission:tool_1",
              approval: "can_use_tool",
              message: "Bash",
            })
            yield {
              type: "raw",
              session_id: "claude_session",
              result,
            }
          }
          yield {
            type: "result",
            subtype: "success",
            session_id: "claude_session",
            result: "done",
            total_cost_usd: 0,
            num_turns: 1,
            usage: {
              input_tokens: 1,
              output_tokens: 1,
            },
          }
        }())
      },
    }), {})

    const submit = await adapter.submit({
      sessionID: "oc_session",
      prompt: "test",
    })
    const stream = adapter.events({ queueTaskID: submit.queueTaskID })
    const first = await stream.next()
    expect(first.value?.type).toBe("executor.status")
    let approval
    for await (const event of stream) {
      if (event.type === "approval.request") {
        approval = event
        break
      }
    }
    expect(approval?.type).toBe("approval.request")
    const resolved = await adapter.resolve?.({
      queueTaskID: submit.queueTaskID,
      requestID: requests[0]!.id,
      kind: "approval",
      response: {
        decision: "accept",
      },
    })
    expect(resolved).toBe(true)
  })
})

function client(messages: Record<string, unknown>[]): ClaudeAgentClient {
  return {
    run() {
      return handle(feed(messages))
    },
  }
}

function handle(stream: AsyncIterable<Record<string, unknown>>): ClaudeAgentHandle {
  return {
    stream,
    async interrupt() {},
    close() {},
  }
}

async function collect(input: AsyncIterable<unknown>) {
  const result: unknown[] = []
  for await (const item of input) result.push(item)
  return result as Array<{ type: string; [key: string]: unknown }>
}

function feed<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item
    },
  }
}
