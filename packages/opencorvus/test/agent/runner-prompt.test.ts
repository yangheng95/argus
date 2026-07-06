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
import {
  copyRepositoryExpertSquadPackage,
  PROJECT_EXPERT_SQUAD_ID,
  writeProjectExpertSquadPackage,
} from "../fixture/expert-squad"
import { PromptProfileResolver } from "../../src/expert-squad/prompt-profile-resolver"
import {
  claimStageContinuationRequest,
  createStageContinuationRequest,
  findStageContinuationRequest,
} from "../../src/engine/stage-continuation"

const RUNNER_PROMPT_TEST_TIMEOUT_MILLISECONDS = 30_000

afterEach(async () => {
  mock.restore()
  Config.global.reset()
  await Instance.disposeAll()
})

test(
  "runAgentSession appends config.agent.build.prompt_append after build core",
  async () => {
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
        prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID },
        agent: {
          build: { prompt_append: "Additional build instruction" },
        },
      },
    })
    await writeProjectExpertSquadPackage(tmp.path)
    const packageToolProviderName = PromptProfileResolver.packageToolProviderName(
      `${PROJECT_EXPERT_SQUAD_ID}/build/build-evidence`,
    )

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
    expect(promptCalls[0].system).toContain("project build overlay")
    expect(promptCalls[0].system.endsWith("Additional build instruction")).toBe(true)
    expect(promptCalls[0].system.indexOf(BUILD_CORE)).toBeLessThan(promptCalls[0].system.indexOf("project build overlay"))
    expect(promptCalls[0].system.indexOf("project build overlay")).toBeLessThan(
      promptCalls[0].system.indexOf("Additional build instruction"),
    )
    expect(promptCalls[0].extra?.runtimeContract).toBeUndefined()
    expect(promptCalls[0].extra?.workerTurnDescriptor).toBeDefined()
    const descriptor = WorkerTurnDescriptor.latestForSession(promptCalls[0].sessionID)
    expect(descriptor?.agent).toBe("build")
    expect(descriptor?.payload.model).toEqual({ providerID: "test", modelID: "mock" })
    expect(descriptor?.payload.workflow.sessionKind).toBe("build")
    expect(descriptor?.payload.output.resultMode).toBe("reply")
    expect(descriptor?.payload.tools.enabled).toEqual([packageToolProviderName])
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
  },
  { timeout: RUNNER_PROMPT_TEST_TIMEOUT_MILLISECONDS },
)

test(
  "runAgentSession installs worker capability projection into descriptor and runtime contract",
  async () => {
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
        prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID },
      },
    })
    await writeProjectExpertSquadPackage(tmp.path)
    const packageToolProviderName = PromptProfileResolver.packageToolProviderName(
      `${PROJECT_EXPERT_SQUAD_ID}/build/build-evidence`,
    )

    const promptCalls: Array<Parameters<typeof SessionPrompt.prompt>[0]> = []
    spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
      promptCalls.push(input)
      return {
        info: {
          id: "msg_runner_worker_capability_assistant",
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
            id: "prt_runner_worker_capability_assistant",
            sessionID: input.sessionID,
            messageID: "msg_runner_worker_capability_assistant",
            type: "text",
            text: "done",
          },
        ],
      } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const toolKit: AgentToolKit<Record<string, never>> = {
      tools: {
        read: tool({
          description: "Projected worker read tool.",
          inputSchema: z.object({}),
          execute: async () => "read",
        }),
        complete_task: tool({
          description: "Orchestrator-only task completion tool.",
          inputSchema: z.object({}),
          execute: async () => "complete",
        }),
      },
      getCollector: () => ({}),
      buildReport: () => ({ summary: "ok", detail: "ok" }),
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const capability = await PromptProfileResolver.resolveWorkerCapability({
          projectDirectory: tmp.path,
          agentID: "build",
          config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
        })
        const out = await runAgentSession({
          kind: "build",
          core: BUILD_CORE,
          sessionTitle: "worker capability projection",
          toolKit,
          buildUserPrompt: () => "implement the request",
        })

        const descriptor = WorkerTurnDescriptor.latestForSession(out.session.id)
        const contract = SessionPrompt.getSessionRuntimeContract(out.session.id)
        expect(descriptor?.payload.capability).toEqual({
          promptProfileID: capability.promptProfileID,
          capabilityProfileID: capability.capabilityProfileID,
          projectionHash: capability.projectionHash,
        })
        expect(contract?.identity.promptProfileID).toBe(capability.promptProfileID)
        expect(contract?.identity.capabilityProfileID).toBe(capability.capabilityProfileID)
        expect(contract?.identity.projectionHash).toBe(capability.projectionHash)
        expect(contract?.projectedRegistryToolIDs).toEqual(capability.builtInToolIDs)
        expect(Object.keys(contract?.tools ?? {}).sort()).toEqual(["read", packageToolProviderName].sort())
        expect(descriptor?.payload.tools.enabled).toEqual(["read", packageToolProviderName].sort())
        expect(contract?.tools).not.toHaveProperty("complete_task")
        expect(contract?.includeMcpTools).toBe(false)
        SessionPrompt.clearSessionRuntimeContract(out.session.id)
      },
    })

    expect(promptCalls).toHaveLength(1)
  },
  { timeout: RUNNER_PROMPT_TEST_TIMEOUT_MILLISECONDS },
)

