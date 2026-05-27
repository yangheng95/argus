import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { EffectiveConfig } from "../../src/config/effective"
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

beforeEach(() => {
  spyOn(EffectiveConfig, "effective").mockResolvedValue({
    experimental: {},
  } as Awaited<ReturnType<typeof EffectiveConfig.effective>>)
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

test("session processor serializes concurrent materialization for the same tool callID", async () => {
  const store = new Map<string, Message.Part>()
  spyOn(Message, "parts").mockImplementation(
    (async (messageID: string) =>
      [...store.values()].filter((p) => p.messageID === messageID)) as typeof Message.parts,
  )
  spyOn(Session, "updatePart").mockImplementation(async (part) => {
    await Bun.sleep(10)
    store.set(part.id, part as Message.Part)
    return part as never
  })

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

  const [first, second] = await Promise.all([
    processor.ensureToolPart("call_build_1", "build", { goalID: "gol_1" }),
    processor.ensureToolPart("call_build_1", "build", { goalID: "gol_1" }),
  ])
  const toolParts = [...store.values()].filter((p): p is Message.ToolPart => p.type === "tool")

  expect(toolParts).toHaveLength(1)
  expect(first.id).toBe(second.id)
  expect(first.id).toBe(toolParts[0]!.id)
  expect(first.callID).toBe("call_build_1")
  expect(first.tool).toBe("build")
  expect(first.state).toMatchObject({
    status: "running",
    input: { goalID: "gol_1" },
  })
  expect(processor.partFromToolCall("call_build_1")?.id).toBe(first.id)
})
