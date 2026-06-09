import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function source(path: string): string {
  return readFileSync(join(OVERLAY_ROOT, path), "utf8")
}

test("task debug info includes the Files panel board projection fields", () => {
  const main = source("src/main.tsx")

  expect(main).toContain("files:     ${debugGoalBoardFiles(gw)}")
  expect(main).toContain(
    "changedFiles=${changedFiles}; changedFileDiffs=${changedFileDiffs}; commits=${commitRefs.size",
  )
  expect(main).toContain("board.goalWorkflows[].steps[].payload.changedFiles / changedFileDiffs / commitRef")
})

test("task debug info SQL exposes per-goal acceptance artifacts for diff triage", () => {
  const main = source("src/main.tsx")

  expect(main).toContain("Per-goal acceptance file projection")
  expect(main).toContain("latest delivered attempt per goal")
  expect(main).toContain("json_extract(d.payload, '$.result.commit_ref') AS commit_ref")
  expect(main).toContain("json_extract(d.payload, '$.result.changed_files') AS changed_files")
  expect(main).toContain("Raw per-goal acceptance artifacts")
  expect(main).toContain("row_number() OVER (PARTITION BY goal_run_id ORDER BY time_created DESC, id DESC)")
})

test("task debug info leads with project-scoped probes before direct DB triage", () => {
  const main = source("src/main.tsx")

  expect(main).toContain("server.url:")
  expect(main).toContain("Project-scoped HTTP probes")
  expect(main).toContain("'x-opencorvus-directory' = $dir")
  expect(main).toContain("/global/health is control-plane only")
  expect(main).toContain("Runtime DB path (single source)")
  expect(main).toContain("/global/health -> paths.database")
  expect(main).toContain("do not infer missing goals/contracts from an empty wrong DB")
  expect(main).not.toContain("DB path (resolved by engine at runtime via /global/health)")
})