test(
  "runAgentSession rejects virtual agent IDs as runtime agentName values",
  async () => {
    mock.module("@/agent/model", () => ({
      resolveAgentModel: async () => {
        throw new Error("model resolution should not run for invalid agentName")
      },
    }))
    const { runAgentSession } = await import("../../src/agent/runner")

    await using tmp = await tmpdir({
      git: true,
      config: {
        prompt_profile: { active: "software-testing" },
      },
    })
    await copyRepositoryExpertSquadPackage(tmp.path, "software-testing")

    const toolKit: AgentToolKit<Record<string, never>> = {
      tools: {},
      getCollector: () => ({}),
      buildReport: () => ({ summary: "ok", detail: "ok" }),
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          runAgentSession({
            kind: "build",
            agentName: "opentest-implementer",
            core: BUILD_CORE,
            sessionTitle: "virtual agent identity rejection",
            toolKit,
            buildUserPrompt: () => "implement the request",
          }),
        ).rejects.toThrow(/agentName "opentest-implementer" must equal base role "build"/)
      },
    })
  },
  { timeout: RUNNER_PROMPT_TEST_TIMEOUT_MILLISECONDS },
)

test(
  "runAgentSession keeps base role identity while attaching software-testing virtual metadata",
  async () => {
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
        prompt_profile: { active: "software-testing" },
      },
    })
    await copyRepositoryExpertSquadPackage(tmp.path, "software-testing")
    const inventoryProviderName = PromptProfileResolver.packageToolProviderName(
      "software-testing/shared/test-artifact-inventory",
    )
    const protocolProviderName = PromptProfileResolver.packageToolProviderName(
      "software-testing/shared/opentest-protocol-engine",
    )

    const promptCalls: Array<Parameters<typeof SessionPrompt.prompt>[0]> = []
    spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
      promptCalls.push(input)
      return {
        info: {
          id: "msg_runner_virtual_identity_assistant",
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
            id: "prt_runner_virtual_identity_assistant",
            sessionID: input.sessionID,
            messageID: "msg_runner_virtual_identity_assistant",
            type: "text",
            text: "done",
          },
        ],
      } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const toolKit: AgentToolKit<Record<string, never>> = {
      tools: {
        read: tool({
          description: "Projected worker read tool.",
          inputSchema: z.object({}),
          execute: async () => "read",
        }),
      },
      getCollector: () => ({}),
      buildReport: () => ({ summary: "ok", detail: "ok" }),
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const capability = await PromptProfileResolver.resolveWorkerCapability({
          projectDirectory: tmp.path,
          agentID: "build",
          config: Config.Info.parse({ prompt_profile: { active: "software-testing" } }),
        })
        const out = await runAgentSession({
          kind: "build",
          core: BUILD_CORE,
          sessionTitle: "software-testing virtual worker metadata",
          toolKit,
          buildUserPrompt: () => "implement the request",
        })

        const descriptor = WorkerTurnDescriptor.latestForSession(out.session.id)
        const contract = SessionPrompt.getSessionRuntimeContract(out.session.id)
        expect(promptCalls).toHaveLength(1)
        expect(promptCalls[0].agent).toBe("build")
        expect(descriptor?.payload.agent).toBe("build")
        expect(descriptor?.payload.roleContractID).toBe("build")
        expect(descriptor?.payload.workflow.sessionKind).toBe("build")
        expect(contract?.identity.agentKind).toBe("build")
        expect(descriptor?.payload.capability).toMatchObject({
          promptProfileID: "software-testing",
          capabilityProfileID: "software-testing",
          projectionHash: capability.projectionHash,
          virtualAgent: expect.objectContaining({
            baseRole: "build",
            virtualAgentID: "opentest-implementer",
            label: "OpenTest Implementer",
          }),
        })
        expect(contract?.identity).toMatchObject({
          promptProfileID: "software-testing",
          capabilityProfileID: "software-testing",
          projectionHash: capability.projectionHash,
          virtualAgent: expect.objectContaining({
            baseRole: "build",
            virtualAgentID: "opentest-implementer",
          }),
        })
        expect(Object.keys(contract?.tools ?? {}).sort()).toEqual(
          ["read", inventoryProviderName, protocolProviderName].sort(),
        )
        SessionPrompt.clearSessionRuntimeContract(out.session.id)
      },
    })
  },
  { timeout: RUNNER_PROMPT_TEST_TIMEOUT_MILLISECONDS },
)

