import fs from "fs/promises"
import path from "path"
import { afterEach, describe, expect, test } from "bun:test"
import { Global } from "../../src/global"
import { Identifier } from "../../src/id/id"
import {
  OrchestratorGoalRunTable,
  OrchestratorGoalTable,
  OrchestratorRunTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
} from "../../src/orchestrator/orchestrator.sql"
import { OrchestratorRuntime } from "../../src/orchestrator/runtime"
import { hooks } from "../../src/orchestrator/state"
import { createGoalRun, updateGoalRun } from "../../src/orchestrator/transition"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("orchestrator.goal session cleanup", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("poll prunes finished goal child sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const specID = Identifier.ascending("spec")
        const goalID = Identifier.ascending("goal")
        const runID = Identifier.ascending("run")
        const root = await Session.create({ title: "Task root" })
        const child = await Session.create({ parentID: root.id, title: "Goal child" })

        Database.transaction((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              title: "task",
              request: "request",
              status: "failed",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorSpecSnapshotTable)
            .values({
              id: specID,
              task_id: taskID,
              version: 1,
              status: "ready",
              summary: "spec",
              content: "spec",
              scope: "",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              spec_snapshot_id: specID,
              description: "goal",
              criteria: "criteria",
              priority: "blocking",
              source: "spec",
              status: "pending",
              order_index: 0,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorRunTable)
            .values({
              id: runID,
              task_id: taskID,
              executor: "opencode",
              status: "failed",
              phase: "dispatch",
              retry_count: 0,
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        const goalRun = createGoalRun({
          taskID,
          goalID,
          coordinatorRunID: runID,
          sessionID: child.id,
          executor: "opencode",
          now,
        })
        updateGoalRun(goalRun.id, {
          status: "completed",
          time_completed: now,
        })

        expect(Database.use((db) =>
          db.select().from(SessionTable).where(eq(SessionTable.id, child.id)).get(),
        )).toBeTruthy()

        await OrchestratorRuntime.poll(hooks())

        const next = Database.use((db) =>
          db.select().from(OrchestratorGoalRunTable).where(eq(OrchestratorGoalRunTable.id, goalRun.id)).get(),
        )

        expect(Database.use((db) =>
          db.select().from(SessionTable).where(eq(SessionTable.id, child.id)).get(),
        )).toBeUndefined()
        expect(Database.use((db) =>
          db.select().from(SessionTable).where(eq(SessionTable.id, root.id)).get(),
        )).toBeTruthy()
        expect(next?.session_id).toBeNull()
        expect((next?.metadata as Record<string, unknown> | undefined)?.local_session_id).toBeNull()
      },
    })
  })

  test("poll prunes expired goal workspaces after 72 hours", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const old = now - (72 * 60 * 60 * 1000) - 1
        const taskID = Identifier.ascending("task")
        const specID = Identifier.ascending("spec")
        const goalID = Identifier.ascending("goal")
        const runID = Identifier.ascending("run")
        const root = await Session.create({ title: "Task root" })
        const child = await Session.create({ parentID: root.id, title: "Goal child" })
        const dir = path.join(Global.Path.data, "goal-workspace", Instance.project.id, taskID, "expired")
        await fs.mkdir(dir, { recursive: true })
        await Bun.write(path.join(dir, "note.txt"), "expired")

        Database.transaction((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              title: "task",
              request: "request",
              status: "failed",
              time_created: old,
              time_updated: old,
            })
            .run()
          db.insert(OrchestratorSpecSnapshotTable)
            .values({
              id: specID,
              task_id: taskID,
              version: 1,
              status: "ready",
              summary: "spec",
              content: "spec",
              scope: "",
              time_created: old,
              time_updated: old,
            })
            .run()
          db.insert(OrchestratorGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              spec_snapshot_id: specID,
              description: "goal",
              criteria: "criteria",
              priority: "blocking",
              source: "spec",
              status: "pending",
              order_index: 0,
              time_created: old,
              time_updated: old,
            })
            .run()
          db.insert(OrchestratorRunTable)
            .values({
              id: runID,
              task_id: taskID,
              executor: "opencode",
              status: "failed",
              phase: "dispatch",
              retry_count: 0,
              time_created: old,
              time_updated: old,
            })
            .run()
        })

        const goalRun = createGoalRun({
          taskID,
          goalID,
          coordinatorRunID: runID,
          sessionID: child.id,
          executor: "opencode",
          workspaceDir: dir,
          now: old,
        })
        updateGoalRun(goalRun.id, {
          status: "failed",
          time_completed: old,
        })

        expect(await fs.stat(dir).then(() => true, () => false)).toBe(true)

        await OrchestratorRuntime.poll(hooks())

        expect(await fs.stat(dir).then(() => true, () => false)).toBe(false)
        expect(Database.use((db) =>
          db.select().from(SessionTable).where(eq(SessionTable.id, child.id)).get(),
        )).toBeUndefined()
      },
    })
  })
})
