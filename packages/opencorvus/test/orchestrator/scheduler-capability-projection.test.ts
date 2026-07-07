import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import * as EngineQueue from "../../src/engine/queue"
import { EffectiveConfig } from "../../src/config/effective"
import { createDecisionLog } from "../../src/decision-log"
import { Identifier } from "../../src/id/id"
import { Orchestrator } from "../../src/orchestrator/agent"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { WorkflowRegistry, type MiniWorkflow } from "../../src/engine/workflow"
import * as TaskLoop from "../../src/orchestrator/loop"
import { PromptProfileResolver } from "../../src/expert-squad/prompt-profile-resolver"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { SessionPrompt } from "../../src/session/prompt"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import {
  copyRepositoryExpertSquadPackage,
  PROJECT_EXPERT_SQUAD_ID,
  writeProjectExpertSquadPackage,
} from "../fixture/expert-squad"
import { tmpdir } from "../fixture/fixture"
import { installControlModel } from "../workspace/mock-control-model"

const expectedSchedulerRoleBaseToolIDs = [
  "select_expert_squad",
  "skill",
  "question",
  "read_context",
  "dispatch_agent",
  "manage_task",
  "wait",
  "inject_operator_message",
  "respond_agent_coordination",
  "cancel_subagent",
] as const

type CapturedRuntimeContract = {
  toolIDs: string[]
  includeMcpTools: boolean | undefined
  identity: {
    agentKind?: string
    contractKind?: string
    sessionID?: string
    promptProfileID?: string
    capabilityProfileID?: string
    projectionHash?: string
  }
}

function insertWorkflowTask(input: {
  taskID: string
  rootSessionID: string
  now: number
  title: string
  kind?: "workflow" | "build"
}) {
  Database.use((db) => {
    db.insert(EngineTaskTable)
      .values({
        id: input.taskID,
        project_id: Instance.project.id,
        session_id: input.rootSessionID,
        source: "test",
        title: input.title,
        request: input.title,
        kind: input.kind ?? "workflow",
        priority: "normal",
        time_created: input.now,
        time_updated: input.now,
        time_started: input.now,
      })
      .run()
  })
}

function toolCallFinish(sessionID: string): Message.WithParts {
  const now = Date.now()
  return {
    info: {
      id: Identifier.ascending("message"),
      sessionID,
      role: "assistant",
      time: { created: now, completed: now },
      parentID: "",
      modelID: "control",
      providerID: "mock-control",
      agent: "orchestrator",
      path: { cwd: Instance.directory, root: Instance.directory },
      cost: 0,
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "tool-calls",
    },
    parts: [],
  }
}

function toolOptions(label: string) {
  const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  return {
    toolCallId: `cal_${label}_${stamp}`,
    opencorvus: {
      sessionID: `ses_${label}_${stamp}`,
      messageID: `msg_${label}_${stamp}`,
      toolCallID: `cal_${label}_${stamp}`,
      toolPartID: `prt_${label}_${stamp}`,
    },
  } as any
}

function toolText(result: unknown): string {
  if (typeof result === "string") return result
  if (
    result &&
    typeof result === "object" &&
    (result as { type?: unknown }).type === "final" &&
    typeof (result as { output?: unknown }).output === "string"
  ) {
    return (result as { output: string }).output
  }
  if (result && typeof result === "object" && typeof (result as { output?: unknown }).output === "string") {
    return (result as { output: string }).output
  }
  return String(result)
}

