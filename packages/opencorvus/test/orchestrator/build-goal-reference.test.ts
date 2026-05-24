import { afterEach, describe, expect, mock, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineArtifactTable, EngineGoalTable, EnginePlanVersionTable, EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { Session } from "../../src/session"
import { listGoalRunsByGoal } from "../../src/engine/store"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let buildAgentRunImpl: ((input: any) => Promise<any>) | undefined

function buildToolOptions(label = "goal_reference") {
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

mock.module("@/build/agent", () => ({
  BuildAgent: {
    run: (input: any) => {
      if (!buildAgentRunImpl) throw new Error("BuildAgent.run mock not configured")
      return buildAgentRunImpl(input)
    },
  },
}))

describe("orchestrator build goal references", () => {
  afterEach(async () => {
    buildAgentRunImpl = undefined
    await resetDatabase()
  })

  test("resolves active-plan display labels like G12 before dispatching build", async () => {
    await using tmp = await tmpdir({ git: true })
    const now = Date.now()
    const ids = seedWorkflowTaskWithGoals({
      directory: tmp.path,
      now,
      goalCount: 12,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal reference root" })
        attachTaskSession(ids.taskID, parent.id)

        let observedGoalID = ""
        buildAgentRunImpl = async (input: any) => {
          await input.onSessionCreated?.("ses_goal_ref_build", {
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          })
          observedGoalID = input.target.id
          return {
            result: {
              status: "passed",
              summary: "Resolved display goal reference.",
              files_changed: [{
                path: "src/goal12.ts",
                summary: "Implemented the twelfth goal.",
                reason: "Regression coverage for display goal references.",
              }],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_ref_build",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID: ids.taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID: "G12",
          request: "Implement goal twelve.",
          reason: "Per-goal pipeline execution using a displayed goal label.",
        }, buildToolOptions("goal_ref_g12"))

        expect(result).toContain("status=passed")
        expect(observedGoalID).toBe(ids.goalIDs[11])
        expect(listGoalRunsByGoal(ids.goalIDs[11]!)).toHaveLength(1)
      },
    })
  })

  test("rejects out-of-range display labels without telling the model to re-run Architect", async () => {
    await using tmp = await tmpdir({ git: true })
    const now = Date.now()
    const ids = seedWorkflowTaskWithGoals({
      directory: tmp.path,
      now,
      goalCount: 2,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal reference invalid root" })
        attachTaskSession(ids.taskID, parent.id)
        let buildCalls = 0
        buildAgentRunImpl = async () => {
          buildCalls++
          throw new Error("should not dispatch")
        }

        const { tools } = createOrchestratorTools({
          taskID: ids.taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID: "G99",
          request: "Implement missing display goal.",
          reason: "Regression coverage for invalid displayed goal labels.",
        }, buildToolOptions("goal_ref_g99"))

        expect(buildCalls).toBe(0)
        expect(result).toContain("outside the active plan range")
        expect(result).not.toContain("register")
        expect(result).not.toContain("architect")
      },
    })
  })

  test("resolves hash and bare numeric active-plan labels", async () => {
    await using tmp = await tmpdir({ git: true })
    const now = Date.now()
    const ids = seedWorkflowTaskWithGoals({
      directory: tmp.path,
      now,
      goalCount: 2,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal reference numeric root" })
        attachTaskSession(ids.taskID, parent.id)

        const observedGoalIDs: string[] = []
        buildAgentRunImpl = async (input: any) => {
          await input.onSessionCreated?.(`ses_goal_ref_numeric_${observedGoalIDs.length + 1}`, {
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          })
          observedGoalIDs.push(input.target.id)
          return {
            result: {
              status: "passed",
              summary: "Resolved numeric goal reference.",
              files_changed: [{
                path: "src/reference.ts",
                summary: "Implemented referenced goal.",
                reason: "Regression coverage for numeric display goal references.",
              }],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: `ses_goal_ref_numeric_${observedGoalIDs.length}`,
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID: ids.taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        await tools.build.execute({
          goalID: "#1",
          request: "Implement first goal.",
          reason: "Per-goal pipeline execution using a hash display label.",
        }, buildToolOptions("goal_ref_hash"))
        await tools.build.execute({
          goalID: "2",
          request: "Implement second goal.",
          reason: "Per-goal pipeline execution using a bare numeric display label.",
        }, buildToolOptions("goal_ref_numeric"))

        expect(observedGoalIDs).toEqual([ids.goalIDs[0], ids.goalIDs[1]])
      },
    })
  }, 30_000)
})

function seedWorkflowTaskWithGoals(input: {
  directory: string
  now: number
  goalCount: number
}) {
  const suffix = `${input.now.toString(16)}_${Math.random().toString(16).slice(2)}`
  const projectID = `project_goal_ref_${suffix}`
  const taskID = `tsk_goal_ref_${suffix}`
  const specID = `spec_goal_ref_${suffix}`
  const planID = `pln_goal_ref_${suffix}`
  const goalIDs = Array.from({ length: input.goalCount }, (_, index) => `gol_goal_ref_${index + 1}_${suffix}`)

  Database.use((db) => {
    db.insert(ProjectTable).values({
      id: projectID,
      worktree: input.directory,
      name: "Goal reference test",
      sandboxes: "[]",
      time_created: input.now,
      time_updated: input.now,
    }).run()
    db.insert(EngineTaskTable).values({
      id: taskID,
      project_id: projectID,
      session_id: null,
      source: "test",
      title: "Goal reference task",
      request: "Build ordered goals",
      kind: "workflow",
      priority: "normal",
      metadata: {
        architect_fidelity: {
          sourceCoverage: [],
          referenceCoverage: [],
          assemblyOwners: [{
            surface: "final-deliverable",
            goal_id: goalIDs[input.goalCount - 1],
            rationale: "The final ordered goal owns assembly for this test task.",
          }],
        },
      },
      time_created: input.now,
      time_updated: input.now,
      time_started: input.now,
    }).run()
    db.insert(EngineSpecSnapshotTable).values({
      id: specID,
      task_id: taskID,
      version: 1,
      status: "ready",
      summary: "Goal reference spec",
      content: "Build ordered goals",
      scope: "Verify ordinal goal references resolve through the active plan.",
      time_created: input.now,
      time_updated: input.now,
    }).run()
    db.insert(EnginePlanVersionTable).values({
      id: planID,
      task_id: taskID,
      spec_snapshot_id: specID,
      version: 1,
      status: "active",
      summary: `${input.goalCount} goals`,
      prompt: "Build ordered goals",
      metadata: {},
      time_created: input.now,
      time_updated: input.now,
    }).run()
    for (const [index, goalID] of goalIDs.entries()) {
      db.insert(EngineGoalTable).values({
        id: goalID,
        task_id: taskID,
        plan_version_id: planID,
        spec_snapshot_id: specID,
        title: `Goal ${index + 1}`,
        slug: `goal-${index + 1}`,
        objective: `Implement goal ${index + 1}`,
        acceptance_specs: [],
        owned_paths: [`src/goal${index + 1}.ts`],
        depends_on: [],
        exports: [],
        imports: [],
        kind: "feature",
        requirement_ids: [],
        priority: "blocking",
        source: "test",
        order_index: index,
        time_created: input.now,
        time_updated: input.now,
      }).run()
    }
    db.insert(EngineArtifactTable).values({
      id: `artifact_contract_graph_${taskID}_${input.now}`,
      task_id: taskID,
      run_id: null,
      goal_run_id: null,
      kind: "architect_contract_graph",
      label: "architect-contract-graph",
      payload: { version: 1, contracts: [], dependency_contracts: [] },
      time_created: input.now,
      time_updated: input.now,
    }).run()
  })

  return { projectID, taskID, specID, planID, goalIDs }
}

function attachTaskSession(taskID: string, sessionID: string) {
  Database.use((db) => {
    db.update(EngineTaskTable)
      .set({ session_id: sessionID, time_updated: Date.now() })
      .where(eq(EngineTaskTable.id, taskID))
      .run()
  })
}
