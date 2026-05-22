import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { EngineConfig } from "../../src/engine/config"
import { PermissionNext } from "../../src/permission/next"
import type { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { Message } from "../../src/session/message"
import { SessionProcessor } from "../../src/session/processor"
import { SessionStatus } from "../../src/session/status"

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

// Regression: a provider re-emit or a retried stream can deliver the SAME tool
// call — identical `call_*` id — twice inside one assistant turn. `toolcalls`
// only tracks in-flight calls and is cleared on tool-result, so before the fix
// the second delivery minted a fresh part with a new id but the same callID.
// `toModelMessages` then emitted that callID in two messages and the provider
// rejected the next request with HTTP 400 `Duplicate value for 'tool_call_id'`.
// The processor must resolve the part by (messageID, callID) and reuse it.
test("session processor reuses one part when the same tool callID is delivered twice", async () => {
  spyOn(Config, "get").mockResolvedValue({ experimental: {} } as Awaited<ReturnType<typeof Config.get>>)
  spyOn(EngineConfig, "get").mockResolvedValue({
    activity: { session_llm_idle_ms: 60 },
  } as Awaited<ReturnType<typeof EngineConfig.get>>)
  spyOn(SessionStatus, "set").mockImplementation(() => {})
  spyOn(Bus, "publish").mockResolvedValue(undefined as never)
  spyOn(Session, "updateMessage").mockResolvedValue(undefined as never)
  spyOn(PermissionNext, "ask").mockResolvedValue(undefined as never)

  // In-memory part store: upsert by part id, exactly like the real PartTable
  // primary key. Message.parts reads it back so the processor's persisted-part
  // fallback has real data to find.
  const store = new Map<string, Message.Part>()
  spyOn(Session, "updatePart").mockImplementation(async (part) => {
    store.set(part.id, part as Message.Part)
    return part as never
  })
  spyOn(Message, "parts").mockImplementation(
    (async (messageID: string) =>
      [...store.values()].filter((p) => p.messageID === messageID)) as typeof Message.parts,
  )

  const messageID = "msg_dup_tool_call"
  const register = (callID: string, goalID: string) => [
    { type: "tool-call", toolCallId: callID, toolName: "register_goal", input: { id: goalID } },
    {
      type: "tool-result",
      toolCallId: callID,
      toolName: "register_goal",
      input: { id: goalID },
      output: { output: `OK ${goalID}` },
    },
  ]
  spyOn(LLM, "stream").mockResolvedValue({
    fullStream: streamOf([
      { type: "start" },
      ...register("call_dup", "goal_1"),
      ...register("call_other", "goal_2"),
      // Provider re-delivers call_dup with the IDENTICAL id after it already
      // completed once — the corruption trigger seen in the live failure.
      ...register("call_dup", "goal_1"),
    ]),
  } as Awaited<ReturnType<typeof LLM.stream>>)

  const processor = SessionProcessor.create({
    assistantMessage: {
      id: messageID,
      sessionID: "ses_dup_tool_call",
      role: "assistant",
      agent: "architect",
      parentID: "msg_parent",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    } as Message.Assistant,
    sessionID: "ses_dup_tool_call",
    model: { providerID: "test-provider", id: "test-model" } as Provider.Model,
    abort: new AbortController().signal,
  })

  await processor.process({} as LLM.StreamInput)

  const toolParts = [...store.values()].filter((p): p is Message.ToolPart => p.type === "tool")
  const callIDs = toolParts.map((p) => p.callID)
  // The re-delivered call_dup must update the existing part, not add a new one.
  expect(callIDs.filter((c) => c === "call_dup")).toHaveLength(1)
  expect(callIDs.filter((c) => c === "call_other")).toHaveLength(1)
  // No callID may appear on more than one part — that is exactly what produces
  // a duplicate provider tool_call_id.
  expect(new Set(callIDs).size).toBe(toolParts.length)
})