async function captureOrchestratorRuntimeContract(input: {
  profileID: string
  writeProjectPackage?: boolean
  repositoryPackageID?: string
  taskKind?: "workflow" | "build"
}): Promise<CapturedRuntimeContract> {
  installControlModel()
  await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })
  let captured: CapturedRuntimeContract | undefined

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      if (input.writeProjectPackage) await writeProjectExpertSquadPackage(tmp.path)
      if (input.repositoryPackageID) await copyRepositoryExpertSquadPackage(tmp.path, input.repositoryPackageID)
      const now = Date.now()
      const taskID = Identifier.ascending("task")
      const root = await Session.create({ kind: "root", title: `scheduler projection ${input.profileID}` })
      await Session.mergeConfigOverlay({
        sessionID: root.id,
        patch: {
          model: "mock-control/control",
          prompt_profile: { active: input.profileID },
        },
      })
      insertWorkflowTask({
        taskID,
        rootSessionID: root.id,
        now,
        title: `scheduler projection ${input.profileID}`,
        kind: input.taskKind,
      })

      spyOn(SessionPrompt, "prompt").mockImplementation((async (promptInput) => {
        const contract = SessionPrompt.getSessionRuntimeContract(promptInput.sessionID)
        captured = {
          toolIDs: Object.keys(contract?.tools ?? {}),
          includeMcpTools: contract?.includeMcpTools,
          identity: {
            agentKind: contract?.identity.agentKind,
            contractKind: contract?.identity.contractKind,
            sessionID: contract?.identity.sessionID,
            promptProfileID: contract?.identity.promptProfileID,
            capabilityProfileID: contract?.identity.capabilityProfileID,
            projectionHash: contract?.identity.projectionHash,
          },
        }
        return toolCallFinish(promptInput.sessionID)
      }) as never)

      await Orchestrator.processTask(taskID, { note: "scheduler capability projection runtime contract test" })
    },
  })

  expect(captured).toBeDefined()
  return captured!
}

