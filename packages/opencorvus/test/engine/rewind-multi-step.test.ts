import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { rewindTask } from "../../src/engine/rewind"
import { updateGoalRun } from "../../src/engine/persist"
import { findGoalRun, findTask } from "../../src/engine/store"
import { Instance } from "../../src/project/instance"
import { ProtocolStore } from "../../src/protocol/store"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { createRewindScenario } from "./rewind-fixture"

async function exists(path: string): Promise<boolean> {
  return fs
    .access(path)
    .then(() => true)
    .catch(() => false)
}

function latestTaskRewoundEvent(taskID: string) {
  return ProtocolStore.listTaskEvents(taskID)
    .filter((event) => event.type === "task.rewound")
    .at(-1)
}

afterEach(async () => {
  await resetDatabase()
})

describe("task rewind unified entrypoint", () => {
  test("message anchor with resetWorktree=true rewinds files and writes cursor", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const scenario = await createRewindScenario(tmp.path)
        const target = scenario.steps[2]!
        const result = await rewindTask({
          taskID: scenario.taskID,
          anchor: {
            kind: "message",
            sessionID: scenario.sessionID,
            messageID: target.userMessageID,
          },
          resetWorktree: true,
          reason: "test message reset",
        })

        expect(result.resetWorktree).toBe(true)
        expect(result.anchorKind).toBe("message")
        expect(await fs.readFile(scenario.primaryFile, "utf-8")).toBe("primary-current")
        expect(await fs.readFile(scenario.existingGoalFile, "utf-8")).toBe("goal-before-base")
        expect(await exists(path.join(scenario.existingGoalWorktree, "goal-after.txt"))).toBe(false)
        expect(await exists(scenario.postCursorGoalWorktree)).toBe(false)
        expect(findTask(scenario.taskID)?.rewind_cursor_time).toBe(result.cursorTime)
        const event = latestTaskRewoundEvent(scenario.taskID)
        expect(event?.type).toBe("task.rewound")
        expect(event?.payload).toMatchObject({ resetWorktree: true, anchorKind: "message" })
      },
    })
  })

  test("message anchor with resetWorktree=false only writes cursor", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const scenario = await createRewindScenario(tmp.path)
        const target = scenario.steps[2]!
        const result = await rewindTask({
          taskID: scenario.taskID,
          anchor: {
            kind: "message",
            sessionID: scenario.sessionID,
            messageID: target.userMessageID,
          },
          resetWorktree: false,
          reason: "test message view",
        })

        expect(result.resetWorktree).toBe(false)
        expect(await fs.readFile(scenario.primaryFile, "utf-8")).toBe("primary-current")
        expect(await fs.readFile(scenario.existingGoalFile, "utf-8")).toBe("goal-before-mutated")
        expect(await exists(scenario.postCursorGoalWorktree)).toBe(true)
        expect(findTask(scenario.taskID)?.rewind_cursor_time).toBe(result.cursorTime)
      },
    })
  })

  test("cursorTime anchor with resetWorktree=true rewinds files and writes cursor", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const scenario = await createRewindScenario(tmp.path)
        const result = await rewindTask({
          taskID: scenario.taskID,
          anchor: {
            kind: "cursorTime",
            cursorTime: scenario.cursorAfterSecondStep,
            anchorEventID: "card-after-second-step",
          },
          resetWorktree: true,
          reason: "test cursor reset",
        })

        expect(result.resetWorktree).toBe(true)
        expect(result.anchorKind).toBe("cursorTime")
        expect(await fs.readFile(scenario.primaryFile, "utf-8")).toBe("primary-current")
        expect(await fs.readFile(scenario.existingGoalFile, "utf-8")).toBe("goal-before-base")
        expect(await exists(path.join(scenario.existingGoalWorktree, "goal-after.txt"))).toBe(false)
        expect(await exists(scenario.postCursorGoalWorktree)).toBe(false)
        expect(findTask(scenario.taskID)?.rewind_cursor_time).toBe(scenario.cursorAfterSecondStep)
      },
    })
  })

  test("resetWorktree prevalidates action data before file side effects and cursor persistence", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const scenario = await createRewindScenario(tmp.path)
        updateGoalRun(scenario.existingGoalRunID, {
          workspace_base_ref: null,
        })

        await expect(
          rewindTask({
            taskID: scenario.taskID,
            anchor: {
              kind: "cursorTime",
              cursorTime: scenario.cursorAfterSecondStep,
              anchorEventID: "card-after-second-step",
            },
            resetWorktree: true,
            reason: "test invalid reset action",
          }),
        ).rejects.toThrow(/workspace_base_ref/)

        expect(findTask(scenario.taskID)?.rewind_cursor_time).toBeNull()
        expect(await fs.readFile(scenario.existingGoalFile, "utf-8")).toBe("goal-before-mutated")
        expect(await exists(scenario.postCursorGoalWorktree)).toBe(true)
      },
    })
  })

  test("resetWorktree aborts affected live run even when its workspace is already absent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const scenario = await createRewindScenario(tmp.path)
        updateGoalRun(scenario.existingGoalRunID, {
          status: "running",
          workspace_dir: null,
          workspace_branch: null,
          workspace_base_ref: null,
        })

        await rewindTask({
          taskID: scenario.taskID,
          anchor: {
            kind: "cursorTime",
            cursorTime: scenario.cursorAfterSecondStep,
            anchorEventID: "card-after-second-step",
          },
          resetWorktree: true,
          reason: "test missing workspace projection",
        })

        expect(findTask(scenario.taskID)?.rewind_cursor_time).toBe(scenario.cursorAfterSecondStep)
        expect(findGoalRun(scenario.existingGoalRunID)?.status).toBe("aborted")
      },
    })
  })

  test("cursorTime anchor with resetWorktree=false only writes cursor", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const scenario = await createRewindScenario(tmp.path)
        const result = await rewindTask({
          taskID: scenario.taskID,
          anchor: {
            kind: "cursorTime",
            cursorTime: scenario.cursorAfterSecondStep,
            anchorEventID: "card-after-second-step",
          },
          resetWorktree: false,
          reason: "test cursor view",
        })

        expect(result.resetWorktree).toBe(false)
        expect(await fs.readFile(scenario.primaryFile, "utf-8")).toBe("primary-current")
        expect(await fs.readFile(scenario.existingGoalFile, "utf-8")).toBe("goal-before-mutated")
        expect(await exists(scenario.postCursorGoalWorktree)).toBe(true)
        expect(findTask(scenario.taskID)?.rewind_cursor_time).toBe(scenario.cursorAfterSecondStep)
      },
    })
  })

  test("task rewind implementation does not import Snapshot", async () => {
    const source = await fs.readFile(new URL("../../src/engine/rewind.ts", import.meta.url), "utf8")
    expect(source).not.toContain("@/snapshot")
    expect(source).not.toContain("Snapshot.")
  })
})
