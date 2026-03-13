import { afterEach, describe, expect, mock, test } from "bun:test"

const calls: Array<Record<string, unknown>> = []

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query(input: Record<string, unknown>) {
    calls.push(input)
    return {
      async *[Symbol.asyncIterator]() {
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
      },
      async interrupt() {},
      close() {},
    }
  },
}))

const { ClaudeAgentExecutor } = await import("../../src/executor/claude-agent")

describe("claude agent sdk options", () => {
  afterEach(() => {
    delete process.env.OPENCORVUS_EXECUTOR_CLAUDE_PERMISSION_MODE
    calls.length = 0
  })

  test("defaults to bypassPermissions for headless runs", async () => {
    await collect(ClaudeAgentExecutor.createSdk().run({ prompt: "test" }))

    const options = calls[0]?.options as Record<string, unknown> | undefined
    expect(options?.permissionMode).toBe("bypassPermissions")
    expect(options?.allowDangerouslySkipPermissions).toBe(true)
  })

  test("honors explicit permission mode overrides", async () => {
    process.env.OPENCORVUS_EXECUTOR_CLAUDE_PERMISSION_MODE = "default"

    await collect(ClaudeAgentExecutor.createSdk().run({ prompt: "test" }))

    const options = calls[0]?.options as Record<string, unknown> | undefined
    expect(options?.permissionMode).toBe("default")
    expect(options?.allowDangerouslySkipPermissions).toBe(false)
  })

  test("forces read-only planning mode when tools are disabled", async () => {
    await collect(ClaudeAgentExecutor.createSdk().run({ prompt: "plan", toolMode: "none", sandbox: "read-only" }))

    const options = calls[0]?.options as Record<string, unknown> | undefined
    expect(options?.permissionMode).toBe("plan")
    expect(options?.allowDangerouslySkipPermissions).toBe(false)
    expect(options?.allowedTools).toEqual([])
  })

  test("injects the OpenCorvus MCP server by default", async () => {
    await collect(ClaudeAgentExecutor.createSdk().run({ prompt: "test", cwd: "/repo" }))

    const options = calls[0]?.options as Record<string, unknown> | undefined
    const mcp = options?.mcpServers as Record<string, { type?: string; command?: string; args?: string[] }> | undefined
    expect(mcp?.opencorvus?.type).toBe("stdio")
    expect(mcp?.opencorvus?.command).toBeTruthy()
    expect(mcp?.opencorvus?.args?.slice(-6)).toEqual(["mcp", "serve", "--cwd", "/repo", "--toolset", "executor"])
  })

  test("passes outputSchema as official outputFormat", async () => {
    await collect(ClaudeAgentExecutor.createSdk().run({
      prompt: "json",
      outputSchema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
        },
        required: ["ok"],
      },
    }))

    const options = calls[0]?.options as Record<string, unknown> | undefined
    expect(options?.outputFormat).toEqual({
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
        },
        required: ["ok"],
      },
    })
  })
})

async function collect(input: AsyncIterable<unknown>) {
  const out: unknown[] = []
  for await (const item of input) out.push(item)
  return out
}
