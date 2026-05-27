import { afterEach, expect, mock, spyOn, test } from "bun:test"
import type { AgentToolKit } from "../../src/agent/runner"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { SessionPrompt } from "../../src/session/prompt"
import BUILD_CORE from "../../src/prompt/core/build-core.txt"
import { tmpdir } from "../fixture/fixture"
import { Message } from "../../src/session/message"
import { tool } from "ai"
import z from "zod"
import { Database } from "../../src/storage/db"
import { EngineTaskTable } from "../../src/engine/engine.sql"

afterEach(async () => {
  mock.restore()
  Config.global.reset()
  await Instance.disposeAll()
})

test("runAgentSession appends config.agent.build.prompt_append after build core", async () => {
  mock.module("@/agent/model", () => ({
    resolveAgentModel: async () => ({
      providerID: "test",
      api: { id: "mock" },
    }),
  }))
  const { runAgentSession } = await import("../../src/agent/runner")

  await using tmp = await tmpdir({
    git: true,
    config: {
      agent: {
        build: { prompt_append: "Additional build instruction" },
      },
    },
  })

  const promptCalls: Array<Parameters<typeof SessionPrompt.prompt>[0]> = []
  spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
    promptCalls.push(input)
    return {
      info: {
        id: "msg_runner_prompt_assistant",
        sessionID: input.sessionID,
        role: "assistant",
        parentID: input.messageID,
        time: { created: Date.now() },
        agent: input.agent ?? "build",
        providerID: input.model?.providerID ?? "test",
        modelID: input.model?.modelID ?? "mock",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        path: { cwd: tmp.path, root: tmp.path },
      },
      parts: [{
        id: "prt_runner_prompt_assistant",
        sessionID: input.sessionID,
        messageID: "msg_runner_prompt_assistant",
        type: "text",
        text: "done",
      }],
    } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
  })

  const toolKit: AgentToolKit<Record<string, never>> = {
    tools: {},
    getCollector: () => ({}),
    buildReport: () => ({ summary: "ok", detail: "ok" }),
  }

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await runAgentSession({
        kind: "build",
        core: BUILD_CORE,
        sessionTitle: "test build",
        toolKit,
        buildUserPrompt: () => "implement the request",
      })
    },
  })

  expect(promptCalls).toHaveLength(1)
  expect(promptCalls[0].agent).toBe("build")
  expect(promptCalls[0].systemMode).toBe("complete")
  expect(promptCalls[0].system).toBe(`${BUILD_CORE}\n\nAdditional build instruction`)
})

test("runAgentSession rejects completion when terminal collector is still unsatisfied", async () => {
  mock.module("@/agent/model", () => ({
    resolveAgentModel: async () => ({
      providerID: "test",
      api: { id: "mock" },
    }),
  }))
  const { AgentRunError, runAgentSession } = await import("../../src/agent/runner")

  await using tmp = await tmpdir({ git: true })

  spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
    return {
      info: {
        id: "msg_runner_unsatisfied_terminal",
        sessionID: input.sessionID,
        role: "assistant",
        parentID: input.messageID,
        time: { created: Date.now() },
        agent: input.agent ?? "build",
        providerID: input.model?.providerID ?? "test",
        modelID: input.model?.modelID ?? "mock",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        path: { cwd: tmp.path, root: tmp.path },
      },
      parts: [{
        id: "prt_runner_unsatisfied_terminal",
        sessionID: input.sessionID,
        messageID: "msg_runner_unsatisfied_terminal",
        type: "text",
        text: "done without terminal report",
      }],
    } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
  })

  type Collector = { done?: boolean }
  const collector: Collector = {}
  const toolKit: AgentToolKit<Collector> = {
    tools: {
      report_build_result: tool({
        inputSchema: z.object({}),
        execute: async () => {
          collector.done = true
          return "RECORDED"
        },
      }),
    },
    getCollector: () => collector,
    buildReport: () => ({ summary: "missing terminal", detail: "missing terminal" }),
  }

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      let thrown: unknown
      try {
        await runAgentSession({
          kind: "build",
          core: BUILD_CORE,
          sessionTitle: "terminal guard",
          toolKit,
          buildUserPrompt: () => "implement the request",
          terminalTool: {
            toolName: "report_build_result",
            isSatisfied: (value) => value.done === true,
            shouldExposeOnlyTerminalTool: () => false,
          },
        })
      } catch (err) {
        thrown = err
      }
      expect(thrown).toBeInstanceOf(AgentRunError)
      expect((thrown as Error).message).toContain("report_build_result")
      expect(Message.TerminalToolMissingError.isInstance((thrown as Error).cause as Error)).toBe(true)
    },
  })
})

test("runAgentSession writes child agent report while called from parent session context", async () => {
  mock.module("@/agent/model", () => ({
    resolveAgentModel: async () => ({
      providerID: "test",
      api: { id: "mock" },
    }),
  }))
  const { runAgentSession } = await import("../../src/agent/runner")
  const { AgentTrace } = await import("../../src/trace")
  const { Session } = await import("../../src/session")
  const { SessionContext } = await import("../../src/session/context")

  await using tmp = await tmpdir({ git: true })

  spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
    return {
      info: {
        id: "msg_runner_context_assistant",
        sessionID: input.sessionID,
        role: "assistant",
        parentID: input.messageID,
        time: { created: Date.now() },
        agent: input.agent ?? "build",
        providerID: input.model?.providerID ?? "test",
        modelID: input.model?.modelID ?? "mock",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        path: { cwd: tmp.path, root: tmp.path },
      },
      parts: [{
        id: "prt_runner_context_assistant",
        sessionID: input.sessionID,
        messageID: "msg_runner_context_assistant",
        type: "text",
        text: "done",
      }],
    } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
  })

  const toolKit: AgentToolKit<Record<string, never>> = {
    tools: {},
    getCollector: () => ({}),
    buildReport: () => ({ summary: "ok", detail: "ok" }),
  }

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const parent = await Session.createNext({
        kind: "orchestrator",
        title: "Parent orchestrator",
        directory: tmp.path,
      })
      const now = Date.now()
      Database.use((db) =>
        db.insert(EngineTaskTable).values({
          id: "tsk_runner_context",
          project_id: Instance.project.id,
          session_id: parent.id,
          source: "test",
          title: "runner context",
          request: "exercise child trace context",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        }).run(),
      )
      let childSessionID = ""

      await SessionContext.provide(parent, async () => {
        const out = await runAgentSession({
          kind: "build",
          core: BUILD_CORE,
          sessionTitle: "child build",
          parentSessionID: parent.id,
          taskID: "tsk_runner_context",
          toolKit,
          buildUserPrompt: () => "implement the request",
        })
        childSessionID = out.session.id
      })

      const childEvents = AgentTrace.readSessionEvents(childSessionID)
      expect(childEvents.some((event) => event.kind === "agent_report")).toBe(true)
      expect(AgentTrace.readSessionEvents(parent.id).some((event) => event.kind === "agent_report")).toBe(false)
    },
  })
})
