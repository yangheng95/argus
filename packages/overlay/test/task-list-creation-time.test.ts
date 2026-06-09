import { beforeEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  boardStore,
  setBoardStore,
  setPendingTasks,
  setTasksData,
  sortedTasks,
  taskCreatedAt,
  taskByID,
  visibleTasks,
} from "../src/store/board"

const TASK_LIST_SOURCE = readFileSync(join(import.meta.dir, "../src/components/TaskList.tsx"), "utf8")

function taskItem(id: string, created: number, updated: number, status = "active"): any {
  return {
    updated_at: updated,
    task: {
      id,
      requestID: id,
      title: id,
      status,
      directory: "C:/repo",
      time: {
        created,
        started: created + 100,
        updated,
        completed: ["completed", "failed", "cancelled"].includes(status) ? updated : undefined,
      },
    },
  }
}

beforeEach(() => {
  setBoardStore("tasks", [])
  setBoardStore("pendingTasks", [])
})

test("task list utilities order only by task creation time", () => {
  const olderCancelled = taskItem("older-cancelled", 1_000, 9_000, "cancelled")
  const newerActive = taskItem("newer-active", 2_000, 3_000, "active")

  expect(taskCreatedAt(olderCancelled)).toBe(1_000)
  expect(sortedTasks({ tasks: [olderCancelled, newerActive] }).map((item) => item.task.id)).toEqual([
    "newer-active",
    "older-cancelled",
  ])
})

test("visibleTasks keeps pending and terminal rows sorted by creation time", () => {
  const olderFailed = taskItem("older-failed", 1_000, 20_000, "failed")
  const active = taskItem("active", 2_000, 4_000, "active")
  const pending = {
    _pending: true,
    requestID: "pending",
    task: {
      id: "pending",
      requestID: "pending",
      title: "pending",
      status: "queued",
      directory: "C:/repo",
      time: { created: 3_000 },
    },
  }

  setTasksData([olderFailed, active])
  setPendingTasks([pending])

  expect(visibleTasks().map((item) => item.task.id)).toEqual(["pending", "active", "older-failed"])
})

test("visibleTasks is the shared memoized task projection", () => {
  const active = taskItem("active", 2_000, 4_000, "active")
  const olderFailed = taskItem("older-failed", 1_000, 20_000, "failed")

  setTasksData([olderFailed, active])

  const first = visibleTasks()
  expect(visibleTasks()).toBe(first)
  expect(taskByID("active")).toBe(first[0])
})

test("task list refresh preserves unchanged row references", () => {
  const active = taskItem("active", 2_000, 4_000, "active")
  const completed = taskItem("completed", 1_000, 5_000, "completed")

  setTasksData([active, completed])
  const firstArray = boardStore.tasks
  const firstActive = boardStore.tasks[0]
  const firstCompleted = boardStore.tasks[1]

  setTasksData([taskItem("active", 2_000, 4_000, "active"), taskItem("completed", 1_000, 5_000, "completed")])

  expect(boardStore.tasks).toBe(firstArray)
  expect(boardStore.tasks[0]).toBe(firstActive)
  expect(boardStore.tasks[1]).toBe(firstCompleted)

  setTasksData([taskItem("active", 2_000, 4_000, "active"), taskItem("completed", 1_000, 6_000, "failed")])

  expect(boardStore.tasks).not.toBe(firstArray)
  expect(boardStore.tasks[0]).toBe(firstActive)
  expect(boardStore.tasks[1]).not.toBe(firstCompleted)
})

test("TaskList has no lifecycle timestamp or status-priority sort path", () => {
  expect(TASK_LIST_SOURCE).toContain("taskCreatedAt")
  expect(TASK_LIST_SOURCE).toContain("items: sortTaskItemsByCreated(group.items)")
  expect(TASK_LIST_SOURCE).toContain('class="project-group"')
  expect(TASK_LIST_SOURCE).toContain("COMPACT_GROUP_VISIBLE_LIMIT")
  expect(TASK_LIST_SOURCE).toContain("visibleGroupItems")
  expect(TASK_LIST_SOURCE).toContain("expandDirectoryGroup(group.directory)")
  expect(TASK_LIST_SOURCE).not.toContain("COMPLETED_STATUSES")
  expect(TASK_LIST_SOURCE).not.toContain('t("task.group.recent")')
  expect(TASK_LIST_SOURCE).not.toContain('t("task.group.active")')
  expect(TASK_LIST_SOURCE).not.toContain("taskUpdated")
  expect(TASK_LIST_SOURCE).not.toContain("queueOrder")
  expect(TASK_LIST_SOURCE).not.toContain("TASK_STATUS_PRIORITY")
  expect(TASK_LIST_SOURCE).not.toContain("time?.updated")
  expect(TASK_LIST_SOURCE).not.toContain("updated_at")
  expect(TASK_LIST_SOURCE).not.toContain("a.directory === activeDir")
  expect(TASK_LIST_SOURCE).not.toContain("b.directory === activeDir")
  expect(TASK_LIST_SOURCE).not.toContain("data-active-project")
})
