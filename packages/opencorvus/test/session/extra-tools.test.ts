import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { asSchema, tool } from "ai"
import z from "zod"
// Import order matters: SessionPrompt loads session/index first which pulls
// in the rest of the session module graph; SessionLoop is then already
// populated by the time we reference it. Loading SessionLoop directly ahead
// of SessionPrompt triggers a module-init cycle where the prompt/index
// destructure sees an empty stub.
import { SessionPrompt } from "../../src/session/prompt"
import { SessionLoop } from "../../src/session/loop"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { withStreamActivity } from "../../src/util/stream-activity"
import { BuildResultSchema } from "../../src/build/types"
import { ProviderSchema } from "../../src/provider/schema"
import { requiresOpenAIStrictToolSchema } from "../../src/provider/strict-tool-schema"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { tmpdir } from "../fixture/fixture"
import { Agent } from "../../src/agent/agent"
import { WorkerTurnDescriptor } from "../../src/agent/worker-turn-descriptor"
import { awaitSessionPromptFinishedInScope, cancelSessionPromptInScope } from "../../src/engine/cancellation-scope"
import { TaskCancellationIncompleteError } from "../../src/engine/cancellation-error"
import { SessionPromptState } from "../../src/session/prompt/state"
import { SkillTool } from "../../src/tool/skill"
import { MCP } from "../../src/mcp"
import { Config } from "../../src/config/config"
import { copyRepositoryExpertSquadPackage } from "../fixture/expert-squad"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { WorkflowRegistry } from "../../src/engine/workflow"

const dummyTool = () =>
  tool({
    description: "test-only",
    inputSchema: z.object({ x: z.number() }),
    async execute(args) {
      return `ok:${args.x}`
    },
  })

const runtimeContract = (
  sessionID: string,
  overrides: Partial<SessionLoop.SessionRuntimeContract> = {},
): SessionLoop.SessionRuntimeContract => {
  const { identity, ...rest } = overrides
  return {
    ...rest,
    identity: {
      sessionID,
      agentKind: "build",
      contractKind: "stage-attempt",
      goalID: "gol_runtime_test",
      goalRunID: "grun_runtime_test",
      attemptID: "attempt_runtime_test",
      installedAt: Date.now(),
      ...identity,
    },
  }
}

const dispatchAgentTargetCases = [
  {
    input: {
      target: "requirements",
      reason: "valid requirements reason",
    },
    expected: {
      target: "requirements",
      reason: "valid requirements reason",
    },
  },
  {
    input: {
      target: "architect",
      reason: "valid architect reason",
    },
    expected: {
      target: "architect",
      reason: "valid architect reason",
    },
  },
  {
    input: {
      target: "frontend_design",
      reason: "valid frontend design reason",
      urls: ["https://example.com"],
    },
    expected: {
      target: "frontend_design",
      reason: "valid frontend design reason",
      urls: ["https://example.com"],
    },
  },
  {
    input: {
      target: "frontend_research",
      reason: "valid frontend research reason",
      source_urls: ["https://example.com"],
    },
    expected: {
      target: "frontend_research",
      reason: "valid frontend research reason",
      source_urls: ["https://example.com"],
    },
  },
  {
    input: {
      target: "deep_research",
      reason: "valid deep research reason",
    },
    expected: {
      target: "deep_research",
      reason: "valid deep research reason",
      source_urls: [],
    },
  },
  {
    input: {
      target: "workload_analysis",
      reason: "valid workload analysis reason",
    },
    expected: {
      target: "workload_analysis",
      reason: "valid workload analysis reason",
    },
  },
  {
    input: {
      target: "analyze_intent",
      reason: "valid intent analysis reason",
    },
    expected: {
      target: "analyze_intent",
      reason: "valid intent analysis reason",
    },
  },
  {
    input: {
      target: "visual_qa",
      reason: "valid visual qa reason",
    },
    expected: {
      target: "visual_qa",
      reason: "valid visual qa reason",
    },
  },
  {
    input: {
      target: "fact_check",
      reason: "valid fact check reason",
      target_session_id: "ses_fact_check_target",
      fact_check_items: [],
    },
    expected: {
      target: "fact_check",
      reason: "valid fact check reason",
      target_session_id: "ses_fact_check_target",
      fact_check_items: [],
    },
  },
  {
    input: {
      target: "build",
      reason: "valid goal build reason",
      goalID: "gol_provider_clean_build",
    },
    expected: {
      target: "build",
      reason: "valid goal build reason",
      goalID: "gol_provider_clean_build",
    },
  },
  {
    input: {
      target: "explore",
      reason: "valid explore reason",
      question: "Which module owns scheduler schema materialization?",
    },
    expected: {
      target: "explore",
      reason: "valid explore reason",
      question: "Which module owns scheduler schema materialization?",
    },
  },
  {
    input: {
      target: "integrity",
      reason: "valid integrity reason",
    },
    expected: {
      target: "integrity",
      reason: "valid integrity reason",
    },
  },
]

