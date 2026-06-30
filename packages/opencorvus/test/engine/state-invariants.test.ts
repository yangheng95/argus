import { describe, expect, test } from "bun:test"
import { ProjectTable } from "../../src/project/project.sql"
import { Database, eq, and, sql } from "../../src/storage/db"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { goalStatusByID } from "../../src/engine/describe"
import { isLiveGoalRunStatus } from "../../src/engine/catalog"
import {
  findActiveRunForTask,
  findGoalRun,
  findRun,
  findRuns,
  findTask,
  listActiveGoalRunsForRun,
  listGoalRunsByGoal,
  listLiveGoalRunsForProject,
  listLiveRuns,
  listLiveRunsForProject,
  viewTask,
} from "../../src/engine/store"

/**
 * Cross-table state invariants. These are the properties the Phase 1-6
 * refactor is meant to hold permanently. Violations have shipped real bugs:
 *   - acceptance without evaluation row (benchmark 006/007 stall)
 *   - engine_goal.status diverging from goal_run chain tip (retry deadlock)
 *   - more than one live tip per goal (concurrent dispatch bug)
 *   - acceptance stuck in `candidate` long after the run finished
 *
 * Run after any benchmark that exercises the full pipeline. A failure here
 * names the specific rows that violate the invariant, not just "something
 * is off".
 */
