import { afterEach, describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

async function seedQueuedTasks(directory: string) {
  return Instance.provide({
    directory,
    fn: async () => {
      const now = Date.now()
      const firstID = Identifier.ascending("task")
      const secondID = Identifier.ascending("task")
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values([
            {
              id: firstID,
              project_id: Instance.project.id,
              source: "test",
              title: "first queued task",
              request: "first queued task",
              priority: "normal",
              queue_order: 0,
              time_created: now,
              time_updated: now,
            },
            {
              id: secondID,
              project_id: Instance.project.id,
              source: "test",
              title: "second queued task",
              request: "second queued task",
              priority: "normal",
              queue_order: 1,
              time_created: now + 1,
              time_updated: now + 1,
            },
          ])
          .run(),
      )
      return { firstID, secondID }
    },
  })
}

function queueOrder(taskID: string) {
  return Database.use((db) =>
    db.select({ queueOrder: EngineTaskTable.queue_order }).from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
  )?.queueOrder
}

describe("task queue routes", () => {
  afterEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("PATCH /task-queue/reorder rejects body directory from another active project", async () => {
    await using projectA = await tmpdir({ git: true })
    await using projectB = await tmpdir({ git: true })
    const app = Server.App()
    const projectBQueue = await seedQueuedTasks(projectB.path)

    const rejected = await app.request("/task-queue/reorder", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": projectA.path,
      },
      body: JSON.stringify({
        directory: projectB.path,
        orderedTaskIDs: [projectBQueue.secondID, projectBQueue.firstID],
      }),
    })

    expect(rejected.status).toBe(422)
    expect(queueOrder(projectBQueue.firstID)).toBe(0)
    expect(queueOrder(projectBQueue.secondID)).toBe(1)

    const accepted = await app.request("/task-queue/reorder", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": projectB.path,
      },
      body: JSON.stringify({
        directory: projectB.path,
        orderedTaskIDs: [projectBQueue.secondID, projectBQueue.firstID],
      }),
    })

    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toMatchObject({
      directory: projectB.path,
      queuedTaskIDs: [projectBQueue.secondID, projectBQueue.firstID],
    })
    expect(queueOrder(projectBQueue.secondID)).toBe(0)
    expect(queueOrder(projectBQueue.firstID)).toBe(1)
  })
})
