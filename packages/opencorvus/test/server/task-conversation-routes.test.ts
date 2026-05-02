import { afterEach, describe, expect, mock, test } from "bun:test"
import { EngineExecutorSessionTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Event } from "../../src/engine/model"
import { EngineProtocol } from "../../src/engine/protocol"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { Message } from "../../src/session/message"
import { Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("task conversation routes", () => {
  afterEach(async () => {
    mock.restore()
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("GET /task/:taskID/conversation preserves emittedAt for fidelity replays", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "panel",
            title: "hydrate fidelity replay",
            request: "hydrate fidelity replay",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          }).run(),
        )

        const session = await Session.create({
          kind: "assistant",
          title: "fidelity replay session",
        })

        await EngineProtocol.emit(Event.IntegrityReviewCompleted, {
          taskID,
          sessionID: session.id,
          verdict: "pass",
          summary: "faithful",
          dimensions: [
            {
              id: "goal_fidelity",
              verdict: "pass",
              issueCount: 0,
              correctionCount: 0,
              missingGoalCount: 0,
            },
          ],
          issues: [],
          corrections: [],
          missingGoals: [],
          attempts: 1,
        }, { source: "test.server" })

        const response = await app.request(`/task/${taskID}/conversation`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
          events?: Array<{
            type?: string
            emittedAt?: number
            timestamp?: number
            payload?: { sessionID?: string }
          }>
        }
        const event = body.events?.find((item) => item.type === "integrity.review.completed")

        expect(event).toBeDefined()
        expect(event?.payload?.sessionID).toBe(session.id)
        expect(event?.emittedAt).toBeGreaterThan(0)
        expect(event?.emittedAt).toBe(event?.timestamp)
      },
    })
  })

  test("GET /task/:taskID/conversation hydrates persisted executor run events", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const now = Date.now()

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "panel",
            title: "hydrate executor history",
            request: "hydrate executor history",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          }).run(),
        )

        await EngineProtocol.emit(Event.RunProgress, {
          taskID,
          runID,
          type: "tool_call",
          summary: "executor started tool",
          payload: {
            id: "call_1",
            name: "shell",
            input: { command: "echo hydrate" },
          },
        }, { source: "test.server" })
        await EngineProtocol.emit(Event.RunOutput, {
          taskID,
          runID,
          type: "stdout",
          text: "hydrate output\n",
        }, { source: "test.server" })

        const response = await app.request(`/task/${taskID}/conversation`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
          lastSequence?: number
          events?: Array<{
            type?: string
            sequence?: number
            run_id?: string
            payload?: { type?: string; text?: string; payload?: Record<string, unknown> }
          }>
        }
        const progress = body.events?.find((item) => item.type === "run.progress")
        const output = body.events?.find((item) => item.type === "run.output")

        expect(progress).toBeDefined()
        expect(progress?.run_id).toBe(runID)
        expect(progress?.payload?.type).toBe("tool_call")
        expect(progress?.payload?.payload).toEqual({
          id: "call_1",
          name: "shell",
          input: { command: "echo hydrate" },
        })
        expect(output).toBeDefined()
        expect(output?.run_id).toBe(runID)
        expect(output?.payload?.text).toBe("hydrate output\n")
        expect(output?.sequence).toBeGreaterThan(0)
        expect(body.lastSequence).toBeGreaterThanOrEqual(output?.sequence ?? 0)
      },
    })
  })

  test("GET /task/:taskID/conversation/events pages executor replay history", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const now = Date.now()

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "panel",
            title: "paged executor history",
            request: "paged executor history",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          }).run(),
        )

        for (const text of ["one", "two", "three"]) {
          await EngineProtocol.emit(Event.RunOutput, {
            taskID,
            runID,
            type: "stdout",
            text,
          }, { source: "test.server" })
        }

        const first = await app.request(`/task/${taskID}/conversation/events?after=0&until=3&limit=2`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(first.status).toBe(200)
        const firstBody = await first.json() as {
          events?: Array<{ type?: string; payload?: { text?: string } }>
          eventReplay?: { cursor?: number; latestSequence?: number; complete?: boolean; limit?: number }
        }
        expect(firstBody.events?.map((event) => event.payload?.text)).toEqual(["one", "two"])
        expect(firstBody.eventReplay).toEqual({
          cursor: 2,
          latestSequence: 3,
          complete: false,
          limit: 2,
        })

        const second = await app.request(`/task/${taskID}/conversation/events?after=2&until=3&limit=2`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(second.status).toBe(200)
        const secondBody = await second.json() as {
          events?: Array<{ type?: string; payload?: { text?: string } }>
          eventReplay?: { cursor?: number; latestSequence?: number; complete?: boolean; limit?: number }
        }
        expect(secondBody.events?.map((event) => event.payload?.text)).toEqual(["three"])
        expect(secondBody.eventReplay).toEqual({
          cursor: 3,
          latestSequence: 3,
          complete: true,
          limit: 2,
        })
      },
    })
  })

  test("POST /task/:taskID/session/:sessionID/reply appends overlay direct user input to an agent session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "task root",
        })
        const requirements = await Session.create({
          kind: "requirements",
          parentID: root.id,
          title: "requirements",
        })

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: root.id,
            source: "panel",
            title: "direct reply",
            request: "direct reply",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          }).run(),
        )

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: requirements.id,
          role: "user",
          time: { created: now + 1 },
          agent: "build",
          model: { providerID: "test-provider", modelID: "test-model" },
        })
        SessionStatus.set(requirements.id, { type: "busy" })

        const response = await app.request(`/task/${taskID}/session/${requirements.id}/reply`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ message: "请把验收标准补充得更具体" }),
        })

        expect(response.status).toBe(202)
        const body = await response.json() as { message_id?: string; session_id?: string; task_id?: string }
        expect(body.task_id).toBe(taskID)
        expect(body.session_id).toBe(requirements.id)
        expect(body.message_id).toBeString()

        const message = await Message.get({ sessionID: requirements.id, messageID: body.message_id! })
        expect(message.info.role).toBe("user")
        if (message.info.role !== "user") throw new Error("expected user message")
        expect(message.info.extra?.overlay_direct_reply).toBe(true)
        expect(message.parts[0]?.type).toBe("text")
        const part = message.parts[0]
        if (part?.type !== "text") throw new Error("expected text part")
        expect(part.metadata?.overlay_direct_reply).toBe(true)
        expect(part.text).toBe("请把验收标准补充得更具体")
      },
    })
  })

  test("POST /task/:taskID/session/:sessionID/cancel aborts only the target agent session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "task root",
        })
        const build = await Session.create({
          kind: "build",
          parentID: root.id,
          title: "build",
        })

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: root.id,
            source: "panel",
            title: "cancel build",
            request: "cancel build",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          }).run(),
        )
        SessionStatus.set(build.id, { type: "busy" })

        const response = await app.request(`/task/${taskID}/session/${build.id}/cancel`, {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { cancelled?: boolean; session_id?: string; task_id?: string }
        expect(body).toEqual({
          task_id: taskID,
          session_id: build.id,
          cancelled: true,
        })
        // audit-2026-04-29 W2-V35 — production session lifecycle now
        // sets `type: "terminal"` after an abort (see actor.ts:107
        // `{ type: "terminal", reason: "aborted" }` and
        // session/prompt/state.ts:56,68). Pre-fix the test expected
        // "idle" — that was the old post-abort state. The semantic
        // shift was deliberate: aborted sessions are TERMINAL (no
        // resume); only naturally-completing sessions move to idle
        // (loop.ts:587). Update the assertion to match the abort
        // path's actual state.
        expect(SessionStatus.get(build.id).type).toBe("terminal")
      },
    })
  })

  test("POST /task/:taskID/cancel aborts the task session tree and live executor sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const executorSessionID = Identifier.ascending("exec")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "task root",
        })
        const requirements = await Session.create({
          kind: "requirements",
          parentID: root.id,
          title: "requirements",
        })
        const build = await Session.create({
          kind: "build",
          parentID: requirements.id,
          title: "build",
        })

        Database.use((db) => {
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: root.id,
            source: "panel",
            title: "cancel task",
            request: "cancel task",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          }).run()
          db.insert(EngineExecutorSessionTable).values({
            id: executorSessionID,
            task_id: taskID,
            run_id: runID,
            provider: "mirrorcode",
            protocol: "session-prompt",
            protocol_version: "v1",
            transport: "inproc",
            status: "active",
            time_created: now,
            time_updated: now,
          }).run()
        })
        SessionStatus.set(root.id, { type: "streaming" })
        SessionStatus.set(requirements.id, { type: "streaming" })
        SessionStatus.set(build.id, { type: "streaming" })

        const response = await app.request(`/task/${taskID}/cancel`, {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toBe(true)
        expect(SessionStatus.get(root.id)).toEqual({ type: "terminal", reason: "aborted" })
        expect(SessionStatus.get(requirements.id)).toEqual({ type: "terminal", reason: "aborted" })
        expect(SessionStatus.get(build.id)).toEqual({ type: "terminal", reason: "aborted" })

        const executorSession = Database.use((db) =>
          db.select().from(EngineExecutorSessionTable)
            .where(eq(EngineExecutorSessionTable.id, executorSessionID))
            .get(),
        )
        expect(executorSession?.status).toBe("aborted")
        expect(executorSession?.time_completed).toBeNumber()
      },
    })
  })
})
