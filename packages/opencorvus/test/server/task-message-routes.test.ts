import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Orchestrator } from "../../src/orchestrator/agent"
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
        const processTask = spyOn(Orchestrator, "processTask").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "panel",
            title: "retry through message",
            request: "retry through message",
            status: "failed",
            priority: "normal",
            error: "initial failure",
            time_created: now,
            time_updated: now,
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
        expect(body.kind).toBe("note")
        expect(body.message).toBe("Operator note recorded. Scheduler notified.")
        expect(body.should_resume).toBe(true)
        expect(processTask).toHaveBeenCalledWith(taskID, {
          kind: "operator_message",
          message: "把当前任务停下来，重新评估策略后继续。",
          attachmentSummary: undefined,
        })

        const row = Database.use((db) =>
          db.select({ status: EngineTaskTable.status }).from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(row?.status).toBe("failed")
      },
    })
  })

  test("POST /task/:taskID/message forwards attachment summary to scheduler", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const processTask = spyOn(Orchestrator, "processTask").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "panel",
            title: "attachment message",
            request: "attachment message",
            status: "active",
            priority: "normal",
            time_created: now,
            time_updated: now,
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
        expect(body.kind).toBe("note")
        expect(body.message).toBe("Operator note recorded. Scheduler notified.")
        expect(body.should_resume).toBe(true)
        expect(processTask).toHaveBeenCalledTimes(1)
        const trigger = processTask.mock.calls[0]?.[1] as {
          kind: string
          message: string
          attachmentSummary?: string
        }
        expect(trigger.kind).toBe("operator_message")
        expect(trigger.message).toBe("参考我刚上传的规格，再决定下一步。")
        expect(trigger.attachmentSummary).toContain("Attachments:")
        expect(trigger.attachmentSummary).toContain("spec.txt")
        expect(trigger.attachmentSummary).toContain("text/plain")
      },
    })
  })
})