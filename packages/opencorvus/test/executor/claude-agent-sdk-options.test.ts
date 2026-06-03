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
    delete process.env.OPENCORVUS_EXECUTOR_CLAUDE_ALLOWED_TOOLS
    delete process.env.OPENCORVUS_EXECUTOR_CLAUDE_DISALLOWED_TOOLS
    calls.length = 0
  })

  test("defaults to bypassPermissions for headless runs", async () => {
    await collect(ClaudeAgentExecutor.createSdk().run({ prompt: "test", cwd: "D:\\repo\\worktree" }))

    const options = calls[0]?.options as Record<string, unknown> | undefined
    expect(options?.permissionMode).toBe("bypassPermissions")
    expect(options?.allowDangerouslySkipPermissions).toBe(true)
  })

  test("unwraps quoted Claude executable paths before passing SDK options", async () => {
    await collect(ClaudeAgentExecutor.createSdk(`'"C:\\Users\\hengu\\.local\\bin\\claude.exe"'`).run({ prompt: "test" }))

    const options = calls[0]?.options as Record<string, unknown> | undefined
    expect(options?.pathToClaudeCodeExecutable).toBe("C:\\Users\\hengu\\.local\\bin\\claude.exe")
  })

  test("honors explicit permission mode overrides", async () => {
    process.env.OPENCORVUS_EXECUTOR_CLAUDE_PERMISSION_MODE = "default"

    await collect(ClaudeAgentExecutor.createSdk().run({ prompt: "test", cwd: "D:\\repo\\worktree" }))

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
    expect(options?.systemPrompt).toBeUndefined()
  })

  test("exposes OpenCorvus MCP server to Claude SDK runs", async () => {
    const cwd = "D:\\repo\\worktree"

    await collect(ClaudeAgentExecutor.createSdk().run({ prompt: "build", cwd }))

    const options = calls[0]?.options as Record<string, unknown> | undefined
    const servers = options?.mcpServers as Record<string, { type?: string; command?: string; args?: string[] }> | undefined
    expect(servers?.opencorvus?.type).toBe("stdio")
    expect(servers?.opencorvus?.command).toBe(process.execPath)
    expect(servers?.opencorvus?.args?.[0]).toEndWith("stdio.ts")
    expect(servers?.opencorvus?.args).toContain("--cwd")
    expect(servers?.opencorvus?.args).toContain(cwd)
    expect("env" in (servers?.opencorvus ?? {})).toBe(false)
  })

  test("passes OpenCorvus runtime env to MCP server when execution context exists", async () => {
    await collect(ClaudeAgentExecutor.createSdk().run({
      prompt: "build",
      cwd: "D:\\repo\\worktree",
      taskID: "tsk_123",
      logicalSessionID: "ses_123",
      runtimeDir: "D:\\repo\\.opencorvus\\runtime",
      worktreeDir: "D:\\repo\\.opencorvus\\worktrees\\w1",
    }))

    const options = calls[0]?.options as Record<string, unknown> | undefined
    const servers = options?.mcpServers as Record<string, { env?: Record<string, string> }> | undefined
    expect(servers?.opencorvus?.env).toEqual({
      OPENCORVUS_TASK_ID: "tsk_123",
      OPENCORVUS_SESSION_ID: "ses_123",
      OPENCORVUS_RUNTIME_DIR: "D:\\repo\\.opencorvus\\runtime",
      OPENCORVUS_WORKTREE_DIR: "D:\\repo\\.opencorvus\\worktrees\\w1",
    })
  })

  test("teaches Claude Code the MCP-prefixed OpenCorvus executor tool names", async () => {
    await collect(
      ClaudeAgentExecutor.createSdk().run({ prompt: "build", system: "base system", cwd: "D:\\repo\\worktree" }),
    )

    const options = calls[0]?.options as Record<string, unknown> | undefined
    const systemPrompt = options?.systemPrompt as { append?: string } | undefined
    expect(systemPrompt?.append).toContain("base system")
    expect(systemPrompt?.append).toContain("skill => mcp__opencorvus__skill")
    expect(systemPrompt?.append).toContain("memory => mcp__opencorvus__memory")
    expect(systemPrompt?.append).toContain("task_report => mcp__opencorvus__task_report")
    expect(systemPrompt?.append).not.toContain("webpage_extract => mcp__opencorvus__webpage_extract")
    expect(systemPrompt?.append).not.toContain("figma_extract => mcp__opencorvus__figma_extract")
    expect(systemPrompt?.append).toContain("Webpage evidence artifacts are produced by the upstream frontend_design stage")
  })

  test("omits options.resume on a fresh run so Claude starts a new session", async () => {
    // Regression: passing OpenCorvus logical IDs (ses_xxx) as `resume:` made
    // the SDK reject the spawn with "is not a UUID and does not match any
    // session title". A fresh run must not set resume at all.
    await collect(
      ClaudeAgentExecutor.createSdk().run({
        prompt: "build",
        cwd: "D:\\repo\\worktree",
        sessionID: "ses_logical_fresh_run",
      }),
    )

    const options = calls[0]?.options as Record<string, unknown> | undefined
    expect(options).toBeDefined()
    expect("resume" in (options ?? {})).toBe(false)
  })

})

async function collect(input: AsyncIterable<unknown>) {
  const out: unknown[] = []
  for await (const item of input) out.push(item)
  return out
}
