import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EnginePlanVersionTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import * as TaskLoop from "../../src/orchestrator/loop"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { PanelTool } from "../../src/tool/panel"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await resetDatabase()
})

async function waitForMockCalls(mockFn: { mock: { calls: unknown[] } }, count: number) {
  for (let i = 0; i < 50; i++) {
    if (mockFn.mock.calls.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function seedFailedTaskWithActivePlan() {
  const now = Date.now()
  const taskID = Identifier.ascending("task")
  const planID = Identifier.ascending("plan")
  const root = await Session.create({ kind: "root", title: "panel replan task" })

  Database.use((db) => {
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: Instance.project.id,
        session_id: root.id,
        source: "test",
        title: "panel replan task",
        request: "panel replan task",
        priority: "normal",
        error: "stale panel plan failed",
        time_created: now,
        time_updated: now,
        time_started: now,
        time_completed: now,
      } as any)
      .run()
    db.insert(EnginePlanVersionTable)
      .values({
        id: planID,
        task_id: taskID,
        version: 1,
        status: "active",
        summary: "stale panel plan",
        prompt: "old panel plan",
        time_created: now,
        time_updated: now,
      })
      .run()
  })

  return taskID
}

describe("panel replan action", () => {
  test("replan_task wakes the orchestrator with replan intent", async () => {
    await using tmp = await tmpdir({ git: true })
    const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await seedFailedTaskWithActivePlan()
        const tool = await PanelTool.init()
        const result = await tool.execute(
          { action: "replan_task", taskID },
          {
            sessionID: Identifier.ascending("session"),
            messageID: Identifier.ascending("message"),
            agent: "panel-test",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
            extra: { surface: "panel" },
          },
        )

        expect(result.title).toBe("Replan queued")
        expect(JSON.parse(result.output)).toMatchObject({
          kind: "message",
          task_id: taskID,
          message: "Replan queued.",
        })
        await waitForMockCalls(runTaskLoop, 1)
        const note = (runTaskLoop.mock.calls[0]?.[0] as { event?: { note?: string } } | undefined)?.event?.note
        expect(note).toContain("User requested replan")
        expect(note).not.toContain("User requested retry")
      },
    })
  }, 15_000)
})
