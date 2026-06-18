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
import { WorkerTurnDescriptor } from "../../src/agent/worker-turn-descriptor"
import { AgentRuntimeMetadata } from "../../src/session/agent-runtime-metadata"
import type { SessionKind } from "../../src/session/session.sql"

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
      parts: [
        {
          id: "prt_runner_prompt_assistant",
          sessionID: input.sessionID,
          messageID: "msg_runner_prompt_assistant",
          type: "text",
          text: "done",
        },
      ],
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
  expect(promptCalls[0].system.startsWith(BUILD_CORE)).toBe(true)
  expect(promptCalls[0].system.endsWith("Additional build instruction")).toBe(true)
  expect(promptCalls[0].extra?.runtimeContract).toBeUndefined()
  expect(promptCalls[0].extra?.workerTurnDescriptor).toBeDefined()
  const descriptor = WorkerTurnDescriptor.latestForSession(promptCalls[0].sessionID)
  expect(descriptor?.agent).toBe("build")
  expect(descriptor?.payload.model).toEqual({ providerID: "test", modelID: "mock" })
  expect(descriptor?.payload.workflow.sessionKind).toBe("build")
  expect(descriptor?.payload.output.resultMode).toBe("reply")
  expect(descriptor?.payload.tools.enabled).toEqual([])
  expect(descriptor?.payload.tools.switches).toMatchObject({
    skill: true,
    task: false,
    webfetch: false,
    websearch: false,
    external_code_search: false,
    memory: false,
    planner: false,
    goal_report: false,
  })
  expect((promptCalls[0].extra?.workerTurnDescriptor as { id: string }).id).toBe(descriptor?.id)
})

test("runAgentSession passes taskID to registry tool execution context", async () => {
  mock.module("@/agent/model", () => ({
    resolveAgentModel: async () => ({
      providerID: "test",
      api: { id: "mock" },
    }),
  }))
  const { runAgentSession } = await import("../../src/agent/runner")

  await using tmp = await tmpdir({ git: true })

  const promptCalls: Array<Parameters<typeof SessionPrompt.prompt>[0]> = []
  spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
    promptCalls.push(input)
    return {
      info: {
        id: "msg_runner_task_context_assistant",
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
      parts: [
        {
          id: "prt_runner_task_context_assistant",
          sessionID: input.sessionID,
          messageID: "msg_runner_task_context_assistant",
          type: "text",
          text: "done",
        },
      ],
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
      const { Session } = await import("../../src/session")
      const root = await Session.createNext({
        kind: "orchestrator",
        title: "Registry tool context root",
        directory: tmp.path,
      })
      const taskID = "tsk_runner_registry_tool_context"
      const now = Date.now()
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: root.id,
            source: "test",
            title: "registry tool context",
            request: "exercise task-scoped registry tools",
            priority: "normal",
            time_created: now,
            time_updated: now,
          })
          .run(),
      )

      await runAgentSession({
        kind: "build",
        core: BUILD_CORE,
        sessionTitle: "task-scoped registry tool context",
        taskID,
        toolKit,
        buildUserPrompt: () => "implement the request",
      })

      expect(promptCalls).toHaveLength(1)
      expect(promptCalls[0].extra?.taskID).toBe(taskID)
      expect(promptCalls[0].extra?.workerTurnDescriptor).toBeDefined()
    },
  })
})

test("runAgentSession installs live runtime contracts for every migrated worker agent", async () => {
  mock.module("@/agent/model", () => ({
    resolveAgentModel: async () => ({
      providerID: "test",
      api: { id: "mock" },
    }),
  }))
  const { runAgentSession } = await import("../../src/agent/runner")

  await using tmp = await tmpdir({ git: true })

  const promptCalls: Array<Parameters<typeof SessionPrompt.prompt>[0]> = []
  spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
    promptCalls.push(input)
    return {
      info: {
        id: `msg_runner_live_contract_${promptCalls.length}`,
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
      parts: [
        {
          id: `prt_runner_live_contract_${promptCalls.length}`,
          sessionID: input.sessionID,
          messageID: `msg_runner_live_contract_${promptCalls.length}`,
          type: "text",
          text: "done",
        },
      ],
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
      for (const kind of AgentRuntimeMetadata.LIVE_RUNTIME_CONTINUATION_SESSION_KINDS) {
        const out = await runAgentSession({
          kind: kind as SessionKind,
          core: `${kind} core`,
          sessionTitle: `${kind} live contract`,
          toolKit,
          buildUserPrompt: () => `${kind} prompt`,
        })
        const descriptor = WorkerTurnDescriptor.latestForSession(out.session.id)
        const contract = SessionPrompt.getSessionRuntimeContract(out.session.id)
        expect(descriptor?.payload.workflow.sessionKind).toBe(kind)
        expect(descriptor?.payload.agent).toBe(kind)
        expect(contract?.identity.agentKind).toBe(kind)
        expect(contract?.identity.workerTurnDescriptorID).toBe(descriptor?.id)
        expect(contract?.identity.workerTurnDescriptorHash).toBe(descriptor?.hash)
        const promptCall = promptCalls.at(-1)
        expect(promptCall?.system.startsWith(`${kind} core`)).toBe(true)
        expect(contract?.system).toEqual([promptCall?.system])
        expect(promptCall?.extra?.workerTurnDescriptor).toEqual({
          id: descriptor?.id,
          hash: descriptor?.hash,
        })
        SessionPrompt.clearSessionRuntimeContract(out.session.id)
      }
    },
  })

  expect(promptCalls.map((call) => call.agent)).toEqual([
    ...AgentRuntimeMetadata.LIVE_RUNTIME_CONTINUATION_SESSION_KINDS,
  ])
})