test(
  "runAgentSession preserves declared stage-owned terminal tools under active project capability projection",
  async () => {
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
        prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID },
      },
    })
    await writeProjectExpertSquadPackage(tmp.path)
    const packageToolProviderName = PromptProfileResolver.packageToolProviderName(
      `${PROJECT_EXPERT_SQUAD_ID}/build/build-evidence`,
    )

    type Collector = { done?: boolean }
    const collector: Collector = {}
    const promptCalls: Array<Parameters<typeof SessionPrompt.prompt>[0]> = []
    spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
      promptCalls.push(input)
      collector.done = true
      return {
        info: {
          id: "msg_runner_stage_owned_terminal_assistant",
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
            id: "prt_runner_stage_owned_terminal_assistant",
            sessionID: input.sessionID,
            messageID: "msg_runner_stage_owned_terminal_assistant",
            type: "text",
            text: "terminal tool satisfied",
          },
        ],
      } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const reportTool = tool({
      description: "Stage-owned terminal report.",
      inputSchema: z.object({}),
      execute: async () => {
        collector.done = true
        return "RECORDED"
      },
    })
    const sidecarTool = tool({
      description: "Undeclared sidecar.",
      inputSchema: z.object({}),
      execute: async () => "sidecar",
    })
    const toolKit: AgentToolKit<Collector> = {
      tools: {
        read: tool({
          description: "Projected worker read tool.",
          inputSchema: z.object({}),
          execute: async () => "read",
        }),
        report_build_result: reportTool,
        unreferenced_sidecar: sidecarTool,
      },
      stageOwnedToolIDs: ["report_build_result"],
      getCollector: () => collector,
      buildReport: () => ({ summary: "ok", detail: "ok" }),
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const out = await runAgentSession({
          kind: "build",
          core: BUILD_CORE,
          sessionTitle: "stage-owned terminal projection",
          toolKit,
          buildUserPrompt: () => "implement the request",
          terminalTool: {
            toolName: "report_build_result",
            isSatisfied: (value) => value.done === true,
            shouldExposeOnlyTerminalTool: () => false,
          },
        })

        const descriptor = WorkerTurnDescriptor.latestForSession(out.session.id)
        const contract = SessionPrompt.getSessionRuntimeContract(out.session.id)
        expect(Object.keys(contract?.tools ?? {}).sort()).toEqual(
          ["read", "report_build_result", packageToolProviderName].sort(),
        )
        expect(contract?.tools.report_build_result).toBe(reportTool)
        expect(contract?.tools).not.toHaveProperty("unreferenced_sidecar")
        expect(descriptor?.payload.tools.enabled).toEqual(
          ["read", "report_build_result", packageToolProviderName].sort(),
        )
        expect(descriptor?.payload.tools.terminal).toBe("report_build_result")
        SessionPrompt.clearSessionRuntimeContract(out.session.id)
      },
    })

    expect(promptCalls).toHaveLength(1)
  },
  { timeout: RUNNER_PROMPT_TEST_TIMEOUT_MILLISECONDS },
)

