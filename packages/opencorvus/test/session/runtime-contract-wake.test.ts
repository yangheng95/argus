import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import type { Provider } from "../../src/provider/provider"
import { ProviderTransform } from "../../src/provider/transform"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { SessionPrompt } from "../../src/session/prompt"
import { Snapshot } from "../../src/snapshot"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { installControlModel } from "../workspace/mock-control-model"

function streamOf(events: Array<Record<string, unknown>>): AsyncIterable<any> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event
    },
  }
}

function hexinClaudeModel(): Provider.Model {
  return {
    id: "hexin/cy-claude-sonnet-4-6",
    providerID: "hexin",
    name: "Hexin Claude",
    api: {
      id: "cy-claude-sonnet-4-6",
      url: "https://aimemodeldev.myhexin.com/litellm/v1",
      npm: "@ai-sdk/openai-compatible",
    },
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, image: false, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, input: 128_000, output: 32_000 },
    options: {},
    headers: {},
  } as Provider.Model
}

async function normalizedClaudeMessages(input: LLM.StreamInput) {
  return await ProviderTransform.message(input.messages, hexinClaudeModel(), {})
}

describe("session runtime contract wakes", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })
    installControlModel()
  })

  afterEach(async () => {
    mock.restore()
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test(
    "internal orchestrator wake runs one turn without appending a user message or replaying stale user system",
    async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          spyOn(Snapshot, "track").mockResolvedValue("snap_runtime_wake")
          spyOn(Snapshot, "patch").mockResolvedValue({ files: [], hash: "hash_runtime_wake" } as never)

          const streamInputs: LLM.StreamInput[] = []
          spyOn(LLM, "stream").mockImplementation((async (input: LLM.StreamInput) => {
            streamInputs.push(input)
            return {
              fullStream: streamOf([
                {
                  type: "finish-step",
                  finishReason: "stop",
                  usage: {
                    inputTokens: 0,
                    outputTokens: 0,
                    reasoningTokens: 0,
                    cachedInputTokens: 0,
                    totalTokens: 0,
                  },
                },
                { type: "finish", finishReason: "stop" },
              ]),
            } as Awaited<ReturnType<typeof LLM.stream>>
          }) as typeof LLM.stream)

          const now = Date.now()
          const session = await Session.create({ kind: "orchestrator", title: "Runtime wake test" })
          await Session.mergeConfigOverlay({
            sessionID: session.id,
            patch: { model: "mock-control/control" },
          })
          const user = await Session.updateMessage({
            id: Identifier.ascending("message"),
            role: "user",
            sessionID: session.id,
            time: { created: now },
            agent: "orchestrator",
            model: { providerID: "mock-control", modelID: "control" },
            system: "STALE_USER_SYSTEM",
            systemMode: "complete",
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            type: "text",
            sessionID: session.id,
            messageID: user.id,
            text: "original visible request",
          })
          const priorAssistant = await Session.updateMessage({
            id: Identifier.ascending("message"),
            role: "assistant",
            sessionID: session.id,
            parentID: user.id,
            time: { created: now + 1, completed: now + 1 },
            agent: "orchestrator",
            modelID: "control",
            providerID: "mock-control",
            path: { cwd: tmp.path, root: tmp.path },
            finish: "stop",
            cost: 0,
            tokens: {
              total: 0,
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            type: "text",
            sessionID: session.id,
            messageID: priorAssistant.id,
            text: "prior local narration",
          })

          SessionPrompt.setSessionRuntimeContract(session.id, {
            identity: {
              sessionID: session.id,
              agentKind: "orchestrator",
              contractKind: "orchestrator-wake",
              installedAt: now,
            },
            system: ["FRESH_RUNTIME_SYSTEM"],
            systemMode: "complete",
            runOnce: true,
            tools: {},
          })

          const result = await Promise.race([
            SessionPrompt.loop({ sessionID: session.id }),
            Bun.sleep(10_000).then(() => undefined),
          ])

          expect(result).toBeDefined()
          expect(streamInputs).toHaveLength(1)
          expect(streamInputs[0]!.runtimeSystemMode).toBe("complete")
          expect(streamInputs[0]!.system.join("\n")).toContain("FRESH_RUNTIME_SYSTEM")
          const providerMessages = await normalizedClaudeMessages(streamInputs[0]!)
          expect(providerMessages.at(-1)?.role).toBe("user")
          const composedSystem = await LLM.composeSystem(streamInputs[0]!)
          expect(composedSystem.join("\n")).toContain("FRESH_RUNTIME_SYSTEM")
          expect(composedSystem.join("\n")).not.toContain("STALE_USER_SYSTEM")
          expect(SessionPrompt.getSessionRuntimeContract(session.id)?.runOnce).toBe(false)

          const messages = await Session.messages({ sessionID: session.id })
          expect(messages.filter((message) => message.info.role === "user")).toHaveLength(1)
          expect(messages.filter((message) => message.info.role === "assistant")).toHaveLength(2)

          SessionPrompt.clearSessionRuntimeContract(session.id)
        },
      })
    },
    { timeout: 20_000 },
  )

  test(
    "internal orchestrator wake resumes an existing standby loop without a new user message",
    async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          spyOn(Snapshot, "track").mockResolvedValue("snap_runtime_standby_wake")
          spyOn(Snapshot, "patch").mockResolvedValue({ files: [], hash: "hash_runtime_standby_wake" } as never)

          const streamInputs: LLM.StreamInput[] = []
          spyOn(LLM, "stream").mockImplementation((async (input: LLM.StreamInput) => {
            streamInputs.push(input)
            return {
              fullStream: streamOf([
                {
                  type: "finish-step",
                  finishReason: "stop",
                  usage: {
                    inputTokens: 0,
                    outputTokens: 0,
                    reasoningTokens: 0,
                    cachedInputTokens: 0,
                    totalTokens: 0,
                  },
                },
                { type: "finish", finishReason: "stop" },
              ]),
            } as Awaited<ReturnType<typeof LLM.stream>>
          }) as typeof LLM.stream)

          const now = Date.now()
          const session = await Session.create({ kind: "orchestrator", title: "Runtime standby wake test" })
          await Session.mergeConfigOverlay({
            sessionID: session.id,
            patch: { model: "mock-control/control" },
          })
          const user = await Session.updateMessage({
            id: Identifier.ascending("message"),
            role: "user",
            sessionID: session.id,
            time: { created: now },
            agent: "orchestrator",
            model: { providerID: "mock-control", modelID: "control" },
            system: "STALE_USER_SYSTEM",
            systemMode: "complete",
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            type: "text",
            sessionID: session.id,
            messageID: user.id,
            text: "original visible request",
          })
          const priorAssistant = await Session.updateMessage({
            id: Identifier.ascending("message"),
            role: "assistant",
            sessionID: session.id,
            parentID: user.id,
            time: { created: now + 1, completed: now + 1 },
            agent: "orchestrator",
            modelID: "control",
            providerID: "mock-control",
            path: { cwd: tmp.path, root: tmp.path },
            finish: "stop",
            cost: 0,
            tokens: {
              total: 0,
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            type: "text",
            sessionID: session.id,
            messageID: priorAssistant.id,
            text: "prior standby narration",
          })

          const standbyResult = await Promise.race([
            SessionPrompt.loop({ sessionID: session.id }),
            Bun.sleep(10_000).then(() => undefined),
          ])

          expect(standbyResult?.info.id).toBe(priorAssistant.id)
          expect(streamInputs).toHaveLength(0)

          SessionPrompt.setSessionRuntimeContract(session.id, {
            identity: {
              sessionID: session.id,
              agentKind: "orchestrator",
              contractKind: "orchestrator-wake",
              installedAt: now,
            },
            system: ["FRESH_RUNTIME_SYSTEM"],
            systemMode: "complete",
            runOnce: true,
            tools: {},
          })

          const wakeResult = await Promise.race([
            SessionPrompt.loop({ sessionID: session.id }),
            Bun.sleep(10_000).then(() => undefined),
          ])

          expect(wakeResult).toBeDefined()
          expect(streamInputs).toHaveLength(1)
          expect(streamInputs[0]!.runtimeSystemMode).toBe("complete")
          const providerMessages = await normalizedClaudeMessages(streamInputs[0]!)
          expect(providerMessages.at(-1)?.role).toBe("user")
          const composedSystem = await LLM.composeSystem(streamInputs[0]!)
          expect(composedSystem.join("\n")).toContain("FRESH_RUNTIME_SYSTEM")
          expect(composedSystem.join("\n")).not.toContain("STALE_USER_SYSTEM")
          expect(SessionPrompt.getSessionRuntimeContract(session.id)?.runOnce).toBe(false)

          const messages = await Session.messages({ sessionID: session.id })
          expect(messages.filter((message) => message.info.role === "user")).toHaveLength(1)
          expect(messages.filter((message) => message.info.role === "assistant")).toHaveLength(2)

          SessionPrompt.clearSessionRuntimeContract(session.id)
        },
      })
    },
    { timeout: 25_000 },
  )

  test(
    "max-step instruction is sent as system context instead of assistant prefill",
    async () => {
      await tmp?.[Symbol.asyncDispose]?.()
      tmp = await tmpdir({
        git: true,
        config: {
          model: "mock-control/control",
          agent: { orchestrator: { steps: 1 } },
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          spyOn(Snapshot, "track").mockResolvedValue("snap_max_step_prefill")
          spyOn(Snapshot, "patch").mockResolvedValue({ files: [], hash: "hash_max_step_prefill" } as never)

          const streamInputs: LLM.StreamInput[] = []
          spyOn(LLM, "stream").mockImplementation((async (input: LLM.StreamInput) => {
            streamInputs.push(input)
            return {
              fullStream: streamOf([
                {
                  type: "finish-step",
                  finishReason: "stop",
                  usage: {
                    inputTokens: 0,
                    outputTokens: 0,
                    reasoningTokens: 0,
                    cachedInputTokens: 0,
                    totalTokens: 0,
                  },
                },
                { type: "finish", finishReason: "stop" },
              ]),
            } as Awaited<ReturnType<typeof LLM.stream>>
          }) as typeof LLM.stream)

          const now = Date.now()
          const session = await Session.create({ kind: "orchestrator", title: "Max step prefill test" })
          await Session.mergeConfigOverlay({
            sessionID: session.id,
            patch: { model: "mock-control/control" },
          })
          const user = await Session.updateMessage({
            id: Identifier.ascending("message"),
            role: "user",
            sessionID: session.id,
            time: { created: now },
            agent: "orchestrator",
            model: { providerID: "mock-control", modelID: "control" },
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            type: "text",
            sessionID: session.id,
            messageID: user.id,
            text: "trigger one bounded turn",
          })
          SessionPrompt.setSessionRuntimeContract(session.id, {
            identity: {
              sessionID: session.id,
              agentKind: "orchestrator",
              contractKind: "orchestrator-wake",
              installedAt: now,
            },
            system: [],
            systemMode: "complete",
            runOnce: true,
            tools: {},
          })

          const result = await Promise.race([
            SessionPrompt.loop({ sessionID: session.id }),
            Bun.sleep(10_000).then(() => undefined),
          ])

          expect(result).toBeDefined()
          expect(streamInputs).toHaveLength(1)
          expect(streamInputs[0]!.messages.at(-1)?.role).toBe("user")
          expect(streamInputs[0]!.system.join("\n")).toContain("CRITICAL - MAXIMUM STEPS REACHED")
          SessionPrompt.clearSessionRuntimeContract(session.id)
        },
      })
    },
    { timeout: 20_000 },
  )
})