describe("orchestrator scheduler capability projection", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("orchestrator public scheduler surface collapses dispatch and lifecycle tools", async () => {
    const workflow = WorkflowRegistry.resolveSync("pipeline")!
    const { tools } = createOrchestratorTools({
      taskID: "tsk_unified_surface",
      agentSessionID: "ses_unified_surface",
      workflow,
    })
    const publicTools = tools as Record<
      string,
      {
        execute?: (input: unknown, options?: unknown) => Promise<unknown>
        inputSchema?: { safeParse: (input: unknown) => { success: boolean } }
      }
    >

    expect(Object.hasOwn(publicTools, "dispatch_agent")).toBe(true)
    expect(Object.hasOwn(publicTools, "manage_task")).toBe(true)

    for (const hidden of [
      "requirements",
      "architect",
      "frontend_research",
      "frontend_design",
      "deep_research",
      "visual_qa",
      "workload_analysis",
      "integrity",
      "fact_check",
      "explore",
      "build",
      "propose_task",
      "complete_task",
      "fail_task",
      "cancel_task",
      "retry_task",
      "add_goal",
      "modify_goal",
      "complete_goal",
      "delete_goal",
      "query_failed_goals",
    ]) {
      expect(Object.hasOwn(publicTools, hidden), `${hidden} must not be public`).toBe(false)
    }

    const manageTaskExecute = publicTools.manage_task.execute
    const dispatchAgentExecute = publicTools.dispatch_agent.execute
    expect(typeof manageTaskExecute).toBe("function")
    expect(typeof dispatchAgentExecute).toBe("function")

    expect(publicTools.manage_task.inputSchema!.safeParse({ action: "fail_task" }).success).toBe(false)
    expect(publicTools.manage_task.inputSchema!.safeParse({ action: "fail_task", error: "fatal" }).success).toBe(
      true,
    )
    expect(publicTools.manage_task.inputSchema!.safeParse({ action: "complete_task", error: "fatal" }).success).toBe(
      false,
    )
    expect(
      publicTools.manage_task.inputSchema!.safeParse({ action: "complete_task", summary: "all evidence passed" })
        .success,
    ).toBe(true)
    expect(publicTools.manage_task.inputSchema!.safeParse({ action: "cancel_task" }).success).toBe(false)
    expect(
      publicTools.manage_task.inputSchema!.safeParse({ action: "cancel_task", reason: "operator requested stop" })
        .success,
    ).toBe(true)

    await expect(manageTaskExecute!({ action: "fail_task" }, toolOptions("manage_task_missing_error"))).rejects.toThrow()
    await expect(
      dispatchAgentExecute!(
        { target: "build", reason: "missing goal or request" },
        toolOptions("dispatch_agent_missing_build_input"),
      ),
    ).rejects.toThrow()
  })

  test("general wake installs only the explicit scheduler role-base tools", async () => {
    const captured = await captureOrchestratorRuntimeContract({ profileID: "general" })

    expect(captured.identity.agentKind).toBe("orchestrator")
    expect(captured.identity.contractKind).toBe("orchestrator-wake")
    expect(captured.identity.promptProfileID).toBe("general")
    expect(captured.identity.capabilityProfileID).toBe("general")
    expect(captured.identity.projectionHash).toMatch(/^[a-f0-9]{64}$/)
    expect(captured.includeMcpTools).toBe(false)
    expect(captured.toolIDs).toEqual([...expectedSchedulerRoleBaseToolIDs])
    expect(captured.toolIDs).not.toContain("complete_task")
    expect(captured.toolIDs).not.toContain("fail_task")
    expect(captured.toolIDs).not.toContain("cancel_task")
    expect(captured.toolIDs).not.toContain("retry_task")
    expect(captured.toolIDs).not.toContain("build")
    expect(captured.toolIDs).not.toContain("frontend_design")
    expect(captured.toolIDs).not.toContain("browser_preview")
    expect(captured.toolIDs).not.toContain("bash")
  })

  test("general wake does not expose project package scheduler tools", async () => {
    const captured = await captureOrchestratorRuntimeContract({
      profileID: "general",
      writeProjectPackage: true,
    })
    const packageToolProviderName = PromptProfileResolver.packageToolProviderName(
      `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/source-evidence`,
    )

    expect(captured.includeMcpTools).toBe(false)
    expect(captured.toolIDs).toEqual([...expectedSchedulerRoleBaseToolIDs])
    expect(captured.toolIDs).not.toContain(packageToolProviderName)
    expect(captured.toolIDs).not.toContain("source-evidence")
  })

  test("frontend automation debug project package wake installs its active projected workflow tools", async () => {
    const captured = await captureOrchestratorRuntimeContract({
      profileID: "frontend-automation-debug",
      repositoryPackageID: "frontend-automation-debug",
    })

    expect(captured.includeMcpTools).toBe(false)
    expect(captured.toolIDs.slice(0, expectedSchedulerRoleBaseToolIDs.length)).toEqual([
      ...expectedSchedulerRoleBaseToolIDs,
    ])
    expect(captured.toolIDs).toContain("dispatch_agent")
    expect(captured.toolIDs).toContain("browser_preview")
    expect(captured.toolIDs).not.toContain("frontend_research")
    expect(captured.toolIDs).not.toContain("frontend_design")
    expect(captured.toolIDs).not.toContain("visual_qa")
    expect(captured.toolIDs).not.toContain("deep_research")
  })

  test("direct build workflow hides profile-declared pipeline workflow tools", async () => {
    const captured = await captureOrchestratorRuntimeContract({
      profileID: "frontend-innovate",
      repositoryPackageID: "frontend-innovate",
      taskKind: "build",
    })

    expect(captured.includeMcpTools).toBe(false)
    expect(captured.identity.promptProfileID).toBe("frontend-innovate")
    expect(captured.identity.capabilityProfileID).toBe("frontend-innovate")
    expect(captured.identity.projectionHash).toMatch(/^[a-f0-9]{64}$/)
    expect(captured.toolIDs).toContain("select_expert_squad")
    expect(captured.toolIDs).toContain("skill")
    expect(captured.toolIDs).toContain("dispatch_agent")
    expect(captured.toolIDs).toContain("bash")
    expect(captured.toolIDs).toContain("browser_preview")
    for (const hidden of [
      "requirements",
      "architect",
      "frontend_design",
      "frontend_research",
      "deep_research",
      "visual_qa",
      "workload_analysis",
      "integrity",
      "fact_check",
      "explore",
    ]) {
      expect(captured.toolIDs, `direct workflow must not expose ${hidden}`).not.toContain(hidden)
    }
  })

  test("dispatch_agent target schema only accepts targets declared by the active workflow", () => {
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    expect(pipeline.steps.map((step) => step.tool)).not.toContain("frontend_design")

    const { tools } = createOrchestratorTools({
      taskID: "tsk_pipeline_dispatch_schema",
      agentSessionID: "ses_pipeline_dispatch_schema",
      workflow: pipeline,
    })
    expect(Object.hasOwn(tools, "frontend_design")).toBe(false)
    expect(
      tools.dispatch_agent.inputSchema!.safeParse({
        target: "frontend_design",
        reason: "visual reference",
        urls: ["https://example.com"],
      }).success,
    ).toBe(false)
    expect(
      tools.dispatch_agent.inputSchema!.safeParse({
        target: "requirements",
        reason: "pipeline requirements intake",
      }).success,
    ).toBe(true)
    expect(
      tools.dispatch_agent.inputSchema!.safeParse({
        target: "requirements",
        reason: "pipeline requirements intake",
        urls: ["https://example.com"],
      }).success,
    ).toBe(false)
    expect(
      tools.dispatch_agent.inputSchema!.safeParse({
        target: "frontend_research",
        reason: "source page investigation",
        source_urls: ["https://example.com"],
      }).success,
    ).toBe(true)
    expect(
      tools.dispatch_agent.inputSchema!.safeParse({
        target: "build",
      }).success,
    ).toBe(false)
    expect(
      tools.dispatch_agent.inputSchema!.safeParse({
        target: "fact_check",
        reason: "Verify report claims without target references.",
      }).success,
    ).toBe(false)
    expect(
      tools.dispatch_agent.inputSchema!.safeParse({
        target: "fact_check",
        target_session_id: "ses_worker_report",
        fact_check_items: [
          {
            claim: "The implementation changed the unified scheduler dispatch tool contract.",
            confidence: "high",
            category: "protocol",
            source: "test",
          },
        ],
        reason: "Verify the worker terminal report claims before accepting them.",
      }).success,
    ).toBe(true)
    expect(
      tools.dispatch_agent.inputSchema!.safeParse({
        target: "unknown_stage",
        reason: "not a registered dispatch target",
      }).success,
    ).toBe(false)

    const directTools = createOrchestratorTools({
      taskID: "tsk_direct_dispatch_schema",
      agentSessionID: "ses_direct_dispatch_schema",
      workflow: WorkflowRegistry.resolveSync("direct")!,
    }).tools
    expect(
      directTools.dispatch_agent.inputSchema!.safeParse({
        target: "requirements",
        reason: "direct workflow does not declare requirements",
      }).success,
    ).toBe(false)
    expect(
      directTools.dispatch_agent.inputSchema!.safeParse({
        target: "integrity",
        reason: "direct workflow does not declare integrity",
      }).success,
    ).toBe(false)

    const customFrontendDesignWorkflow = {
      ...pipeline,
      id: "custom-frontend-design",
      name: "Custom Frontend Design",
      steps: [
        {
          id: "frontend_design",
          tool: "frontend_design",
          agentRole: "frontend-design",
          label: "Design",
          hint: "Custom workflow frontend_design step.",
          scope: "task",
          skippable: true,
          after: [],
        },
      ],
      goalLoopStepIDs: [],
    } satisfies MiniWorkflow
    const customTools = createOrchestratorTools({
      taskID: "tsk_custom_dispatch_schema",
      agentSessionID: "ses_custom_dispatch_schema",
      workflow: customFrontendDesignWorkflow,
    }).tools
    expect(
      customTools.dispatch_agent.inputSchema!.safeParse({
        target: "frontend_design",
        reason: "visual reference",
        urls: ["https://example.com"],
      }).success,
    ).toBe(true)

    const innovateWorkflow = WorkflowRegistry.resolveSync("frontend_innovate")!
    expect(innovateWorkflow.steps.map((step) => step.tool)).toContain("frontend_design")
    const innovateTools = createOrchestratorTools({
      taskID: "tsk_frontend_innovate_dispatch_schema",
      agentSessionID: "ses_frontend_innovate_dispatch_schema",
      workflow: innovateWorkflow,
    }).tools
    expect(
      innovateTools.dispatch_agent.inputSchema!.safeParse({
        target: "frontend_design",
        reason: "redesign from source and competitor evidence",
        urls: ["https://example.com"],
      }).success,
    ).toBe(true)
  })

  test("project package wake installs scheduler package tools without MCP activation", async () => {
    const captured = await captureOrchestratorRuntimeContract({
      profileID: PROJECT_EXPERT_SQUAD_ID,
      writeProjectPackage: true,
    })
    const packageToolProviderName = PromptProfileResolver.packageToolProviderName(
      `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/source-evidence`,
    )

    expect(captured.includeMcpTools).toBe(false)
    expect(captured.toolIDs).toContain("select_expert_squad")
    expect(captured.toolIDs).toContain("skill")
    expect(captured.toolIDs).toContain("dispatch_agent")
    expect(captured.toolIDs).toContain(packageToolProviderName)
    expect(captured.toolIDs).not.toContain("build")
    expect(captured.toolIDs).not.toContain(`${PROJECT_EXPERT_SQUAD_ID}/orchestrator/source-evidence`)
    expect(captured.toolIDs).not.toContain("source-evidence")
    expect(captured.toolIDs).not.toContain("build-evidence")
    expect(captured.toolIDs).not.toContain("package-browser")
  })

  test("select_expert_squad accepts explicitly installed project package profile IDs", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await copyRepositoryExpertSquadPackage(tmp.path, "frontend-replica")
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({ kind: "root", title: "scheduler installed package selection" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: {
            prompt_profile: { active: "frontend-replica" },
          },
        })
        insertWorkflowTask({
          taskID,
          rootSessionID: root.id,
          now,
          title: "scheduler installed package selection",
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: root.id,
          signal: new AbortController().signal,
        })

        const result = await tools.select_expert_squad.execute(
          {
            profile_id: "frontend-replica",
            reason: "The frontend-replica package is explicitly installed in the project before profile validation.",
          },
          toolOptions("select_expert_squad_payload_package"),
        )

        expect(toolText(result)).toContain(`Expert squad already active for task ${taskID}.`)
        expect(toolText(result)).toContain("- continuation_wake: not_scheduled")
        expect(Object.keys(await PromptProfileResolver.definitions(tmp.path))).toContain("frontend-replica")
      },
    })
  })

  test("select_expert_squad continuation wake installs selected profile projected tool table", async () => {
    installControlModel()
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })
    let captured: CapturedRuntimeContract | undefined

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await copyRepositoryExpertSquadPackage(tmp.path, "frontend-replica")
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({ kind: "root", title: "scheduler transition selection" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: {
            model: "mock-control/control",
            prompt_profile: { active: "general" },
          },
        })
        insertWorkflowTask({
          taskID,
          rootSessionID: root.id,
          now,
          title: "scheduler transition selection",
        })

        spyOn(SessionPrompt, "prompt").mockImplementation((async (promptInput) => {
          const contract = SessionPrompt.getSessionRuntimeContract(promptInput.sessionID)
          captured = {
            toolIDs: Object.keys(contract?.tools ?? {}),
            includeMcpTools: contract?.includeMcpTools,
            identity: {
              agentKind: contract?.identity.agentKind,
              contractKind: contract?.identity.contractKind,
              sessionID: contract?.identity.sessionID,
              promptProfileID: contract?.identity.promptProfileID,
              capabilityProfileID: contract?.identity.capabilityProfileID,
              projectionHash: contract?.identity.projectionHash,
            },
          }
          return toolCallFinish(promptInput.sessionID)
        }) as never)

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: root.id,
          signal: new AbortController().signal,
        })
        const result = await tools.select_expert_squad.execute(
          {
            profile_id: "frontend-replica",
            reason: "The task requires source URL/reference-screenshot replica workflow evidence.",
          },
          toolOptions("select_expert_squad_transition"),
        )

        expect(toolText(result)).toContain("- continuation_wake: started")
        await TaskLoop.awaitTaskLoopIdle(taskID, 15_000)
      },
    })

    expect(captured).toBeDefined()
    expect(captured?.identity.promptProfileID).toBe("frontend-replica")
    expect(captured?.identity.capabilityProfileID).toBe("frontend-replica")
    expect(captured?.identity.projectionHash).toMatch(/^[a-f0-9]{64}$/)
    expect(captured?.includeMcpTools).toBe(false)
    expect(captured?.toolIDs).toContain("select_expert_squad")
    expect(captured?.toolIDs).toContain("skill")
    expect(captured?.toolIDs).toContain("dispatch_agent")
    expect(captured?.toolIDs).toContain("browser_preview")
    expect(captured?.toolIDs).toContain("bash")
    expect(captured?.toolIDs).not.toContain("frontend_research")
    expect(captured?.toolIDs).not.toContain("frontend_design")
    expect(captured?.toolIDs).not.toContain("visual_qa")
    expect(captured?.toolIDs).not.toContain("integrity")
    expect(captured?.toolIDs).not.toContain("deep_research")
    expect(captured?.toolIDs).not.toContain("fact_check")
  }, 20_000)

  test("select_expert_squad restores the previous active profile when continuation wake is ignored", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await copyRepositoryExpertSquadPackage(tmp.path, "frontend-replica")
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({ kind: "root", title: "scheduler ignored selection" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: {
            model: "mock-control/control",
            prompt_profile: { active: "general" },
          },
        })
        insertWorkflowTask({
          taskID,
          rootSessionID: root.id,
          now,
          title: "scheduler ignored selection",
        })
        const dispatchTaskLoop = spyOn(EngineQueue, "dispatchTaskLoop").mockResolvedValue("ignored")
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: root.id,
          signal: new AbortController().signal,
        })

        await expect(
          tools.select_expert_squad.execute(
            {
              profile_id: "frontend-replica",
              reason: "The task requires reference screenshot replica workflow evidence.",
            },
            toolOptions("select_expert_squad_ignored_dispatch"),
          ),
        ).rejects.toThrow(/continuation wake was ignored/)

        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
        expect((await EffectiveConfig.effective({ sessionID: root.id })).prompt_profile.active).toBe("general")
        expect(createDecisionLog(taskID).readByKey("select_expert_squad")).toBeUndefined()
      },
    })
  })

  test("select_expert_squad restores the previous active profile when continuation wake throws", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await copyRepositoryExpertSquadPackage(tmp.path, "frontend-replica")
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({ kind: "root", title: "scheduler thrown selection" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: {
            model: "mock-control/control",
            prompt_profile: { active: "general" },
          },
        })
        insertWorkflowTask({
          taskID,
          rootSessionID: root.id,
          now,
          title: "scheduler thrown selection",
        })
        const dispatchTaskLoop = spyOn(EngineQueue, "dispatchTaskLoop").mockRejectedValue(
          new Error("synthetic continuation dispatch failure"),
        )
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: root.id,
          signal: new AbortController().signal,
        })

        await expect(
          tools.select_expert_squad.execute(
            {
              profile_id: "frontend-replica",
              reason: "The task requires reference screenshot replica workflow evidence.",
            },
            toolOptions("select_expert_squad_thrown_dispatch"),
          ),
        ).rejects.toThrow("synthetic continuation dispatch failure")

        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
        expect((await EffectiveConfig.effective({ sessionID: root.id })).prompt_profile.active).toBe("general")
        expect(createDecisionLog(taskID).readByKey("select_expert_squad")).toBeUndefined()
      },
    })
  })
})
