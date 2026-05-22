import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { EngineConfig } from "../../src/engine/config"
import type { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { Message } from "../../src/session/message"
import { SessionProcessor } from "../../src/session/processor"
import { SessionStatus } from "../../src/session/status"

afterEach(() => {
  mock.restore()
})

function stalledAfterStartStream(onReturn: () => void): AsyncIterable<{ type: string }> {
  return {
    [Symbol.asyncIterator]() {
      let emittedStart = false
      return {
        next() {
          if (!emittedStart) {
            emittedStart = true
            return Promise.resolve({ done: false, value: { type: "start" } })
          }
          return new Promise<IteratorResult<{ type: string }>>(() => {})
        },
        async return() {
          onReturn()
          return { done: true, value: undefined as never }
        },
      }
    },
  }
}

test("session processor exits a stalled provider iterator when its activity signal aborts", async () => {
  let upstreamReturned = false
  spyOn(Config, "get").mockResolvedValue({ experimental: {} } as Awaited<ReturnType<typeof Config.get>>)
  spyOn(EngineConfig, "get").mockResolvedValue({
    activity: { session_llm_idle_ms: 60 },
  } as Awaited<ReturnType<typeof EngineConfig.get>>)
  spyOn(SessionStatus, "set").mockImplementation(() => {})
  spyOn(Bus, "publish").mockResolvedValue(undefined as never)
  spyOn(Session, "updateMessage").mockResolvedValue(undefined as never)
  spyOn(Message, "parts").mockResolvedValue([])
  spyOn(LLM, "stream").mockResolvedValue({
    fullStream: stalledAfterStartStream(() => {
      upstreamReturned = true
    }),
  } as Awaited<ReturnType<typeof LLM.stream>>)

  const abort = new AbortController()
  const processor = SessionProcessor.create({
    assistantMessage: {
      id: "msg_processor_abort",
      sessionID: "ses_processor_abort",
      role: "assistant",
      agent: "architect",
      parentID: "msg_parent",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    } as Message.Assistant,
    sessionID: "ses_processor_abort",
    model: { providerID: "test-provider", id: "test-model" } as Provider.Model,
    abort: abort.signal,
  })

  setTimeout(() => abort.abort(new Error("operator cancelled stalled stream")), 30)
  const result = await Promise.race([
    processor.process({} as LLM.StreamInput),
    Bun.sleep(500).then(() => "timed-out" as const),
  ])

  expect(result).toBe("stop")
  expect(upstreamReturned).toBe(true)
})

test("session processor can materialize a tool part before stream chunks catch up", async () => {
  spyOn(Session, "updatePart").mockImplementation(async (part) => part as never)

  const processor = SessionProcessor.create({
    assistantMessage: {
      id: "msg_processor_tool_identity",
      sessionID: "ses_processor_tool_identity",
      role: "assistant",
      agent: "orchestrator",
      parentID: "msg_parent",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    } as Message.Assistant,
    sessionID: "ses_processor_tool_identity",
    model: { providerID: "test-provider", id: "test-model" } as Provider.Model,
    abort: new AbortController().signal,
  })

  const part = await processor.ensureToolPart("call_build_1", "build", { goalID: "gol_1" })

  expect(part.callID).toBe("call_build_1")
  expect(part.tool).toBe("build")
  expect(part.state).toMatchObject({
    status: "running",
    input: { goalID: "gol_1" },
  })
  expect(processor.partFromToolCall("call_build_1")?.id).toBe(part.id)
})
