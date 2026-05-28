import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import {
  EngineArtifactTable,
  EngineGoalTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import {
  beginBuildAttempt,
  ensureBuildRetryFeedbackForGoal,
  finalizeBuildAttempt,
  startNewAttempt,
  updateGoalWorkspace,
} from "../../src/engine/persist"
import { goalStatusByID } from "../../src/engine/describe"
import { findDeliveryByGoalRun, findGoalLatestWorkspace, findGoalRun, getGoalRetryCount } from "../../src/engine/store"
import { createDecisionLog } from "../../src/decision-log"
import { resetDatabase } from "../fixture/db"

/**
 * Contract tests for Goal.startNewAttempt — the single atomic entry-point
 * that flips a goal back to `pending` when its tip is terminal. These are
 * load-bearing: every retry path (manual_retry, delivery_rework,
 * modify_contract, restart_stage) funnels through this one function, and
 * its mechanism decoupling from LLM decisions is the core of the attempt
 * redesign. A regression here reopens the "status carousel deadlock" bug.
 */

let projectID = ""
let taskID = ""
let runID = ""
let goalID = ""

function seedBaseline() {
  const now = Date.now()
  Database.transaction((db) => {
    db.insert(ProjectTable).values({
      id: projectID,
      worktree: process.cwd(),
      name: "startNewAttempt test",
      sandboxes: [],
      time_created: now,
      time_updated: now,
    }).run()
    db.insert(EngineTaskTable).values({
      id: taskID,
      project_id: projectID,
      source: "test",
      title: "t",
      request: "t",
      priority: "normal",
      time_created: now,
      time_updated: now,
      time_started: now,
    }).run()
    // Phase-6-e: run rows live in engine_artifact (kind="run").
    db.insert(EngineArtifactTable).values({
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
    }).run()
    db.insert(EngineGoalTable).values({
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
    }).run()
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
    db.insert(EngineArtifactTable).values({
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
    }).run(),
  )
}

beforeEach(async () => {
  await resetDatabase()
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  projectID = `proj_sna_${stamp}`
  taskID = `task_sna_${stamp}`
  runID = `run_sna_${stamp}`
  goalID = `goal_sna_${stamp}`
  seedBaseline()
})

afterEach(async () => {
  await resetDatabase()
})

describe("Goal.startNewAttempt — terminal-tip supersede", () => {
  test("completed tip → superseded_reason column set + goal.status projects pending", () => {
    const gr = `grun_completed_${Date.now()}`
    insertGoalRun({ id: gr, status: "completed" })
    // Sanity: starting status is the seeded passed.
    expect(goalStatusByID(goalID)).toBe("passed")

    const result = startNewAttempt({ goalID, reason: "delivery_rework" })

    expect(result.supersededTipID).toBe(gr)
    expect(result.retryCount).toBe(1)
    expect(getGoalRetryCount(goalID)).toBe(1)
    const tip = findGoalRun(gr)
    expect(tip?.superseded_reason).toBe("delivery_rework")
    expect(tip?.superseded_at).toBeGreaterThan(0)
    // FSM state is immutable — supersede never mutates the terminal status.
    expect(tip?.status).toBe("completed")
    // engine_goal.status is reprojected via syncGoalStatus — readiness picks
    // it up on the next pool.submit.
    expect(goalStatusByID(goalID)).toBe("pending")
  })

  test("failed tip → pending (manual_retry reason)", () => {
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
    expect(goalStatusByID(goalID)).toBe("pending")
  })

  test("aborted tip → pending (restart_stage reason)", () => {
    const gr = `grun_aborted_${Date.now()}`
    insertGoalRun({ id: gr, status: "aborted" })
    Database.use((db) =>
      db.update(EngineGoalTable).set({ status: "pending" }).where(eq(EngineGoalTable.id, goalID)).run(),
    )

    startNewAttempt({ goalID, reason: "restart_stage" })

    expect(findGoalRun(gr)?.superseded_reason).toBe("restart_stage")
  })
})

describe("Goal.startNewAttempt — no-op branches", () => {
  test("no goal_run at all → no supersede, status unchanged", () => {
    // No insertGoalRun call — goal has zero runs in history.
    const before = goalStatusByID(goalID)
    const result = startNewAttempt({ goalID, reason: "delivery_rework" })
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

    const result = startNewAttempt({ goalID, reason: "delivery_rework" })

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

    const first = startNewAttempt({ goalID, reason: "delivery_rework" })
    expect(first.supersededTipID).toBe(gr)
    const firstReasonAt = findGoalRun(gr)?.superseded_at

    // Second call — tip is already superseded (superseded_reason is set).
    // Function must NOT overwrite the reason/timestamp.
    const second = startNewAttempt({ goalID, reason: "manual_retry" })

    expect(second.supersededTipID).toBeUndefined()
    expect(second.retryCount).toBe(1)
    expect(getGoalRetryCount(goalID)).toBe(1)
    const row = findGoalRun(gr)
    expect(row?.superseded_reason).toBe("delivery_rework") // NOT overwritten
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
    const retryEntries = createDecisionLog(taskID).readByPhase("retry").filter((entry) => entry.goalID === goalID)
    expect(retryEntries).toHaveLength(1)
    expect(retryEntries[0]?.key).toBe(`build_retry_previous_${gr}`)
    expect(retryEntries[0]?.value).toContain("merge_back conflict in IndustryCardListMTts.tsx")
  })

  test("ensureBuildRetryFeedbackForGoal writes retry feedback before prompt context is composed", () => {
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

    const created = ensureBuildRetryFeedbackForGoal({
      taskID,
      goalID,
      source: "test.prompt_context",
    })

    expect(created).toBe(true)
    const retryEntries = createDecisionLog(taskID).readByPhase("retry").filter((entry) => entry.goalID === goalID)
    expect(retryEntries).toHaveLength(1)
    expect(retryEntries[0]?.value).toContain("Merge left worktree in MERGING state")
    expect(retryEntries[0]?.value).toContain("merge_back hit conflicts on one file")

    const second = ensureBuildRetryFeedbackForGoal({
      taskID,
      goalID,
      source: "test.prompt_context",
    })
    expect(second).toBe(false)
    expect(createDecisionLog(taskID).readByPhase("retry").filter((entry) => entry.goalID === goalID)).toHaveLength(1)
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
  })

  test("finalizeBuildAttempt writes goal delivery from published commit and reported files when host diff is empty", () => {
    const nextRunID = beginBuildAttempt({
      taskID,
      goalID,
      runID,
      sessionID: "ses_start_new_reported_files_delivery",
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

    const delivery = findDeliveryByGoalRun(nextRunID)
    expect(delivery?.result?.commit_ref).toBe("abc1234")
    expect(delivery?.result?.changed_files).toEqual(["src/index.ts"])
    expect(delivery?.result?.diffs).toMatchObject([
      {
        file: "src/index.ts",
        source: "build_report_files_changed",
      },
    ])
  })
})
