import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Orchestrator } from "../../src/orchestrator/agent"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
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
  "query_failed_goals",
  "complete_task",
  "fail_task",
  "cancel_task",
  "retry_task",
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

  test("general wake installs only the explicit scheduler role-base tools", async () => {
    const captured = await captureOrchestratorRuntimeContract({ profileID: "general" })

    expect(captured.identity.agentKind).toBe("orchestrator")
    expect(captured.identity.contractKind).toBe("orchestrator-wake")
    expect(captured.identity.promptProfileID).toBe("general")
    expect(captured.identity.capabilityProfileID).toBe("general")
    expect(captured.identity.projectionHash).toMatch(/^[a-f0-9]{64}$/)
    expect(captured.includeMcpTools).toBe(false)
    expect(captured.toolIDs).toEqual([...expectedSchedulerRoleBaseToolIDs])
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
    expect(captured.toolIDs).toContain("frontend_research")
    expect(captured.toolIDs).toContain("frontend_design")
    expect(captured.toolIDs).toContain("visual_qa")
    expect(captured.toolIDs).toContain("browser_preview")
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
    expect(captured.toolIDs).toContain("build")
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
    expect(captured.toolIDs).toContain("build")
    expect(captured.toolIDs).toContain(packageToolProviderName)
    expect(captured.toolIDs).not.toContain(`${PROJECT_EXPERT_SQUAD_ID}/orchestrator/source-evidence`)
    expect(captured.toolIDs).not.toContain("source-evidence")
    expect(captured.toolIDs).not.toContain("build-evidence")
    expect(captured.toolIDs).not.toContain("package-browser")
  })

  test("select_expert_squad rejects migrated profile IDs when the project package is absent", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({ kind: "root", title: "scheduler missing migrated package" })
        insertWorkflowTask({
          taskID,
          rootSessionID: root.id,
          now,
          title: "scheduler missing migrated package",
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: root.id,
          signal: new AbortController().signal,
        })

        await expect(
          tools.select_expert_squad.execute(
            {
              profile_id: "frontend-replica",
              reason: "Migrated expert squad IDs must come from project packages.",
            },
            toolOptions("select_expert_squad_missing_migrated_package"),
          ),
        ).rejects.toThrow('Unknown prompt profile "frontend-replica"')
      },
    })
  })

  test("select_expert_squad continuation wake installs selected profile projected tool table", async () => {
    installControlModel()
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })
    await copyRepositoryExpertSquadPackage(tmp.path, "frontend-replica")
    let captured: CapturedRuntimeContract | undefined

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
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
    expect(captured?.toolIDs).toContain("frontend_research")
    expect(captured?.toolIDs).toContain("frontend_design")
    expect(captured?.toolIDs).toContain("visual_qa")
    expect(captured?.toolIDs).toContain("integrity")
    expect(captured?.toolIDs).toContain("browser_preview")
    expect(captured?.toolIDs).toContain("bash")
    expect(captured?.toolIDs).not.toContain("deep_research")
    expect(captured?.toolIDs).not.toContain("fact_check")
  })
})
