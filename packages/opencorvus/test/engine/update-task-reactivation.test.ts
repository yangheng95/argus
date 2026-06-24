import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { findTask } from "../../src/engine/store"
import { updateTask } from "../../src/engine/state"
import { deriveTaskStatus } from "../../src/engine/task-status"
import { resetDatabase } from "../fixture/db"

/**
 * A reactivation path such as retry_task or manual un-fail calls
 * `updateTask({ status: "active", error: null })` against a
 * task whose terminal state was previously stamped via `fail_task` or
 * `cancelTask`. Without explicit `time_completed: null`, the row keeps the
 * old terminal timestamp, and `deriveTaskStatus` (single source per
 * task-status.ts) reads `time_completed != null` and reports the task as
 * `completed` / `failed` even while the orchestrator is happily running
 * subsequent stages on it.
 *
 * Real incident — 2026-05-07 tsk_e0265e83b001R63v1bqRw1lFjm:
 *   12:59:42  fail_task → time_completed stamped, error set
 *   12:59:48  manual reactivation -> cleared error only
 *   13:05:17  Requirements parsed (still status=completed)
 *   13:15:24  Goals decomposed by Architect (still status=completed)
 *   13:20:27  ... (still status=completed; user reports stuck task)
 *
 * Pin: every reactivation through `updateTask({status: "active"})` must
 * leave the task in derived `active` (or `queued` if time_started never set).
 * Symmetric with the `queued` case which already clears both timestamps.
 */
describe("updateTask({ status: 'active' }) — reactivation invariant", () => {
  let projectID = ""
  let taskID = ""

  beforeEach(async () => {
    await resetDatabase()
    const stamp = Date.now().toString(16)
    projectID = `project_react_${stamp}`
    taskID = `tsk_react_${stamp}`
    const now = Date.now()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Reactivation Test",
          sandboxes: "[]",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Reactivation task",
          request: "Verify status='active' clears time_completed",
          priority: "normal",
          time_created: now,
          time_updated: now,
        })
        .run()
    })
  })

  afterEach(async () => {
    await resetDatabase()
  })

  test("reactivating a failed task clears time_completed (derived status flips back to active)", async () => {
    const failNow = Date.now() - 60_000
    Database.use((db) =>
      db
        .update(EngineTaskTable)
        .set({
          time_started: failNow - 120_000,
          time_completed: failNow,
          error: "fail_task: architect fidelity blocked",
          time_updated: failNow,
        })
        .where(eq(EngineTaskTable.id, taskID))
        .run(),
    )
    const failed = findTask(taskID)
    expect(failed).toBeDefined()
    expect(deriveTaskStatus(failed!)).toBe("failed")

    await updateTask(failed!, { status: "active", error: null }, "manual reactivation")

    const reactivated = findTask(taskID)
    expect(reactivated).toBeDefined()
    expect(reactivated!.time_completed).toBe(null)
    expect(reactivated!.error).toBe(null)
    expect(deriveTaskStatus(reactivated!)).toBe("active")
  })

  test("reactivating a completed task (no error) also clears time_completed", async () => {
    const completeNow = Date.now() - 30_000
    Database.use((db) =>
      db
        .update(EngineTaskTable)
        .set({
          time_started: completeNow - 120_000,
          time_completed: completeNow,
          error: null,
          time_updated: completeNow,
        })
        .where(eq(EngineTaskTable.id, taskID))
        .run(),
    )
    const completed = findTask(taskID)
    expect(deriveTaskStatus(completed!)).toBe("completed")

    await updateTask(completed!, { status: "active" }, "operator reactivated")

    const reactivated = findTask(taskID)
    expect(reactivated!.time_completed).toBe(null)
    expect(deriveTaskStatus(reactivated!)).toBe("active")
  })

  test("reactivating a still-running task is a no-op on time_completed (already null)", async () => {
    const startNow = Date.now() - 120_000
    Database.use((db) =>
      db
        .update(EngineTaskTable)
        .set({
          time_started: startNow,
          time_completed: null,
          error: null,
          time_updated: startNow,
        })
        .where(eq(EngineTaskTable.id, taskID))
        .run(),
    )
    const running = findTask(taskID)
    expect(deriveTaskStatus(running!)).toBe("active")

    await updateTask(running!, { status: "active" }, "redundant active update")

    const after = findTask(taskID)
    expect(after!.time_completed).toBe(null)
    expect(after!.time_started).toBe(startNow)
    expect(deriveTaskStatus(after!)).toBe("active")
  })

  test("explicit time_completed in the values payload still wins (caller override is honoured)", async () => {
    const failNow = Date.now() - 60_000
    Database.use((db) =>
      db
        .update(EngineTaskTable)
        .set({
          time_started: failNow - 120_000,
          time_completed: failNow,
          error: "prior failure",
          time_updated: failNow,
        })
        .where(eq(EngineTaskTable.id, taskID))
        .run(),
    )
    const explicitTimestamp = Date.now()
    const failed = findTask(taskID)
    await updateTask(
      failed!,
      { status: "active", error: null, time_completed: explicitTimestamp },
      "caller-provided time_completed must not be overwritten",
    )

    const after = findTask(taskID)
    expect(after!.time_completed).toBe(explicitTimestamp)
    // Derived status is still failed-shape (time_completed!=null + error==null
    // → completed) because the caller explicitly asked for that combination;
    // the auto-clear only fires when the caller did NOT pass time_completed.
    expect(deriveTaskStatus(after!)).toBe("completed")
  })
})
