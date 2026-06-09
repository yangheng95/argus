import { afterEach, describe, expect, test } from "bun:test"
import { ClaudeCodeExecutor } from "../../src/executor/claude-code"
import { claudeSdkEnv } from "../../src/executor/claude-agent"
import { getModelOverride, setModelOverride } from "../../src/executor/runtime-env"

const CLAUDE_KEY = "OPENCORVUS_EXECUTOR_CLAUDE_MODEL"
const CODEX_KEY = "OPENCORVUS_EXECUTOR_CODEX_MODEL"

describe("executor runtime model env", () => {
  const originalClaude = process.env[CLAUDE_KEY]
  const originalCodex = process.env[CODEX_KEY]

  afterEach(() => {
    restore(CLAUDE_KEY, originalClaude)
    restore(CODEX_KEY, originalCodex)
  })

  test("keeps claude-code model separate from OpenCorvus provider/model refs", () => {
    process.env[CLAUDE_KEY] = "alibaba-coding-plan-cn/kimi-k2.5"

    expect(() => getModelOverride("claude-code")).toThrow("Claude Code expects the native Claude CLI --model value")
  })

  test("accepts the native Claude CLI model string for claude-code", () => {
    setModelOverride("claude-code", " claude-opus-4-7 ")

    expect(process.env[CLAUDE_KEY]).toBe("claude-opus-4-7")
    expect(getModelOverride("claude-code")).toBe("claude-opus-4-7")
  })

  test("rejects OpenCorvus provider/model refs at the Claude request boundary", () => {
    expect(() =>
      ClaudeCodeExecutor.request({
        prompt: "hello",
        model: "alibaba-coding-plan-cn/kimi-k2.5",
      }),
    ).toThrow("Claude Code expects the native Claude CLI --model value")
  })

  test("keeps codex model separate from OpenCorvus provider/model refs", () => {
    expect(() => setModelOverride("codex", "openai/gpt-5.3-codex")).toThrow(
      "Codex expects the native Codex CLI --model value",
    )
  })

  test("accepts the native Codex CLI model string for codex", () => {
    setModelOverride("codex", " gpt-5.5 ")

    expect(process.env[CODEX_KEY]).toBe("gpt-5.5")
    expect(getModelOverride("codex")).toBe("gpt-5.5")
  })

  test("normalizes Anthropic base URL for Claude Agent SDK requests", () => {
    const env = claudeSdkEnv({
      ANTHROPIC_BASE_URL: "https://example.test/proxy/v1/",
    } as NodeJS.ProcessEnv)

    expect(env.ANTHROPIC_BASE_URL).toBe("https://example.test/proxy")
  })
})

function restore(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}