test(
  "runAgentSession passes taskID to registry tool execution context",
  async () => {
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
  },
  { timeout: RUNNER_PROMPT_TEST_TIMEOUT_MILLISECONDS },
)

test(
  "runAgentSession installs live runtime contracts for every migrated worker agent",
  async () => {
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
  },
  { timeout: RUNNER_PROMPT_TEST_TIMEOUT_MILLISECONDS },
)

test(
  "runAgentSession continuation appends a visible recovery message to the same session and consumes the artifact once",
  async () => {
    mock.module("@/agent/model", () => ({
      resolveAgentModel: async () => ({
        providerID: "test",
        api: { id: "mock" },
      }),
    }))
    const { runAgentSession } = await import("../../src/agent/runner")
    const { Session } = await import("../../src/session")

    await using tmp = await tmpdir({ git: true })

    const loopCalls: Array<Parameters<typeof SessionPrompt.loop>[0]> = []
    spyOn(SessionPrompt, "loop").mockImplementation(async (input) => {
      loopCalls.push(input)
      return {
        info: {
          id: "msg_runner_continuation_assistant",
          sessionID: input.sessionID,
          role: "assistant",
          parentID: undefined,
          time: { created: Date.now() },
          agent: "architect",
          providerID: "test",
          modelID: "mock",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          path: { cwd: tmp.path, root: tmp.path },
        },
        parts: [
          {
            id: "prt_runner_continuation_assistant",
            sessionID: input.sessionID,
            messageID: "msg_runner_continuation_assistant",
            type: "text",
            text: "submitted",
          },
        ],
      } as Awaited<ReturnType<typeof SessionPrompt.loop>>
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
          title: "runner continuation root",
          directory: tmp.path,
        })
        const child = await Session.createNext({
          kind: "architect",
          parentID: parent.id,
          title: "architect child",
          directory: tmp.path,
        })
        const taskID = "tsk_runner_stage_continuation"
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: parent.id,
              source: "test",
              title: "runner continuation",
              request: "continue architect finalizer",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )
        const request = createStageContinuationRequest({
          taskID,
          stage: "architect",
          sessionID: child.id,
          parentSessionID: parent.id,
          inputDigest: "digest-runner-continuation",
          failureName: "TerminalToolMissingError",
          failureMessage: "Model did not call terminal tool submit_architect",
          finalizerName: "submit_architect",
          now,
        })

        const out = await runAgentSession({
          kind: "architect",
          core: "architect core",
          sessionTitle: "architect child",
          taskID,
          parentSessionID: parent.id,
          continuation: {
            sessionID: child.id,
            artifactID: request.artifactID,
            kind: "protocol-finalizer-miss",
            reason: request.payload.reason,
            finalizerName: "submit_architect",
          },
          toolKit,
          buildUserPrompt: () => "fresh prompt must not be used for continuation",
        })

        expect(out.session.id).toBe(child.id)
        expect(loopCalls).toEqual([{ sessionID: child.id }])
        const consumed = findStageContinuationRequest({ taskID, artifactID: request.artifactID })
        expect(consumed?.payload.claimed_at).toBeGreaterThanOrEqual(now)
        expect(consumed?.payload.consumed_at).toBeGreaterThanOrEqual(now)
        const continuationMessageID = consumed?.payload.continuation_message_id
        expect(continuationMessageID).toBeTruthy()
        const continuationMessage = await Message.get({
          sessionID: child.id,
          messageID: continuationMessageID!,
        })
        expect(continuationMessage.info.role).toBe("user")
        const text = continuationMessage.parts.map((part) => (part.type === "text" ? part.text : "")).join("\n")
        expect(text).toContain(`continuation_artifact_id: ${request.artifactID}`)
        expect(text).toContain("required_finalizer: submit_architect")
        expect(text).not.toContain("fresh prompt must not be used")
        expect(() =>
          claimStageContinuationRequest({
            taskID,
            artifactID: request.artifactID,
            sessionID: child.id,
            finalizerName: "submit_architect",
          }),
        ).toThrow("already consumed")
      },
    })
  },
  { timeout: RUNNER_PROMPT_TEST_TIMEOUT_MILLISECONDS },
)

