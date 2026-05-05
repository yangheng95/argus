import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineGoalTable, EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { createWorkflowState, WorkflowRegistry } from "../../src/engine/workflow"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { Session } from "../../src/session"
import { recordIntegrityAttempt } from "../../src/engine/persist"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { findGoal, findGoalLatestWorkspace, findLatestIntegrityAttemptArtifact, listGoalRunsByGoal } from "../../src/engine/store"
import { seedGoalRunAttemptWithWorkspace } from "../fixture/goal-run-attempt"
import { Filesystem } from "../../src/util/filesystem"

let buildAgentRunImpl: ((input: any) => Promise<any>) | undefined
let reviewIntegrityImpl: ((input: any) => Promise<any>) | undefined
let applyIntegrityCorrectionsImpl: ((goals: any[], verdict: any) => any[]) | undefined

mock.module("@/build/agent", () => ({
  BuildAgent: {
    run: (input: any) => {
      if (!buildAgentRunImpl) throw new Error("BuildAgent.run mock not configured")
      return buildAgentRunImpl(input)
    },
  },
}))

mock.module("@/integrity", () => ({
  reviewIntegrity: (input: any) => {
    if (!reviewIntegrityImpl) throw new Error("reviewIntegrity mock not configured")
    return reviewIntegrityImpl(input)
  },
  applyIntegrityCorrections: (goals: any[], verdict: any) => {
    if (applyIntegrityCorrectionsImpl) return applyIntegrityCorrectionsImpl(goals, verdict)
    return goals
  },
}))

function insertWorkflowTaskWithGoal(input: {
  projectID: string
  taskID: string
  goalID: string
  sessionID: string
  worktree: string
  projectName: string
  taskTitle: string
  request: string
  goalTitle: string
  goalSlug: string
  objective: string
  now: number
  workspaceDir?: string
  workspaceBranch?: string
  specID?: string
}) {
  const specID = input.specID ?? `spec_${input.goalID}`
  Database.use((db) => {
    db.insert(ProjectTable).values({
      id: input.projectID,
      worktree: input.worktree,
      name: input.projectName,
      sandboxes: "[]",
      time_created: input.now,
      time_updated: input.now,
    }).run()
    db.insert(EngineTaskTable).values({
      id: input.taskID,
      project_id: input.projectID,
      session_id: input.sessionID,
      source: "test",
      title: input.taskTitle,
      request: input.request,
      kind: "workflow",
      priority: "normal",
      time_created: input.now,
      time_updated: input.now,
      time_started: input.now,
    }).run()
    db.insert(EngineSpecSnapshotTable).values({
      id: specID,
      task_id: input.taskID,
      version: 1,
      status: "ready",
      summary: `${input.goalTitle} spec`,
      content: input.request,
      scope: input.objective,
      time_created: input.now,
      time_updated: input.now,
    }).run()
    db.insert(EngineGoalTable).values({
      id: input.goalID,
      task_id: input.taskID,
      spec_snapshot_id: specID,
      title: input.goalTitle,
      slug: input.goalSlug,
      objective: input.objective,
      acceptance_specs: [],
      owned_paths: ["src/index.ts"],
      depends_on: [],
      exports: [],
      imports: [],
      kind: "feature",
      requirement_ids: [],
      priority: "blocking",
      source: "test",
      status: "pending",
      order_index: 0,
      time_created: input.now,
      time_updated: input.now,
    }).run()
  })
  // Phase H (2026-05-05): seed via the shared fixture helper instead of an
  // ad-hoc Drizzle insert (rule 9 — single abstraction for the same shape
  // also used in engine/writer.test.ts).
  if (input.workspaceDir !== undefined || input.workspaceBranch !== undefined) {
    seedGoalRunAttemptWithWorkspace({
      taskID: input.taskID,
      goalID: input.goalID,
      workspaceDir: input.workspaceDir ?? null,
      workspaceBranch: input.workspaceBranch ?? null,
      status: "queued",
      now: input.now,
    })
  }
}

