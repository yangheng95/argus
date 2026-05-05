import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { createWorkflowState, WorkflowRegistry } from "../../src/engine/workflow"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { findGoal, findGoalLatestWorkspace, listGoalRunsByGoal } from "../../src/engine/store"
import { seedGoalRunAttemptWithWorkspace } from "../fixture/goal-run-attempt"
import { Filesystem } from "../../src/util/filesystem"

let buildAgentRunImpl: ((input: any) => Promise<any>) | undefined

mock.module("@/build/agent", () => ({
  BuildAgent: {
    run: (input: any) => {
      if (!buildAgentRunImpl) throw new Error("BuildAgent.run mock not configured")
      return buildAgentRunImpl(input)
    },
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
}) {
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
    db.insert(EngineGoalTable).values({
      id: input.goalID,
      task_id: input.taskID,
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
  })

  afterEach(async () => {
    buildAgentRunImpl = undefined
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
