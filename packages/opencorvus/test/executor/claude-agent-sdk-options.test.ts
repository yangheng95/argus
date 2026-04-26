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
    expect(options?.mcpServers).toBeUndefined()
  })

  test("exposes OpenCorvus MCP server to Claude SDK runs", async () => {
    const cwd = "D:\\repo\\worktree"

    await collect(ClaudeAgentExecutor.createSdk().run({ prompt: "build", cwd }))

    const options = calls[0]?.options as Record<string, unknown> | undefined
    const servers = options?.mcpServers as Record<string, { command?: string; args?: string[] }> | undefined
    expect(servers?.opencorvus?.command).toBe(process.execPath)
    expect(servers?.opencorvus?.args).toContain("mcp")
    expect(servers?.opencorvus?.args).toContain("serve")
    expect(servers?.opencorvus?.args).toContain("--cwd")
    expect(servers?.opencorvus?.args).toContain(cwd)
  })
})

async function collect(input: AsyncIterable<unknown>) {
  const out: unknown[] = []
  for await (const item of input) out.push(item)
  return out
}
