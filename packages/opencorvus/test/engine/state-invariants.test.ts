import { describe, expect, test } from "bun:test"
import {
  Database,
  count,
  eq,
  and,
  inArray,
  sql,
} from "../../src/storage/db"
import {
  EngineArtifactTable,
} from "../../src/engine/engine.sql"
import { listGoalRunsByGoal, listGoalRunsForTask } from "../../src/engine/store"

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
            and(
              eq(EngineArtifactTable.acceptance_id, d.id),
              eq(EngineArtifactTable.kind, "verification-evidence"),
            ),
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
    const liveStatuses = ["queued", "accepted", "planning", "running", "evaluating", "blocked"] as const
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
      const supersededIDs = new Set(
        goalRuns.map((r) => r.supersede_of).filter((x): x is string => !!x),
      )
      const tips = goalRuns.filter((r) => !supersededIDs.has(r.id))
      const liveTips = tips.filter((r) => liveStatuses.includes(r.status as (typeof liveStatuses)[number]))
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
          .where(
            and(
              eq(EngineArtifactTable.goal_run_id, id),
              eq(EngineArtifactTable.kind, "goal_run_attempt"),
            ),
          )
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
          .where(
            and(
              eq(EngineArtifactTable.goal_run_id, id),
              eq(EngineArtifactTable.kind, "goal_run_attempt"),
            ),
          )
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
})
