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
import { SessionSummary } from "../../src/session/summary"
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

function stalledAfter(events: Array<Record<string, unknown>>): AsyncIterable<any> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        next() {
          if (index < events.length) {
            return Promise.resolve({ done: false, value: events[index++] })
          }
          return new Promise<IteratorResult<any>>(() => {})
        },
        async return() {
          return { done: true, value: undefined }
        },
      }
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

test("session processor preserves invalid tool-call input and paired tool-error cause", async () => {
  spyOn(Config, "get").mockResolvedValue({ experimental: {} } as Awaited<ReturnType<typeof Config.get>>)
  spyOn(EngineConfig, "get").mockResolvedValue({
    activity: { session_llm_idle_ms: 60 },
  } as Awaited<ReturnType<typeof EngineConfig.get>>)
  spyOn(SessionStatus, "set").mockImplementation(() => {})
  spyOn(Bus, "publish").mockResolvedValue(undefined as never)
  spyOn(Session, "updateMessage").mockResolvedValue(undefined as never)
  spyOn(SessionSummary, "summarize").mockImplementation(() => {})
  spyOn(SessionCompaction, "isOverflow").mockResolvedValue(false)
  spyOn(Snapshot, "track").mockResolvedValue("snap_invalid_tool_call")
  spyOn(PermissionNext, "ask").mockResolvedValue(undefined as never)

  const store = new Map<string, Message.Part>()
  spyOn(Session, "updatePart").mockImplementation(async (part) => {
    store.set(part.id, part as Message.Part)
    return part as never
  })
  spyOn(Message, "parts").mockImplementation(
    (async (messageID: string) =>
      [...store.values()].filter((p) => p.messageID === messageID)) as typeof Message.parts,
  )

  const messageID = "msg_invalid_tool_call"
  const parseError = "Invalid tool input for register_goal: expected object, received array"
  spyOn(LLM, "stream").mockResolvedValue({
    fullStream: streamOf([
      { type: "tool-input-start", toolCallId: "call_invalid", toolName: "register_goal" },
      {
        type: "tool-call",
        toolCallId: "call_invalid",
        toolName: "register_goal",
        input: [],
        invalid: true,
        error: new Error(parseError),
      },
      {
        type: "tool-error",
        toolCallId: "call_invalid",
        toolName: "register_goal",
        input: [],
        error: parseError,
      },
      {
        type: "finish-step",
        finishReason: "tool-calls",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 2,
        },
      },
      {
        type: "finish",
        finishReason: "tool-calls",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 2,
        },
      },
    ]),
  } as Awaited<ReturnType<typeof LLM.stream>>)

  const processor = SessionProcessor.create({
    assistantMessage: {
      id: messageID,
      sessionID: "ses_invalid_tool_call",
      role: "assistant",
      agent: "architect",
      parentID: "msg_parent",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    } as Message.Assistant,
    sessionID: "ses_invalid_tool_call",
    model: {
      providerID: "test-provider",
      id: "test-model",
      api: { npm: "@ai-sdk/openai" },
    } as Provider.Model,
    abort: new AbortController().signal,
  })

  await processor.process({} as LLM.StreamInput)

  const part = [...store.values()].find((p): p is Message.ToolPart => p.type === "tool" && p.callID === "call_invalid")
  expect(part?.state.status).toBe("error")
  expect(part?.state.status === "error" ? part.state.failure.message : "").toContain(parseError)
  expect(part?.state.status === "error" ? part.state.input : undefined).toEqual([])
})

