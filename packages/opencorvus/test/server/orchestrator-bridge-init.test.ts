import { afterEach, describe, expect, test } from "bun:test"
import { EngineInteractionRequestTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Instance } from "../../src/project/instance"
import { Question } from "../../src/question"
import { EngineRoutes } from "../../src/server/routes/orchestrator"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("orchestrator message bridge init", () => {
  afterEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("route middleware does not require an instance context before parameter validation", async () => {
    expect(Instance.current()).toBeUndefined()

    const response = await EngineRoutes().request("/task/not-a-task/progress")

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      data: { taskID: "not-a-task" },
      success: false,
    })
  })

  test("route middleware still runs inside a project instance context", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await EngineRoutes().request("/task/not-a-task/progress")

        expect(response.status).toBe(400)
        expect(await response.json()).toMatchObject({
          data: { taskID: "not-a-task" },
          success: false,
        })
      },
    })
  })

  test("late project bootstrap installs the task question interaction bridge", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        expect(Instance.directory).toBe(tmp.path)
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const root = await Session.create({ kind: "root", title: "task root" })
        const orchestrator = await Session.create({
          kind: "orchestrator",
          parentID: root.id,
          title: "orchestrator",
        })
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "question interaction",
              request: "question interaction",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const ask = Question.ask({
          sessionID: orchestrator.id,
          timeoutMs: 1000,
          questions: [{ header: "question", question: "Need user input?", options: [], custom: true }],
        })

        let interaction: typeof EngineInteractionRequestTable.$inferSelect | undefined
        for (let i = 0; i < 50; i += 1) {
          interaction = Database.use((db) =>
            db
              .select()
              .from(EngineInteractionRequestTable)
              .where(eq(EngineInteractionRequestTable.session_id, orchestrator.id))
              .get(),
          )
          if (interaction) break
          await Bun.sleep(20)
        }

        expect(interaction).toMatchObject({
          task_id: taskID,
          session_id: orchestrator.id,
          request_type: "question",
          status: "pending",
        })

        await Question.reject(interaction!.external_id)
        await ask.catch(() => undefined)
      },
    })
  })
})
