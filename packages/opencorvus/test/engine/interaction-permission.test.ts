import { afterEach, describe, expect, test } from "bun:test"
import { EngineArtifactTable, EngineInteractionRequestTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { EngineInteraction } from "../../src/engine/interaction"
import { EngineService } from "@/task-api"
import { Identifier } from "../../src/id/id"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("engine permission interactions", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("surfaces permission requests from child build sessions on the task board", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        EngineInteraction.subscribe({
          async updateTask(row) {
            return row
          },
          async updateRun(row) {
            return row
          },
        })

        const root = await Session.create({ kind: "root", title: "task root" })
        const orchestrator = await Session.create({ kind: "orchestrator", parentID: root.id, title: "orchestrator" })
        const build = await Session.create({ kind: "build", parentID: orchestrator.id, title: "build" })
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const permissionID = Identifier.ascending("permission")
        const now = Date.now()

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "permission interaction",
              request: "permission interaction",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )
        Database.use((db) =>
          db
            .insert(EngineArtifactTable)
            .values({
              id: runID,
              task_id: taskID,
              run_id: runID,
              kind: "run",
              label: "run-running",
              payload: {
                plan_version_id: null,
                session_id: root.id,
                executor: "opencorvus",
                status: "running",
                phase: "execute",
                blocking_reason: null,
                error: null,
                retry_count: 0,
                executor_ref: null,
                metadata: null,
                time_started: now,
                time_completed: null,
              },
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        const ask = PermissionNext.ask({
          id: permissionID,
          sessionID: build.id,
          permission: "external_directory",
          patterns: ["C:\\outside"],
          metadata: {},
          always: ["C:\\outside"],
          ruleset: [{ permission: "external_directory", pattern: "*", action: "ask" }],
        })

        let interaction: typeof EngineInteractionRequestTable.$inferSelect | undefined
        for (let i = 0; i < 50; i += 1) {
          interaction = Database.use((db) =>
            db
              .select()
              .from(EngineInteractionRequestTable)
              .where(eq(EngineInteractionRequestTable.external_id, permissionID))
              .get(),
          )
          if (interaction) break
          await Bun.sleep(20)
        }

        expect(interaction).toMatchObject({
          task_id: taskID,
          run_id: runID,
          session_id: build.id,
          external_id: permissionID,
          request_type: "permission",
          status: "pending",
        })

        await EngineService.replyInteraction(interaction!.id, {
          reply: "once",
          autoReply: false,
        })
        await expect(ask).resolves.toBeUndefined()

        const resolved = Database.use((db) =>
          db
            .select()
            .from(EngineInteractionRequestTable)
            .where(eq(EngineInteractionRequestTable.id, interaction!.id))
            .get(),
        )
        expect(resolved?.status).toBe("answered")

        const rejectedPermissionID = Identifier.ascending("permission")
        const rejectedAsk = PermissionNext.ask({
          id: rejectedPermissionID,
          sessionID: build.id,
          permission: "external_directory",
          patterns: ["C:\\blocked"],
          metadata: {},
          always: ["C:\\blocked"],
          ruleset: [{ permission: "external_directory", pattern: "*", action: "ask" }],
        })

        let rejectedInteraction: typeof EngineInteractionRequestTable.$inferSelect | undefined
        for (let i = 0; i < 50; i += 1) {
          rejectedInteraction = Database.use((db) =>
            db
              .select()
              .from(EngineInteractionRequestTable)
              .where(eq(EngineInteractionRequestTable.external_id, rejectedPermissionID))
              .get(),
          )
          if (rejectedInteraction) break
          await Bun.sleep(20)
        }

        await EngineService.rejectInteraction(rejectedInteraction!.id, {
          autoReply: false,
        })
        await expect(rejectedAsk).rejects.toBeInstanceOf(PermissionNext.RejectedError)

        const rejected = Database.use((db) =>
          db
            .select()
            .from(EngineInteractionRequestTable)
            .where(eq(EngineInteractionRequestTable.id, rejectedInteraction!.id))
            .get(),
        )
        expect(rejected?.status).toBe("rejected")
      },
    })
  })
})