test("session processor pauses terminal payload generation at tool-input-start for pre-submit reflection", async () => {
  spyOn(Config, "get").mockResolvedValue({ experimental: {} } as Awaited<ReturnType<typeof Config.get>>)
  spyOn(EngineConfig, "get").mockResolvedValue({
    activity: { session_llm_idle_ms: 60 },
  } as Awaited<ReturnType<typeof EngineConfig.get>>)
  spyOn(SessionStatus, "set").mockImplementation(() => {})
  spyOn(Bus, "publish").mockResolvedValue(undefined as never)
  spyOn(Session, "updateMessage").mockResolvedValue(undefined as never)
  spyOn(PermissionNext, "ask").mockResolvedValue(undefined as never)

  const store = new Map<string, Message.Part>()
  spyOn(Session, "updatePart").mockImplementation(async (part) => {
    store.set(part.id, part as Message.Part)
    return part as never
  })
  spyOn(Session, "updatePartDelta").mockImplementation(async () => undefined as never)
  spyOn(Message, "parts").mockImplementation(
    (async (messageID: string) =>
      [...store.values()].filter((p) => p.messageID === messageID)) as typeof Message.parts,
  )

  let payloadConsumed = false
  let streamClosed = false
  const terminalStream: AsyncIterable<any> = {
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        async next() {
          index += 1
          if (index === 1) return { done: false, value: { type: "start" } }
          if (index === 2) {
            return {
              done: false,
              value: {
                type: "tool-input-start",
                toolCallId: "call_terminal",
                toolName: "report_build_result",
              },
            }
          }
          payloadConsumed = true
          return {
            done: false,
            value: {
              type: "tool-input-delta",
              toolCallId: "call_terminal",
              toolName: "report_build_result",
              inputTextDelta: "{\"summary\":\"large terminal payload\"}",
            },
          }
        },
        async return() {
          streamClosed = true
          return { done: true, value: undefined }
        },
      }
    },
  }

  spyOn(LLM, "stream").mockResolvedValue({
    fullStream: terminalStream,
  } as Awaited<ReturnType<typeof LLM.stream>>)

  const processor = SessionProcessor.create({
    assistantMessage: {
      id: "msg_pre_submit_reflection",
      sessionID: "ses_pre_submit_reflection",
      role: "assistant",
      agent: "build",
      parentID: "msg_parent",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    } as Message.Assistant,
    sessionID: "ses_pre_submit_reflection",
    model: { providerID: "test-provider", id: "test-model" } as Provider.Model,
    abort: new AbortController().signal,
  })

  const result = await processor.process({
    preTerminalToolInputStart: ({ toolName }) =>
      toolName === "report_build_result"
        ? {
          title: "Pre-terminal Reflection Required",
          output: "reflect first",
          metadata: { preTerminalReflection: true },
        }
        : undefined,
  } as LLM.StreamInput)

  expect(result).toBe("continue")
  expect(payloadConsumed).toBe(false)
  expect(streamClosed).toBe(true)
  const toolParts = [...store.values()].filter((p): p is Message.ToolPart => p.type === "tool")
  expect(toolParts).toHaveLength(1)
  expect(toolParts[0]!.tool).toBe("report_build_result")
  expect(toolParts[0]!.state.status).toBe("completed")
  expect((toolParts[0]!.state as Message.ToolStateCompleted).output).toBe("reflect first")
  expect((toolParts[0]!.state as Message.ToolStateCompleted).input).toEqual({})
})

