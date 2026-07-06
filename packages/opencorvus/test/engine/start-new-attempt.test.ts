import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import {
  beginBuildAttempt,
  ensureBuildRetryEvidenceForGoal,
  finalizeBuildAttempt,
  persistTaskAcceptance,
  startNewAttempt,
  updateGoalWorkspace,
} from "../../src/engine/persist"
import { describeGoal, goalStatusByID } from "../../src/engine/describe"
import {
  findAcceptanceByGoalRun,
  findBuildOutcomeByGoalRun,
  findGoal,
  findGoalLatestWorkspace,
  findGoalRun,
  findRun,
  findWorkspaceDiffsForAcceptance,
  requireTask,
  getGoalRetryCount,
} from "../../src/engine/store"
import { createDecisionLog } from "../../src/decision-log"
import { resetDatabase } from "../fixture/db"

/**
 * Contract tests for Goal.startNewAttempt — the single atomic entry-point
 * that records retry intent on a terminal tip without changing lifecycle
 * projection. These are load-bearing: every retry path (manual_retry,
 * acceptance_rework, modify_contract) funnels through this one
 * function, and its mechanism decoupling from LLM decisions is the core of the attempt
 * redesign. A regression here reopens the "status carousel deadlock" bug.
 */

let projectID = ""
let taskID = ""
let runID = ""
let goalID = ""

