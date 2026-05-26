import { afterEach, expect, mock, spyOn, test } from "bun:test"
import type { AgentToolKit } from "../../src/agent/runner"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  mock.restore()
  Config.global.reset()
  await Instance.disposeAll()
})

function mockResolvedModel() {
  mock.module("@/agent/model", () => ({
    resolveAgentModel: async () => ({
      providerID: "test",
      api: { id: "mock" },
    }),
  }))
}

function mockPromptCapture(calls: Array<Parameters<typeof SessionPrompt.prompt>[0]>) {
  spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
    calls.push(input)
    return {
      info: {
        id: "msg_pre_terminal_assistant",
        sessionID: input.sessionID,
        role: "assistant",
        parentID: input.messageID,
        time: { created: Date.now() },
        agent: input.agent ?? "test-agent",
        providerID: input.model?.providerID ?? "test",
        modelID: input.model?.modelID ?? "mock",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        path: { cwd: Instance.directory, root: Instance.directory },
      },
      parts: [{
        id: "prt_pre_terminal_assistant",
        sessionID: input.sessionID,
        messageID: "msg_pre_terminal_assistant",
        type: "text",
        text: "done",
      }],
    } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
  })
}

test("runAgentSession appends pre-terminal reflection for terminal-tool agents", async () => {
  mockResolvedModel()
  const { runAgentSession } = await import("../../src/agent/runner")
  const calls: Array<Parameters<typeof SessionPrompt.prompt>[0]> = []
  mockPromptCapture(calls)

  await using tmp = await tmpdir({ git: true })
  const toolKit: AgentToolKit<{ finalized: boolean }> = {
    tools: { submit_requirements: {} as any },
    getCollector: () => ({ finalized: false }),
    buildReport: () => ({ summary: "ok", detail: "ok" }),
  }

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await runAgentSession({
        kind: "requirements",
        core: "Requirements core",
        sessionTitle: "requirements reflection",
        toolKit,
        buildUserPrompt: () => "extract requirements",
        terminalTool: {
          toolName: "submit_requirements",
          isSatisfied: (collector) => collector.finalized,
          shouldExposeOnlyTerminalTool: () => false,
        },
      })
    },
  })

  expect(calls).toHaveLength(1)
  expect(calls[0].system).toContain("# Pre-terminal Reflection")
  expect(calls[0].system).toContain("submit_requirements")
  expect(calls[0].system).toContain("prompt-visible original user request")
  expect(calls[0].system).toContain("system-provided authoritative request-bundle path")
}, 30_000)

test("runAgentSession appends pre-terminal reflection for StructuredOutput agents", async () => {
  mockResolvedModel()
  const { runAgentSession } = await import("../../src/agent/runner")
  const calls: Array<Parameters<typeof SessionPrompt.prompt>[0]> = []
  mockPromptCapture(calls)

  await using tmp = await tmpdir({ git: true })
  const toolKit: AgentToolKit<Record<string, never>> = {
    tools: {},
    getCollector: () => ({}),
    buildReport: () => ({ summary: "ok", detail: "ok" }),
  }

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await runAgentSession({
        kind: "intent-analysis",
        core: "Intent core",
        sessionTitle: "intent reflection",
        toolKit,
        buildUserPrompt: () => "classify intent",
        format: {
          schema: {
            type: "object",
            properties: { summary: { type: "string" } },
            required: ["summary"],
          },
        },
      })
    },
  })

  expect(calls).toHaveLength(1)
  expect(calls[0].system).toContain("# Pre-terminal Reflection")
  expect(calls[0].system).toContain("StructuredOutput")
  expect(calls[0].system).toContain("intent-analysis")
}, 30_000)
