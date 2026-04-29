import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import { rewindTask } from "../../src/engine/rewind"
import { findTask } from "../../src/engine/store"
import { Instance } from "../../src/project/instance"
import { ProtocolStore } from "../../src/protocol/store"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { createRewindScenario } from "./rewind-fixture"

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
        expect(await fs.readFile(scenario.filename, "utf-8")).toBe(target.expectedBeforeStep)
        expect(findTask(scenario.taskID)?.rewind_cursor_time).toBe(result.cursorTime)
        const event = ProtocolStore.listTaskEvents(scenario.taskID).at(-1)
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
        expect(await fs.readFile(scenario.filename, "utf-8")).toBe("S4")
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
        expect(await fs.readFile(scenario.filename, "utf-8")).toBe("S2")
        expect(findTask(scenario.taskID)?.rewind_cursor_time).toBe(scenario.cursorAfterSecondStep)
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
        expect(await fs.readFile(scenario.filename, "utf-8")).toBe("S4")
        expect(findTask(scenario.taskID)?.rewind_cursor_time).toBe(scenario.cursorAfterSecondStep)
      },
    })
  })
})
