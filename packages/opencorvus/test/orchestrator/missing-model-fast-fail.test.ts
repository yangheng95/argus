import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import path from "node:path"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { findTask } from "../../src/engine/store"
import { deriveTaskStatus } from "../../src/engine/task-status"
import { Identifier } from "../../src/id/id"
import { Orchestrator } from "../../src/orchestrator/agent"
import { Instance } from "../../src/project/instance"
import { ProtocolStore } from "../../src/protocol/store"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("Orchestrator missing-model fast-fail", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("marks task failed and emits task.updated in the first wake", async () => {
    await using tmp = await tmpdir({ config: { agent: {} } })
    const prevHome = process.env.OPENCORVUS_HOME
    const prevGlobalConfigDir = process.env.OPENCORVUS_GLOBAL_CONFIG_DIR
    process.env.OPENCORVUS_HOME = path.join(tmp.path, ".opencorvus-home")
    process.env.OPENCORVUS_GLOBAL_CONFIG_DIR = path.join(tmp.path, ".opencorvus-home", "config")

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const now = Date.now()
          const taskID = Identifier.ascending("task")
          const root = await Session.create({ kind: "root", title: "Missing model task" })
          const prompt = spyOn(SessionPrompt, "prompt").mockImplementation(async () => {
            throw new Error("SessionPrompt.prompt must not run without an orchestrator model")
          })

          Database.use((db) => {
            db.insert(EngineTaskTable)
              .values({
                id: taskID,
                project_id: Instance.project.id,
                session_id: root.id,
                source: "test",
                title: "Missing model task",
                request: "do work",
                kind: "workflow",
                priority: "normal",
                time_created: now,
                time_updated: now,
                time_started: now,
              })
              .run()
          })

          await Orchestrator.processTask(taskID)

          const task = findTask(taskID)
          expect(task).toBeDefined()
          expect(deriveTaskStatus(task!)).toBe("failed")
          expect(task!.time_completed).toBeNumber()
          expect(task!.error).toContain('No model configured for agent "orchestrator"')
          expect(prompt).not.toHaveBeenCalled()
          let events = ProtocolStore.listTaskEvents(taskID)
          for (let i = 0; i < 5 && events.every((event) => event.type !== "task.updated"); i++) {
            await new Promise((resolve) => setTimeout(resolve, 0))
            events = ProtocolStore.listTaskEvents(taskID)
          }
          expect(events).toContainEqual(
            expect.objectContaining({
              type: "task.updated",
              payload: expect.objectContaining({
                status: "failed",
                summary: expect.stringContaining('No model configured for agent "orchestrator"'),
              }),
            }),
          )
        },
      })
    } finally {
      if (prevHome === undefined) delete process.env.OPENCORVUS_HOME
      else process.env.OPENCORVUS_HOME = prevHome
      if (prevGlobalConfigDir === undefined) delete process.env.OPENCORVUS_GLOBAL_CONFIG_DIR
      else process.env.OPENCORVUS_GLOBAL_CONFIG_DIR = prevGlobalConfigDir
    }
  })
})