test("session processor closes a persisted running tool part when only the result event is in memory", async () => {
  spyOn(Config, "get").mockResolvedValue({ experimental: {} } as Awaited<ReturnType<typeof Config.get>>)
  spyOn(EngineConfig, "get").mockResolvedValue({
    activity: { session_llm_idle_ms: 60 },
  } as Awaited<ReturnType<typeof EngineConfig.get>>)
  spyOn(SessionStatus, "set").mockImplementation(() => {})
  spyOn(Bus, "publish").mockResolvedValue(undefined as never)
  spyOn(Session, "updateMessage").mockResolvedValue(undefined as never)
  spyOn(SessionSummary, "summarize").mockImplementation(() => {})
  spyOn(SessionCompaction, "isOverflow").mockResolvedValue(false)
  spyOn(Snapshot, "track").mockResolvedValue("snap_persisted_tool_result")

  const messageID = "msg_persisted_tool_result"
  const store = new Map<string, Message.Part>()
  store.set("prt_persisted_merge", {
    id: "prt_persisted_merge",
    messageID,
    sessionID: "ses_persisted_tool_result",
    type: "tool",
    callID: "call_persisted_merge",
    tool: "merge_back",
    state: {
      status: "running",
      input: {},
      time: { start: Date.now() - 10 },
    },
  } as Message.ToolPart)
  spyOn(Session, "updatePart").mockImplementation(async (part) => {
    store.set(part.id, part as Message.Part)
    return part as never
  })
  spyOn(Message, "parts").mockImplementation(
    (async (id: string) =>
      [...store.values()].filter((p) => p.messageID === id)) as typeof Message.parts,
  )
  spyOn(LLM, "stream").mockResolvedValue({
    fullStream: streamOf([
      {
        type: "tool-result",
        toolCallId: "call_persisted_merge",
        toolName: "merge_back",
        input: {},
        output: { output: "{\"status\":\"merged\"}" },
      },
      {
        type: "finish-step",
        finishReason: "tool-calls",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 2,
        },
      },
      { type: "finish", finishReason: "tool-calls" },
    ]),
  } as Awaited<ReturnType<typeof LLM.stream>>)

  const processor = SessionProcessor.create({
    assistantMessage: {
      id: messageID,
      sessionID: "ses_persisted_tool_result",
      role: "assistant",
      agent: "build",
      parentID: "msg_parent",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    } as Message.Assistant,
    sessionID: "ses_persisted_tool_result",
    model: {
      providerID: "test-provider",
      id: "test-model",
      api: { npm: "@ai-sdk/openai" },
    } as Provider.Model,
    abort: new AbortController().signal,
  })

  await processor.process({} as LLM.StreamInput)

  const part = store.get("prt_persisted_merge") as Message.ToolPart
  expect(part.state.status).toBe("completed")
  expect(part.state.status === "completed" ? part.state.output : undefined).toBe("{\"status\":\"merged\"}")
})

test("session processor closes a persisted running tool part when only the error event is in memory", async () => {
  spyOn(Config, "get").mockResolvedValue({ experimental: {} } as Awaited<ReturnType<typeof Config.get>>)
  spyOn(EngineConfig, "get").mockResolvedValue({
    activity: { session_llm_idle_ms: 60 },
  } as Awaited<ReturnType<typeof EngineConfig.get>>)
  spyOn(SessionStatus, "set").mockImplementation(() => {})
  spyOn(Bus, "publish").mockResolvedValue(undefined as never)
  spyOn(Session, "updateMessage").mockResolvedValue(undefined as never)
  spyOn(SessionSummary, "summarize").mockImplementation(() => {})
  spyOn(SessionCompaction, "isOverflow").mockResolvedValue(false)
  spyOn(Snapshot, "track").mockResolvedValue("snap_persisted_tool_error")

  const messageID = "msg_persisted_tool_error"
  const store = new Map<string, Message.Part>()
  store.set("prt_persisted_error", {
    id: "prt_persisted_error",
    messageID,
    sessionID: "ses_persisted_tool_error",
    type: "tool",
    callID: "call_persisted_error",
    tool: "merge_back",
    state: {
      status: "running",
      input: {},
      time: { start: Date.now() - 10 },
    },
  } as Message.ToolPart)
  spyOn(Session, "updatePart").mockImplementation(async (part) => {
    store.set(part.id, part as Message.Part)
    return part as never
  })
  spyOn(Message, "parts").mockImplementation(
    (async (id: string) =>
      [...store.values()].filter((p) => p.messageID === id)) as typeof Message.parts,
  )
  spyOn(LLM, "stream").mockResolvedValue({
    fullStream: streamOf([
      {
        type: "tool-error",
        toolCallId: "call_persisted_error",
        toolName: "merge_back",
        input: {},
        error: "merge failed",
      },
      {
        type: "finish-step",
        finishReason: "tool-calls",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 2,
        },
      },
      { type: "finish", finishReason: "tool-calls" },
    ]),
  } as Awaited<ReturnType<typeof LLM.stream>>)

  const processor = SessionProcessor.create({
    assistantMessage: {
      id: messageID,
      sessionID: "ses_persisted_tool_error",
      role: "assistant",
      agent: "build",
      parentID: "msg_parent",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    } as Message.Assistant,
    sessionID: "ses_persisted_tool_error",
    model: {
      providerID: "test-provider",
      id: "test-model",
      api: { npm: "@ai-sdk/openai" },
    } as Provider.Model,
    abort: new AbortController().signal,
  })

  await processor.process({} as LLM.StreamInput)

  const part = store.get("prt_persisted_error") as Message.ToolPart
  expect(part.state.status).toBe("error")
  expect(part.state.status === "error" ? part.state.failure.message : "").toContain("merge failed")
})

