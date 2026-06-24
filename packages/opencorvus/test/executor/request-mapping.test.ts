import { describe, expect, test } from "bun:test"
import { ClaudeCodeExecutor } from "../../src/executor/claude-code"
import { CodexExecutor } from "../../src/executor/codex"

function feed(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item
    },
  }
}

describe("executor request mapping", () => {
  test("codex request maps function and builtin tools", () => {
    const req = CodexExecutor.request({
      model: "gpt-5.2-codex",
      prompt: "fix the failing test",
      cwd: "/repo",
      system: "stay concise",
      tools: [
        { type: "function", name: "read", description: "Read a file", inputSchema: { type: "object" } },
        { type: "builtin", name: "web_search" },
      ],
    })

    expect(req).toMatchObject({
      model: "gpt-5.2-codex",
      stream: true,
      input: "fix the failing test",
      instructions: "stay concise",
      metadata: { cwd: "/repo" },
      tools: [
        {
          type: "function",
          name: "read",
          description: "Read a file",
          parameters: { type: "object" },
        },
        {
          type: "web_search_preview",
        },
      ],
    })
  })

  test("codex provider normalizes responses events", async () => {
    const provider = CodexExecutor.create({
      responses: {
        create() {
          return feed([
            { type: "response.created", response: { id: "resp_1" } },
            { type: "response.output_text.delta", delta: "Hel" },
            {
              type: "response.output_item.added",
              item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "read" },
            },
            { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"filePath":"README.md"' },
            {
              type: "response.function_call_arguments.done",
              item_id: "fc_1",
              arguments: '{"filePath":"README.md"}',
            },
            { type: "response.completed", response: { id: "resp_1", output_text: "Hello" } },
          ])
        },
        async cancel() {},
      },
    })

    const out = []
    for await (const item of provider.run({
      model: "gpt-5.2-codex",
      prompt: "hello",
    })) {
      out.push(item)
    }

    expect(provider.capabilities()).toMatchObject({
      customTools: true,
      interrupt: true,
    })
    expect(out).toEqual([
      { type: "text_delta", text: "Hel" },
      { type: "tool_delta", id: "call_1", name: "read", delta: '{"filePath":"README.md"' },
      { type: "tool_call", id: "call_1", name: "read", input: '{"filePath":"README.md"}' },
      { type: "done", sessionID: "resp_1", output: "Hello", meta: { id: "resp_1", output_text: "Hello" } },
    ])
  })

  test("claude request keeps claude code preset and resume session", () => {
    const req = ClaudeCodeExecutor.resumeRequest({
      sessionID: "sess_1",
      model: "claude-sonnet-4-5",
      prompt: "fix the build",
      cwd: "/repo",
      system: "only touch tests",
      tools: [
        { type: "builtin", name: "Bash" },
        { type: "function", name: "read" },
      ],
    })

    expect(req).toMatchObject({
      prompt: "fix the build",
      options: {
        model: "claude-sonnet-4-5",
        cwd: "/repo",
        includePartialMessages: true,
        resume: "sess_1",
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: "only touch tests",
        },
        tools: ["Bash"],
      },
    })
  })

  test("claude request disables tools for planning runs", () => {
    const req = ClaudeCodeExecutor.request({
      prompt: "draft a plan",
      toolMode: "none",
    })

    expect(req).toMatchObject({
      prompt: "draft a plan",
      options: {
        tools: [],
      },
    })
  })

  test("claude provider normalizes agent sdk messages without duplicate assistant replay", async () => {
    const provider = ClaudeCodeExecutor.create(() =>
      feed([
        { type: "system", subtype: "init", session_id: "sess_a", tools: ["Bash"] },
        {
          type: "stream_event",
          uuid: "msg_1",
          event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } },
        },
        {
          type: "stream_event",
          uuid: "msg_1",
          event: {
            type: "content_block_start",
            index: 1,
            content_block: {
              type: "tool_use",
              id: "toolu_1",
              name: "Read",
              input: {},
            },
          },
        },
        {
          type: "stream_event",
          uuid: "msg_1",
          event: {
            type: "content_block_delta",
            index: 1,
            delta: {
              type: "input_json_delta",
              partial_json: '{"file":"README.md"}',
            },
          },
        },
        { type: "stream_event", uuid: "msg_1", event: { type: "content_block_stop", index: 1 } },
        {
          type: "assistant",
          uuid: "msg_1",
          message: {
            content: [
              { type: "text", text: "duplicate full assistant message" },
              { type: "tool_use", id: "toolu_1", name: "Read", input: { file: "README.md" } },
            ],
          },
        },
        {
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "README body" }],
          },
        },
        {
          type: "result",
          subtype: "success",
          session_id: "sess_a",
          result: "Done",
          total_cost_usd: 0.12,
          num_turns: 3,
        },
      ]),
    )

    const out = []
    for await (const item of provider.run({
      model: "claude-sonnet-4-5",
      prompt: "hello",
    })) {
      out.push(item)
    }

    expect(provider.capabilities()).toMatchObject({
      builtinTools: true,
      customTools: false,
      interrupt: false,
    })
    expect(out).toEqual([
      {
        type: "progress",
        phase: "init",
        summary: "init",
        meta: { type: "system", subtype: "init", session_id: "sess_a", tools: ["Bash"] },
      },
      { type: "text_delta", text: "Hel" },
      { type: "tool_call", id: "toolu_1", name: "Read", input: '{"file":"README.md"}' },
      { type: "tool_result", id: "toolu_1", output: "README body" },
      {
        type: "done",
        sessionID: "sess_a",
        output: "Done",
        costUSD: 0.12,
        turns: 3,
        meta: {
          type: "result",
          subtype: "success",
          session_id: "sess_a",
          result: "Done",
          total_cost_usd: 0.12,
          num_turns: 3,
        },
      },
    ])
  })
})
