import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { SCHEMA_DDL } from "../src/storage/ddl"

// Phase E (2026-05-05) — engine_goal.retry_count is gone. The per-goal
// implementation version counter (V label) was a denormalised cache of
// the latest goal_run_attempt artifact's payload.retry_count. Same value,
// two writers, no transactional coupling. Rule 8 (no dual source) forced
// the move: callers go through engine/store.ts:getGoalRetryCount(goalID)
// which reads the latest attempt artifact's payload.

describe("engine_goal.retry_count column retired", () => {
  test("Drizzle schema body has no retry_count column declaration", () => {
    const source = readFileSync(resolve(import.meta.dir, "../src/engine/engine.sql.ts"), "utf8")
    const tableStart = source.indexOf("export const EngineGoalTable = sqliteTable(")
    expect(tableStart).toBeGreaterThan(0)
    // Body extends until the next top-level export.
    const next = source.indexOf("export ", tableStart + 1)
    const body = source.slice(tableStart, next > 0 ? next : tableStart + 6000)
    expect(body).not.toMatch(/retry_count:\s*integer\(\)/)
  })

  test("DDL has no retry_count column declaration on engine_goal", () => {
    const goalTableStart = SCHEMA_DDL.indexOf('CREATE TABLE IF NOT EXISTS "engine_goal"')
    expect(goalTableStart).toBeGreaterThan(0)
    const goalTableEnd = SCHEMA_DDL.indexOf(");", goalTableStart)
    const ddl = SCHEMA_DDL.slice(goalTableStart, goalTableEnd).replace(/--[^\n]*\n/g, "\n")
    expect(ddl).not.toMatch(/^\s*retry_count\s+integer/m)
  })

  test("getGoalRetryCount is exported from engine/store", async () => {
    const mod = await import("@/engine/store")
    expect(typeof mod.getGoalRetryCount).toBe("function")
  })

  test("openGoalImplementationVersion no longer writes engine_goal.retry_count", () => {
    const source = readFileSync(resolve(import.meta.dir, "../src/engine/persist.ts"), "utf8")
    const fnStart = source.indexOf("function openGoalImplementationVersion(")
    expect(fnStart).toBeGreaterThan(0)
    const fnEnd = source.indexOf("\n}\n", fnStart)
    const body = source.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 1500)
    // No `update(EngineGoalTable).set({ retry_count })` style write.
    expect(body).not.toMatch(/EngineGoalTable[\s\S]*retry_count/m)
  })

  test("startNewAttempt resetWorkspace path no longer writes engine_goal.retry_count", () => {
    const source = readFileSync(resolve(import.meta.dir, "../src/engine/persist.ts"), "utf8")
    const fnStart = source.indexOf("export function startNewAttempt(")
    expect(fnStart).toBeGreaterThan(0)
    const fnEnd = source.indexOf("\n}\n", fnStart)
    const body = source.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 3500)
    // Reset path nulls workspace pointer via updateGoalRun on the artifact;
    // the retry_count column doesn't exist anymore.
    expect(body).not.toMatch(/EngineGoalTable[\s\S]*?retry_count:/m)
  })

  test("inspect-task diagnostic does not query retired engine_goal retry_count", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../../script/inspect-task.ts"), "utf8")
    expect(source).not.toContain("retry_count")
  })
})
