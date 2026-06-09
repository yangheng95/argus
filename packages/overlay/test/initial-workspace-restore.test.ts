import { expect, test } from "bun:test"
import { initialRestoreTaskID } from "../src/services/init"

test("initial workspace restore keeps an existing saved task selection", () => {
  const selected = initialRestoreTaskID(
    [{ task: { id: "tsk_active", status: "active" } }, { task: { id: "tsk_saved", status: "completed" } }],
    "tsk_saved",
  )

  expect(selected).toBe("tsk_saved")
})

test("initial workspace restore selects the newest running task when no saved task exists", () => {
  const selected = initialRestoreTaskID(
    [
      { task: { id: "tsk_done", status: "completed" } },
      { task: { id: "tsk_running", status: "active" } },
      { task: { id: "tsk_waiting", status: "queued" } },
    ],
    "",
  )

  expect(selected).toBe("tsk_running")
})

test("initial workspace restore leaves cold start unselected when only terminal tasks exist", () => {
  const selected = initialRestoreTaskID(
    [{ task: { id: "tsk_done", status: "completed" } }, { task: { id: "tsk_failed", status: "failed" } }],
    "",
  )

  expect(selected).toBe("")
})

test("initial workspace restore does not auto-select running tasks from a stale directory list", () => {
  const selected = initialRestoreTaskID([{ task: { id: "tsk_other_dir", status: "active" } }], "", {
    selectRunningWhenUnmatched: false,
  })

  expect(selected).toBe("")
})
