import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { EngineConfig } from "../../src/engine/config"
import { PermissionNext } from "../../src/permission/next"
import type { Provider } from "../../src/provider/provider"
import { Snapshot } from "../../src/snapshot"
import { Session } from "../../src/session"
import { SessionCompaction } from "../../src/session/compaction"
import { LLM } from "../../src/session/llm"
import { Message } from "../../src/session/message"
import { SessionProcessor } from "../../src/session/processor"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"

afterEach(() => {
  mock.restore()
})

function streamOf(events: Array<Record<string, unknown>>): AsyncIterable<any> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e
    },
  }
}

// Regression: prior to this fix, `case "finish-step"` did
// `input.assistantMessage.tokens = usage.tokens`. Multi-step messages
// saw the second step OVERWRITE the first step's tokens, silently
// dropping them. `cost` was already cumulative (`+=`); tokens must
// match. The overlay's chat-usage strip aggregates from
// `Message.Assistant.tokens`, so without this fix the strip undercounts
// multi-step turns.
test("session processor accumulates tokens across multiple finish-step events on one assistant message", async () => {
  spyOn(Config, "get").mockResolvedValue({ experimental: {} } as Awaited<ReturnType<typeof Config.get>>)
  spyOn(EngineConfig, "get").mockResolvedValue({
    activity: { session_llm_idle_ms: 60 },
  } as Awaited<ReturnType<typeof EngineConfig.get>>)
  spyOn(SessionStatus, "set").mockImplementation(() => {})
  spyOn(Bus, "publish").mockResolvedValue(undefined as never)
  spyOn(Session, "updateMessage").mockResolvedValue(undefined as never)
  spyOn(SessionSummary, "summarize").mockImplementation(() => {})
  spyOn(SessionCompaction, "isOverflow").mockResolvedValue(false)
  spyOn(Snapshot, "track").mockResolvedValue("snap_tokens_accum")
  spyOn(PermissionNext, "ask").mockResolvedValue(undefined as never)

  // Mirror the working `processor-duplicate-tool-call` test fixture: an
  // in-memory part store + Message.parts adapter so the processor's
  // persisted-part lookup has real data. Two finish-step events in one
  // stream (no start-step → snapshot stays undefined → patch block is
  // skipped, matching the executor's tool-result-driven turn shape).
  const store = new Map<string, Message.Part>()
  spyOn(Session, "updatePart").mockImplementation(async (part) => {
    store.set(part.id, part as Message.Part)
    return part as never
  })
  spyOn(Message, "parts").mockImplementation((async (messageID: string) =>
    [...store.values()].filter((p) => p.messageID === messageID)) as typeof Message.parts)

  spyOn(LLM, "stream").mockResolvedValue({
    fullStream: streamOf([
      {
        type: "finish-step",
        finishReason: "tool-calls",
        usage: {
          inputTokens: 100,
          outputTokens: 40,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 140,
        },
      },
      {
        type: "finish-step",
        finishReason: "stop",
        usage: {
          inputTokens: 250,
          outputTokens: 60,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 310,
        },
      },
    ]),
  } as Awaited<ReturnType<typeof LLM.stream>>)

  const assistantMessage = {
    id: "msg_tokens_accum",
    sessionID: "ses_tokens_accum",
    role: "assistant",
    agent: "architect",
    parentID: "msg_parent",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: Date.now() },
  } as Message.Assistant

  const processor = SessionProcessor.create({
    assistantMessage,
    sessionID: "ses_tokens_accum",
    model: {
      providerID: "test-provider",
      id: "test-model",
      api: { npm: "@ai-sdk/openai" },
    } as Provider.Model,
    abort: new AbortController().signal,
  })

  await processor.process({} as LLM.StreamInput)

  // Sum of both finish-step events: 100+250 input, 40+60 output, 140+310 total.
  expect(assistantMessage.tokens.input).toBe(350)
  expect(assistantMessage.tokens.output).toBe(100)
  expect(assistantMessage.tokens.total).toBe(450)
})
