import { describe, expect, test } from "bun:test"
import { BuildSessionReplayPressure } from "../../src/build/session-replay-pressure"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import type { Message } from "../../src/session/message"
import { tmpdir } from "../fixture/fixture"

const model = {
  id: "test-model",
  providerID: "test",
  name: "test",
  limit: { context: 100_000, input: 100_000, output: 8_000 },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  capabilities: {
    toolcall: true,
    attachment: false,
    reasoning: false,
    temperature: true,
    input: { text: true, image: false, audio: false, video: false, pdf: false },
    output: { text: true, image: false, audio: false, video: false },
  },
  api: { npm: "@ai-sdk/openai" },
  options: {},
} as any

async function seedAssistant(input: { sessionID: string; inputTokens: number; toolOutput?: string }) {
  const now = Date.now()
  const user = await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID: input.sessionID,
    role: "user",
    time: { created: now },
    agent: "build",
    model: { providerID: "test", modelID: "test-model" },
  } satisfies Message.User)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: user.id,
    type: "text",
    text: "continue build",
  })
  const assistant = await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID: input.sessionID,
    role: "assistant",
    parentID: user.id,
    agent: "build",
    modelID: "test-model",
    providerID: "test",
    path: { cwd: Instance.directory, root: Instance.worktree },
    cost: 0,
    tokens: {
      total: input.inputTokens + 100,
      input: input.inputTokens,
      output: 100,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    finish: "tool-calls",
    time: { created: now + 1, completed: now + 2 },
  } satisfies Message.Assistant)
  if (input.toolOutput) {
    await Session.updatePart({
      id: Identifier.ascending("part"),
      sessionID: input.sessionID,
      messageID: assistant.id,
      type: "tool",
      callID: Identifier.ascending("call"),
      tool: "read",
      state: {
        status: "completed",
        input: { path: "large.txt" },
        output: input.toolOutput,
        title: "Read",
        metadata: {},
        time: { start: now + 1, end: now + 2 },
      },
      metadata: {},
    })
  }
}

describe("BuildSessionReplayPressure", () => {
  test("uses configured Build retry replay token limit against latest assistant input tokens", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "build", title: "pressure tokens" })
        await seedAssistant({ sessionID: session.id, inputTokens: 1_500 })

        const evaluation = BuildSessionReplayPressure.evaluate({
          sessionID: session.id,
          config: { agent: { build: { retry_replay_token_limit: 1_000 } } } as any,
          model,
        })

        expect(evaluation.summary.latestAssistantInputTokens).toBe(1_500)
        expect(evaluation.summary.replayTokensEstimate).toBe(1_500)
        expect(evaluation.contextUnavailableReason).toContain("prior_session_replay_pressure")
        expect(evaluation.contextUnavailableReason).toContain("estimate=1500")
        expect(evaluation.contextUnavailableReason).toContain("limit=1000")
      },
    })
  })

  test("estimates replay pressure from persisted tool input and output when tokens are small", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "build", title: "pressure tool output" })
        await seedAssistant({
          sessionID: session.id,
          inputTokens: 100,
          toolOutput: "x".repeat(8_000),
        })

        const evaluation = BuildSessionReplayPressure.evaluate({
          sessionID: session.id,
          config: { agent: { build: { retry_replay_token_limit: 1_000 } } } as any,
          model,
        })

        expect(evaluation.summary.toolOutputChars).toBe(8_000)
        expect(evaluation.summary.uncompactedToolParts).toBe(1)
        expect(evaluation.summary.replayTokensEstimate).toBeGreaterThanOrEqual(2_000)
        expect(evaluation.contextUnavailableReason).toContain("tool_output_chars=8000")
      },
    })
  })
})
