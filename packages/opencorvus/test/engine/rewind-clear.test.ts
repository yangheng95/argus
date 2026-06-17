import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { clearRewindCursor, rewindTask } from "../../src/engine/rewind"
import { findTask } from "../../src/engine/store"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { createRewindScenario } from "./rewind-fixture"

async function exists(path: string): Promise<boolean> {
  return fs
    .access(path)
    .then(() => true)
    .catch(() => false)
}

afterEach(async () => {
  await resetDatabase()
})

describe("task rewind clear", () => {
  test("clear after view-only rewind removes cursor", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const scenario = await createRewindScenario(tmp.path)
        await rewindTask({
          taskID: scenario.taskID,
          anchor: {
            kind: "cursorTime",
            cursorTime: scenario.cursorAfterSecondStep,
          },
          resetWorktree: false,
          reason: "test clear view",
        })

        expect(findTask(scenario.taskID)?.rewind_cursor_time).toBe(scenario.cursorAfterSecondStep)
        await clearRewindCursor(scenario.taskID)
        expect(findTask(scenario.taskID)?.rewind_cursor_time).toBeNull()
      },
    })
  })

  test("clear after worktree rewind does not restore files", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const scenario = await createRewindScenario(tmp.path)
        await rewindTask({
          taskID: scenario.taskID,
          anchor: {
            kind: "cursorTime",
            cursorTime: scenario.cursorAfterSecondStep,
          },
          resetWorktree: true,
          reason: "test clear files",
        })

        expect(await fs.readFile(scenario.existingGoalFile, "utf-8")).toBe("goal-before-base")
        expect(await exists(path.join(scenario.existingGoalWorktree, "goal-after.txt"))).toBe(false)
        expect(await exists(scenario.postCursorGoalWorktree)).toBe(false)
        await clearRewindCursor(scenario.taskID)
        expect(findTask(scenario.taskID)?.rewind_cursor_time).toBeNull()
        expect(await fs.readFile(scenario.existingGoalFile, "utf-8")).toBe("goal-before-base")
        expect(await exists(path.join(scenario.existingGoalWorktree, "goal-after.txt"))).toBe(false)
        expect(await exists(scenario.postCursorGoalWorktree)).toBe(false)
      },
    })
  })
})