describe("engine state invariants", () => {
  function withMalformedGoalRunAttempt(
    input: { suffix: string; status?: unknown },
    assertMalformed: (ids: { projectID: string; taskID: string; goalID: string; goalRunID: string }) => void,
  ) {
    const now = Date.now()
    const projectID = `proj_goal_run_status_${input.suffix}_${now}`
    const taskID = `tsk_goal_run_status_${input.suffix}_${now}`
    const goalID = `gol_goal_run_status_${input.suffix}_${now}`
    const runID = `run_goal_run_status_${input.suffix}_${now}`
    const goalRunID = `grun_goal_run_status_${input.suffix}_${now}`
    const artifactID = `art_goal_run_status_${input.suffix}_${now}`
    const payload: Record<string, unknown> = { goal_id: goalID }
    if ("status" in input) payload.status = input.status

    Database.transaction((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "goal_run_attempt status invariant",
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
          title: "goal_run_attempt status invariant",
          request: "test",
          kind: "workflow",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
      db.insert(EngineArtifactTable)
        .values({
          id: artifactID,
          task_id: taskID,
          run_id: runID,
          goal_run_id: goalRunID,
          kind: "goal_run_attempt",
          label: "malformed-goal-run-attempt",
          payload,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    try {
      assertMalformed({ projectID, taskID, goalID, goalRunID })
    } finally {
      Database.transaction((db) => {
        db.delete(EngineArtifactTable).where(eq(EngineArtifactTable.goal_run_id, goalRunID)).run()
        db.delete(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).run()
        db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run()
      })
    }
  }

  function withMalformedRunArtifact(
    input: { suffix: string; status?: unknown },
    assertMalformed: (ids: { projectID: string; taskID: string; runID: string }) => void,
  ) {
    const now = Date.now()
    const projectID = `proj_run_status_${input.suffix}_${now}`
    const taskID = `tsk_run_status_${input.suffix}_${now}`
    const runID = `run_status_${input.suffix}_${now}`
    const payload: Record<string, unknown> = {
      plan_version_id: null,
      session_id: null,
      executor: "opencorvus",
      phase: "dispatch",
      blocking_reason: null,
      error: null,
      retry_count: 0,
      executor_ref: null,
      metadata: null,
      time_started: null,
      time_completed: null,
    }
    if ("status" in input) payload.status = input.status

    Database.transaction((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "run artifact status invariant",
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
          title: "run artifact status invariant",
          request: "test",
          kind: "workflow",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
      db.insert(EngineArtifactTable)
        .values({
          id: runID,
          task_id: taskID,
          run_id: runID,
          kind: "run",
          label: "malformed-run",
          payload,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    try {
      assertMalformed({ projectID, taskID, runID })
    } finally {
      Database.transaction((db) => {
        db.delete(EngineArtifactTable).where(eq(EngineArtifactTable.run_id, runID)).run()
        db.delete(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).run()
        db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run()
      })
    }
  }

  test("every acceptance has at least one evidence artifact row", () => {
    // Post-phase-6-c: deliveries live in engine_artifact (kind='acceptance') and
    // evidence too (kind='verification-evidence'). Evidence is append-only so
    // the 1:1 invariant was relaxed to "at least one" — persistTaskAcceptance
    // writes a pending row and updateEvaluationFromAcceptanceVerdict appends a
    // settled row. A acceptance with zero evidence rows means persistTaskAcceptance
    // was bypassed.
    const deliveries = Database.use((db) =>
      db
        .select({ id: EngineArtifactTable.id })
        .from(EngineArtifactTable)
        .where(eq(EngineArtifactTable.kind, "acceptance"))
        .all(),
    )
    if (deliveries.length === 0) return
    const violations: Array<{ acceptanceID: string; evidenceCount: number }> = []
    for (const d of deliveries) {
      const rows = Database.use((db) =>
        db
          .select({ id: EngineArtifactTable.id })
          .from(EngineArtifactTable)
          .where(
            and(eq(EngineArtifactTable.acceptance_id, d.id), eq(EngineArtifactTable.kind, "verification-evidence")),
          )
          .all(),
      )
      if (rows.length < 1) {
        violations.push({ acceptanceID: d.id, evidenceCount: rows.length })
      }
    }
    expect(violations).toEqual([])
  })

  test("each goal has at most one live tip in its supersede chain", () => {
    // Phase-6-d: goal_run rows are engine_artifact kind='goal_run_attempt';
    // `listGoalRunsByGoal` collapses the append-only stream to the latest per
    // logical goal_run. The invariant is unchanged.
    const distinctGoalIDs = Database.use((db) =>
      db
        .selectDistinct({ goalID: sql<string>`json_extract(${EngineArtifactTable.payload}, '$.goal_id')` })
        .from(EngineArtifactTable)
        .where(eq(EngineArtifactTable.kind, "goal_run_attempt"))
        .all()
        .map((r) => r.goalID)
        .filter((x): x is string => !!x),
    )
    const violations: Array<{ goalID: string; liveTips: string[] }> = []
    for (const goalID of distinctGoalIDs) {
      const goalRuns = listGoalRunsByGoal(goalID)
      const supersededIDs = new Set(goalRuns.map((r) => r.supersede_of).filter((x): x is string => !!x))
      const tips = goalRuns.filter((r) => !supersededIDs.has(r.id))
      const liveTips = tips.filter((r) => isLiveGoalRunStatus(r.status))
      if (liveTips.length > 1) {
        violations.push({ goalID, liveTips: liveTips.map((r) => r.id) })
      }
    }
    expect(violations).toEqual([])
  })

  test("supersede_of references exist (no dangling links)", () => {
    // Phase-6-d: walk distinct logical goal_run_ids; each goal_run's
    // supersede_of must point at another logical goal_run that exists.
    const logicalIDs = Database.use((db) =>
      db
        .selectDistinct({ id: EngineArtifactTable.goal_run_id })
        .from(EngineArtifactTable)
        .where(eq(EngineArtifactTable.kind, "goal_run_attempt"))
        .all()
        .map((r) => r.id)
        .filter((x): x is string => !!x),
    )
    const allIDs = new Set(logicalIDs)
    const dangling: Array<{ runID: string; missingParent: string }> = []
    for (const id of logicalIDs) {
      const row = Database.use((db) =>
        db
          .select()
          .from(EngineArtifactTable)
          .where(and(eq(EngineArtifactTable.goal_run_id, id), eq(EngineArtifactTable.kind, "goal_run_attempt")))
          .orderBy(sql`${EngineArtifactTable.time_created} DESC`)
          .get(),
      )
      const payload = (row?.payload ?? {}) as { supersede_of?: string | null }
      if (payload.supersede_of && !allIDs.has(payload.supersede_of)) {
        dangling.push({ runID: id, missingParent: payload.supersede_of })
      }
    }
    expect(dangling).toEqual([])
  })

  test("supersede chain has no cycles", () => {
    const logicalIDs = Database.use((db) =>
      db
        .selectDistinct({ id: EngineArtifactTable.goal_run_id })
        .from(EngineArtifactTable)
        .where(eq(EngineArtifactTable.kind, "goal_run_attempt"))
        .all()
        .map((r) => r.id)
        .filter((x): x is string => !!x),
    )
    const rows: Array<{ id: string; supersede_of: string | null }> = []
    for (const id of logicalIDs) {
      const row = Database.use((db) =>
        db
          .select()
          .from(EngineArtifactTable)
          .where(and(eq(EngineArtifactTable.goal_run_id, id), eq(EngineArtifactTable.kind, "goal_run_attempt")))
          .orderBy(sql`${EngineArtifactTable.time_created} DESC`)
          .get(),
      )
      const payload = (row?.payload ?? {}) as { supersede_of?: string | null }
      rows.push({ id, supersede_of: payload.supersede_of ?? null })
    }
    const parent = new Map<string, string>()
    for (const r of rows) {
      if (r.supersede_of) parent.set(r.id, r.supersede_of)
    }
    const cycles: string[][] = []
    for (const start of parent.keys()) {
      const seen: string[] = []
      let cur: string | undefined = start
      while (cur && !seen.includes(cur)) {
        seen.push(cur)
        cur = parent.get(cur)
      }
      if (cur && seen.includes(cur)) {
        cycles.push(seen)
      }
    }
    expect(cycles).toEqual([])
  })

  test("goal_run_attempt payload status is required on all common read projections", () => {
    withMalformedGoalRunAttempt({ suffix: "missing" }, ({ projectID, goalID, goalRunID }) => {
      expect(() => listGoalRunsByGoal(goalID)).toThrow(/missing payload\.status/)
      expect(() => findGoalRun(goalRunID)).toThrow(/missing payload\.status/)
      expect(() => goalStatusByID(goalID)).toThrow(/missing payload\.status/)
      expect(() => listLiveGoalRunsForProject(projectID)).toThrow(/missing payload\.status/)
    })
  })

  test("goal_run_attempt payload status must be a catalog status", () => {
    withMalformedGoalRunAttempt({ suffix: "invalid", status: "zombie" }, ({ goalID, goalRunID }) => {
      expect(() => listGoalRunsByGoal(goalID)).toThrow(/invalid payload\.status "zombie"/)
      expect(() => findGoalRun(goalRunID)).toThrow(/invalid payload\.status "zombie"/)
    })
  })

  test("active goal-run projection excludes queued and terminal tips", () => {
    const now = Date.now()
    const projectID = `proj_goal_run_active_${now}`
    const taskID = `tsk_goal_run_active_${now}`
    const runID = `run_goal_run_active_${now}`
    const statuses = [
      "queued",
      "accepted",
      "planning",
      "running",
      "evaluating",
      "blocked",
      "completed",
      "failed",
      "aborted",
    ] as const

    Database.transaction((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "active goal_run projection",
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
          title: "active goal_run projection",
          request: "test",
          kind: "workflow",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()

      for (const [index, status] of statuses.entries()) {
        const goalRunID = `grun_goal_run_active_${status}_${now}`
        db.insert(EngineArtifactTable)
          .values({
            id: `art_goal_run_active_${status}_${now}`,
            task_id: taskID,
            run_id: runID,
            goal_run_id: goalRunID,
            kind: "goal_run_attempt",
            label: `attempt-${status}`,
            payload: {
              goal_id: `gol_goal_run_active_${status}_${now}`,
              status,
              retry_count: 0,
              time_started: index === 0 ? null : now,
              time_completed: status === "completed" || status === "failed" || status === "aborted" ? now : null,
            },
            time_created: now + index,
            time_updated: now + index,
          })
          .run()
      }
    })

    try {
      expect(listActiveGoalRunsForRun(runID).map((row) => row.status).sort()).toEqual([
        "accepted",
        "blocked",
        "evaluating",
        "planning",
        "running",
      ])
    } finally {
      Database.transaction((db) => {
        db.delete(EngineArtifactTable).where(eq(EngineArtifactTable.run_id, runID)).run()
        db.delete(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).run()
        db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run()
      })
    }
  })

  test("run artifact payload status is required on common read projections", () => {
    withMalformedRunArtifact({ suffix: "missing" }, ({ projectID, taskID, runID }) => {
      expect(() => findRun(runID)).toThrow(/missing payload\.status/)
      expect(() => findRuns(taskID)).toThrow(/missing payload\.status/)
      expect(() => findActiveRunForTask(taskID)).toThrow(/missing payload\.status/)
      expect(() => listLiveRunsForProject(projectID)).toThrow(/missing payload\.status/)
      expect(() => listLiveRuns()).toThrow(/missing payload\.status/)
      const task = findTask(taskID)
      expect(task).toBeDefined()
      expect(() => viewTask(task!)).toThrow(/missing payload\.status/)
    })
  })

  test("run artifact payload status must be a catalog status", () => {
    withMalformedRunArtifact({ suffix: "invalid", status: "zombie" }, ({ taskID, runID }) => {
      expect(() => findRun(runID)).toThrow(/invalid payload\.status "zombie"/)
      expect(() => findRuns(taskID)).toThrow(/invalid payload\.status "zombie"/)
    })
  })
})