function seedBaseline() {
  const now = Date.now()
  Database.transaction((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: process.cwd(),
        name: "startNewAttempt test",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "t",
        request: "t",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run()
    // Phase-6-e: run rows live in engine_artifact (kind="run").
    db.insert(EngineArtifactTable)
      .values({
        id: runID,
        task_id: taskID,
        run_id: runID,
        kind: "run",
        label: "run-running",
        payload: {
          plan_version_id: null,
          session_id: null,
          executor: "opencorvus",
          status: "running",
          phase: "execute",
          blocking_reason: null,
          error: null,
          retry_count: 0,
          executor_ref: null,
          metadata: null,
          time_started: now,
          time_completed: null,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineGoalTable)
      .values({
        id: goalID,
        task_id: taskID,
        title: "g",
        slug: "g",
        objective: "obj",
        acceptance_specs: [],
        owned_paths: [],
        depends_on: [],
        exports: [],
        imports: [],
        kind: "feature",
        requirement_ids: [],
        priority: "blocking",
        source: "test",
        status: "passed",
        order_index: 0,
        time_created: now,
        time_updated: now,
      })
      .run()
  })
}

// Phase-6-d: goal_run rows live in engine_artifact (kind="goal_run_attempt").
// First row id = logical goal_run_id; subsequent appends use the shared helper
// in persist.ts (appendGoalRunArtifact). Test fixtures insert the initial row
// directly with the goal_run-shaped payload.
function insertGoalRun(input: {
  id: string
  status: "queued" | "running" | "completed" | "failed" | "aborted" | "evaluating" | "blocked" | "accepted" | "planning"
  supersedeOf?: string
  error?: string
}) {
  const now = Date.now()
  const terminal = input.status === "completed" || input.status === "failed" || input.status === "aborted"
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: input.id,
        task_id: taskID,
        run_id: runID,
        goal_run_id: input.id,
        kind: "goal_run_attempt",
        label: `attempt-${input.status}`,
        payload: {
          goal_id: goalID,
          plan_node_id: null,
          session_id: null,
          status: input.status,
          retry_count: 0,
          blocking_reason: null,
          error: input.error ?? null,
          workspace_dir: null,
          base_ref: null,
          merge_ref: null,
          supersede_of: input.supersedeOf ?? null,
          superseded_reason: null,
          superseded_at: null,
          metadata: null,
          time_started: null,
          time_completed: terminal ? now : null,
        },
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

beforeEach(async () => {
  await resetDatabase()
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  projectID = `proj_sna_${stamp}`
  taskID = `tsk_sna_${stamp}`
  runID = `run_sna_${stamp}`
  goalID = `gol_sna_${stamp}`
  seedBaseline()
})

afterEach(async () => {
  await resetDatabase()
})

function currentGoalDesc() {
  return describeGoal(findGoal(goalID)!)
}

describe("Goal.startNewAttempt — terminal-tip supersede", () => {
  test("completed tip → superseded_reason column set without lifecycle re-projection", () => {
    const gr = `grun_completed_${Date.now()}`
    insertGoalRun({ id: gr, status: "completed" })
    // Sanity: starting status is the seeded passed.
    expect(goalStatusByID(goalID)).toBe("passed")

    const result = startNewAttempt({ goalID, reason: "acceptance_rework" })

    expect(result.supersededTipID).toBe(gr)
    expect(result.retryCount).toBe(1)
    expect(getGoalRetryCount(goalID)).toBe(1)
    const tip = findGoalRun(gr)
    expect(tip?.superseded_reason).toBe("acceptance_rework")
    expect(tip?.superseded_at).toBeGreaterThan(0)
    // Persisted state is immutable — supersede never mutates the terminal status.
    expect(tip?.status).toBe("completed")
    expect(goalStatusByID(goalID)).toBe("passed")
    const desc = currentGoalDesc()
    expect(desc.needs_redispatch).toBe(true)
    expect(desc.is_terminal_ok).toBe(false)
  })

  test("failed tip → retry intent fact without status reset", () => {
    const gr = `grun_failed_${Date.now()}`
    insertGoalRun({ id: gr, status: "failed" })
    // Pre-project the seeded goal.status to match its only goal_run tip so
    // deriveGoalStatus has a consistent baseline to flip from.
    Database.use((db) =>
      db.update(EngineGoalTable).set({ status: "failed" }).where(eq(EngineGoalTable.id, goalID)).run(),
    )
    expect(goalStatusByID(goalID)).toBe("failed")

    const result = startNewAttempt({ goalID, reason: "manual_retry" })

    expect(result.retryCount).toBe(1)
    expect(getGoalRetryCount(goalID)).toBe(1)
    expect(findGoalRun(gr)?.superseded_reason).toBe("manual_retry")
    expect(goalStatusByID(goalID)).toBe("failed")
    const desc = currentGoalDesc()
    expect(desc.needs_redispatch).toBe(true)
    expect(desc.is_terminal_fail).toBe(false)
  })

  test("aborted tip → terminal non-satisfying status without a lifecycle reset reason", () => {
    const gr = `grun_aborted_${Date.now()}`
    insertGoalRun({ id: gr, status: "aborted" })
    Database.use((db) =>
      db.update(EngineGoalTable).set({ status: "pending" }).where(eq(EngineGoalTable.id, goalID)).run(),
    )

    startNewAttempt({ goalID, reason: "manual_retry" })

    expect(findGoalRun(gr)?.superseded_reason).toBe("manual_retry")
    expect(goalStatusByID(goalID)).toBe("failed")
  })
})

describe("Goal.startNewAttempt — no-op branches", () => {
  test("no goal_run at all → no supersede, status unchanged", () => {
    // No insertGoalRun call — goal has zero runs in history.
    const before = goalStatusByID(goalID)
    const result = startNewAttempt({ goalID, reason: "acceptance_rework" })
    expect(result.supersededTipID).toBeUndefined()
    expect(result.retryCount).toBe(0)
    expect(getGoalRetryCount(goalID)).toBe(0)
    // With no goal_run, deriveGoalStatus returns undefined and
    // syncGoalStatus keeps whatever engine_goal started with.
    expect(goalStatusByID(goalID)).toBe(before!)
  })

  test("live (running) tip → no supersede — supersede has no meaning on live rows", () => {
    const gr = `grun_live_${Date.now()}`
    insertGoalRun({ id: gr, status: "running" })
    Database.use((db) =>
      db.update(EngineGoalTable).set({ status: "running" }).where(eq(EngineGoalTable.id, goalID)).run(),
    )

    const result = startNewAttempt({ goalID, reason: "acceptance_rework" })

    expect(result.supersededTipID).toBeUndefined()
    expect(result.retryCount).toBe(0)
    expect(getGoalRetryCount(goalID)).toBe(0)
    expect(findGoalRun(gr)?.superseded_reason).toBeFalsy()
    // Goal stays running — live converges naturally; mechanism doesn't
    // short-circuit the executor.
    expect(goalStatusByID(goalID)).toBe("running")
  })
})

describe("Goal.startNewAttempt — idempotence", () => {
  test("second call on an already-superseded tip is a no-op (reason preserved)", () => {
    const gr = `grun_idemp_${Date.now()}`
    insertGoalRun({ id: gr, status: "completed" })

    const first = startNewAttempt({ goalID, reason: "acceptance_rework" })
    expect(first.supersededTipID).toBe(gr)
    const firstReasonAt = findGoalRun(gr)?.superseded_at

    // Second call — tip is already superseded (superseded_reason is set).
    // Function must NOT overwrite the reason/timestamp.
    const second = startNewAttempt({ goalID, reason: "manual_retry" })

    expect(second.supersededTipID).toBeUndefined()
    expect(second.retryCount).toBe(1)
    expect(getGoalRetryCount(goalID)).toBe(1)
    const row = findGoalRun(gr)
    expect(row?.superseded_reason).toBe("acceptance_rework") // NOT overwritten
    expect(row?.superseded_at).toBe(firstReasonAt!)
  })
})

describe("Goal.startNewAttempt — options", () => {
  test("resetWorkspace nulls workspace_dir / workspace_branch / workspace_base_ref", () => {
    const gr = `grun_ws_${Date.now()}`
    insertGoalRun({ id: gr, status: "completed" })
    // Phase B (2026-05-05): workspace pointer lives on the latest attempt
    // artifact, so seed it AFTER insertGoalRun (so the patch lands on the
    // tip that the resetWorkspace path will null out).
    updateGoalWorkspace({
      goalID,
      workspaceDir: "C:/tmp/ws-x",
      workspaceBranch: "opencorvus/x",
      workspaceBaseRef: "abc123",
    })

    const result = startNewAttempt({
      goalID,
      reason: "modify_contract",
      resetWorkspace: true,
    })

    expect(result.resetWorkspace).toBe(true)
    const ws = findGoalLatestWorkspace(goalID)
    expect(ws.directory).toBeNull()
    expect(ws.branch).toBeNull()
    expect(ws.baseRef).toBeNull()
    expect(getGoalRetryCount(goalID)).toBe(1)
  })

  test("beginBuildAttempt records the current goal retry_count for the visible V label", () => {
    const gr = `grun_build_retry_${Date.now()}`
    insertGoalRun({ id: gr, status: "failed" })
    const opened = startNewAttempt({ goalID, reason: "manual_retry" })
    expect(opened.retryCount).toBe(1)

    const nextRunID = beginBuildAttempt({
      taskID,
      goalID,
      runID,
      sessionID: "ses_start_new_retry_count",
    })

    expect(findGoalRun(nextRunID)?.retry_count).toBe(1)
  })

  test("beginBuildAttempt advances version when retrying a failed goal directly", () => {
    const gr = `grun_direct_build_retry_${Date.now()}`
    insertGoalRun({ id: gr, status: "failed", error: "merge_back conflict in IndustryCardListMTts.tsx" })

    const nextRunID = beginBuildAttempt({
      taskID,
      goalID,
      runID,
      sessionID: "ses_start_new_direct_retry",
    })

    expect(getGoalRetryCount(goalID)).toBe(1)
    expect(findGoalRun(gr)?.superseded_reason).toBe("build_retry")
    expect(findGoalRun(nextRunID)?.retry_count).toBe(1)
    const retryEntries = createDecisionLog(taskID)
      .readByPhase("retry")
      .filter((entry) => entry.goalID === goalID)
    expect(retryEntries).toHaveLength(1)
    expect(retryEntries[0]?.key).toBe(`build_retry_previous_${gr}`)
    expect(retryEntries[0]?.value).toContain(`Previous goal_run ${gr} terminal error`)
    expect(retryEntries[0]?.value).toContain("merge_back conflict in IndustryCardListMTts.tsx")
    expect(retryEntries[0]?.value).not.toContain("Terminal error: merge_back conflict")
  })

  test("ensureBuildRetryEvidenceForGoal writes retry evidence before prompt context is composed", () => {
    const gr = `grun_prompt_feedback_${Date.now()}`
    insertGoalRun({ id: gr, status: "failed", error: "Merge left worktree in MERGING state" })
    createDecisionLog(taskID).append({
      goalID,
      phase: "build",
      key: "build_report_for_architecture_review",
      value: JSON.stringify({
        status: "failed",
        summary: "merge_back hit conflicts on one file",
        error: "Resolve markers in the same worktree before retrying.",
      }),
      reason: "test build report",
    })

    const created = ensureBuildRetryEvidenceForGoal({
      taskID,
      goalID,
      source: "test.prompt_context",
    })

    expect(created).toBe(true)
    const retryEntries = createDecisionLog(taskID)
      .readByPhase("retry")
      .filter((entry) => entry.goalID === goalID)
    expect(retryEntries).toHaveLength(1)
    expect(retryEntries[0]?.value).toContain(`Previous goal_run ${gr} terminal error`)
    expect(retryEntries[0]?.value).toContain("Merge left worktree in MERGING state")
    expect(retryEntries[0]?.value).toContain("merge_back hit conflicts on one file")
    expect(retryEntries[0]?.value).toContain("Resolve markers in the same worktree before retrying.")
    expect(retryEntries[0]?.value).not.toContain("Required for this retry")
    expect(retryEntries[0]?.value).not.toContain("Previous build session")
    expect(retryEntries[0]?.value).not.toContain("Retry count on previous attempt")

    const second = ensureBuildRetryEvidenceForGoal({
      taskID,
      goalID,
      source: "test.prompt_context",
    })
    expect(second).toBe(false)
    expect(
      createDecisionLog(taskID)
        .readByPhase("retry")
        .filter((entry) => entry.goalID === goalID),
    ).toHaveLength(1)
  })

  test("ensureBuildRetryEvidenceForGoal appends clarified retry evidence over old ambiguous text", () => {
    const gr = `grun_retry_clarified_${Date.now()}`
    insertGoalRun({ id: gr, status: "failed", error: "MCP server browser failed to connect: Not connected" })
    const log = createDecisionLog(taskID)
    log.append({
      goalID,
      phase: "retry",
      key: `build_retry_previous_${gr}`,
      value: "Terminal error: MCP server browser failed to connect: Not connected",
      reason: "old ambiguous retry text",
    })

    const created = ensureBuildRetryEvidenceForGoal({
      taskID,
      goalID,
      source: "test.retry_clarification",
    })

    expect(created).toBe(true)
    const retryEntries = log.readByPhase("retry").filter((entry) => entry.goalID === goalID)
    expect(retryEntries).toHaveLength(2)
    const latest = log.readByKey(`build_retry_previous_${gr}`)
    expect(latest?.value).toContain(`Previous goal_run ${gr} terminal error`)
    expect(latest?.value).toContain("MCP server browser failed to connect: Not connected")
    expect(latest?.value).not.toBe("Terminal error: MCP server browser failed to connect: Not connected")
    expect(latest?.reason).toContain("supersedes decision_log")
  })

  test("ensureBuildRetryEvidenceForGoal preserves precise terminal retry evidence", () => {
    const gr = `grun_retry_precise_${Date.now()}`
    insertGoalRun({ id: gr, status: "failed", error: "prior build failed" })
    const log = createDecisionLog(taskID)
    const precise = "Terminal error: exact context overflow failure from persisted facts"
    log.append({
      goalID,
      phase: "retry",
      key: `build_retry_previous_${gr}`,
      value: precise,
      reason: "precise retry evidence",
    })

    const created = ensureBuildRetryEvidenceForGoal({
      taskID,
      goalID,
      source: "test.retry_precise_preserve",
    })

    expect(created).toBe(false)
    const retryEntries = log.readByPhase("retry").filter((entry) => entry.goalID === goalID)
    expect(retryEntries).toHaveLength(1)
    expect(log.readByKey(`build_retry_previous_${gr}`)?.value).toBe(precise)
  })

  test("ensureBuildRetryEvidenceForGoal preserves clarified precise retry evidence", () => {
    const gr = `grun_retry_clarified_precise_${Date.now()}`
    insertGoalRun({ id: gr, status: "failed", error: "prior build failed" })
    const log = createDecisionLog(taskID)
    const precise = `Previous goal_run ${gr} terminal error (status=failed): exact retry failure from persisted facts`
    log.append({
      goalID,
      phase: "retry",
      key: `build_retry_previous_${gr}`,
      value: precise,
      reason: "clarified precise retry evidence",
    })

    const created = ensureBuildRetryEvidenceForGoal({
      taskID,
      goalID,
      source: "test.retry_clarified_precise_preserve",
    })

    expect(created).toBe(false)
    const retryEntries = log.readByPhase("retry").filter((entry) => entry.goalID === goalID)
    expect(retryEntries).toHaveLength(1)
    expect(log.readByKey(`build_retry_previous_${gr}`)?.value).toBe(precise)
  })

  test("finalizeBuildAttempt preserves workspace branch when failed finalize omits it", () => {
    const nextRunID = beginBuildAttempt({
      taskID,
      goalID,
      runID,
      sessionID: "ses_start_new_workspace_preserve",
      workspaceDir: "C:/tmp/ws-preserve",
      workspaceBranch: "opencorvus/ws-preserve",
      workspaceBaseRef: "abc123",
    })

    finalizeBuildAttempt({
      goalRunID: nextRunID,
      taskID,
      goalID,
      runID,
      status: "failed",
      workspaceDir: "C:/tmp/ws-preserve",
      error: "BuildResultSchema rejected passed result with error",
      summary: "BuildAgent.run threw before producing a verdict",
    })

    const row = findGoalRun(nextRunID)
    expect(row?.status).toBe("failed")
    expect(row?.workspace_dir).toBe("C:/tmp/ws-preserve")
    expect(row?.workspace_branch).toBe("opencorvus/ws-preserve")
    expect(row?.workspace_base_ref).toBe("abc123")
    const outcome = findBuildOutcomeByGoalRun(nextRunID)
    expect(outcome?.terminal_status).toBe("failed")
    expect(outcome?.outcome_kind).toBe("failed")
    expect(outcome?.error).toBe("BuildResultSchema rejected passed result with error")
    expect(outcome?.workspace).toEqual({
      dir: "C:/tmp/ws-preserve",
      branch: "opencorvus/ws-preserve",
      base_ref: "abc123",
    })
  })

  test("finalizeBuildAttempt does not write goal acceptance from reported files when host commit diff is empty", () => {
    const nextRunID = beginBuildAttempt({
      taskID,
      goalID,
      runID,
      sessionID: "ses_start_new_reported_files_acceptance",
      workspaceDir: "C:/tmp/ws-reported-files",
      workspaceBranch: "opencorvus/ws-reported-files",
      workspaceBaseRef: "base123",
    })

    finalizeBuildAttempt({
      goalRunID: nextRunID,
      taskID,
      goalID,
      runID,
      status: "completed",
      commitRef: "abc1234",
      workspaceDir: "C:/tmp/ws-reported-files",
      workspaceBranch: "opencorvus/ws-reported-files",
      workspaceBaseRef: "base123",
      summary: "Build changed one file and merged it.",
      fileChanges: [
        {
          path: "src/index.ts",
          summary: "Updated scoped implementation.",
          reason: "Required by the goal.",
        },
      ],
      diffs: [],
    })

    const acceptance = findAcceptanceByGoalRun(nextRunID)
    expect(acceptance).toBeUndefined()
    const outcome = findBuildOutcomeByGoalRun(nextRunID)
    expect(outcome?.terminal_status).toBe("completed")
    expect(outcome?.outcome_kind).toBe("no_project_diff")
    expect(outcome?.no_diff_reason).toBe("actual_changed_files_empty")
    expect(outcome?.commit_ref).toBe("abc1234")
    expect(outcome?.changed_files).toEqual([])
  })

  test("finalizeBuildAttempt filters runtime worktree paths from goal acceptance diffs", () => {
    const nextRunID = beginBuildAttempt({
      taskID,
      goalID,
      runID,
      sessionID: "ses_start_new_runtime_diff_filter",
      workspaceDir: "C:/tmp/ws-runtime-filter",
      workspaceBranch: "opencorvus/ws-runtime-filter",
      workspaceBaseRef: "base123",
    })

    finalizeBuildAttempt({
      goalRunID: nextRunID,
      taskID,
      goalID,
      runID,
      status: "completed",
      commitRef: "def5678",
      publishedCommitRef: "a393474",
      diffBaseRef: "a6bb0f9",
      diffHeadRef: "a393474",
      workspaceDir: "C:/tmp/ws-runtime-filter",
      workspaceBranch: "opencorvus/ws-runtime-filter",
      workspaceBaseRef: "base123",
      summary: "Build changed one source file and one runtime scratch file.",
      diffs: [
        {
          file: ".opencorvus/r/s/ab/cdef12/worktree/package.json",
          before: "{}",
          after: '{"private":true}',
          additions: 1,
          deletions: 1,
          status: "modified",
        },
        {
          file: "src/index.ts",
          before: "export const value = 1\n",
          after: "export const value = 2\n",
          additions: 1,
          deletions: 1,
          status: "modified",
        },
      ],
    })

    const acceptance = findAcceptanceByGoalRun(nextRunID)
    expect(acceptance?.result?.commit_ref).toBe("def5678")
    expect(acceptance?.result?.published_commit_ref).toBe("a393474")
    expect(acceptance?.result?.diff_base_ref).toBe("a6bb0f9")
    expect(acceptance?.result?.diff_head_ref).toBe("a393474")
    expect(acceptance?.result?.changed_files).toEqual(["src/index.ts"])
    expect(acceptance?.result?.diffs).toEqual([
      { file: "src/index.ts", status: "modified", additions: 1, deletions: 1 },
    ])
    expect(typeof acceptance?.result?.build_attempt_outcome_id).toBe("string")
    expect(JSON.stringify(acceptance?.result?.diffs)).not.toContain("export const value")
    expect(findWorkspaceDiffsForAcceptance(acceptance!.id)).toEqual([
      {
        file: "src/index.ts",
        before: "export const value = 1\n",
        after: "export const value = 2\n",
        additions: 1,
        deletions: 1,
        status: "modified",
      },
    ])
    const outcome = findBuildOutcomeByGoalRun(nextRunID)
    expect(outcome?.terminal_status).toBe("completed")
    expect(outcome?.outcome_kind).toBe("delivered")
    expect(outcome?.changed_files).toEqual(["src/index.ts"])
    expect(goalStatusByID(goalID)).toBe("passed")
  })

  test("persistTaskAcceptance keeps acceptance summaries bounded and stores workspace preview bodies", () => {
    const acceptanceID = "acc_start_new_summary"
    const task = requireTask(taskID)
    const run = findRun(runID)
    expect(run).toBeDefined()

    persistTaskAcceptance({
      task,
      run: run!,
      acceptanceID,
      now: Date.now(),
      acceptance: {
        summary: "Task acceptance summary.",
        commitRef: "abc1234",
        diffs: [
          {
            file: "src/large.ts",
            before: "a".repeat(2048),
            after: "b".repeat(2048),
            diff: "c".repeat(2048),
            additions: 20,
            deletions: 10,
            status: "modified",
          },
        ],
      },
    })

    const artifacts = Database.use((db) =>
      db.select().from(EngineArtifactTable).where(eq(EngineArtifactTable.acceptance_id, acceptanceID)).all(),
    )
    const acceptanceArtifact = artifacts.find((item) => item.kind === "acceptance")
    const workspaceDiffArtifact = artifacts.find((item) => item.kind === "diff" && item.label === "workspace-diff")
    const changedFileArtifact = artifacts.find((item) => item.kind === "changed_file" && item.label === "src/large.ts")

    expect(acceptanceArtifact?.payload.result.diffs).toEqual([
      { file: "src/large.ts", status: "modified", additions: 20, deletions: 10 },
    ])
    expect(workspaceDiffArtifact?.payload.diffs).toEqual([
      {
        file: "src/large.ts",
        before: "a".repeat(2048),
        after: "b".repeat(2048),
        additions: 20,
        deletions: 10,
        status: "modified",
      },
    ])
    expect(findWorkspaceDiffsForAcceptance(acceptanceID)).toEqual(workspaceDiffArtifact?.payload.diffs)
    expect(changedFileArtifact?.payload).toEqual({
      file: "src/large.ts",
      status: "modified",
      additions: 20,
      deletions: 10,
    })
    expect(JSON.stringify([acceptanceArtifact, changedFileArtifact])).not.toContain("aaaa")
    expect(JSON.stringify([acceptanceArtifact, changedFileArtifact])).not.toContain("bbbb")
    expect(JSON.stringify(artifacts)).not.toContain("cccc")
  })
})
