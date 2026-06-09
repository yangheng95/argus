import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { updateGoalWorkspace } from "../../src/engine/persist"
import { resetDatabase } from "../fixture/db"

// Phase G (2026-05-05) — updateGoalWorkspace must reject the no-tip case.
//
// Pre-fix the writer synthesised a queued goal_run_attempt artifact with
// `coordinatorRunID: "synthetic"` whenever it was called on a goal that had
// never been attempted. That pattern (a) wrote a fake run pointer into the
// attempt's run_id slot — invalid as a foreign reference for any downstream
// reader that resolves run_id back to a real engine_run snapshot — and
// (b) let upstream callers use the workspace writer as a backdoor for
// attempt creation, breaking the rule that beginBuildAttempt is the single
// entry point that creates an attempt artifact.
//
// Post-fix updateGoalWorkspace throws when no tip exists; the orchestrator
// build dispatch path was rewired so that the freshly-created worktree
// pointer rides the new attempt artifact via beginBuildAttempt instead.

describe("updateGoalWorkspace — no-tip path", () => {
  let projectID = ""
  let taskID = ""
  let goalID = ""

  beforeEach(async () => {
    await resetDatabase()
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    projectID = `proj_ugw_${stamp}`
    taskID = `task_ugw_${stamp}`
    goalID = `goal_ugw_${stamp}`
    const now = Date.now()
    Database.transaction((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "updateGoalWorkspace test",
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
          order_index: 0,
          time_created: now,
          time_updated: now,
        })
        .run()
    })
  })

  afterEach(async () => {
    await resetDatabase()
  })

  test("throws when goal has no goal_run_attempt artifact", () => {
    expect(() =>
      updateGoalWorkspace({
        goalID,
        workspaceDir: "/tmp/some-worktree",
        workspaceBranch: "feature/x",
        workspaceBaseRef: "abc123",
      }),
    ).toThrow(/has no goal_run_attempt artifact/)
  })

  test("throws on missing goal id", () => {
    expect(() =>
      updateGoalWorkspace({
        goalID: "goal_does_not_exist",
        workspaceDir: null,
        workspaceBranch: null,
      }),
    ).toThrow(/not found/)
  })
})