test("session processor marks a superseded duplicate merge_back call instead of losing the open part", async () => {
  spyOn(Config, "get").mockResolvedValue({ experimental: {} } as Awaited<ReturnType<typeof Config.get>>)
  spyOn(EngineConfig, "get").mockResolvedValue({
    activity: { session_llm_idle_ms: 60 },
  } as Awaited<ReturnType<typeof EngineConfig.get>>)
  spyOn(SessionStatus, "set").mockImplementation(() => {})
  spyOn(Bus, "publish").mockResolvedValue(undefined as never)
  spyOn(Session, "updateMessage").mockResolvedValue(undefined as never)
  spyOn(SessionSummary, "summarize").mockImplementation(() => {})
  spyOn(SessionCompaction, "isOverflow").mockResolvedValue(false)
  spyOn(Snapshot, "track").mockResolvedValue("snap_duplicate_merge_back")

  const messageID = "msg_duplicate_merge_back"
  const store = new Map<string, Message.Part>()
  spyOn(Session, "updatePart").mockImplementation(async (part) => {
    store.set(part.id, part as Message.Part)
    return part as never
  })
  spyOn(Message, "parts").mockImplementation(
    (async (id: string) =>
      [...store.values()].filter((p) => p.messageID === id)) as typeof Message.parts,
  )
  spyOn(LLM, "stream").mockResolvedValue({
    fullStream: streamOf([
      { type: "tool-call", toolCallId: "call_merge_first", toolName: "merge_back", input: {} },
      { type: "tool-call", toolCallId: "call_merge_second", toolName: "merge_back", input: {} },
      {
        type: "tool-result",
        toolCallId: "call_merge_second",
        toolName: "merge_back",
        input: {},
        output: { output: "{\"status\":\"merged\",\"primary_head\":\"abc\"}" },
      },
      {
        type: "finish-step",
        finishReason: "tool-calls",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 2,
        },
      },
      { type: "finish", finishReason: "tool-calls" },
    ]),
  } as Awaited<ReturnType<typeof LLM.stream>>)

  const processor = SessionProcessor.create({
    assistantMessage: {
      id: messageID,
      sessionID: "ses_duplicate_merge_back",
      role: "assistant",
      agent: "build",
      parentID: "msg_parent",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    } as Message.Assistant,
    sessionID: "ses_duplicate_merge_back",
    model: {
      providerID: "test-provider",
      id: "test-model",
      api: { npm: "@ai-sdk/openai" },
    } as Provider.Model,
    abort: new AbortController().signal,
  })

  await processor.process({} as LLM.StreamInput)

  const first = [...store.values()].find(
    (p): p is Message.ToolPart => p.type === "tool" && p.callID === "call_merge_first",
  )
  const second = [...store.values()].find(
    (p): p is Message.ToolPart => p.type === "tool" && p.callID === "call_merge_second",
  )
  expect(first?.state.status).toBe("error")
  expect(first?.state.status === "error" ? first.state.failure.name : "").toBe("SupersededDuplicateToolCall")
  expect(second?.state.status).toBe("completed")
})