test("runAgentSession does not hide-recover when terminal collector is still unsatisfied", async () => {
  mock.module("@/agent/model", () => ({
    resolveAgentModel: async () => ({
      providerID: "test",
      api: { id: "mock" },
    }),
  }))
  const { AgentRunError, runAgentSession } = await import("../../src/agent/runner")

  await using tmp = await tmpdir({ git: true })

  let promptCount = 0
  spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
    promptCount += 1
    return {
      info: {
        id: `msg_runner_unsatisfied_terminal_${promptCount}`,
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
      parts: [
        {
          id: `prt_runner_unsatisfied_terminal_${promptCount}`,
          sessionID: input.sessionID,
          messageID: `msg_runner_unsatisfied_terminal_${promptCount}`,
          type: "text",
          text: "done without terminal report",
        },
      ],
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
      expect(promptCount).toBe(1)
      expect(thrown).toBeInstanceOf(AgentRunError)
      expect((thrown as Error).message).toContain("report_build_result")
      expect(Message.TerminalToolMissingError.isInstance((thrown as Error).cause as Error)).toBe(true)
    },
  })
})

test("runAgentSession does not retry terminal protocol misses inside the runner", async () => {
  mock.module("@/agent/model", () => ({
    resolveAgentModel: async () => ({
      providerID: "test",
      api: { id: "mock" },
    }),
  }))
  const { AgentRunError, runAgentSession } = await import("../../src/agent/runner")

  await using tmp = await tmpdir({ git: true })

  let promptCount = 0
  spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
    promptCount += 1
    return {
      info: {
        id: `msg_runner_terminal_exhausted_${promptCount}`,
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
      parts: [
        {
          id: `prt_runner_terminal_exhausted_${promptCount}`,
          sessionID: input.sessionID,
          messageID: `msg_runner_terminal_exhausted_${promptCount}`,
          type: "text",
          text: "still no terminal report",
        },
      ],
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
          sessionTitle: "terminal exhausted",
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
      expect(promptCount).toBe(1)
      expect(thrown).toBeInstanceOf(AgentRunError)
      expect((thrown as Error).message).toContain("report_build_result")
      expect(Message.TerminalToolMissingError.isInstance((thrown as Error).cause as Error)).toBe(true)
    },
  })
})

test("runAgentSession does not hide-recover when structured output is missing", async () => {
  mock.module("@/agent/model", () => ({
    resolveAgentModel: async () => ({
      providerID: "test",
      api: { id: "mock" },
    }),
  }))
  const { AgentRunError, runAgentSession } = await import("../../src/agent/runner")

  await using tmp = await tmpdir({ git: true })

  let promptCount = 0
  spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
    promptCount += 1
    return {
      info: {
        id: `msg_runner_structured_recovery_${promptCount}`,
        sessionID: input.sessionID,
        role: "assistant",
        parentID: input.messageID,
        time: { created: Date.now() },
        agent: input.agent ?? "intent-analysis",
        providerID: input.model?.providerID ?? "test",
        modelID: input.model?.modelID ?? "mock",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        path: { cwd: tmp.path, root: tmp.path },
        error: new Message.StructuredOutputError({
          message: "Model did not produce structured output before the turn ended",
          retries: 0,
        }),
      },
      parts: [
        {
          id: `prt_runner_structured_recovery_${promptCount}`,
          sessionID: input.sessionID,
          messageID: `msg_runner_structured_recovery_${promptCount}`,
          type: "text",
          text: "plain text instead of structured output",
        },
      ],
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
      let thrown: unknown
      try {
        await runAgentSession({
          kind: "intent-analysis",
          core: "intent core",
          sessionTitle: "structured recovery",
          toolKit,
          buildUserPrompt: () => "classify the request",
          format: {
            schema: {
              type: "object",
              properties: { intent_class: { type: "string" } },
              required: ["intent_class"],
            },
          },
        })
      } catch (err) {
        thrown = err
      }

      expect(promptCount).toBe(1)
      expect(thrown).toBeInstanceOf(AgentRunError)
      expect((thrown as Error).message).toContain("StructuredOutputError")
    },
  })
})

test("runAgentSession does not recover non-finalizer provider errors", async () => {
  mock.module("@/agent/model", () => ({
    resolveAgentModel: async () => ({
      providerID: "test",
      api: { id: "mock" },
    }),
  }))
  const { AgentRunError, runAgentSession } = await import("../../src/agent/runner")

  await using tmp = await tmpdir({ git: true })

  let promptCount = 0
  spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
    promptCount += 1
    return {
      info: {
        id: `msg_runner_provider_error_${promptCount}`,
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
        error: {
          name: "APIError",
          data: {
            message: "provider rejected tool_choice",
            isRetryable: false,
          },
        },
      },
      parts: [
        {
          id: `prt_runner_provider_error_${promptCount}`,
          sessionID: input.sessionID,
          messageID: `msg_runner_provider_error_${promptCount}`,
          type: "text",
          text: "provider error",
        },
      ],
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
    buildReport: () => ({ summary: "provider error", detail: "provider error" }),
  }

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      let thrown: unknown
      try {
        await runAgentSession({
          kind: "build",
          core: BUILD_CORE,
          sessionTitle: "provider error",
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

      expect(promptCount).toBe(1)
      expect(thrown).toBeInstanceOf(AgentRunError)
      expect((thrown as Error).message).toContain("provider rejected tool_choice")
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
      parts: [
        {
          id: "prt_runner_context_assistant",
          sessionID: input.sessionID,
          messageID: "msg_runner_context_assistant",
          type: "text",
          text: "done",
        },
      ],
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
        db
          .insert(EngineTaskTable)
          .values({
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
          })
          .run(),
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
