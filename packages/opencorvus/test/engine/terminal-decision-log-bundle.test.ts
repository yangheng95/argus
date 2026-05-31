import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { findRun, findTask } from "../../src/engine/store"
import { updateTask } from "../../src/engine/state"
import { createDecisionLog } from "../../src/decision-log"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"

// codex Q-TERM: the complete decision-log projection must be (re)materialized
// at the single terminal seam (engine/state.ts finalizeLiveRunForTerminalTask)
// for every terminal intent — INCLUDING a replayed update that re-enters a
// row already terminal (the updateTask no-op guard branch). The terminal
// write is best-effort: a failure must NOT cascade-break task termination
// (deliberate refinement of codex D5, artifact §11).

afterEach(async () => {
  await resetDatabase()
})

function seedRunningTaskRun(input?: { taskCompleted?: number }) {
  const now = Date.now()
  const taskID = `task_term_dl_${now}_${Math.random().toString(36).slice(2)}`
  const runID = `run_term_dl_${now}_${Math.random().toString(36).slice(2)}`
  const projectID = `project_term_dl_${now}_${Math.random().toString(36).slice(2)}`
  Database.transaction((db) => {
    db.insert(ProjectTable).values({
      id: projectID, worktree: process.cwd(), name: "terminal dl test",
      sandboxes: "[]", time_created: now, time_updated: now,
    }).run()
    db.insert(EngineTaskTable).values({
      id: taskID, project_id: projectID, source: "test",
      title: "terminal decision-log materialization",
      request: "materialize complete decision log at terminal",
      priority: "normal", time_started: now,
      time_completed: input?.taskCompleted ?? null,
      time_created: now, time_updated: now,
    }).run()
    db.insert(EngineArtifactTable).values({
      id: runID, task_id: taskID, run_id: runID, kind: "run", label: "run-running",
      payload: {
        plan_version_id: null, session_id: null, executor: "opencorvus",
        status: "running", phase: "deliver", blocking_reason: null, error: null,
        retry_count: 0, executor_ref: null, metadata: null,
        time_started: now, time_completed: null,
      },
      time_created: now, time_updated: now,
    }).run()
  })
  return { taskID, runID, now }
}

describe("terminal seam materializes the complete decision-log bundle", () => {
  test("completed task writes task-scoped runtime decision-log.md", async () => {
    const { taskID, runID, now } = seedRunningTaskRun()
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        createDecisionLog(taskID).append({
          phase: "requirements", key: "runtime", value: "Bun", reason: "template pins Bun",
        })
        await updateTask(findTask(taskID)!, { status: "completed", time_completed: now + 10 }, "done")
      },
    })
    // Run still finalized (terminal write did not disturb core state).
    expect(findRun(runID)?.status).toBe("completed")
    const doc = await fs.readFile(ProjectRuntimePaths.decisionLogPaths(tmp.path, taskID).absolute, "utf8")
    expect(doc).toContain("### runtime")
    expect(doc).toContain("_Why: template pins Bun_")
  })

  test("REPLAYED terminal update on an already-terminal row re-materializes (no-op guard branch)", async () => {
    const completed = Date.now() - 500
    const { taskID } = seedRunningTaskRun({ taskCompleted: completed })
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const log = createDecisionLog(taskID)
        log.append({ phase: "delivery", key: "first", value: "v1", reason: "r1" })
        await updateTask(findTask(taskID)!, { status: "completed", time_completed: completed }, "done")

        // A LATER decision lands, then the SAME terminal write replays (row is
        // already terminal → updateTask no-op guard). The on-disk projection
        // must still refresh to include the new decision (codex Q-TERM).
        log.append({ phase: "agent_error", key: "late", value: "v2", reason: "r2" })
        await updateTask(findTask(taskID)!, { status: "completed", time_completed: completed }, "done again")
      },
    })
    const doc = await fs.readFile(ProjectRuntimePaths.decisionLogPaths(tmp.path, taskID).absolute, "utf8")
    expect(doc).toContain("### first")
    expect(doc).toContain("### late") // proves the replay re-materialized
  })

  test("terminal bundle write failure does NOT cascade-break task termination", async () => {
    const { taskID, runID, now } = seedRunningTaskRun()
    await using tmp = await tmpdir()
    // Plant a FILE where `.opencorvus/` must be created → fs.mkdir throws.
    await fs.writeFile(path.join(tmp.path, ".opencorvus"), "blocker", "utf8")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        createDecisionLog(taskID).append({ phase: "requirements", key: "k", value: "v", reason: "r" })
        // Must NOT throw — best-effort + loud (refinement of codex D5).
        await updateTask(findTask(taskID)!, { status: "failed", error: "boom", time_completed: now + 5 }, "failed")
      },
    })
    // Core terminal state + run finalization unaffected by the audit-write failure.
    const run = findRun(runID)
    expect(run?.status).toBe("failed")
    expect(run?.error).toBe("boom")
  })
})
