import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { updateTask } from "../../src/engine/state"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import * as Queue from "../../src/engine/queue"
import { Identifier } from "../../src/id/id"
import { ensureMissionSession } from "../../src/mission/session"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionWake } from "../../src/session/wake"
import { Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

async function seedRootSession(sessionID: string, text = "initial request") {
  const info = {
    id: Identifier.ascending("message"),
    sessionID,
    role: "user" as const,
    time: { created: Date.now() - 1_000 },
    agent: "orchestrator",
    model: {
      providerID: "test-provider",
      modelID: "test-model",
    },
  }
  await Session.persistMessage({
    info,
    parts: [
      {
        id: Identifier.ascending("part"),
        messageID: info.id,
        sessionID,
        type: "text",
        text,
        kind: "user_content",
      },
    ],
    touchSessionID: sessionID,
  })
}

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 50; i++) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(await predicate()).toBe(true)
}

describe("task terminal lineage notifications", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("child task completion appends a real message to the parent task and wakes it", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue("started")
        const now = Date.now()
        const parentRoot = await Session.create({ kind: "root", title: "parent task" })
        await seedRootSession(parentRoot.id)
        const parentTaskID = Identifier.ascending("task")
        const childTaskID = Identifier.ascending("task")

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values([
              {
                id: parentTaskID,
                project_id: Instance.project.id,
                session_id: parentRoot.id,
                source: "test",
                title: "parent task",
                request: "parent task",
                priority: "normal",
                time_started: now,
                time_created: now,
                time_updated: now,
              },
              {
                id: childTaskID,
                project_id: Instance.project.id,
                source: "orchestrator:propose_task",
                title: "child task",
                request: "child task",
                priority: "normal",
                metadata: { parent_task_id: parentTaskID },
                time_started: now,
                time_created: now,
                time_updated: now,
              },
            ])
            .run(),
        )

        const child = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, childTaskID)).get(),
        )!
        await updateTask(child, { status: "completed" }, "child delivered")
        await waitFor(async () => {
          const messages = await Session.messages({ sessionID: parentRoot.id })
          return messages.some((message) =>
            message.parts.some((part) => part.type === "text" && part.text.includes("Child task terminal update.")),
          )
        })

        const messages = await Session.messages({ sessionID: parentRoot.id })
        const text = messages
          .flatMap((message) => message.parts)
          .find((part) => part.type === "text" && part.text.includes("Child task terminal update."))
        expect(text).toMatchObject({
          type: "text",
          text: expect.stringContaining(`task_id: ${childTaskID}`),
        })
        expect(dispatchTaskLoop).toHaveBeenCalledWith(
          expect.objectContaining({
            taskID: parentTaskID,
          }),
        )
        expect(dispatchTaskLoop.mock.calls[0]?.[0]).not.toHaveProperty("interrupt")
      },
    })
  })

  test("mission-owned task completion wakes the mission session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const wake = spyOn(SessionWake, "wake").mockResolvedValue("mission-session")
        const mission = await ensureMissionSession({ missionID: "notify-mission", defaultCwd: tmp.path })
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "mission",
              title: "mission child",
              request: "mission child",
              priority: "normal",
              metadata: { actor: "mission", mission: { id: mission.missionID, session_id: mission.id } },
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        const task = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )!

        await updateTask(task, { status: "failed", error: "acceptance failed" }, "task failed acceptance")
        await waitFor(() => wake.mock.calls.length > 0)

        expect(wake).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionID: mission.id,
            agent: "mission",
            reason: {
              source: "mission.child_task_result",
              missionID: mission.missionID,
              taskID,
              taskStatus: "failed",
            },
            prompt: expect.stringContaining("Mission task terminal update."),
          }),
        )
        expect(wake.mock.calls[0]?.[0]?.prompt).toContain(`task_id: ${taskID}`)
        expect(wake.mock.calls[0]?.[0]?.prompt).toContain("error: acceptance failed")
      },
    })
  })
})