test(
  "runAgentSession does not hide-recover when terminal collector is still unsatisfied",
  async () => {
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
      stageOwnedToolIDs: ["report_build_result"],
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
  },
  { timeout: RUNNER_PROMPT_TEST_TIMEOUT_MILLISECONDS },
)

test(
  "runAgentSession does not retry terminal protocol misses inside the runner",
  async () => {
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
      stageOwnedToolIDs: ["report_build_result"],
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
  },
  { timeout: RUNNER_PROMPT_TEST_TIMEOUT_MILLISECONDS },
)

test(
  "runAgentSession does not hide-recover when structured output is missing",
  async () => {
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
  },
  { timeout: RUNNER_PROMPT_TEST_TIMEOUT_MILLISECONDS },
)

test(
  "runAgentSession does not recover non-finalizer provider errors",
  async () => {
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
      stageOwnedToolIDs: ["report_build_result"],
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
  },
  { timeout: RUNNER_PROMPT_TEST_TIMEOUT_MILLISECONDS },
)

test(
  "runAgentSession writes child agent report while called from parent session context",
  async () => {
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

        const childEvents = AgentTrace.readSessionEvents(childSessionID, "tsk_runner_context")
        expect(childEvents.some((event) => event.kind === "agent_report")).toBe(true)
        expect(
          AgentTrace.readSessionEvents(parent.id, "tsk_runner_context").some((event) => event.kind === "agent_report"),
        ).toBe(false)
      },
    })
  },
  { timeout: RUNNER_PROMPT_TEST_TIMEOUT_MILLISECONDS },
)

test(
  "runAgentSession continuation loop runs under child session context",
  async () => {
    mock.module("@/agent/model", () => ({
      resolveAgentModel: async () => ({
        providerID: "test",
        api: { id: "mock" },
      }),
    }))
    const { runAgentSession } = await import("../../src/agent/runner")
    const { Session } = await import("../../src/session")
    const { SessionContext } = await import("../../src/session/context")

    await using tmp = await tmpdir({ git: true })

    let loopAmbientSessionID: string | undefined
    spyOn(SessionPrompt, "loop").mockImplementation(async (input) => {
      loopAmbientSessionID = SessionContext.tryUse()?.id
      return {
        info: {
          id: `msg_continuation_loop_${input.sessionID}`,
          sessionID: input.sessionID,
          role: "assistant",
          parentID: undefined,
          time: { created: Date.now() },
          agent: "build",
          providerID: "test",
          modelID: "mock",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          path: { cwd: tmp.path, root: tmp.path },
        },
        parts: [
          {
            id: `prt_continuation_loop_${input.sessionID}`,
            sessionID: input.sessionID,
            messageID: `msg_continuation_loop_${input.sessionID}`,
            type: "text",
            text: "continued",
          },
        ],
      } as Awaited<ReturnType<typeof SessionPrompt.loop>>
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.createNext({
          kind: "orchestrator",
          title: "Parent orchestrator",
          directory: tmp.path,
        })
        const child = await Session.createNext({
          kind: "build",
          parentID: parent.id,
          title: "Continuation child build",
          directory: tmp.path,
        })
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: "tsk_runner_continuation_context",
              project_id: Instance.project.id,
              session_id: parent.id,
              source: "test",
              title: "runner continuation context",
              request: "exercise continuation session context",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )
        const continuation = createStageContinuationRequest({
          taskID: "tsk_runner_continuation_context",
          stage: "build",
          sessionID: child.id,
          parentSessionID: parent.id,
          normalizedStageInput: { task: "same child continuation" },
          inputDigest: "digest-continuation-context",
          failureName: "TerminalToolMissingError",
          failureMessage: "missing report_build_result",
          finalizerName: "report_build_result",
        })
        const collector = { finalized: true }
        const toolKit: AgentToolKit<typeof collector> = {
          tools: {
            report_build_result: tool({
              description: "terminal build result",
              inputSchema: z.object({}),
              execute: () => {
                collector.finalized = true
                return "ok"
              },
            }),
          },
          stageOwnedToolIDs: ["report_build_result"],
          getCollector: () => collector,
          buildReport: () => ({ summary: "ok", detail: "ok" }),
        }

        await SessionContext.provide(parent, async () => {
          await runAgentSession({
            kind: "build",
            core: BUILD_CORE,
            sessionTitle: "Continuation child build",
            parentSessionID: parent.id,
            taskID: "tsk_runner_continuation_context",
            continuation: {
              sessionID: child.id,
              artifactID: continuation.artifactID,
              reason: "continue same child",
              kind: "protocol-finalizer-miss",
              finalizerName: "report_build_result",
            },
            toolKit,
            terminalTool: {
              toolName: "report_build_result",
              isSatisfied: (value) => value.finalized,
              shouldExposeOnlyTerminalTool: () => false,
            },
            buildUserPrompt: () => "unused for continuation",
          })
        })

        expect(loopAmbientSessionID).toBe(child.id)
        expect(
          findStageContinuationRequest({
            taskID: "tsk_runner_continuation_context",
            artifactID: continuation.artifactID,
          })?.payload.consumed_at,
        ).toBeNumber()
      },
    })
  },
  { timeout: RUNNER_PROMPT_TEST_TIMEOUT_MILLISECONDS },
)