describe("orchestrator tools", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
    reviewIntegrityImpl = async () => ({
      verdict: "pass",
      summary: "Integrity pass",
      dimensions: [
        { id: "goal_fidelity", verdict: "pass", issues: [] },
        { id: "technical_feasibility", verdict: "pass", issues: [] },
        { id: "hallucination", verdict: "pass", issues: [] },
        { id: "solution_quality", verdict: "pass", issues: [] },
      ],
      issues: [],
      corrections: [],
      missingGoals: [],
      sessionID: "ses_integrity_default",
    })
  })

  afterEach(async () => {
    buildAgentRunImpl = undefined
    reviewIntegrityImpl = undefined
    applyIntegrityCorrectionsImpl = undefined
    mock.restore()
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("workflow tasks reject task-level build before delivery rework", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_build_${stamp}`
    const taskID = `tsk_build_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const workflowState = createWorkflowState(pipeline)

    Database.use((db) => {
      db.insert(ProjectTable).values({
        id: projectID,
        worktree: process.cwd(),
        name: "Build workflow contract test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineTaskTable).values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Build workflow contract task",
        request: "Verify workflow task-level build cannot bypass requirements and architect",
        kind: "workflow",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      }).run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "build workflow test" })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState,
        })

        const result = await tools.build.execute({
          request: "Implement the page directly.",
          reason: "Try to bypass the workflow.",
        }, {} as any)

        expect(result).toContain("rejected task-level build")
        expect(result).toContain("kind=workflow")
        expect(result).toContain("requirements, architect, and per-goal build")
        expect(workflowState.workflowID).toBe("pipeline")
      },
    })
  })

  test("publish gate failures remain rework feedback instead of terminal task failures", async () => {
    const source = await fs.readFile(path.join(import.meta.dir, "../../src/orchestrator/tools.ts"), "utf8")

    expect(source).toContain("publishGateReworkResult")
    expect(source).not.toContain('await updateTask(currentTask, { status: "failed", error: publishResult.summary')
    expect(source).not.toContain('await updateTask(task, { status: "failed", error: result.summary')
  })

  test("goal build auto-runs integrity for the active spec before dispatch", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_integrity_${stamp}`
    const taskID = `tsk_goal_integrity_${stamp}`
    const goalID = `goal_integrity_${stamp}`
    let integrityCalls = 0

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal integrity build test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal integrity build test",
          taskTitle: "Goal integrity build task",
          request: "Build a scoped goal after integrity review",
          goalTitle: "Require integrity before build",
          goalSlug: "require-integrity-before-build",
          objective: "Verify build auto-runs integrity on the active spec",
          now,
        })

        reviewIntegrityImpl = async () => {
          integrityCalls += 1
          return {
            verdict: "pass",
            summary: "Integrity pass",
            dimensions: [
              { id: "goal_fidelity", verdict: "pass", issues: [] },
              { id: "technical_feasibility", verdict: "pass", issues: [] },
              { id: "hallucination", verdict: "pass", issues: [] },
              { id: "solution_quality", verdict: "pass", issues: [] },
            ],
            issues: [],
            corrections: [],
            missingGoals: [],
            sessionID: "ses_integrity_auto",
          }
        }
        buildAgentRunImpl = async (input: any) => ({
          result: {
            status: "passed",
            summary: "Goal built successfully",
            patch_summary: "Changed scoped files",
            tests: [],
            commit_ref: "abc1234",
          },
          sessionID: "ses_goal_integrity_build",
          worktreeDir: input.managedWorktree.directory,
          worktreeBranch: input.managedWorktree.branch,
          worktreeBaseRef: input.managedWorktree.baseRef,
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        expect(result).toContain("status=passed")
        expect(integrityCalls).toBe(1)
        const artifact = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: `spec_${goalID}` })
        expect(artifact?.kind).toBe("integrity_attempt")
      },
    })
  })

  test("goal build stops when integrity rewrites the active goal graph", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_integrity_block_${stamp}`
    const taskID = `tsk_goal_integrity_block_${stamp}`
    const goalID = `goal_integrity_block_${stamp}`
    let buildCalls = 0

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal integrity correction test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal integrity correction test",
          taskTitle: "Goal integrity correction task",
          request: "Do not dispatch build against a stale goal graph",
          goalTitle: "Require graph refresh after integrity",
          goalSlug: "require-graph-refresh-after-integrity",
          objective: "Verify build aborts when integrity corrects the current graph",
          now,
        })

        reviewIntegrityImpl = async () => ({
          verdict: "needs_correction",
          summary: "Goal graph must change",
          dimensions: [
            { id: "goal_fidelity", verdict: "needs_correction", issues: [{ description: "Split the goal", type: "coverage_gap" }] },
            { id: "technical_feasibility", verdict: "pass", issues: [] },
            { id: "hallucination", verdict: "pass", issues: [] },
            { id: "solution_quality", verdict: "needs_correction", issues: [{ description: "Current goal is too broad", type: "granularity" }] },
          ],
          issues: [{ description: "Split the goal", type: "coverage_gap" }],
          corrections: [{ type: "split_goal" }],
          missingGoals: [],
          sessionID: "ses_integrity_corrected",
        })
        applyIntegrityCorrectionsImpl = () => ([
          {
            id: `${goalID}_replacement`,
            title: "Replacement goal",
            objective: "Updated objective",
            acceptance_specs: [],
            owned_paths: ["src/index.ts"],
            depends_on: [],
            exports: [],
            imports: [],
            priority: "blocking",
            kind: "feature",
            requirement_ids: [],
          },
        ])
        buildAgentRunImpl = async () => {
          buildCalls += 1
          throw new Error("Build should not run after integrity correction")
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        expect(result).toContain("integrity corrected the active goal graph")
        expect(buildCalls).toBe(0)
        expect(findGoal(goalID)).toBeUndefined()
      },
    })
  })

  test("goal build blocks on a persisted needs_correction integrity verdict", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_integrity_persisted_block_${stamp}`
    const taskID = `tsk_goal_integrity_persisted_block_${stamp}`
    const goalID = `goal_integrity_persisted_block_${stamp}`
    const specID = `spec_${goalID}`
    let buildCalls = 0

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "persisted integrity block test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Persisted integrity block test",
          taskTitle: "Persisted integrity block task",
          request: "Do not dispatch build after a failed integrity attempt",
          goalTitle: "Block persisted integrity failure",
          goalSlug: "block-persisted-integrity-failure",
          objective: "Verify build reads persisted integrity verdicts before dispatch",
          now,
          specID,
        })
        recordIntegrityAttempt({
          taskID,
          sessionID: "ses_integrity_persisted_block",
          specSnapshotID: specID,
          verdict: "needs_correction",
          perDimension: [
            { id: "goal_fidelity", verdict: "pass" },
            { id: "technical_feasibility", verdict: "pass" },
            { id: "hallucination", verdict: "needs_correction" },
            { id: "solution_quality", verdict: "concerns" },
          ],
          issuesCount: 2,
          correctionsCount: 0,
          missingCount: 0,
          reason: "Reference requirements were not grounded.",
          now,
        })
        buildAgentRunImpl = async () => {
          buildCalls += 1
          throw new Error("Build should not run after persisted needs_correction")
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        expect(result).toContain("integrity verdict is needs_correction")
        expect(result).toContain("build is blocked")
        expect(buildCalls).toBe(0)
        expect(listGoalRunsByGoal(goalID)).toHaveLength(0)
      },
    })
  })

  test("goal build success removes the completed worktree and clears goal workspace metadata", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_cleanup_${stamp}`
    const taskID = `tsk_goal_cleanup_${stamp}`
    const goalID = `goal_cleanup_${stamp}`
    let buildWorktreeDir = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal cleanup build test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal cleanup build test",
          taskTitle: "Goal cleanup build task",
          request: "Build a scoped goal and clean its worktree after success",
          goalTitle: "Clean successful worktree",
          goalSlug: "clean-successful-worktree",
          objective: "Verify completed goal worktrees are removed after a passed build",
          now,
        })

        buildAgentRunImpl = async (input: any) => {
          buildWorktreeDir = input.managedWorktree.directory
          expect(input.target.id).toBe(goalID)
          expect(await Filesystem.exists(buildWorktreeDir)).toBe(true)
          return {
            result: {
              status: "passed",
              summary: "Goal built successfully",
              patch_summary: "Changed scoped files",
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_cleanup_build",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        expect(result).toContain("status=passed")
        expect(result).toContain("goal worktree cleaned after successful merge")
        expect(buildWorktreeDir).not.toBe("")
        expect(await Filesystem.exists(buildWorktreeDir)).toBe(false)
        const ws = findGoalLatestWorkspace(goalID)
        expect(ws.directory).toBeNull()
        expect(ws.branch).toBeNull()
        expect(ws.baseRef).toBeNull()
        expect(listGoalRunsByGoal(goalID)[0]?.workspace_dir).toBeNull()
      },
    })
  })

  test("goal build failure keeps the worktree for diagnosis", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_keep_${stamp}`
    const taskID = `tsk_goal_keep_${stamp}`
    const goalID = `goal_keep_${stamp}`
    let buildWorktreeDir = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal failed build test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal failed build test",
          taskTitle: "Goal failed build task",
          request: "Build a scoped goal and preserve its worktree on failure",
          goalTitle: "Preserve failed worktree",
          goalSlug: "preserve-failed-worktree",
          objective: "Verify failed goal worktrees remain available for diagnosis",
          now,
        })

        buildAgentRunImpl = async (input: any) => {
          buildWorktreeDir = input.managedWorktree.directory
          expect(await Filesystem.exists(buildWorktreeDir)).toBe(true)
          return {
            result: {
              status: "failed",
              summary: "Goal build failed",
              patch_summary: "",
              tests: [],
              error: "diagnostic failure",
            },
            sessionID: "ses_goal_failed_build",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        expect(result).toContain("status=failed")
        expect(result).not.toContain("goal worktree cleaned")
        expect(await Filesystem.exists(buildWorktreeDir)).toBe(true)
        expect(findGoalLatestWorkspace(goalID).directory).toBe(buildWorktreeDir)
        expect(listGoalRunsByGoal(goalID)[0]?.workspace_dir).toBe(buildWorktreeDir)
      },
    })
  })

  test("goal build success keeps workspace pointers when cleanup is refused", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_refuse_${stamp}`
    const taskID = `tsk_goal_refuse_${stamp}`
    const goalID = `goal_refuse_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal cleanup refused test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal cleanup refused test",
          taskTitle: "Goal cleanup refused task",
          request: "Build a scoped goal whose recorded workspace is not a goal worktree",
          goalTitle: "Refuse unsafe cleanup",
          goalSlug: "refuse-unsafe-cleanup",
          objective: "Verify unsafe cleanup failures preserve diagnosis pointers",
          now,
          workspaceDir: tmp.path,
          workspaceBranch: "opencorvus/not-a-goal-worktree",
        })

        buildAgentRunImpl = async (input: any) => ({
          result: {
            status: "passed",
            summary: "Goal built successfully",
            patch_summary: "Changed scoped files",
            tests: [],
            commit_ref: "abc1234",
          },
          sessionID: "ses_goal_cleanup_refused",
          worktreeDir: input.managedWorktree.directory,
          worktreeBranch: input.managedWorktree.branch,
          worktreeBaseRef: input.managedWorktree.baseRef,
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        expect(result).toContain("status=passed")
        expect(result).toContain("goal worktree cleanup failed")
        expect(await Filesystem.exists(tmp.path)).toBe(true)
        expect(findGoalLatestWorkspace(goalID).directory).toBe(tmp.path)
        expect(listGoalRunsByGoal(goalID)[0]?.workspace_dir).toBe(tmp.path)
      },
    })
  })
})