test("session processor throws when a clean finish leaves an open tool part", async () => {
  spyOn(Config, "get").mockResolvedValue({ experimental: {} } as Awaited<ReturnType<typeof Config.get>>)
  spyOn(EngineConfig, "get").mockResolvedValue({
    activity: { session_llm_idle_ms: 60 },
  } as Awaited<ReturnType<typeof EngineConfig.get>>)
  spyOn(SessionStatus, "set").mockImplementation(() => {})
  spyOn(Bus, "publish").mockResolvedValue(undefined as never)
  spyOn(Session, "updateMessage").mockResolvedValue(undefined as never)
  spyOn(SessionSummary, "summarize").mockImplementation(() => {})
  spyOn(SessionCompaction, "isOverflow").mockResolvedValue(false)
  spyOn(Snapshot, "track").mockResolvedValue("snap_lost_tool_part")

  const store = new Map<string, Message.Part>()
  spyOn(Session, "updatePart").mockImplementation(async (part) => {
    store.set(part.id, part as Message.Part)
    return part as never
  })
  spyOn(Message, "parts").mockImplementation(
    (async (messageID: string) =>
      [...store.values()].filter((p) => p.messageID === messageID)) as typeof Message.parts,
  )
  spyOn(LLM, "stream").mockResolvedValue({
    fullStream: streamOf([
      { type: "tool-input-start", toolCallId: "call_lost", toolName: "register_goal" },
      {
        type: "finish-step",
        finishReason: "tool-calls",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 2,
        },
      },
      { type: "finish", finishReason: "tool-calls" },
    ]),
  } as Awaited<ReturnType<typeof LLM.stream>>)

  const processor = SessionProcessor.create({
    assistantMessage: {
      id: "msg_lost_tool_part",
      sessionID: "ses_lost_tool_part",
      role: "assistant",
      agent: "architect",
      parentID: "msg_parent",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    } as Message.Assistant,
    sessionID: "ses_lost_tool_part",
    model: {
      providerID: "test-provider",
      id: "test-model",
      api: { npm: "@ai-sdk/openai" },
    } as Provider.Model,
    abort: new AbortController().signal,
  })

  await expect(processor.process({} as LLM.StreamInput)).rejects.toThrow(SessionProcessor.ProcessorLostPartsError)
})

test("session processor stamps open tool parts with the real activity abort cause", async () => {
  spyOn(Config, "get").mockResolvedValue({ experimental: {} } as Awaited<ReturnType<typeof Config.get>>)
  spyOn(EngineConfig, "get").mockResolvedValue({
    activity: { session_llm_idle_ms: 60 },
  } as Awaited<ReturnType<typeof EngineConfig.get>>)
  spyOn(SessionStatus, "set").mockImplementation(() => {})
  spyOn(Bus, "publish").mockResolvedValue(undefined as never)
  spyOn(Session, "updateMessage").mockResolvedValue(undefined as never)

  const store = new Map<string, Message.Part>()
  spyOn(Session, "updatePart").mockImplementation(async (part) => {
    store.set(part.id, part as Message.Part)
    return part as never
  })
  spyOn(Message, "parts").mockImplementation(
    (async (messageID: string) =>
      [...store.values()].filter((p) => p.messageID === messageID)) as typeof Message.parts,
  )
  spyOn(LLM, "stream").mockResolvedValue({
    fullStream: stalledAfter([
      { type: "tool-input-start", toolCallId: "call_abort", toolName: "register_goal" },
    ]),
  } as Awaited<ReturnType<typeof LLM.stream>>)

  const abort = new AbortController()
  const processor = SessionProcessor.create({
    assistantMessage: {
      id: "msg_abort_tool_part",
      sessionID: "ses_abort_tool_part",
      role: "assistant",
      agent: "architect",
      parentID: "msg_parent",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    } as Message.Assistant,
    sessionID: "ses_abort_tool_part",
    model: {
      providerID: "test-provider",
      id: "test-model",
      api: { npm: "@ai-sdk/openai" },
    } as Provider.Model,
    abort: abort.signal,
  })

  setTimeout(() => abort.abort(new Error("operator cancelled stalled stream")), 30)
  const result = await Promise.race([
    processor.process({} as LLM.StreamInput),
    Bun.sleep(500).then(() => "timed-out" as const),
  ])

  expect(result).toBe("stop")
  const part = [...store.values()].find((p): p is Message.ToolPart => p.type === "tool" && p.callID === "call_abort")
  expect(part?.state.status).toBe("error")
  expect(part?.state.status === "error" ? part.state.failure.message : "").toContain("external abort signal fired")
})
