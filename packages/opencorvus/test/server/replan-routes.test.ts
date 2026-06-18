import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EnginePlanVersionTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { findActivePlanForTask } from "../../src/engine/store"
import { Identifier } from "../../src/id/id"
import * as TaskLoop from "../../src/orchestrator/loop"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
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

async function seedFailedTaskWithActivePlan(input: { title: string }) {
  const now = Date.now()
  const taskID = Identifier.ascending("task")
  const planID = Identifier.ascending("plan")
  const root = await Session.create({ kind: "root", title: input.title })

  Database.use((db) => {
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: Instance.project.id,
        session_id: root.id,
        source: "test",
        title: input.title,
        request: input.title,
        priority: "normal",
        error: "stale active plan failed",
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
        summary: "stale active plan",
        prompt: "old plan",
        time_created: now,
        time_updated: now,
      })
      .run()
  })

  return taskID
}

describe("task replan and retry routes", () => {
  test("POST /task/:taskID/replan wakes the orchestrator with replan intent", async () => {
    await using tmp = await tmpdir({ git: true })
    const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
    const taskID = await Instance.provide({
      directory: tmp.path,
      fn: () => seedFailedTaskWithActivePlan({ title: "route replan task" }),
    })

    const response = await Server.App().request(`/task/${taskID}/replan`, {
      method: "POST",
      headers: { "x-opencorvus-directory": tmp.path },
    })

    expect(response.status).toBe(200)
    await waitForMockCalls(runTaskLoop, 1)
    const event = (runTaskLoop.mock.calls[0]?.[0] as
      | { event?: { note?: string; operatorIntent?: { kind?: string } } }
      | undefined)?.event
    expect(event?.operatorIntent).toEqual({ kind: "replan" })
    expect(event?.note).toContain("User requested replan")
    expect(event?.note).toContain("Create a fresh plan")
    expect(event?.note).not.toContain("User requested retry")
    expect(findActivePlanForTask(taskID)).toBeUndefined()
  }, 15_000)

  test("POST /task/:taskID/retry still wakes the orchestrator with retry intent", async () => {
    await using tmp = await tmpdir({ git: true })
    const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
    const taskID = await Instance.provide({
      directory: tmp.path,
      fn: () => seedFailedTaskWithActivePlan({ title: "route retry task" }),
    })

    const response = await Server.App().request(`/task/${taskID}/retry`, {
      method: "POST",
      headers: { "x-opencorvus-directory": tmp.path },
    })

    expect(response.status).toBe(200)
    await waitForMockCalls(runTaskLoop, 1)
    const event = (runTaskLoop.mock.calls[0]?.[0] as
      | { event?: { note?: string; operatorIntent?: { kind?: string } } }
      | undefined)?.event
    expect(event?.operatorIntent).toEqual({ kind: "retry" })
    expect(event?.note).toContain("User requested retry")
    expect(event?.note).not.toContain("User requested replan")
    expect(findActivePlanForTask(taskID)?.status).toBe("active")
  }, 15_000)
})
