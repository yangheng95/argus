import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import * as Queue from "../../src/engine/queue"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("task message routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("POST /task/:taskID/message triggers scheduler with natural language", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()

        // audit-2026-04-29 W2-V35 — handleTaskMessage was changed
        // to REJECT messages on failed/cancelled tasks (see
        // task-api/index.ts:1239: "audit Q1 finding"). Pre-fix
        // the test seeded a failed row (time_completed + error
        // both set) and expected the message to be recorded as a
        // note that triggers scheduler — that contract no longer
        // applies. Seed an ACTIVE task instead so the
        // scheduler-trigger contract under test still fires.
        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "panel",
            title: "retry through message",
            request: "retry through message",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          }).run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "把当前任务停下来，重新评估策略后继续。",
            source: "panel",
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { kind: string; message: string; should_resume: boolean }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body.kind).toBe("note")
        expect(body.message).toBe("Operator note recorded. Scheduler notified.")
        expect(body.should_resume).toBe(true)
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
        // V35: dispatchTaskLoop trigger schema changed from
        //   trigger: { kind, message, attachmentSummary }
        // to
        //   event: { note, operatorMessage: { text, attachmentSummary } }
        // Reflect the new shape.
        expect(dispatchTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          event: {
            note: "把当前任务停下来，重新评估策略后继续。",
            operatorMessage: {
              text: "把当前任务停下来，重新评估策略后继续。",
              attachmentSummary: undefined,
            },
          },
          interrupt: true,
        })

        // V35: row state is no longer "failed" (we seeded an active
        // task) — assertion on "row stays failed" is dropped.
        const row = Database.use((db) =>
          db.select({
            time_completed: EngineTaskTable.time_completed,
            error: EngineTaskTable.error,
          }).from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(row?.error).toBeNull()
      },
    })
  })

  test("POST /task/:taskID/message forwards attachment summary to scheduler", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "panel",
            title: "attachment message",
            request: "attachment message",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          }).run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "参考我刚上传的规格，再决定下一步。",
            source: "panel",
            attachments: [{
              mime: "text/plain",
              filename: "spec.txt",
              data: Buffer.from("hello spec").toString("base64"),
            }],
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { kind: string; message: string; should_resume: boolean }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body.kind).toBe("note")
        expect(body.message).toBe("Operator note recorded. Scheduler notified.")
        expect(body.should_resume).toBe(true)
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
        // V35: trigger schema replaced with `event.operatorMessage`.
        const event = (dispatchTaskLoop.mock.calls[0]?.[0] as {
          event: {
            note?: string
            operatorMessage: {
              text: string
              attachmentSummary?: string
            }
          }
        })?.event
        expect(event.operatorMessage.text).toBe("参考我刚上传的规格，再决定下一步。")
        expect(event.operatorMessage.attachmentSummary).toContain("Attachments:")
        expect(event.operatorMessage.attachmentSummary).toContain("spec.txt")
        expect(event.operatorMessage.attachmentSummary).toContain("text/plain")
        expect((dispatchTaskLoop.mock.calls[0]?.[0] as { interrupt?: boolean }).interrupt).toBe(true)
      },
    })
  })
})