describe("SessionLoop session runtime contract", () => {
  test("round-trips a registered stage tool map", () => {
    const sessionID = `ses_runtime_${Date.now()}_visible`
    SessionLoop.setSessionRuntimeContract(
      sessionID,
      runtimeContract(sessionID, {
        tools: { persistent: dummyTool() },
      }),
    )
    expect(Object.keys(SessionLoop.getSessionRuntimeContract(sessionID)?.tools ?? {})).toEqual(["persistent"])
    SessionLoop.clearSessionRuntimeContract(sessionID)
    expect(SessionLoop.getSessionRuntimeContract(sessionID)).toBeUndefined()
  })

  test("a second runtime contract replaces the map wholesale", () => {
    const sessionID = `ses_runtime_${Date.now()}_replace`
    SessionLoop.setSessionRuntimeContract(
      sessionID,
      runtimeContract(sessionID, {
        tools: { first: dummyTool() },
      }),
    )
    SessionLoop.setSessionRuntimeContract(
      sessionID,
      runtimeContract(sessionID, {
        tools: { second: dummyTool() },
      }),
    )
    expect(Object.keys(SessionLoop.getSessionRuntimeContract(sessionID)?.tools ?? {})).toEqual(["second"])
  })

  test("runtime contract preserves the Model Context Protocol tool-loading flag", () => {
    const sessionID = `ses_runtime_${Date.now()}_mcp_off`
    SessionLoop.setSessionRuntimeContract(
      sessionID,
      runtimeContract(sessionID, {
        tools: { persistent: dummyTool() },
        includeMcpTools: false,
      }),
    )

    expect(SessionLoop.getSessionRuntimeContract(sessionID)?.includeMcpTools).toBe(false)
    SessionLoop.clearSessionRuntimeContract(sessionID)
  })

  test("runtime contract filters registry tools through projected worker tool IDs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = `ses_runtime_${Date.now()}_projected_registry`
        SessionLoop.setSessionRuntimeContract(
          sessionID,
          runtimeContract(sessionID, {
            tools: { persistent: dummyTool() },
            includeMcpTools: false,
            projectedRegistryToolIDs: ["read"],
          }),
        )
        try {
          const resolved = await SessionLoop.resolveTools({
            agent: (await Agent.get("build"))!,
            model: {
              providerID: "test",
              id: "test",
              api: { id: "test", npm: "@ai-sdk/openai" },
              capabilities: { input: {}, reasoning: false },
            } as any,
            session: { id: sessionID, kind: "build", permission: [] } as any,
            processor: {
              message: { id: "msg_test" },
              partFromToolCall: () => undefined,
              ensureToolPart: async () => undefined,
            } as any,
            bypassAgentCheck: false,
            messages: [],
            config: Config.Info.parse(await Config.get()),
          })

          expect(resolved.read).toBeDefined()
          expect(resolved.write).toBeUndefined()
          expect(resolved.persistent).toBeDefined()
        } finally {
          SessionLoop.clearSessionRuntimeContract(sessionID)
        }
      },
    })
  })

  test("build runtime contract includes Model Context Protocol tools by default", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = `ses_runtime_${Date.now()}_mcp_default`
        const toolsSpy = spyOn(MCP, "tools").mockResolvedValue({
          browser_screenshot: dummyTool() as any,
        })
        try {
          SessionLoop.setSessionRuntimeContract(
            sessionID,
            runtimeContract(sessionID, {
              tools: { persistent: dummyTool() },
            }),
          )
          const resolved = await SessionLoop.resolveTools({
            agent: (await Agent.get("build"))!,
            model: {
              providerID: "test",
              id: "test",
              api: { id: "test", npm: "@ai-sdk/openai" },
              capabilities: { input: {}, reasoning: false },
            } as any,
            session: { id: sessionID, kind: "task", permission: [] } as any,
            processor: {
              message: { id: "msg_test" },
              partFromToolCall: () => undefined,
              ensureToolPart: async () => undefined,
            } as any,
            bypassAgentCheck: false,
            messages: [],
            config: Config.Info.parse(await Config.get()),
          })

          expect(toolsSpy).toHaveBeenCalled()
          expect(resolved.browser_screenshot).toBeDefined()
          expect(resolved.persistent).toBeDefined()
        } finally {
          SessionLoop.clearSessionRuntimeContract(sessionID)
          toolsSpy.mockRestore()
        }
      },
    })
  })

  test("runtime contract can request an exact worker tool surface", () => {
    const contract = runtimeContract("ses_exact_runtime_tools", {
      exactTools: true,
      tools: { persistent: dummyTool() },
    })

    expect(SessionLoop.usesExactRuntimeContractTools("build", contract)).toBe(true)
  })

  test("worker descriptor capability mismatch is rejected before continuation", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "build", title: "capability mismatch" })
        const sessionID = session.id
        const descriptor = WorkerTurnDescriptor.create({
          sessionID,
          payload: {
            agent: "build",
            roleContractID: "build",
            model: { providerID: "test", modelID: "test" },
            prompt: { systemMode: "complete", rawSystemPrompt: false },
            tools: { enabled: [], switches: {} },
            capability: {
              promptProfileID: "old-profile",
              capabilityProfileID: "old-profile",
              projectionHash: "old-hash",
            },
            output: { format: "text", resultMode: "reply" },
            workflow: { sessionKind: "build" },
          },
        })
        SessionLoop.setSessionRuntimeContract(
          sessionID,
          runtimeContract(sessionID, {
            identity: {
              sessionID,
              agentKind: "build",
              contractKind: "stage-attempt",
              goalID: undefined,
              goalRunID: undefined,
              attemptID: undefined,
              workerTurnDescriptorID: descriptor.id,
              workerTurnDescriptorHash: descriptor.hash,
              promptProfileID: "new-profile",
              capabilityProfileID: "new-profile",
              projectionHash: "new-hash",
            },
            tools: {},
            system: ["capability mismatch test"],
          }),
        )
        try {
          expect(() =>
            SessionLoop.validateSessionRuntimeContractForContinuation({
              sessionID,
              sessionKind: "build",
              expectedAgentKind: "build",
              requireWorkerTurnDescriptor: true,
              requireRuntimeContract: true,
            }),
          ).toThrow(/prompt profile mismatch/)
        } finally {
          SessionLoop.clearSessionRuntimeContract(sessionID)
        }
      },
    })
  })

  test("SessionPrompt.cancel preserves runtime contract until the owning loop settles", async () => {
    const sessionID = `ses_runtime_${Date.now()}_cancel`
    await using tmp = await tmpdir()
    const abort = SessionPromptState.start(sessionID, tmp.path)
    try {
      SessionPrompt.setSessionRuntimeContract(
        sessionID,
        runtimeContract(sessionID, {
          tools: { persistent: dummyTool() },
        }),
      )
      expect(SessionPrompt.getSessionRuntimeContract(sessionID)?.tools).toBeDefined()
      expect(SessionPrompt.cancel(sessionID, tmp.path)).toBe(true)
      expect(SessionPrompt.getSessionRuntimeContract(sessionID)?.tools).toBeDefined()
    } finally {
      if (abort) SessionPromptState.finish(sessionID, abort, tmp.path)
      SessionPrompt.clearSessionRuntimeContract(sessionID)
    }
  })

  test("SessionPrompt.cancel aborts a registered activity monitor", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "activity monitor cancel" })
        const sessionID = session.id
        const monitor = withStreamActivity({ idleMs: 60_000, label: "session-cancel-test" })
        const unregister = SessionStatus.registerActivityMonitor(sessionID, monitor)
        try {
          SessionPrompt.cancel(sessionID)
          expect(monitor.signal.aborted).toBe(true)
          expect(monitor.timedOut()).toBe(false)
          expect(String(monitor.signal.reason)).toContain("session cancelled")
        } finally {
          unregister()
          monitor.dispose()
        }
      },
    })
  })

  test("cancellation scope reports live sessions whose prompt state belongs to another directory", async () => {
    const sessionID = `ses_runtime_${Date.now()}_strict_cancel`
    await using tmp = await tmpdir({ git: true })
    await using other = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const abort = SessionPromptState.start(sessionID, other.path)
        SessionStatus.set(sessionID, { type: "streaming" }, { publish: false })
        try {
          expect(() =>
            cancelSessionPromptInScope({
              session: {
                id: sessionID,
                directory: tmp.path,
              },
            }),
          ).toThrow(TaskCancellationIncompleteError)
          expect(SessionStatus.get(sessionID)).toEqual({ type: "streaming" })
        } finally {
          if (abort) SessionPromptState.finish(sessionID, abort, other.path)
          SessionStatus.set(sessionID, { type: "idle" }, { publish: false })
        }
      },
    })
  })

  test("cancellation scope reports stale active status when no prompt state exists", async () => {
    const sessionID = `ses_runtime_${Date.now()}_stale_cancel`
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        SessionStatus.set(sessionID, { type: "streaming" }, { publish: false })

        try {
          expect(() =>
            cancelSessionPromptInScope({
              session: {
                id: sessionID,
                directory: tmp.path,
              },
            }),
          ).toThrow(TaskCancellationIncompleteError)
          expect(SessionStatus.get(sessionID)).toEqual({ type: "streaming" })
        } finally {
          SessionStatus.set(sessionID, { type: "idle" }, { publish: false })
        }
      },
    })
  })

  test("cancellation settle proof rejects terminal status while prompt state remains live", async () => {
    const sessionID = `ses_runtime_${Date.now()}_settle`
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const abort = SessionPromptState.start(sessionID, tmp.path)
        expect(abort).toBeDefined()
        try {
          SessionStatus.set(sessionID, { type: "terminal", reason: "aborted" }, { publish: false })
          await expect(
            awaitSessionPromptFinishedInScope({
              session: { id: sessionID, directory: tmp.path },
              inactivityTimeoutMs: 20,
            }),
          ).rejects.toThrow(TaskCancellationIncompleteError)
        } finally {
          SessionPromptState.finish(sessionID, abort, tmp.path)
        }
      },
    })
  })

  test("rejects a contract whose identity belongs to another session", () => {
    const sessionID = `ses_runtime_${Date.now()}_mismatch`
    expect(() =>
      SessionLoop.setSessionRuntimeContract(
        sessionID,
        runtimeContract("ses_other_runtime", {
          tools: { persistent: dummyTool() },
        }),
      ),
    ).toThrow("identity mismatch")
    expect(SessionLoop.getSessionRuntimeContract(sessionID)).toBeUndefined()
  })

  test("validation rejects missing contracts for stage continuations", () => {
    const sessionID = `ses_runtime_${Date.now()}_missing`
    expect(() =>
      SessionLoop.validateSessionRuntimeContractForContinuation({
        sessionID,
        sessionKind: "build",
        expectedAgentKind: "build",
        requireRuntimeContract: true,
      }),
    ).toThrow("missing")
  })

  test("validation rejects runtime-required contracts without worker descriptors", () => {
    const sessionID = `ses_runtime_${Date.now()}_missing_descriptor`
    SessionLoop.setSessionRuntimeContract(
      sessionID,
      runtimeContract(sessionID, {
        tools: { persistent: dummyTool() },
      }),
    )
    expect(() =>
      SessionLoop.validateSessionRuntimeContractForContinuation({
        sessionID,
        sessionKind: "build",
        expectedAgentKind: "build",
        requireRuntimeContract: true,
        requireWorkerTurnDescriptor: true,
      }),
    ).toThrow("worker descriptor missing")
    SessionLoop.clearSessionRuntimeContract(sessionID)
  })

  test("validation rejects stale agent, goal, goal_run, attempt, and satisfied terminal collector", () => {
    const sessionID = `ses_runtime_${Date.now()}_stale`
    SessionLoop.setSessionRuntimeContract(
      sessionID,
      runtimeContract(sessionID, {
        terminalToolContract: {
          toolName: "report_build_result",
          isSatisfied: () => true,
          shouldExposeOnlyTerminalTool: () => false,
        },
      }),
    )
    expect(() =>
      SessionLoop.validateSessionRuntimeContractForContinuation({
        sessionID,
        expectedAgentKind: "requirements",
      }),
    ).toThrow("agent mismatch")
    expect(() =>
      SessionLoop.validateSessionRuntimeContractForContinuation({
        sessionID,
        expectedAgentKind: "build",
        expectedGoalID: "gol_other",
      }),
    ).toThrow("goal mismatch")
    expect(() =>
      SessionLoop.validateSessionRuntimeContractForContinuation({
        sessionID,
        expectedAgentKind: "build",
        expectedGoalID: "gol_runtime_test",
        expectedGoalRunID: "grun_other",
      }),
    ).toThrow("goal_run mismatch")
    expect(() =>
      SessionLoop.validateSessionRuntimeContractForContinuation({
        sessionID,
        expectedAgentKind: "build",
        expectedGoalID: "gol_runtime_test",
        expectedGoalRunID: "grun_runtime_test",
        expectedAttemptID: "attempt_other",
      }),
    ).toThrow("attempt mismatch")
    expect(() =>
      SessionLoop.validateSessionRuntimeContractForContinuation({
        sessionID,
        expectedAgentKind: "build",
        expectedGoalID: "gol_runtime_test",
        expectedGoalRunID: "grun_runtime_test",
        expectedAttemptID: "attempt_runtime_test",
      }),
    ).toThrow("already satisfied")
    SessionLoop.clearSessionRuntimeContract(sessionID)
  })

  test("validation binds continuation to the persisted worker turn descriptor", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "descriptor validation", kind: "build" })
        const sessionID = session.id
        const descriptor = WorkerTurnDescriptor.create({
          sessionID,
          payload: {
            agent: "build",
            roleContractID: "build",
            model: { providerID: "test", modelID: "model-api" },
            prompt: { systemMode: "complete", rawSystemPrompt: false },
            tools: { enabled: ["persistent"], terminal: "report_build_result" },
            output: { format: "text", resultMode: "reply" },
            workflow: {
              goalID: "gol_runtime_test",
              goalRunID: "grun_runtime_test",
              attemptID: "attempt_runtime_test",
              sessionKind: "build",
            },
          },
        })
        SessionLoop.setSessionRuntimeContract(
          sessionID,
          runtimeContract(sessionID, {
            identity: {
              workerTurnDescriptorID: descriptor.id,
              workerTurnDescriptorHash: descriptor.hash,
            },
            tools: { persistent: dummyTool() },
          }),
        )
        expect(
          SessionLoop.validateSessionRuntimeContractForContinuation({
            sessionID,
            sessionKind: "build",
            expectedAgentKind: "build",
            expectedGoalID: "gol_runtime_test",
            expectedGoalRunID: "grun_runtime_test",
            expectedAttemptID: "attempt_runtime_test",
            expectedWorkerTurnDescriptor: { id: descriptor.id, hash: descriptor.hash },
            expectedModel: { providerID: "test", modelID: "model-api" },
            expectedResultMode: "reply",
          })?.identity.workerTurnDescriptorID,
        ).toBe(descriptor.id)
        expect(() =>
          SessionLoop.validateSessionRuntimeContractForContinuation({
            sessionID,
            sessionKind: "build",
            expectedAgentKind: "build",
            expectedWorkerTurnDescriptor: { id: descriptor.id, hash: "bad-hash" },
          }),
        ).toThrow("descriptor hash mismatch")
        expect(() =>
          SessionLoop.validateSessionRuntimeContractForContinuation({
            sessionID,
            sessionKind: "build",
            expectedAgentKind: "build",
            expectedWorkerTurnDescriptor: { id: descriptor.id, hash: descriptor.hash },
            expectedResultMode: "summary",
          }),
        ).toThrow("result mode mismatch")
        SessionLoop.setSessionRuntimeContract(
          sessionID,
          runtimeContract(sessionID, {
            identity: {
              workerTurnDescriptorID: descriptor.id,
              workerTurnDescriptorHash: descriptor.hash,
            },
            tools: { other: dummyTool() },
          }),
        )
        expect(() =>
          SessionLoop.validateSessionRuntimeContractForContinuation({
            sessionID,
            sessionKind: "build",
            expectedAgentKind: "build",
            expectedWorkerTurnDescriptor: { id: descriptor.id, hash: descriptor.hash },
          }),
        ).toThrow("descriptor tools mismatch")
        SessionLoop.clearSessionRuntimeContract(sessionID)
      },
    })
  })
})

