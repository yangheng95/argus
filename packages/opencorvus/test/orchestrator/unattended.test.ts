import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Config } from "../../src/config/config"
import { Identifier } from "../../src/id/id"
import { OrchestratorInteractionRequestTable, OrchestratorRunTable, OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { OrchestratorRuntime } from "../../src/orchestrator/runtime"
import { hooks } from "../../src/orchestrator/state"
import { UNATTENDED_AUTO_REPLY, unattendedProject } from "../../src/orchestrator/unattended"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("orchestrator.unattended", () => {
  afterEach(async () => {
    mock.restore()
    delete process.env.OPENCORVUS_UNATTENDED
    delete process.env.OPENCORVUS_INTERACTION_TIMEOUT_MS
    await resetDatabase().catch(() => undefined)
  })

  test("defaults to unattended when no override is present", async () => {
    spyOn(Config, "get").mockResolvedValue({ experimental: {} } as never)

    expect(await unattendedProject()).toBe(true)
    expect(UNATTENDED_AUTO_REPLY).toContain("autonomously end-to-end")
  })

  test("allows config to opt out of unattended mode", async () => {
    spyOn(Config, "get").mockResolvedValue({ experimental: { unattended: false } } as never)

    expect(await unattendedProject()).toBe(false)
  })

  test("syncRun honors interaction timeout configured after module load", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const interactionID = Identifier.ascending("interaction")
        const requestID = Identifier.ascending("permission")
        process.env.OPENCORVUS_UNATTENDED = "1"
        process.env.OPENCORVUS_INTERACTION_TIMEOUT_MS = "0"
        spyOn(PermissionNext, "reply").mockResolvedValue(undefined)

        Database.transaction((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              title: "task",
              request: "request",
              status: "running",
              active_run_id: runID,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorRunTable)
            .values({
              id: runID,
              task_id: taskID,
              executor: "opencode",
              status: "running",
              phase: "dispatch",
              retry_count: 0,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorInteractionRequestTable)
            .values({
              id: interactionID,
              task_id: taskID,
              run_id: runID,
              external_id: requestID,
              request_type: "permission",
              status: "pending",
              title: "Need approval",
              body: "approve this step",
              payload: {},
              time_created: now - 5,
              time_updated: now - 5,
            })
            .run()
        })

        await OrchestratorRuntime.syncRun(runID, hooks())

        const interaction = Database.use((db) =>
          db.select().from(OrchestratorInteractionRequestTable).where(eq(OrchestratorInteractionRequestTable.id, interactionID)).get(),
        )

        expect(interaction?.status).toBe("rejected")
        expect(interaction?.response).toMatchObject({
          message: "Timed out waiting for operator response",
          timed_out: true,
        })
      },
    })
  })

  test("syncRun leaves pending interactions blocked when unattended is disabled", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const interactionID = Identifier.ascending("interaction")
        const requestID = Identifier.ascending("permission")
        process.env.OPENCORVUS_UNATTENDED = "0"
        process.env.OPENCORVUS_INTERACTION_TIMEOUT_MS = "0"
        const reply = spyOn(PermissionNext, "reply").mockResolvedValue(undefined)

        Database.transaction((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              title: "task",
              request: "request",
              status: "running",
              active_run_id: runID,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorRunTable)
            .values({
              id: runID,
              task_id: taskID,
              executor: "opencode",
              status: "running",
              phase: "dispatch",
              retry_count: 0,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorInteractionRequestTable)
            .values({
              id: interactionID,
              task_id: taskID,
              run_id: runID,
              external_id: requestID,
              request_type: "permission",
              status: "pending",
              title: "Need approval",
              body: "approve this step",
              payload: {},
              time_created: now - 60_000,
              time_updated: now - 60_000,
            })
            .run()
        })

        await OrchestratorRuntime.syncRun(runID, hooks())

        const interaction = Database.use((db) =>
          db.select().from(OrchestratorInteractionRequestTable).where(eq(OrchestratorInteractionRequestTable.id, interactionID)).get(),
        )
        const run = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, runID)).get(),
        )
        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )

        expect(reply).not.toHaveBeenCalled()
        expect(interaction?.status).toBe("pending")
        expect(run?.status).toBe("blocked")
        expect(task?.status).toBe("blocked")
      },
    })
  })
})
