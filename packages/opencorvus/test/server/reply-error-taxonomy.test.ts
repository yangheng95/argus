import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { deriveTaskStatus } from "../../src/engine/task-status"
import { Identifier } from "../../src/id/id"
import * as TaskLoop from "../../src/orchestrator/loop"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("task agent session reply routes through task-root wake when direct continuation is unavailable", () => {
  afterEach(async () => {
    mock.restore()
    await Instance.disposeAll()
    await resetDatabase()
  })

  async function seedTask(input: { taskID: string; rootID: string; now: number }) {
    await Session.updateMessage({
      id: Identifier.ascending("message"),
      sessionID: input.rootID,
      role: "user",
      time: { created: input.now - 1 },
      agent: "orchestrator",
      model: { providerID: "overlay", modelID: "default" },
    })
    Database.use((db) =>
      db
        .insert(EngineTaskTable)
        .values({
          id: input.taskID,
          project_id: Instance.project.id,
          session_id: input.rootID,
          source: "panel",
          title: "reply routing",
          request: "reply routing",
          priority: "normal",
          time_created: input.now,
          time_updated: input.now,
          time_started: input.now,
        })
        .run(),
    )
  }

  async function postReply(input: { taskID: string; sessionID: string; directory: string; message?: string }) {
    return Server.App().request(`/task/${input.taskID}/session/${input.sessionID}/reply`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": input.directory,
      },
      body: JSON.stringify({ message: input.message ?? "continue here" }),
    })
  }

  async function expectTaskRootWake(input: { taskID: string; rootID: string; targetSessionID: string }) {
    const messages = await Session.messages({ sessionID: input.rootID })
    const latest = messages
      .map((message) => message.info)
      .filter((info) => info.role === "user")
      .at(-1)
    expect(latest?.extra).toMatchObject({
      operator_message: {
        source: "overlay_agent_session_reply",
        target: {
          kind: "agent_session",
          sessionID: input.targetSessionID,
        },
      },
    })
    const task = Database.use((db) =>
      db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, input.taskID)).get(),
    )
    expect(task ? deriveTaskStatus(task) : undefined).toBe("active")
  }

  test("kind not in direct-reply set is accepted as targeted task-root input", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const executor = await Session.create({ kind: "executor", parentID: root.id, title: "executor" })
        await seedTask({ taskID, rootID: root.id, now })

        const response = await postReply({ taskID, sessionID: executor.id, directory: tmp.path })

        expect(response.status).toBe(202)
        await expectTaskRootWake({ taskID, rootID: root.id, targetSessionID: executor.id })
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
      },
    })
  })

  test("build sessions are accepted as targeted task-root input", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const build = await Session.create({ kind: "build", parentID: root.id, title: "build" })
        await seedTask({ taskID, rootID: root.id, now })

        const response = await postReply({ taskID, sessionID: build.id, directory: tmp.path })

        expect(response.status).toBe(202)
        await expectTaskRootWake({ taskID, rootID: root.id, targetSessionID: build.id })
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
      },
    })
  })

  test("sessions without a prior envelope are accepted as targeted task-root input", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const evaluator = await Session.create({ kind: "evaluator", parentID: root.id, title: "evaluator" })
        await seedTask({ taskID, rootID: root.id, now })

        const response = await postReply({ taskID, sessionID: evaluator.id, directory: tmp.path })

        expect(response.status).toBe(202)
        await expectTaskRootWake({ taskID, rootID: root.id, targetSessionID: evaluator.id })
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
      },
    })
  })

  test("sessions with missing runtime contract are accepted as targeted task-root input", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const architect = await Session.create({ kind: "architect", parentID: root.id, title: "architect" })
        await seedTask({ taskID, rootID: root.id, now })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: architect.id,
          role: "user",
          time: { created: now + 1 },
          agent: "architect",
          model: { providerID: "test-provider", modelID: "test-model" },
        })

        const response = await postReply({ taskID, sessionID: architect.id, directory: tmp.path })

        expect(response.status).toBe(202)
        await expectTaskRootWake({ taskID, rootID: root.id, targetSessionID: architect.id })
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
      },
    })
  })

  test("healthy direct sessions still append directly to that session", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: {
            model: "overlay/default",
            agent: { architect: { model: "overlay/architect" } },
          },
        })
        const assistant = await Session.create({ kind: "assistant", parentID: root.id, title: "assistant" })
        await seedTask({ taskID, rootID: root.id, now })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: assistant.id,
          role: "user",
          time: { created: now + 1 },
          agent: "assistant",
          model: { providerID: "overlay", modelID: "default" },
        })

        const response = await postReply({ taskID, sessionID: assistant.id, directory: tmp.path })

        expect(response.status).toBe(202)
        const directMessages = await Session.messages({ sessionID: assistant.id })
        expect(directMessages.filter((message) => message.info.role === "user")).toHaveLength(2)
      },
    })
  })
})
