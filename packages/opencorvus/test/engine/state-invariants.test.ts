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
  EngineDeliveryTable,
  EngineEvaluationTable,
  EngineGoalTable,
  EngineGoalRunTable,
} from "../../src/engine/engine.sql"
import { deriveGoalStatus } from "../../src/engine/goal-status"

/**
 * Cross-table state invariants. These are the properties the Phase 1-6
 * refactor is meant to hold permanently. Violations have shipped real bugs:
 *   - delivery without evaluation row (benchmark 006/007 stall)
 *   - engine_goal.status diverging from goal_run chain tip (retry deadlock)
 *   - more than one live tip per goal (concurrent dispatch bug)
 *   - delivery stuck in `candidate` long after the run finished
 *
 * Run after any benchmark that exercises the full pipeline. A failure here
 * names the specific rows that violate the invariant, not just "something
 * is off".
 */
describe("engine state invariants", () => {
  test("every delivery has exactly one evaluation row (1:1)", () => {
    // delivery.id is unique, so each delivery should appear exactly once in
    // evaluation rows. persistDelivery creates them in the same transaction —
    // a missing row means a writer bypassed persistDelivery.
    const deliveries = Database.use((db) =>
      db.select({ id: EngineDeliveryTable.id }).from(EngineDeliveryTable).all(),
    )
    if (deliveries.length === 0) return // no data to check
    const violations: Array<{ deliveryID: string; evaluationCount: number }> = []
    for (const d of deliveries) {
      const rows = Database.use((db) =>
        db
          .select({ id: EngineEvaluationTable.id })
          .from(EngineEvaluationTable)
          .where(eq(EngineEvaluationTable.delivery_id, d.id))
          .all(),
      )
      if (rows.length !== 1) {
        violations.push({ deliveryID: d.id, evaluationCount: rows.length })
      }
    }
    expect(violations).toEqual([])
  })

  test("engine_goal.status equals derived from goal_run chain tip (or default)", () => {
    const goals = Database.use((db) =>
      db.select().from(EngineGoalTable).all(),
    )
    const violations: Array<{ goalID: string; stored: string; derived: string | undefined }> = []
    for (const g of goals) {
      const derived = deriveGoalStatus(g.id)
      // deriveGoalStatus returns undefined when there is no goal_run yet.
      // The stored status in that case is whatever the initial insert said
      // (usually "pending"); we do not enforce a specific value, only that
      // once derivation has something to say, the stored value matches.
      if (derived === undefined) continue
      if (g.status !== derived) {
        violations.push({ goalID: g.id, stored: g.status, derived })
      }
    }
    expect(violations).toEqual([])
  })

  test("each goal has at most one live tip in its supersede chain", () => {
    const liveStatuses = ["queued", "accepted", "planning", "running", "evaluating", "blocked"] as const
    const rows = Database.use((db) =>
      db
        .select()
        .from(EngineGoalRunTable)
        .all(),
    )
    const byGoal = new Map<string, typeof rows>()
    for (const r of rows) {
      const list = byGoal.get(r.goal_id) ?? []
      list.push(r)
      byGoal.set(r.goal_id, list)
    }
    const violations: Array<{ goalID: string; liveTips: string[] }> = []
    for (const [goalID, goalRuns] of byGoal) {
      const supersededIDs = new Set(
        goalRuns
          .map((r) => (r as { supersede_of?: string | null }).supersede_of)
          .filter((x): x is string => !!x),
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
    const rows = Database.use((db) =>
      db
        .select({ id: EngineGoalRunTable.id, supersede_of: EngineGoalRunTable.supersede_of })
        .from(EngineGoalRunTable)
        .all(),
    )
    const allIDs = new Set(rows.map((r) => r.id))
    const dangling = rows
      .filter((r) => r.supersede_of && !allIDs.has(r.supersede_of))
      .map((r) => ({ runID: r.id, missingParent: r.supersede_of }))
    expect(dangling).toEqual([])
  })

  test("supersede chain has no cycles", () => {
    const rows = Database.use((db) =>
      db
        .select({ id: EngineGoalRunTable.id, supersede_of: EngineGoalRunTable.supersede_of })
        .from(EngineGoalRunTable)
        .all(),
    )
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