test(
  "runAgentSessionWithRetry writes exhausted retry report under child session context",
  async () => {
    mock.module("@/agent/model", () => ({
      resolveAgentModel: async () => ({
        providerID: "test",
        api: { id: "mock" },
      }),
    }))
    const { AgentRunError, runAgentSessionWithRetry } = await import("../../src/agent/runner")
    const { AgentTrace } = await import("../../src/trace")
    const { Session } = await import("../../src/session")
    const { SessionContext } = await import("../../src/session/context")

    await using tmp = await tmpdir({ git: true })

    spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
      return {
        info: {
          id: `msg_retry_exhausted_${input.sessionID}`,
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
            id: `prt_retry_exhausted_${input.sessionID}`,
            sessionID: input.sessionID,
            messageID: `msg_retry_exhausted_${input.sessionID}`,
            type: "text",
            text: "incomplete",
          },
        ],
      } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    const toolKitFactory = (): AgentToolKit<Record<string, never>> => ({
      tools: {},
      getCollector: () => ({}),
      buildReport: () => ({ summary: "retry exhausted", detail: "retry exhausted" }),
    })

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
              id: "tsk_retry_trace_context",
              project_id: Instance.project.id,
              session_id: parent.id,
              source: "test",
              title: "retry trace context",
              request: "exercise retry final trace context",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        let thrown: unknown
        await SessionContext.provide(parent, async () => {
          try {
            await runAgentSessionWithRetry({
              kind: "build",
              core: BUILD_CORE,
              sessionTitle: "retry child build",
              parentSessionID: parent.id,
              taskID: "tsk_retry_trace_context",
              maxRetries: 1,
              toolKitFactory,
              buildUserPrompt: () => "implement the request",
              isComplete: () => ({ ok: false, terminal: false, reason: "missing terminal report" }),
            })
          } catch (err) {
            thrown = err
          }
        })

        expect(thrown).toBeInstanceOf(AgentRunError)
        expect((thrown as Error).message).toContain("missing terminal report")
        const childEvents = AgentTrace.readTaskEvents("tsk_retry_trace_context").filter(
          (event) => event.kind === "agent_report_retry_final",
        )
        expect(childEvents).toHaveLength(1)
        expect(childEvents[0]?.sessionID).not.toBe(parent.id)
        expect(childEvents[0]?.parentSessionID).toBe(parent.id)
        expect(
          AgentTrace.readSessionEvents(parent.id, "tsk_retry_trace_context").some(
            (event) => event.kind === "agent_report_retry_final",
          ),
        ).toBe(false)
      },
    })
  },
  { timeout: RUNNER_PROMPT_TEST_TIMEOUT_MILLISECONDS },
)
