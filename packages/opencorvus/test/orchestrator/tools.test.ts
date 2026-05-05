import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Database, eq } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineGoalTable, EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { createWorkflowState, WorkflowRegistry } from "../../src/engine/workflow"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { recordIntegrityAttempt } from "../../src/engine/persist"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { findGoal, findGoalLatestWorkspace, findLatestIntegrityAttemptArtifact, listGoalRunsByGoal } from "../../src/engine/store"
import { seedGoalRunAttemptWithWorkspace } from "../fixture/goal-run-attempt"
import { Filesystem } from "../../src/util/filesystem"

let buildAgentRunImpl: ((input: any) => Promise<any>) | undefined
let reviewIntegrityImpl: ((input: any) => Promise<any>) | undefined

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

  test("architect does not start without an active requirements spec snapshot", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_architect_requires_spec_${stamp}`
    const taskID = `tsk_architect_requires_spec_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable).values({
        id: projectID,
        worktree: process.cwd(),
        name: "Architect requirements preflight test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineTaskTable).values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Architect requirements preflight task",
        request: "Verify architect cannot run after requirements spec is cleared",
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
        const parent = await Session.create({ kind: "root", title: "architect preflight test" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.architect.execute({}, {} as any)

        expect(result).toContain("no active requirements spec snapshot")
        expect(result).toContain("requirements")
        const architectSessions = Database.use((db) =>
          db.select().from(SessionTable).where(eq(SessionTable.kind, "architect")).all(),
        )
        expect(architectSessions).toHaveLength(0)
      },
    })
  })

  test("publish gate failures remain rework feedback instead of terminal task failures", async () => {
    const source = await fs.readFile(path.join(import.meta.dir, "../../src/orchestrator/tools.ts"), "utf8")

    expect(source).toContain("publishGateReworkResult")
    expect(source).not.toContain('await updateTask(currentTask, { status: "failed", error: publishResult.summary')
    expect(source).not.toContain('await updateTask(task, { status: "failed", error: result.summary')
  })

  test("goal build runs first, then records architecture review feedback", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_integrity_${stamp}`
    const taskID = `tsk_goal_integrity_${stamp}`
    const goalID = `goal_integrity_${stamp}`
    let architectureReviewCalls = 0
    let buildCalls = 0

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
          request: "Build a scoped goal with complete context",
          goalTitle: "Build with architecture review",
          goalSlug: "build-with-architecture-review",
          objective: "Verify build runs before architecture review feedback is recorded",
          now,
        })

        reviewIntegrityImpl = async () => {
          architectureReviewCalls += 1
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
        buildAgentRunImpl = async (input: any) => {
          buildCalls += 1
          return {
            result: {
              status: "passed",
              summary: "Goal built successfully",
              files_changed: [{
                path: "src/index.ts",
                summary: "Changed scoped implementation file.",
                reason: "Required by the mocked goal build.",
              }],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_integrity_build",
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
        expect(result).toContain("architecture_review: pass")
        expect(buildCalls).toBe(1)
        expect(architectureReviewCalls).toBe(1)
        const artifact = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: `spec_${goalID}` })
        expect(artifact?.kind).toBe("integrity_attempt")
      },
    })
  })

  test("goal build receives the complete architecture protocol, not only its local slice", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_arch_context_${stamp}`
    const taskID = `tsk_goal_arch_context_${stamp}`
    const goalID = `goal_arch_context_${stamp}`
    const siblingGoalID = `goal_arch_sibling_${stamp}`
    let capturedContext: any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal architecture context test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal architecture context test",
          taskTitle: "Goal architecture context task",
          request: "Build a scoped goal with the full architecture protocol",
          goalTitle: "Feature implementation",
          goalSlug: "feature-implementation",
          objective: "Implement the feature without breaking sibling architecture contracts",
          now,
        })

        Database.use((db) => {
          db.insert(EngineGoalTable).values({
            id: siblingGoalID,
            task_id: taskID,
            spec_snapshot_id: `spec_${goalID}`,
            title: "Shared shell",
            slug: "shared-shell",
            objective: "Provide the shared shell consumed by feature goals",
            acceptance_specs: [{
              id: `acc_shell_${stamp}`,
              source_requirement_id: "REQ-1",
              goal_id: siblingGoalID,
              title: "shell exports AppShell",
              scorers: [{
                type: "llm_judge",
                name: "shell contract",
                criteria: "The shared shell renders and exports AppShell for feature goals.",
              }],
              severity: "essential",
            }],
            owned_paths: ["src/App.tsx", "src/main.tsx"],
            depends_on: [],
            exports: ["AppShell"],
            imports: [],
            kind: "bootstrap",
            requirement_ids: [],
            priority: "blocking",
            source: "test",
            status: "pending",
            order_index: 1,
            time_created: now,
            time_updated: now,
          }).run()
          db.update(EngineTaskTable)
            .set({
              metadata: {
                architect_fidelity: {
                  sourceCoverage: [{
                    id: "sibling-source",
                    paths: ["src/App.tsx"],
                    goal_ids: [siblingGoalID],
                    action: "modify",
                    rationale: "The shell source must remain the shared integration surface.",
                  }],
                  referenceCoverage: [{
                    id: "sibling-reference",
                    surface: "shared shell",
                    goal_ids: [siblingGoalID],
                    visual_spec_ids: [],
                    expectation: "The shell reference remains binding for every feature goal.",
                  }],
                  assemblyOwners: [{
                    surface: "app",
                    goal_id: siblingGoalID,
                    rationale: "The shell owns final app assembly.",
                  }],
                },
              },
              time_updated: now,
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run()
        })

        const { createDecisionLog } = await import("../../src/decision-log")
        const decisionLog = createDecisionLog(taskID)
        decisionLog.append({
          phase: "architect",
          goalID: siblingGoalID,
          key: "shell_contract",
          value: "## Shell exports\nShared shell owns AppShell and feature goals must preserve that export.",
          reason: "Architect sibling contract",
        })

        buildAgentRunImpl = async (input: any) => {
          capturedContext = input.context
          return {
            result: {
              status: "passed",
              summary: "Goal built with full architecture context",
              files_changed: [{
                path: "src/index.ts",
                summary: "Changed scoped implementation file.",
                reason: "Required by the mocked goal build.",
              }],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_arch_context_build",
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
        expect(capturedContext?.architectContracts?.map((c: any) => c.goalIDs?.[0])).toContain(siblingGoalID)
        expect(capturedContext?.collaborationGoals?.find((g: any) => g.id === siblingGoalID)?.objective).toContain("shared shell")
        expect(
          capturedContext?.collaborationGoals
            ?.find((g: any) => g.id === siblingGoalID)
            ?.acceptance_specs
            ?.some((spec: string) => spec.includes("shell exports AppShell")),
        ).toBe(true)
        expect(capturedContext?.fidelity?.sourceCoverage?.map((row: any) => row.id)).toContain("sibling-source")
        expect(capturedContext?.fidelity?.referenceCoverage?.map((row: any) => row.id)).toContain("sibling-reference")
        expect(capturedContext?.fidelity?.assemblyOwners?.map((row: any) => row.goal_id)).toContain(siblingGoalID)
      },
    })
  })

  test("post-build architecture review never rewrites the active goal graph", async () => {
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
          request: "Do not let architecture review mutate the goal graph",
          goalTitle: "Review without graph mutation",
          goalSlug: "review-without-graph-mutation",
          objective: "Verify post-build review records feedback but does not rewrite goals",
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
        buildAgentRunImpl = async (input: any) => {
          buildCalls += 1
          return {
            result: {
              status: "passed",
              summary: "Goal built before architecture review feedback.",
              files_changed: [{
                path: "src/index.ts",
                summary: "Changed scoped implementation file.",
                reason: "Required by the mocked goal build.",
              }],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_review_after_build",
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
        expect(result).toContain("architecture_review: needs_correction")
        expect(buildCalls).toBe(1)
        expect(listGoalRunsByGoal(goalID)).toHaveLength(1)
        expect(findGoal(goalID)).toBeTruthy()
      },
    })
  })

  test("architecture review records correction feedback without changing goals", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_noop_${stamp}`
    const taskID = `tsk_integrity_noop_${stamp}`
    const goalID = `goal_integrity_noop_${stamp}`
    const specID = `spec_${goalID}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity no-op test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity no-op correction test",
          taskTitle: "Integrity no-op correction task",
          request: "Do not block forever on no-op integrity corrections",
          goalTitle: "Keep graph executable",
          goalSlug: "keep-graph-executable",
          objective: "Verify no-op corrections do not remain needs_correction",
          now,
          specID,
        })

        reviewIntegrityImpl = async () => ({
          verdict: "needs_correction",
          summary: "Correction has no semantic effect",
          dimensions: [
            { id: "goal_fidelity", verdict: "pass", issues: [] },
            { id: "technical_feasibility", verdict: "needs_correction", issues: [{ description: "Dependency prose only", type: "missing_capability" }] },
            { id: "hallucination", verdict: "pass", issues: [] },
            { id: "solution_quality", verdict: "concerns", issues: [] },
          ],
          issues: [{ description: "Dependency prose only", type: "missing_capability" }],
          corrections: [{ action: "modify", goalID, reason: "No actual updates", updates: {} }],
          missingGoals: [],
          sessionID: "ses_integrity_noop",
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.integrity.execute({}, {} as any)

        expect(result).toContain("Integrity verdict: needs_correction")
        expect(findGoal(goalID)).toBeTruthy()
        const artifact = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID })
        expect(artifact?.label).toBe("verdict-needs_correction")
      },
    })
  })

  test("diagnostic architecture findings do not restart requirements by themselves", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_upstream_${stamp}`
    const taskID = `tsk_integrity_upstream_${stamp}`
    const goalID = `goal_integrity_upstream_${stamp}`
    const specID = `spec_${goalID}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity upstream restart test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity upstream restart test",
          taskTitle: "Integrity upstream restart task",
          request: "Record diagnostic architecture findings without rewriting requirements",
          goalTitle: "Record diagnostic architecture feedback",
          goalSlug: "record-diagnostic-architecture-feedback",
          objective: "Verify diagnostic findings become feedback instead of task mutation",
          now,
          specID,
        })

        reviewIntegrityImpl = async () => ({
          verdict: "needs_correction",
          summary: "Integrity needs_correction",
          dimensions: [
            { id: "goal_fidelity", verdict: "pass", issues: [] },
            { id: "technical_feasibility", verdict: "pass", issues: [] },
            {
              id: "hallucination",
              verdict: "needs_correction",
              issues: [{ description: "REQ-9 is not grounded in the user request.", type: "unsupported_claim" }],
            },
            { id: "solution_quality", verdict: "pass", issues: [] },
          ],
          issues: [{ description: "REQ-9 is not grounded in the user request.", type: "unsupported_claim" }],
          corrections: [],
          missingGoals: [],
          sessionID: "ses_integrity_upstream",
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.integrity.execute({}, {} as any)

        expect(result).toContain("Integrity verdict: needs_correction")
        expect(result).toContain("does not rewrite requirements, goals, or runs")
        expect(findGoal(goalID)).toBeTruthy()
        const artifact = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID })
        expect(artifact?.label).toBe("verdict-needs_correction")
      },
    })
  })

  test("repeated architecture corrections remain feedback instead of automatic plan restart", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_plan_restart_${stamp}`
    const taskID = `tsk_integrity_plan_restart_${stamp}`
    const goalID = `goal_integrity_plan_restart_${stamp}`
    const specID = `spec_${goalID}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity plan restart test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity plan restart test",
          taskTitle: "Integrity plan restart task",
          request: "Do not let repeated architecture review feedback mutate the plan automatically",
          goalTitle: "Keep repeated review as feedback",
          goalSlug: "keep-repeated-review-as-feedback",
          objective: "Verify repeated review findings do not restart Architect automatically",
          now,
          specID,
        })
        for (const offset of [1, 2]) {
          recordIntegrityAttempt({
            taskID,
            sessionID: `ses_prior_integrity_${offset}`,
            specSnapshotID: specID,
            verdict: "needs_correction",
            perDimension: [
              { id: "goal_fidelity", verdict: "needs_correction" },
              { id: "technical_feasibility", verdict: "pass" },
              { id: "hallucination", verdict: "pass" },
              { id: "solution_quality", verdict: "pass" },
            ],
            issuesCount: 1,
            correctionsCount: 1,
            missingCount: 0,
            reason: "Prior goal-layer correction did not converge.",
            now: now + offset,
          })
        }

        reviewIntegrityImpl = async () => ({
          verdict: "needs_correction",
          summary: "Integrity needs_correction",
          dimensions: [
            {
              id: "goal_fidelity",
              verdict: "needs_correction",
              issues: [{ description: "Goal still misses REQ-1.", type: "uncovered" }],
            },
            { id: "technical_feasibility", verdict: "pass", issues: [] },
            { id: "hallucination", verdict: "pass", issues: [] },
            { id: "solution_quality", verdict: "pass", issues: [] },
          ],
          issues: [{ description: "Goal still misses REQ-1.", type: "uncovered" }],
          corrections: [{ action: "modify", goalID, reason: "Still missing REQ-1", updates: { objective: "cover REQ-1" } }],
          missingGoals: [],
          sessionID: "ses_integrity_plan_restart",
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.integrity.execute({}, {} as any)

        expect(result).toContain("Integrity verdict: needs_correction")
        expect(result).not.toContain("Task restarted from plan")
        expect(findGoal(goalID)).toBeTruthy()
        const artifact = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID })
        expect(artifact?.label).toBe("verdict-needs_correction")
      },
    })
  })

  test("mixed architecture findings are recorded without requirements or plan restart", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_mixed_restart_${stamp}`
    const taskID = `tsk_integrity_mixed_restart_${stamp}`
    const goalID = `goal_integrity_mixed_restart_${stamp}`
    const specID = `spec_${goalID}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity mixed restart test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity mixed restart test",
          taskTitle: "Integrity mixed restart task",
          request: "Record mixed architecture findings without automatic replanning",
          goalTitle: "Record mixed architecture feedback",
          goalSlug: "record-mixed-architecture-feedback",
          objective: "Verify mixed diagnostic plus goal-layer failures stay as review feedback",
          now,
          specID,
        })
        for (const offset of [1, 2]) {
          recordIntegrityAttempt({
            taskID,
            sessionID: `ses_prior_mixed_integrity_${offset}`,
            specSnapshotID: specID,
            verdict: "needs_correction",
            perDimension: [
              { id: "goal_fidelity", verdict: "needs_correction" },
              { id: "technical_feasibility", verdict: "pass" },
              { id: "hallucination", verdict: "pass" },
              { id: "solution_quality", verdict: "pass" },
            ],
            issuesCount: 1,
            correctionsCount: 1,
            missingCount: 0,
            reason: "Prior goal-layer correction did not converge.",
            now: now + offset,
          })
        }

        reviewIntegrityImpl = async () => ({
          verdict: "needs_correction",
          summary: "Integrity needs_correction",
          dimensions: [
            {
              id: "goal_fidelity",
              verdict: "needs_correction",
              issues: [{ description: "Goal still misses REQ-1.", type: "uncovered" }],
            },
            {
              id: "technical_feasibility",
              verdict: "needs_correction",
              issues: [{ description: "Import/export contract is still inconsistent.", type: "missing_capability" }],
            },
            {
              id: "hallucination",
              verdict: "needs_correction",
              issues: [{ description: "A goal references an invented artifact.", type: "invented_artifact" }],
            },
            {
              id: "solution_quality",
              verdict: "needs_correction",
              issues: [{ description: "Goal granularity remains unstable.", type: "granularity_off" }],
            },
          ],
          issues: [
            { description: "Goal still misses REQ-1.", type: "uncovered" },
            { description: "Import/export contract is still inconsistent.", type: "missing_capability" },
            { description: "A goal references an invented artifact.", type: "invented_artifact" },
            { description: "Goal granularity remains unstable.", type: "granularity_off" },
          ],
          corrections: [{ action: "modify", goalID, reason: "Still missing REQ-1", updates: { objective: "cover REQ-1" } }],
          missingGoals: [{ title: "Missing integration goal", objective: "Close the integration gap" }],
          sessionID: "ses_integrity_mixed_restart",
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.integrity.execute({}, {} as any)

        expect(result).toContain("Integrity verdict: needs_correction")
        expect(result).not.toContain("Task restarted from plan")
        expect(result).not.toContain("Task restarted from requirements")
        expect(findGoal(goalID)).toBeTruthy()
        const spec = Database.use((db) =>
          db.select({ status: EngineSpecSnapshotTable.status })
            .from(EngineSpecSnapshotTable)
            .where(eq(EngineSpecSnapshotTable.id, specID))
            .get(),
        )
        expect(spec?.status).toBe("ready")
        const artifact = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID })
        const payload = artifact?.payload as Record<string, unknown> | undefined
        expect(artifact?.label).toBe("verdict-needs_correction")
        expect(payload?.reason).toBe("Integrity needs_correction")
      },
    })
  })

  test("goal build is not blocked by stale architecture review feedback", async () => {
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
          request: "Let build act on complete context despite prior review feedback",
          goalTitle: "Build after prior architecture feedback",
          goalSlug: "build-after-prior-architecture-feedback",
          objective: "Verify stale review artifacts do not block a capable build agent",
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
        buildAgentRunImpl = async (input: any) => {
          buildCalls += 1
          return {
            result: {
              status: "passed",
              summary: "Build handled the prior architecture feedback.",
              files_changed: [{
                path: "src/index.ts",
                summary: "Changed implementation after review feedback.",
                reason: "Prior review feedback is context, not a dispatch gate.",
              }],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_after_prior_review",
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
        expect(buildCalls).toBe(1)
        expect(listGoalRunsByGoal(goalID)).toHaveLength(1)
      },
    })
  })

  test("goal build is not blocked by correction-bearing review history", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_integrity_concern_block_${stamp}`
    const taskID = `tsk_goal_integrity_concern_block_${stamp}`
    const goalID = `goal_integrity_concern_block_${stamp}`
    const specID = `spec_${goalID}`
    let buildCalls = 0

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "persisted integrity concern block test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Persisted integrity concern block test",
          taskTitle: "Persisted integrity concern block task",
          request: "Let build consume correction-bearing review history as context",
          goalTitle: "Build after correction feedback",
          goalSlug: "build-after-correction-feedback",
          objective: "Verify correction counts inform the prompt rather than block dispatch",
          now,
          specID,
        })
        recordIntegrityAttempt({
          taskID,
          sessionID: "ses_integrity_concern_block",
          specSnapshotID: specID,
          verdict: "concerns",
          perDimension: [
            { id: "goal_fidelity", verdict: "concerns" },
            { id: "technical_feasibility", verdict: "pass" },
            { id: "hallucination", verdict: "pass" },
            { id: "solution_quality", verdict: "concerns" },
          ],
          issuesCount: 3,
          correctionsCount: 1,
          missingCount: 0,
          reason: "A concern still carried a concrete correction action.",
          now,
        })
        buildAgentRunImpl = async (input: any) => {
          buildCalls += 1
          return {
            result: {
              status: "passed",
              summary: "Build handled correction-bearing review history.",
              files_changed: [{
                path: "src/index.ts",
                summary: "Changed implementation after correction feedback.",
                reason: "Review history is context, not a dispatch gate.",
              }],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_after_correction_feedback",
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
        expect(buildCalls).toBe(1)
        expect(listGoalRunsByGoal(goalID)).toHaveLength(1)
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
              files_changed: [{
                path: "src/index.ts",
                summary: "Changed scoped implementation file.",
                reason: "Required by the mocked goal build.",
              }],
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
              files_changed: [],
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
            files_changed: [{
              path: "src/index.ts",
              summary: "Changed scoped implementation file.",
              reason: "Required by the mocked goal build.",
            }],
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
