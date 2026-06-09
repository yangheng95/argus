import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { beginBuildAttempt, createGoalRun, startNewAttempt } from "../../src/engine/persist"
import { goalStatusByID } from "../../src/engine/describe"
import { processOwner } from "../../src/engine/lease"
import { findLatestTipGoalRun, findGoalRun, listGoalRunsByGoal } from "../../src/engine/store"
import { resetDatabase } from "../fixture/db"

/**
 * Regression for specs/scheduler-collab-audit-2026-04-30.md §11.6 + L8 +
 * scheduler-fix-plan-2026-04-30.md P0. The bug: retry attempts created via
 * `beginBuildAttempt` left supersede_of=null on the new running goal_run row.
 * findLatestTipGoalRun then projected the patched-old terminal row as the
 * live tip and deriveGoalStatus returned `pending` while the build was
 * actually running. Two retry shapes both reach beginBuildAttempt and both
 * must populate supersede_of; codex 3rd-pass identified the
 * startNewAttempt-then-beginBuildAttempt path as a separate failure mode
 * from the beginBuildAttempt-only retry.
 *
 * Rule 36 negative case: first-ever attempt (no prior tip) leaves
 * supersede_of=null; this test asserts that.
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
        name: "begin-build-attempt-supersede test",
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
        status: "pending",
        order_index: 0,
        time_created: now,
        time_updated: now,
      })
      .run()
  })
}

function insertGoalRun(input: {
  id: string
  status: "running" | "failed" | "completed" | "aborted"
  supersedeOf?: string
  owner?: string | null
}) {
  const now = Date.now()
  const terminal = input.status === "failed" || input.status === "completed" || input.status === "aborted"
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
          error: null,
          workspace_dir: null,
          base_ref: null,
          merge_ref: null,
          supersede_of: input.supersedeOf ?? null,
          superseded_reason: null,
          superseded_at: null,
          metadata: null,
          owner: input.owner ?? null,
          time_started: null,
          time_completed: terminal ? now : null,
        },
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function insertTerminalGoalRun(input: { id: string; status: "failed" | "completed" | "aborted" }) {
  insertGoalRun(input)
}

beforeEach(async () => {
  await resetDatabase()
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  projectID = `proj_bba_${stamp}`
  taskID = `task_bba_${stamp}`
  runID = `run_bba_${stamp}`
  goalID = `goal_bba_${stamp}`
  seedBaseline()
})

afterEach(async () => {
  await resetDatabase()
})

describe("beginBuildAttempt — supersede_of population", () => {
  test("retry path: openGoalImplementationVersion supersedes tip → new row.supersede_of points at old tip + status=running", () => {
    const oldRunID = `grun_old_${Date.now()}`
    insertTerminalGoalRun({ id: oldRunID, status: "failed" })
    expect(goalStatusByID(goalID)).toBe("failed")

    const newRunID = beginBuildAttempt({
      taskID,
      goalID,
      runID,
      sessionID: "ses_bba_retry",
    })

    const newRow = findGoalRun(newRunID)
    expect(newRow?.status).toBe("running")
    expect(newRow?.supersede_of).toBe(oldRunID)
    // Live tip must be the new running row, not the patched-old.
    expect(findLatestTipGoalRun(goalID)?.id).toBe(newRunID)
    // Derived goal status must reflect the new running attempt.
    expect(goalStatusByID(goalID)).toBe("running")
  })

  test("acceptance_rework path: startNewAttempt patches tip first, beginBuildAttempt still threads supersede_of", () => {
    const oldRunID = `grun_oldrework_${Date.now()}`
    insertTerminalGoalRun({ id: oldRunID, status: "failed" })

    // Step 1: orchestrator/acceptance calls startNewAttempt → patches old row's
    // superseded_reason. Goal projects to pending.
    const sna = startNewAttempt({ goalID, reason: "acceptance_rework" })
    expect(sna.supersededTipID).toBe(oldRunID)
    expect(findGoalRun(oldRunID)?.superseded_reason).toBe("acceptance_rework")
    expect(goalStatusByID(goalID)).toBe("pending")

    // Step 2: build tool runs beginBuildAttempt. openGoalImplementationVersion
    // sees tip is already superseded → returns no supersededTipID. Without
    // P0's findLatestTipGoalRun fallback, the new row would get
    // supersede_of=null and the goal would stay `pending` despite an active
    // running attempt. With the fix, supersede_of points at oldRunID.
    const newRunID = beginBuildAttempt({
      taskID,
      goalID,
      runID,
      sessionID: "ses_bba_rework",
    })

    const newRow = findGoalRun(newRunID)
    expect(newRow?.status).toBe("running")
    expect(newRow?.supersede_of).toBe(oldRunID)
    // Live tip is now the new running row.
    expect(findLatestTipGoalRun(goalID)?.id).toBe(newRunID)
    // Goal status flips from pending → running on this transition.
    expect(goalStatusByID(goalID)).toBe("running")
  })

  test("first-ever attempt (no prior tip) → supersede_of stays null", () => {
    // No prior goal_run inserted.
    const newRunID = beginBuildAttempt({
      taskID,
      goalID,
      runID,
      sessionID: "ses_bba_first",
    })

    const newRow = findGoalRun(newRunID)
    expect(newRow?.status).toBe("running")
    expect(newRow?.supersede_of).toBeNull()
    expect(findLatestTipGoalRun(goalID)?.id).toBe(newRunID)
    expect(goalStatusByID(goalID)).toBe("running")
  })

  test("live tip → beginBuildAttempt refuses to supersede or duplicate the running executor", () => {
    const liveRunID = `grun_live_${Date.now()}`
    insertGoalRun({ id: liveRunID, status: "running" })

    expect(() =>
      beginBuildAttempt({
        taskID,
        goalID,
        runID,
        sessionID: "ses_bba_live_refuse",
      }),
    ).toThrow(/already has live goal_run/)

    const rows = listGoalRunsByGoal(goalID)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(liveRunID)
    expect(findGoalRun(liveRunID)?.supersede_of).toBeNull()
    expect(goalStatusByID(goalID)).toBe("running")
  })

  test("foreign live owner with live PID → beginBuildAttempt refuses duplicate instead of retiring it", () => {
    const liveRunID = `grun_live_foreign_${Date.now()}`
    insertGoalRun({ id: liveRunID, status: "running", owner: `${process.pid}:other:alive0` })
    expect(goalStatusByID(goalID)).toBe("running")

    expect(() =>
      beginBuildAttempt({
        taskID,
        goalID,
        runID,
        sessionID: "ses_bba_live_foreign_refuse",
      }),
    ).toThrow(/already has live goal_run/)

    const rows = listGoalRunsByGoal(goalID)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(liveRunID)
    expect(findGoalRun(liveRunID)?.status).toBe("running")
    expect(findGoalRun(liveRunID)?.error).toBeNull()
    expect(findGoalRun(liveRunID)?.supersede_of).toBeNull()
    expect(goalStatusByID(goalID)).toBe("running")
  })

  test("owner-orphaned live tip → beginBuildAttempt retires the orphan and re-dispatches instead of throwing", () => {
    // A prior process drove this attempt live, then the process restarted.
    // The tip status is still `running` but its owner is a foreign (dead)
    // process. The half-streamed turn cannot resume; describeGoal reports it as
    // orphaned + dispatchable, so the orchestrator calls build({goalID}) →
    // beginBuildAttempt. This must NOT throw "second live attempt"; it must
    // retire the orphan and open a fresh attempt. Regression for the
    // independent-review MAJOR (2026-05-29): the live-guard was not
    // owner-orphan-aware, so re-dispatch of a restart orphan threw.
    const orphanID = `grun_orphan_${Date.now()}`
    insertGoalRun({ id: orphanID, status: "running", owner: "999999:dead:beef00" })
    // The overlay/board projection no longer shows it running (owner-aware).
    expect(goalStatusByID(goalID)).toBe("failed")

    const newRunID = beginBuildAttempt({
      taskID,
      goalID,
      runID,
      sessionID: "ses_bba_orphan",
    })

    // Orphan tip was retired to aborted, with an explanatory reason.
    expect(findGoalRun(orphanID)?.status).toBe("aborted")
    expect(findGoalRun(orphanID)?.error).toContain("orphaned")
    // Fresh attempt is the live tip, owned by THIS process, superseding the orphan.
    const newRow = findGoalRun(newRunID)
    expect(newRow?.status).toBe("running")
    expect(newRow?.supersede_of).toBe(orphanID)
    expect(newRow?.owner).toBe(processOwner())
    expect(findLatestTipGoalRun(goalID)?.id).toBe(newRunID)
    expect(goalStatusByID(goalID)).toBe("running")
  })

  test("createGoalRun reuses a live row even if bad historical data already points supersede_of at it", () => {
    const liveRunID = `grun_bad_live_parent_${Date.now()}`
    const badChildID = `grun_bad_child_${Date.now()}`
    insertGoalRun({ id: liveRunID, status: "running" })
    insertGoalRun({ id: badChildID, status: "failed", supersedeOf: liveRunID })

    const row = createGoalRun({
      taskID,
      goalID,
      coordinatorRunID: runID,
    })

    expect(row.id).toBe(liveRunID)
    expect(listGoalRunsByGoal(goalID).filter((r) => r.status === "running")).toHaveLength(1)
  })
})
