/**
 * Fix 3 (specs/architecture-review-rework-closure-2026-05-06.md, Layer 3)
 *
 * `countGoalAttemptsBySupersedeReason` is the convergence-boundary counter.
 * `openArchitectureReviewRework` calls it per goal and refuses to open
 * another rework attempt under the same reason once the count reaches the
 * limit (MAX_REVIEW_REWORK_PER_GOAL). Without this counter, V_n loops
 * indefinitely; with it, an exhausted-evidence entry is written into
 * decision_log and the orchestrator decides whether to escalate to
 * `architect` re-run on the next decision turn.
 */
import { afterEach, beforeEach, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import {
  EngineArtifactTable,
  EngineGoalTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { countGoalAttemptsBySupersedeReason } from "../../src/engine/store"
import { resetDatabase } from "../fixture/db"

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
      name: "countAttemptsBySupersedeReason test",
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
    db.insert(EngineArtifactTable).values({
      id: runID,
      task_id: taskID,
      run_id: runID,
      kind: "run",
      label: "run-running",
      payload: {
        plan_version_id: null,
        session_id: null,
        executor: "mirrorcode",
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
      status: "pending",
      order_index: 0,
      time_created: now,
      time_updated: now,
    }).run()
  })
}

function insertGoalRun(input: {
  id: string
  status: "completed" | "failed" | "aborted"
  supersedeOf?: string
  supersededReason?: string | null
}) {
  const now = Date.now()
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
        error: null,
        workspace_dir: null,
        base_ref: null,
        merge_ref: null,
        supersede_of: input.supersedeOf ?? null,
        superseded_reason: input.supersededReason ?? null,
        superseded_at: input.supersededReason ? now : null,
        metadata: null,
        time_started: null,
        time_completed: now,
      },
      time_created: now,
      time_updated: now,
    }).run(),
  )
}

beforeEach(async () => {
  await resetDatabase()
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  projectID = `proj_count_${stamp}`
  taskID = `task_count_${stamp}`
  runID = `run_count_${stamp}`
  goalID = `goal_count_${stamp}`
  seedBaseline()
})

afterEach(async () => {
  await resetDatabase()
})

test("countGoalAttemptsBySupersedeReason: returns 0 when goal has no runs", () => {
  expect(countGoalAttemptsBySupersedeReason(goalID, "architecture_review_rework")).toBe(0)
})

test("countGoalAttemptsBySupersedeReason: returns 0 when no run carries the reason", () => {
  const a = `grun_a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const b = `grun_b_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  insertGoalRun({ id: a, status: "completed", supersededReason: null })
  insertGoalRun({ id: b, status: "failed", supersededReason: "delivery_rework" })
  expect(countGoalAttemptsBySupersedeReason(goalID, "architecture_review_rework")).toBe(0)
})

test("countGoalAttemptsBySupersedeReason: counts only rows whose superseded_reason matches exactly", () => {
  // Mixed rework history: some delivery_rework, some architecture_review_rework,
  // some still-live (no reason). Only architecture_review_rework should count.
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const r1 = `grun1_${stamp}`
  const r2 = `grun2_${stamp}`
  const r3 = `grun3_${stamp}`
  const r4 = `grun4_${stamp}`
  insertGoalRun({ id: r1, status: "completed", supersededReason: "architecture_review_rework" })
  insertGoalRun({ id: r2, status: "failed", supersededReason: "architecture_review_rework", supersedeOf: r1 })
  insertGoalRun({ id: r3, status: "failed", supersededReason: "delivery_rework", supersedeOf: r2 })
  insertGoalRun({ id: r4, status: "completed", supersededReason: null, supersedeOf: r3 })

  expect(countGoalAttemptsBySupersedeReason(goalID, "architecture_review_rework")).toBe(2)
  expect(countGoalAttemptsBySupersedeReason(goalID, "delivery_rework")).toBe(1)
  expect(countGoalAttemptsBySupersedeReason(goalID, "manual_retry")).toBe(0)
})

test("countGoalAttemptsBySupersedeReason: dependency-rework reason is distinct from direct rework", () => {
  // The orchestrator distinguishes architecture_review_rework (direct affected
  // goals) from architecture_review_dependency_rework (downstream dependents).
  // The convergence boundary counts each separately so a dependent goal
  // doesn't get penalised by direct-rework history on its upstream.
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const r1 = `grun1_${stamp}`
  const r2 = `grun2_${stamp}`
  insertGoalRun({
    id: r1,
    status: "failed",
    supersededReason: "architecture_review_rework",
  })
  insertGoalRun({
    id: r2,
    status: "failed",
    supersededReason: "architecture_review_dependency_rework",
    supersedeOf: r1,
  })
  expect(countGoalAttemptsBySupersedeReason(goalID, "architecture_review_rework")).toBe(1)
  expect(countGoalAttemptsBySupersedeReason(goalID, "architecture_review_dependency_rework")).toBe(1)
})