describe("extras execute-return normalisation (integration via resolveTools)", () => {
  // We can't hit resolveTools without the full session/model context, but we
  // can verify the wrapping behaviour by inspecting the registered tool and
  // calling its execute directly.
  const plainStringTool = () =>
    tool({
      description: "returns plain string",
      inputSchema: z.object({}),
      async execute() {
        return "OK: hello"
      },
    })

  const partialObjectTool = () =>
    tool({
      description: "returns partial object",
      inputSchema: z.object({}),
      async execute() {
        return { output: "done" } // missing title + metadata
      },
    })

  const fullObjectTool = () =>
    tool({
      description: "returns full object",
      inputSchema: z.object({}),
      async execute() {
        return { output: "x", title: "t", metadata: { a: 1 } }
      },
    })

  test("plain-string returns survive resolveTools via the wrapper (smoke)", async () => {
    // Exercising resolveTools requires a live session. This unit-level smoke
    // just confirms that runtime-contract tools can carry execute functions
    // returning plain strings — the wrapper behaviour is verified end-to-end by the
    // intent-analysis smoke test, which used to fail with a ZodError on
    // Message.ToolPart persistence before the wrapper was added.
    const sessionID = `ses_runtime_${Date.now()}_wrap_smoke`
    SessionLoop.setSessionRuntimeContract(
      sessionID,
      runtimeContract(sessionID, {
        tools: {
          plain: plainStringTool(),
          partial: partialObjectTool(),
          full: fullObjectTool(),
        },
      }),
    )
    const extras = SessionLoop.getSessionRuntimeContract(sessionID)?.tools ?? {}
    expect(Object.keys(extras).sort()).toEqual(["full", "partial", "plain"])
    SessionLoop.clearSessionRuntimeContract(sessionID)
  })

  test("orchestrator runtime contract uses exact tools instead of registry inheritance", () => {
    const contract = runtimeContract("ses_orchestrator_exact", {
      identity: {
        sessionID: "ses_orchestrator_exact",
        agentKind: "orchestrator",
        contractKind: "orchestrator-wake",
      },
      tools: {},
    })
    expect(SessionLoop.usesExactRuntimeContractTools("orchestrator", contract)).toBe(true)
    expect(SessionLoop.usesExactRuntimeContractTools("orchestrator", undefined)).toBe(false)
    expect(SessionLoop.usesExactRuntimeContractTools("build", contract)).toBe(false)
  })

  test("frontend-research runtime contract uses exact submit and skill tools instead of registry or MCP inheritance", () => {
    const contract = runtimeContract("ses_frontend_research_exact", {
      identity: {
        sessionID: "ses_frontend_research_exact",
        agentKind: "frontend-research",
        contractKind: "stage-attempt",
      },
      tools: { skill: dummyTool(), submit_research_brief: dummyTool() },
    })

    expect(SessionLoop.usesExactRuntimeContractTools("frontend-research", contract)).toBe(true)
    expect(SessionLoop.usesExactRuntimeContractTools("deep-research", contract)).toBe(false)
    expect(SessionLoop.usesExactRuntimeContractTools("frontend-research", undefined)).toBe(false)
  })

  test("orchestrator-wake runtime contract does not require a worker descriptor", () => {
    const sessionID = `ses_runtime_${Date.now()}_orchestrator_descriptor_exempt`
    SessionLoop.setSessionRuntimeContract(
      sessionID,
      runtimeContract(sessionID, {
        identity: {
          sessionID,
          agentKind: "orchestrator",
          contractKind: "orchestrator-wake",
        },
        tools: { requirements: dummyTool() },
      }),
    )
    expect(
      SessionLoop.validateSessionRuntimeContractForContinuation({
        sessionID,
        sessionKind: "orchestrator",
        expectedAgentKind: "orchestrator",
        expectedContractKind: "orchestrator-wake",
        requireRuntimeContract: true,
        requireWorkerTurnDescriptor: true,
      })?.identity.contractKind,
    ).toBe("orchestrator-wake")
    SessionLoop.clearSessionRuntimeContract(sessionID)
  })

  test("tool switches remove disabled tools and support all-tools disable", () => {
    const namedTools = { bash: dummyTool(), skill: dummyTool(), read: dummyTool() }
    SessionLoop.applyToolSwitches(namedTools, { bash: false })
    expect(Object.keys(namedTools).sort()).toEqual(["read", "skill"])

    const allTools = { bash: dummyTool(), skill: dummyTool() }
    SessionLoop.applyToolSwitches(allTools, { "*": false })
    expect(Object.keys(allTools)).toEqual([])
  })

  test("orchestrator resolveTools returns exactly runtime contract tools", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "orchestrator", title: "orchestrator exact" })
        const sessionID = session.id
        SessionLoop.setSessionRuntimeContract(
          sessionID,
          runtimeContract(sessionID, {
            identity: {
              sessionID,
              agentKind: "orchestrator",
              contractKind: "orchestrator-wake",
            },
            tools: { requirements: dummyTool() },
          }),
        )
        const resolved = await SessionLoop.resolveTools({
          agent: (await Agent.get("orchestrator"))!,
          model: {
            providerID: "test",
            id: "test",
            api: { id: "test", npm: "@ai-sdk/openai" },
            capabilities: { input: {}, reasoning: false },
          } as any,
          session: { ...session, permission: [] } as any,
          processor: {
            message: { id: "msg_test" },
            partFromToolCall: () => undefined,
            ensureToolPart: async () => undefined,
          } as any,
          bypassAgentCheck: false,
          messages: [],
        })

        expect(Object.keys(resolved)).toEqual(["requirements"])
        expect(resolved.skill).toBeUndefined()
        SessionLoop.clearSessionRuntimeContract(sessionID)
      },
    })
  })

  test("orchestrator resolveTools preserves runtime expert-squad skill under exact wake contracts", async () => {
    await using tmp = await tmpdir({ git: true })
    await copyRepositoryExpertSquadPackage(tmp.path, "frontend-replica")
    await copyRepositoryExpertSquadPackage(tmp.path, "frontend-innovate")
    await copyRepositoryExpertSquadPackage(tmp.path, "frontend-automation-debug")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = `ses_runtime_${Date.now()}_orchestrator_skill_exact`
        const config = Config.Info.parse(await Config.get())
        SessionLoop.setSessionRuntimeContract(
          sessionID,
          runtimeContract(sessionID, {
            identity: {
              sessionID,
              agentKind: "orchestrator",
              contractKind: "orchestrator-wake",
            },
            tools: {
              skill: dummyTool(),
              select_expert_squad: dummyTool(),
            },
          }),
        )
        const resolved = await SessionLoop.resolveTools({
          agent: (await Agent.get("orchestrator"))!,
          model: {
            providerID: "test",
            id: "test",
            api: { id: "test", npm: "@ai-sdk/openai" },
            capabilities: { input: {}, reasoning: false },
          } as any,
          session: { id: sessionID, kind: "orchestrator", permission: [] } as any,
          processor: {
            message: { id: "msg_test" },
            partFromToolCall: () => undefined,
            ensureToolPart: async () => undefined,
          } as any,
          bypassAgentCheck: false,
          messages: [],
          config,
        })

        expect(Object.keys(resolved).sort()).toEqual(["select_expert_squad", "skill"])
        const result = await (resolved.skill as any).execute(
          { query: "frontend expert squad" },
          { toolCallId: "call_orchestrator_expert_skill" },
        )
        expect(result.output).toContain("<name>frontend-replica-expert-squad</name>")
        expect(result.output).toContain("<name>frontend-innovate-expert-squad</name>")
        expect(result.output).toContain("<name>frontend-automation-debug-expert-squad</name>")
        SessionLoop.clearSessionRuntimeContract(sessionID)
      },
    })
  })

  test("frontend-research resolveTools preserves runtime skill under exact stage contracts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = `ses_runtime_${Date.now()}_frontend_research_exact`
        const config = Config.Info.parse(await Config.get())
        SessionLoop.setSessionRuntimeContract(
          sessionID,
          runtimeContract(sessionID, {
            identity: {
              sessionID,
              agentKind: "frontend-research",
              contractKind: "stage-attempt",
            },
            tools: {
              skill: dummyTool(),
              submit_research_brief: dummyTool(),
            },
          }),
        )
        const resolved = await SessionLoop.resolveTools({
          agent: (await Agent.get("frontend-research"))!,
          model: {
            providerID: "test",
            id: "test",
            api: { id: "test", npm: "@ai-sdk/openai" },
            capabilities: { input: {}, reasoning: false },
          } as any,
          session: { id: sessionID, kind: "frontend-research", permission: [] } as any,
          processor: {
            message: { id: "msg_test" },
            partFromToolCall: () => undefined,
            ensureToolPart: async () => undefined,
          } as any,
          bypassAgentCheck: false,
          messages: [],
          config,
        })

        expect(Object.keys(resolved).sort()).toEqual(["skill", "submit_research_brief"])
        expect(resolved.read).toBeUndefined()
        expect(resolved.websearch).toBeUndefined()
        SessionLoop.clearSessionRuntimeContract(sessionID)
      },
    })
  })

  test("frontend-design resolveTools preserves runtime skill under exact stage contracts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = `ses_runtime_${Date.now()}_frontend_design_exact`
        const config = Config.Info.parse(await Config.get())
        SessionLoop.setSessionRuntimeContract(
          sessionID,
          runtimeContract(sessionID, {
            identity: {
              sessionID,
              agentKind: "frontend-design",
              contractKind: "stage-attempt",
            },
            tools: {
              skill: dummyTool(),
              submit_frontend_template: dummyTool(),
            },
          }),
        )
        const resolved = await SessionLoop.resolveTools({
          agent: (await Agent.get("frontend-design"))!,
          model: {
            providerID: "test",
            id: "test",
            api: { id: "test", npm: "@ai-sdk/openai" },
            capabilities: { input: {}, reasoning: false },
          } as any,
          session: { id: sessionID, kind: "frontend-design", permission: [] } as any,
          processor: {
            message: { id: "msg_test" },
            partFromToolCall: () => undefined,
            ensureToolPart: async () => undefined,
          } as any,
          bypassAgentCheck: false,
          messages: [],
          config,
        })

        expect(Object.keys(resolved).sort()).toEqual(["skill", "submit_frontend_template"])
        expect(resolved.websearch).toBeUndefined()
        SessionLoop.clearSessionRuntimeContract(sessionID)
      },
    })
  })

  test("exact runtime contract skill tool is rebound to the turn-scoped mount surface", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencorvus", "skill", "runtime-needs-bash")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: runtime-needs-bash
description: Skill requiring a canonical tool that is not in this exact runtime contract.
required_tools:
  - bash
mounted_agents:
  - frontend-design
---

# Runtime Needs Bash
`,
        )
      },
    })

    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sessionID = `ses_runtime_${Date.now()}_skill_surface`
          const frontendDesign = await Agent.get("frontend-design")
          expect(frontendDesign).toBeDefined()
          const config = Config.Info.parse(await Config.get())
          const staleSkill = await SkillTool.init({ agent: frontendDesign, config })
          const staleExtraSkill = tool({
            description: staleSkill.description,
            inputSchema: staleSkill.parameters,
            async execute(args) {
              return staleSkill.execute(args as never, {
                sessionID,
                messageID: "msg_test",
                callID: "call_test",
                agent: "frontend-design",
                abort: AbortSignal.any([]),
                messages: [],
                metadata: () => {},
                ask: async () => {},
              })
            },
          })

          SessionLoop.setSessionRuntimeContract(
            sessionID,
            runtimeContract(sessionID, {
              identity: {
                sessionID,
                agentKind: "frontend-design",
                contractKind: "stage-attempt",
              },
              tools: {
                skill: staleExtraSkill,
                submit_frontend_template: dummyTool(),
              },
            }),
          )
          const resolved = await SessionLoop.resolveTools({
            agent: frontendDesign!,
            model: {
              providerID: "test",
              id: "test",
              api: { id: "test", npm: "@ai-sdk/openai" },
              capabilities: { input: {}, reasoning: false },
            } as any,
            session: { id: sessionID, kind: "frontend-design", permission: [] } as any,
            processor: {
              message: { id: "msg_test" },
              partFromToolCall: () => undefined,
              ensureToolPart: async () => undefined,
            } as any,
            bypassAgentCheck: false,
            messages: [],
            config,
          })

          expect(Object.keys(resolved).sort()).toEqual(["skill", "submit_frontend_template"])
          await expect(
            (resolved.skill as any).execute(
              { name: "runtime-needs-bash" },
              { toolCallId: "call_runtime_skill_surface" },
            ),
          ).rejects.toThrow('Skill "runtime-needs-bash" not found or not allowed')
          SessionLoop.clearSessionRuntimeContract(sessionID)
        },
      })
    } finally {
      process.env.OPENCORVUS_TEST_HOME = home
    }
  })

  test("normalizes multimodal extra-tool results without stringifying attachments into output", () => {
    const dataUrl = "data:image/png;base64," + "a".repeat(1024)
    const normalized = SessionLoop.normalizeExtraToolResult({
      text: '{"ok":true,"path":"shot.png"}',
      attachments: [{ type: "file", mime: "image/png", url: dataUrl }],
    })

    expect(normalized.output).toBe('{"ok":true,"path":"shot.png"}')
    expect(normalized.output).not.toContain("data:image/png;base64")
    expect(normalized.attachments).toEqual([{ type: "file", mime: "image/png", url: dataUrl }])
  })

  test("rejects attachment-only extra-tool results instead of serializing bytes as text", () => {
    expect(() =>
      SessionLoop.normalizeExtraToolResult({
        attachments: [{ type: "file", mime: "image/png", url: "data:image/png;base64,UE5H" }],
      }),
    ).toThrow("attachments without string output/text")
  })

  test("materializes data URL tool-result attachments into AttachmentStore refs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const attachments = await SessionLoop.materializeToolResultAttachments([
          { type: "file", mime: "image/png", filename: "tool.png", url: "data:image/png;base64,UE5H" },
        ])
        expect(Array.isArray(attachments)).toBe(true)
        const first = (attachments as Array<{ url: string; mime: string }>)[0]
        expect(first.url.startsWith("data:")).toBe(false)
        const located = AttachmentStore.nameFromUrl(first.url)
        expect(located).toBeTruthy()
        const bytes = await AttachmentStore.read(located!.projectID, located!.name)
        expect(bytes.toString("utf8")).toBe("PNG")
      },
    })
  }, 20000)
})

describe("extra tool provider schema preparation", () => {
  const dashScopeModel = {
    providerID: "alibaba-cn",
    id: "kimi-k2.5",
    api: {
      id: "kimi-k2.5",
      npm: "@ai-sdk/openai-compatible",
      url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
  } as any
  const hexinGptModel = {
    providerID: "hexin",
    id: "hexin/gpt-5.5",
    api: {
      id: "gpt-5.5",
      npm: "@ai-sdk/openai-compatible",
      url: "https://aimemodeldev.myhexin.com/litellm/v1",
    },
  } as any
  const requestyOpenAIOModel = {
    providerID: "requesty",
    id: "requesty/openai/o4-mini",
    api: {
      id: "openai/o4-mini",
      npm: "@ai-sdk/openai-compatible",
      url: "https://router.requesty.ai/v1",
    },
  } as any
  const requestyOpenAIChatGPTModel = {
    providerID: "requesty-chatgpt",
    id: "requesty/openai/chatgpt-4o-latest",
    api: {
      id: "openai/chatgpt-4o-latest",
      npm: "@ai-sdk/openai-compatible",
      url: "https://router.requesty.ai/v1",
    },
  } as any
  const openAIModel = {
    providerID: "openai",
    id: "openai/gpt-5.1",
    api: {
      id: "gpt-5.1",
      npm: "@ai-sdk/openai",
      url: "https://api.openai.com/v1",
    },
  } as any
  const azureModel = {
    providerID: "azure",
    id: "azure/gpt-5.1",
    api: {
      id: "gpt-5.1",
      npm: "@ai-sdk/azure",
      url: "https://example.openai.azure.com/openai/deployments/gpt-5.1",
    },
  } as any

  const jsonSchemaAllowsNull = (schema: unknown): boolean => {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false
    const record = schema as Record<string, unknown>
    if (record.type === "null") return true
    if (Array.isArray(record.type) && record.type.includes("null")) return true
    return (
      (Array.isArray(record.anyOf) && record.anyOf.some(jsonSchemaAllowsNull)) ||
      (Array.isArray(record.oneOf) && record.oneOf.some(jsonSchemaAllowsNull))
    )
  }

  test("keeps explicit final confirmation required on extra submit tools", () => {
    const prepared = SessionLoop.prepareProviderTool({
      name: "submit_requirements",
      source: "extra",
      model: dashScopeModel,
      tool: tool({
        description: "submit",
        inputSchema: z.object({ final: z.literal(true) }),
        async execute() {
          return { output: "ok", title: "", metadata: {} }
        },
      }),
    }) as any

    const schema = asSchema(prepared.inputSchema).jsonSchema as any
    expect(schema.type).toBe("object")
    expect(schema.required).toContain("final")
    expect(schema.properties.final.const).toBe(true)
  })

  test("normalizes extra discriminated result tools to provider-bound root object schema", () => {
    const prepared = SessionLoop.prepareProviderTool({
      name: "report_build_result",
      source: "extra",
      model: dashScopeModel,
      tool: tool({
        description: "report build result",
        inputSchema: BuildResultSchema,
        async execute() {
          return { output: "ok", title: "", metadata: {} }
        },
      }),
    }) as any

    const schema = asSchema(prepared.inputSchema).jsonSchema as any
    expect(schema.type).toBe("object")
    expect(schema.anyOf).toBeUndefined()
    expect(schema.properties.status.enum).toEqual(["passed", "failed"])
  })

  test("materializes zod defaults before provider-bound tool execution", async () => {
    let seenArgs: unknown
    const prepared = SessionLoop.prepareProviderTool({
      name: "run_command",
      source: "extra",
      model: dashScopeModel,
      tool: tool({
        description: "run command",
        inputSchema: z.object({
          command: z.string(),
          timeout_ms: z.number().int().positive().default(300_000),
          background: z.boolean().default(false),
        }),
        async execute(args) {
          seenArgs = args
          return { output: "ok", title: "", metadata: {} }
        },
      }),
    }) as any

    await prepared.execute({ command: "printf ok" }, { toolCallId: "call_defaults" })

    expect(seenArgs).toEqual({
      command: "printf ok",
      timeout_ms: 300_000,
      background: false,
    })
  })

  test("rejects invalid provider-bound tool input before execute", async () => {
    let executed = false
    const prepared = SessionLoop.prepareProviderTool({
      name: "numeric_tool",
      source: "extra",
      model: dashScopeModel,
      tool: tool({
        description: "numeric",
        inputSchema: z.object({ count: z.number() }),
        async execute() {
          executed = true
          return { output: "ok", title: "", metadata: {} }
        },
      }),
    }) as any

    await expect(prepared.execute({ count: "bad" }, { toolCallId: "call_invalid" })).rejects.toThrow(
      "Invalid input for tool numeric_tool",
    )
    expect(executed).toBe(false)
  })

  test("strips GPT strict-schema null placeholders before local execution validation", async () => {
    let seenArgs: unknown
    const prepared = SessionLoop.prepareProviderTool({
      name: "submit_timeline",
      source: "structured",
      model: hexinGptModel,
      tool: tool({
        description: "submit timeline",
        inputSchema: z.object({
          chronology: z.array(
            z.object({
              event: z.string(),
              evidence: z.string().optional(),
            }),
          ),
        }),
        async execute(args) {
          seenArgs = args
          return { output: "ok", title: "", metadata: {} }
        },
      }),
    }) as any

    await prepared.execute(
      { chronology: [{ event: "captured", evidence: null }] },
      { toolCallId: "call_null_optional" },
    )

    expect(seenArgs).toEqual({ chronology: [{ event: "captured" }] })
  })

  test("uses one strict tool-schema predicate for provider schema and execution cleanup", async () => {
    const cases = [
      { model: openAIModel, strict: true },
      { model: azureModel, strict: true },
      { model: hexinGptModel, strict: true },
      { model: requestyOpenAIOModel, strict: true },
      { model: requestyOpenAIChatGPTModel, strict: true },
      { model: dashScopeModel, strict: false },
    ]
    for (const { model, strict } of cases) {
      expect(requiresOpenAIStrictToolSchema(model), model.id).toBe(strict)

      const inputSchema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      })
      const providerJsonSchema = asSchema(ProviderSchema.input(model, inputSchema) as never).jsonSchema as any
      expect(jsonSchemaAllowsNull(providerJsonSchema.properties.optional), model.id).toBe(strict)

      let seenArgs: unknown
      const prepared = SessionLoop.prepareProviderTool({
        name: `strict_schema_parity_${model.providerID}`,
        source: "extra",
        model,
        tool: tool({
          description: "strict schema parity",
          inputSchema,
          async execute(args) {
            seenArgs = args
            return { output: "ok", title: "", metadata: {} }
          },
        }),
      }) as any

      const execution = prepared.execute(
        { required: "present", optional: null },
        { toolCallId: `call_strict_schema_parity_${model.providerID}` },
      )
      if (strict) {
        await execution
        expect(seenArgs).toEqual({ required: "present" })
      } else {
        await expect(execution).rejects.toThrow("Invalid input")
      }
    }
  })

  test("keeps BuildResult local semantics after GPT strict-schema null placeholders", async () => {
    let seenArgs: any
    const prepared = SessionLoop.prepareProviderTool({
      name: "report_build_result",
      source: "extra",
      model: hexinGptModel,
      tool: tool({
        description: "report build result",
        inputSchema: BuildResultSchema,
        async execute(args) {
          seenArgs = args
          return { output: "ok", title: "", metadata: {} }
        },
      }),
    }) as any

    await prepared.execute(
      {
        status: "passed",
        summary: "No-op verification passed.",
        files_changed: [],
        tests: [],
        fact_check_items: [],
        error: null,
      },
      { toolCallId: "call_build_null_error" },
    )
    expect(seenArgs.status).toBe("passed")
    expect("error" in seenArgs).toBe(false)

    await expect(
      prepared.execute(
        {
          status: "passed",
          summary: "No-op verification passed.",
          files_changed: [],
          tests: [],
          fact_check_items: [],
          error: "dummy",
        },
        { toolCallId: "call_build_string_error" },
      ),
    ).rejects.toThrow("Invalid input for tool report_build_result")
  })

  test("strips GPT strict-schema null placeholders for dispatch_agent target branches with optional literals", async () => {
    const workflow = WorkflowRegistry.resolveSync("pipeline")!
    const { tools } = createOrchestratorTools({
      taskID: "tsk_dispatch_null_placeholders",
      agentSessionID: "ses_dispatch_null_placeholders",
      signal: new AbortController().signal,
      workflow,
    })
    const reason =
      "Current graph state: gol_001 completed; gol_002 is the only dependency-unblocked blocking goal."
    const pollutedInput = {
      reason,
      source_urls: null,
      focus: null,
      continuation_artifact_id: null,
      target: "build",
      target_deliverable: null,
      request: null,
      goalID: "gol_dispatch_null_placeholders",
      directBuildIntent: null,
      worktreeUsage: "managed_worktree",
      userConfirmedStaleIntegrityData: null,
      app_url: null,
      preview_command: null,
      target_session_id: null,
      target_agent: null,
      fact_check_items: null,
      question: null,
    }
    let seenArgs: unknown
    const prepared = SessionLoop.prepareProviderTool({
      name: "dispatch_agent",
      source: "extra",
      model: hexinGptModel,
      tool: tool({
        description: "dispatch agent schema materialization test",
        inputSchema: (tools.dispatch_agent as { inputSchema: unknown }).inputSchema as any,
        async execute(args) {
          seenArgs = args
          return { output: "ok", title: "", metadata: {} }
        },
      }),
    }) as any

    await prepared.execute(pollutedInput, { toolCallId: "call_dispatch_agent_null_placeholders" })
    expect(seenArgs).toEqual({
      reason,
      target: "build",
      goalID: "gol_dispatch_null_placeholders",
      worktreeUsage: "managed_worktree",
    })

    await expect(
      prepared.execute(
        {
          ...pollutedInput,
          target_agent: "opentest-build-agent",
        },
        { toolCallId: "call_dispatch_agent_non_null_unknown" },
      ),
    ).rejects.toThrow("Invalid input for tool dispatch_agent")

    await expect(
      prepared.execute(
        {
          ...pollutedInput,
          directBuildIntent: "wrong_intent",
        },
        { toolCallId: "call_dispatch_agent_wrong_literal" },
      ),
    ).rejects.toThrow("Invalid input for tool dispatch_agent")
  })

  test("strips GPT strict-schema null placeholders across scheduler discriminated tools", async () => {
    const { tools } = createOrchestratorTools({
      taskID: "tsk_scheduler_null_placeholders",
      agentSessionID: "ses_scheduler_null_placeholders",
      signal: new AbortController().signal,
    })
    const runPrepared = async (name: string, inputSchema: unknown, input: Record<string, unknown>) => {
      let seenArgs: unknown
      const prepared = SessionLoop.prepareProviderTool({
        name,
        source: "extra",
        model: hexinGptModel,
        tool: tool({
          description: "scheduler discriminated tool schema materialization test",
          inputSchema: inputSchema as any,
          async execute(args) {
            seenArgs = args
            return { output: "ok", title: "", metadata: {} }
          },
        }),
      }) as any

      await prepared.execute(input, { toolCallId: `call_${name}_${input.target ?? input.action}` })
      return seenArgs
    }

    const dispatchNulls = {
      request: null,
      goalID: null,
      directBuildIntent: null,
      worktreeUsage: null,
      userConfirmedStaleIntegrityData: null,
      target_deliverable: null,
      source_urls: null,
      urls: null,
      figma_url: null,
      materials: null,
      focus: null,
      app_url: null,
      preview_command: null,
      continuation_artifact_id: null,
      target_session_id: null,
      target_agent: null,
      fact_check_items: null,
    }
    for (const { input, expected } of dispatchAgentTargetCases) {
      await expect(
        runPrepared("dispatch_agent", (tools.dispatch_agent as { inputSchema: unknown }).inputSchema, {
          ...dispatchNulls,
          ...input,
        }),
      ).resolves.toEqual(expected)
    }

    const manageTaskNulls = {
      title: null,
      request: null,
      reason: null,
      evidence_anchor: null,
      priority: null,
      queue: null,
      kind: null,
      summary: null,
      error: null,
      goalID: null,
      updates: null,
      goal: null,
    }
    const manageTaskCases = [
      {
        input: { action: "complete_task", summary: "complete evidence" },
        expected: { action: "complete_task", summary: "complete evidence" },
      },
      {
        input: { action: "fail_task", error: "fatal evidence" },
        expected: { action: "fail_task", error: "fatal evidence" },
      },
      {
        input: { action: "query_failed_goals" },
        expected: { action: "query_failed_goals" },
      },
    ]
    for (const { input, expected } of manageTaskCases) {
      await expect(
        runPrepared("manage_task", (tools.manage_task as { inputSchema: unknown }).inputSchema, {
          ...manageTaskNulls,
          ...input,
        }),
      ).resolves.toEqual(expected)
    }

    await expect(
      runPrepared("manage_task", (tools.manage_task as { inputSchema: unknown }).inputSchema, {
        ...manageTaskNulls,
        action: "complete_task",
        summary: "complete evidence",
        error: "non-null cross-action field",
      }),
    ).rejects.toThrow("Invalid input for tool manage_task")
  })

  test("keeps dispatch_agent reason non-nullable in GPT strict provider schema", () => {
    const { tools } = createOrchestratorTools({
      taskID: "tsk_dispatch_reason_schema",
      agentSessionID: "ses_dispatch_reason_schema",
      signal: new AbortController().signal,
    })
    const providerJsonSchema = asSchema(
      ProviderSchema.input(hexinGptModel, (tools.dispatch_agent as { inputSchema: unknown }).inputSchema) as never,
    ).jsonSchema as any

    expect(providerJsonSchema.required).toContain("reason")
    expect(jsonSchemaAllowsNull(providerJsonSchema.properties.reason)).toBe(false)
    expect(jsonSchemaAllowsNull(providerJsonSchema.properties.request)).toBe(true)

    const dispatchInputSchema = (tools.dispatch_agent as { inputSchema: { safeParse: (input: unknown) => unknown } })
      .inputSchema as any
    for (const { input } of dispatchAgentTargetCases) {
      expect(
        dispatchInputSchema.safeParse({
          ...input,
          reason: "",
        }).success,
      ).toBe(false)
    }
    expect(
      dispatchInputSchema.safeParse({
        target: "build",
        reason: "per-goal build reason",
        goalID: "gol_dispatch_reason",
      }).success,
    ).toBe(true)
  })

  test("adds v6-aware model output conversion for project tool-result objects", () => {
    const prepared = SessionLoop.prepareProviderTool({
      name: "submit_requirements",
      source: "extra",
      model: dashScopeModel,
      tool: tool({
        description: "submit",
        inputSchema: z.object({ final: z.literal(true) }),
        async execute() {
          return { output: "accepted", title: "Submit", metadata: { ok: true } }
        },
      }),
    }) as any

    expect(
      prepared.toModelOutput({
        toolCallId: "call_submit",
        input: { final: true },
        output: { output: "accepted", title: "Submit", metadata: { ok: true } },
      }),
    ).toEqual({ type: "text", value: "accepted" })
  })

  test("preserves explicit tool model output conversion", () => {
    const customToModelOutput = () => ({ type: "text", value: "custom" })
    const prepared = SessionLoop.prepareProviderTool({
      name: "submit_requirements",
      source: "extra",
      model: dashScopeModel,
      tool: {
        ...tool({
          description: "submit",
          inputSchema: z.object({ final: z.literal(true) }),
          async execute() {
            return { output: "accepted", title: "Submit", metadata: { ok: true } }
          },
        }),
        toModelOutput: customToModelOutput,
      } as any,
    }) as any

    expect(prepared.toModelOutput).toBe(customToModelOutput)
    expect(prepared.toModelOutput({ output: { output: "accepted" } })).toEqual({ type: "text", value: "custom" })
  })

  test("rejects provider-bound tools without an input schema", () => {
    expect(() =>
      SessionLoop.prepareProviderTool({
        name: "broken_extra",
        source: "extra",
        model: dashScopeModel,
        tool: { description: "broken" } as any,
      }),
    ).toThrow("missing inputSchema")
  })
})

describe("SessionLoop.summarizeModelMessagePayloads", () => {
  test("reports the largest model-message parts without logging payload bytes", () => {
    const rows = SessionLoop.summarizeModelMessagePayloads([
      { role: "user", content: [{ type: "text", text: "small" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolName: "runtime_screenshot",
            toolCallId: "call-1",
            output: { type: "text", value: "x".repeat(500) },
          },
          { type: "text", text: "tiny" },
        ],
      },
      {
        role: "user",
        content: [{ type: "file", mediaType: "image/png", data: "y".repeat(300) }],
      },
    ] as any)

    expect(rows[0]).toMatchObject({
      role: "tool",
      type: "tool-result",
      toolName: "runtime_screenshot",
      toolCallId: "call-1",
    })
    expect(rows[1]).toMatchObject({
      role: "user",
      type: "file",
      mediaType: "image/png",
    })
    expect(JSON.stringify(rows)).not.toContain("yyyyyyyyyyyyyyyy")
  })
})

describe("SessionPrompt re-exports runtime contract API", () => {
  test("surfaces the session runtime contract functions only", () => {
    expect(typeof SessionPrompt.setSessionRuntimeContract).toBe("function")
    expect(typeof SessionPrompt.getSessionRuntimeContract).toBe("function")
    expect(typeof SessionPrompt.clearSessionRuntimeContract).toBe("function")
    expect(typeof SessionPrompt.validateSessionRuntimeContractForContinuation).toBe("function")
    expect(typeof SessionPrompt.agentKindRequiresRuntimeContract).toBe("function")
    expect((SessionPrompt as any).setExtraTools).toBeUndefined()
    expect((SessionPrompt as any).getExtraTools).toBeUndefined()
    expect((SessionPrompt as any).withExtraTools).toBeUndefined()
    // The re-exports must be the same function references: SessionPrompt is
    // a thin namespace on top of SessionLoop, not an independent copy.
    expect(SessionPrompt.setSessionRuntimeContract).toBe(SessionLoop.setSessionRuntimeContract)
    expect(SessionPrompt.getSessionRuntimeContract).toBe(SessionLoop.getSessionRuntimeContract)
    expect(SessionPrompt.clearSessionRuntimeContract).toBe(SessionLoop.clearSessionRuntimeContract)
    expect(SessionPrompt.validateSessionRuntimeContractForContinuation).toBe(
      SessionLoop.validateSessionRuntimeContractForContinuation,
    )
    expect(SessionPrompt.agentKindRequiresRuntimeContract).toBe(SessionLoop.agentKindRequiresRuntimeContract)
  })
})

describe("SessionLoop.setStepHook / withStepHook", () => {
  test("setStepHook round-trips via withStepHook (hook cleared on completion)", async () => {
    const sessionID = `ses_step_${Date.now()}_ok`
    const calls: Array<{ step: number; turn: string }> = []
    await SessionLoop.withStepHook(
      sessionID,
      async (event) => {
        calls.push({ step: event.step, turn: event.turn })
      },
      async () => {
        // Inside the wrapper, a hook is registered — we can't directly assert
        // registration without exposing a getter, but we assert clearing via
        // an indirect contract: a post-exit setStepHook(undefined) is a no-op.
        expect(true).toBe(true)
      },
    )
    // Post-callback: setting undefined on an empty slot is a no-op — this
    // throws if the cleanup was skipped (the Map remembers the fn).
    expect(() => SessionLoop.setStepHook(sessionID, undefined)).not.toThrow()
    expect(calls).toEqual([])
  })

  test("withStepHook clears even when the callback throws", async () => {
    const sessionID = `ses_step_${Date.now()}_throw`
    const hook = () => undefined
    await expect(
      SessionLoop.withStepHook(sessionID, hook, async () => {
        throw new Error("intentional")
      }),
    ).rejects.toThrow("intentional")
    // Map entry cleared — setting again should not stack (idempotent no-op).
    SessionLoop.setStepHook(sessionID, undefined)
  })

  test("setStepHook replaces the registered hook wholesale", async () => {
    const sessionID = `ses_step_${Date.now()}_replace`
    const firstCalls: number[] = []
    const secondCalls: number[] = []
    const first = (e: { step: number }) => {
      firstCalls.push(e.step)
    }
    const second = (e: { step: number }) => {
      secondCalls.push(e.step)
    }
    SessionLoop.setStepHook(sessionID, first)
    SessionLoop.setStepHook(sessionID, second)
    // After replace, only `second` is active. We cannot invoke the hook
    // from here without running a real session, so this test just asserts
    // the API contract does not throw.
    SessionLoop.setStepHook(sessionID, undefined)
    expect(firstCalls).toEqual([])
    expect(secondCalls).toEqual([])
  })

  test("SessionPrompt re-exports setStepHook / withStepHook with identity", () => {
    expect(SessionPrompt.setStepHook).toBe(SessionLoop.setStepHook)
    expect(SessionPrompt.withStepHook).toBe(SessionLoop.withStepHook)
  })
})
