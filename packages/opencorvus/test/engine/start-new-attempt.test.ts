import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import {
  EngineGoalRunTable,
  EngineGoalTable,
  EngineRunTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { startNewAttempt } from "../../src/engine/persist"
import { goalStatusByID } from "../../src/engine/describe"
import { findGoal, findGoalRun } from "../../src/engine/store"
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
      status: "active",
      active_run_id: runID,
      priority: "normal",
      time_created: now,
      time_updated: now,
    }).run()
    db.insert(EngineRunTable).values({
      id: runID,
      task_id: taskID,
      executor: "opencode",
      status: "running",
      phase: "execute",
      retry_count: 0,
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
      retry_count: 0,
      order_index: 0,
      time_created: now,
      time_updated: now,
    }).run()
  })
}

function insertGoalRun(input: {
  id: string
  status: "queued" | "running" | "completed" | "failed" | "aborted" | "evaluating" | "blocked" | "accepted" | "planning"
  supersedeOf?: string
}) {
  const now = Date.now()
  Database.use((db) =>
    db.insert(EngineGoalRunTable).values({
      id: input.id,
      task_id: taskID,
      goal_id: goalID,
      coordinator_run_id: runID,
      status: input.status,
      retry_count: 0,
      supersede_of: input.supersedeOf ?? null,
      time_created: now,
      time_updated: now,
      ...(input.status === "completed" || input.status === "failed" || input.status === "aborted"
        ? { time_completed: now }
        : {}),
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

    startNewAttempt({ goalID, reason: "manual_retry" })

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
    const row = findGoalRun(gr)
    expect(row?.superseded_reason).toBe("delivery_rework") // NOT overwritten
    expect(row?.superseded_at).toBe(firstReasonAt!)
  })
})

describe("Goal.startNewAttempt — options", () => {
  test("resetWorkspace nulls workspace_dir / workspace_branch / workspace_base_ref", () => {
    Database.use((db) =>
      db.update(EngineGoalTable)
        .set({
          workspace_dir: "C:/tmp/ws-x",
          workspace_branch: "opencorvus/x",
          workspace_base_ref: "abc123",
        })
        .where(eq(EngineGoalTable.id, goalID))
        .run(),
    )
    const gr = `grun_ws_${Date.now()}`
    insertGoalRun({ id: gr, status: "completed" })

    const result = startNewAttempt({
      goalID,
      reason: "modify_contract",
      resetWorkspace: true,
    })

    expect(result.resetWorkspace).toBe(true)
    const g = findGoal(goalID)
    expect(g?.workspace_dir).toBeNull()
    expect(g?.workspace_branch).toBeNull()
    expect(g?.workspace_base_ref).toBeNull()
  })
})

