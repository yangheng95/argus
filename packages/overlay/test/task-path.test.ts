import { describe, expect, test } from "bun:test"

import { taskScopedPath } from "../src/services/task-path"

describe("taskScopedPath", () => {
  test("uses the bare task route when no directory is provided", () => {
    expect(taskScopedPath("task-abc-123")).toBe("task/task-abc-123")
    expect(taskScopedPath("task-abc-123", "", "/cancel")).toBe("task/task-abc-123/cancel")
  })

  test("adds the task directory for cross-project routes", () => {
    expect(taskScopedPath("task-abc-123", "C:/Local/Temp", "/cancel")).toBe(
      "task/task-abc-123/cancel?directory=C%3A%2FLocal%2FTemp",
    )
  })

  test("encodes both the task id and the directory", () => {
    expect(taskScopedPath("task/with spaces", "C:/Users/example/my temp/project", "/replan")).toBe(
      "task/task%2Fwith%20spaces/replan?directory=C%3A%2FUsers%2Fexample%2Fmy+temp%2Fproject",
    )
  })
})
