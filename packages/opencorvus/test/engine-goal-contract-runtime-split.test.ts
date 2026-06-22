import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { SCHEMA_DDL } from "../src/storage/ddl"

// Phase B (2026-05-05) — verify the schema split between contract data
// (engine_goal) and runtime worktree state (engine_artifact[goal_run_attempt]
// payload). The two could go out of sync because the build tool wrote the
// engine_goal columns BEFORE creating the attempt artifact; a rejected
// dispatch left the contract row claiming "in flight" with no matching
// attempt. The columns are gone now (no dual source, rule 8); a single
// helper findGoalLatestWorkspace reads the persistent pointer from the
// latest attempt payload.

describe("engine_goal schema — runtime workspace columns retired", () => {
  test("Drizzle schema has no workspace_dir / workspace_branch / workspace_base_ref columns", () => {
    const source = readFileSync(resolve(import.meta.dir, "../src/engine/engine.sql.ts"), "utf8")
    // The EngineGoalTable definition is the authoritative schema source.
    // Anchor on the table name to scope the search to the table body.
    const tableStart = source.indexOf(`export const EngineGoalTable = sqliteTable(`)
    expect(tableStart).toBeGreaterThan(0)
    const tableEnd = source.indexOf("indexes:", tableStart)
    // Pick a generous body slice — the table block ends before the next top-level export.
    const tableEndFallback = source.indexOf("export const ", tableStart + 1)
    const body = source.slice(
      tableStart,
      tableEnd > 0 ? tableEnd : tableEndFallback > 0 ? tableEndFallback : tableStart + 6000,
    )

    // Column declarations look like `workspace_dir: text(),` — easier to grep
    // than the snake_case appearing in JSDoc (which is allowed).
    expect(body).not.toContain("workspace_dir: text()")
    expect(body).not.toContain("workspace_branch: text()")
    expect(body).not.toContain("workspace_base_ref: text()")
  })

  test("DDL has no workspace_* column declarations on engine_goal", () => {
    const goalTableStart = SCHEMA_DDL.indexOf('CREATE TABLE IF NOT EXISTS "engine_goal"')
    expect(goalTableStart).toBeGreaterThan(0)
    const goalTableEnd = SCHEMA_DDL.indexOf(");", goalTableStart)
    const ddl = SCHEMA_DDL.slice(goalTableStart, goalTableEnd)
    // Strip SQL comments so retirement notes don't trip the assertion.
    const ddlCode = ddl.replace(/--[^\n]*\n/g, "\n")
    expect(ddlCode).not.toMatch(/^\s*workspace_dir\s+text/m)
    expect(ddlCode).not.toMatch(/^\s*workspace_branch\s+text/m)
    expect(ddlCode).not.toMatch(/^\s*workspace_base_ref\s+text/m)
  })

  test("inspect-task diagnostic does not query retired engine_goal workspace columns", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../../script/inspect-task.ts"), "utf8")
    expect(source).not.toContain("workspace_branch")
    expect(source).not.toContain("workspace_dir")
    expect(source).not.toContain("workspace_base_ref")
  })

  test("findGoalLatestWorkspace is exported from engine/store", async () => {
    const mod = await import("@/engine/store")
    expect(typeof mod.findGoalLatestWorkspace).toBe("function")
    // Returns { directory, branch, baseRef } shape; missing goal returns
    // a no-op triple so callers don't branch on undefined.
  })
})

describe("goal_run_attempt artifact carries the workspace triple", () => {
  test("artifactRowToGoalRunRow includes workspace_branch + workspace_base_ref", () => {
    const source = readFileSync(resolve(import.meta.dir, "../src/engine/store.ts"), "utf8")
    // The mapper must read all three workspace_* fields from payload —
    // otherwise findGoalLatestWorkspace cannot reconstitute the triple.
    const mapperStart = source.indexOf("function artifactRowToGoalRunRow(")
    expect(mapperStart).toBeGreaterThan(0)
    const mapperEnd = source.indexOf("function ", mapperStart + 1)
    const mapper = source.slice(mapperStart, mapperEnd)
    expect(mapper).toContain("workspace_dir: payload.workspace_dir ?? null")
    expect(mapper).toContain("workspace_branch: payload.workspace_branch ?? null")
    expect(mapper).toContain("workspace_base_ref: payload.workspace_base_ref ?? null")
  })
})
