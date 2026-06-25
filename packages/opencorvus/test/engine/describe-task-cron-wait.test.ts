import { afterEach, describe, expect, test } from "bun:test"
import { describeTask, renderTaskDescription } from "../../src/engine/describe"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { CronService } from "../../src/scheduler/cron-service"
import { CronJobTable } from "../../src/scheduler/cron.sql"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
  await Instance.disposeAll()
})

describe("engine describe task cron waits", () => {
  test("renders pending task cron waits as task evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = "tsk_describe_cron_wait_" + Math.random().toString(36).slice(2)
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "Describe task cron wait",
              request: "Wait for an external DNS propagation event",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            } as any)
            .run(),
        )

        const scheduled = CronService.createTaskWake({
          name: "task wait",
          reason: "external DNS propagation",
          projectId: Instance.project.id,
          taskId: taskID,
          durationMs: 20 * 60 * 1000,
        })
        const row = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, scheduled.id)).get())
        expect(row?.task_id).toBe(taskID)

        const desc = await describeTask(taskID)
        expect(desc.task_cron_waits).toHaveLength(1)
        expect(desc.task_cron_waits?.[0]).toMatchObject({
          job_id: scheduled.id,
          reason: "external DNS propagation",
          enabled: true,
          one_shot: true,
        })

        const markdown = renderTaskDescription(desc)
        expect(markdown).toContain("## Scheduled task waits (1)")
        expect(markdown).toContain("pending")
        expect(markdown).toContain("external DNS propagation")
        expect(markdown).toContain("Do not use `wait` to poll live builds")
      },
    })
  })
})
