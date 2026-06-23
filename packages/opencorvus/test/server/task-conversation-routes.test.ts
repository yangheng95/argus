import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Event } from "../../src/engine/model"
import { EngineProtocol } from "../../src/engine/protocol"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import {
  __taskListProjectionEventTypeForTest,
  __taskMessageWatermarkForTest,
} from "../../src/server/routes/orchestrator"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { MessageTable, PartTable } from "../../src/session/session.sql"
import { SessionStatus } from "../../src/session/status"
import { SessionPrompt } from "../../src/session/prompt"
import { Message } from "../../src/session/message"
import { WorkerTurnDescriptor } from "../../src/agent/worker-turn-descriptor"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function sseReader(response: Response): () => Promise<any> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("SSE response body missing")
  const decoder = new TextDecoder()
  let buffer = ""
  return async () => {
    while (true) {
      let boundary = buffer.indexOf("\n\n")
      let delimiterLength = 2
      const crlfBoundary = buffer.indexOf("\r\n\r\n")
      if (boundary < 0 || (crlfBoundary >= 0 && crlfBoundary < boundary)) {
        boundary = crlfBoundary
        delimiterLength = 4
      }
      if (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + delimiterLength)
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trimStart())
          .join("\n")
        if (data) return JSON.parse(data)
        continue
      }
      const next = await reader.read()
      if (next.done) throw new Error("SSE stream ended before the expected event")
      buffer += decoder.decode(next.value, { stream: true })
    }
  }
}

function integrityReviewCompletedPayload(input: { taskID: string; sessionID: string }) {
  return {
    taskID: input.taskID,
    sessionID: input.sessionID,
    verdict: "pass" as const,
    summary: "faithful",
    teamReportMarkdown: "Faithful replay passed.",
    reviewers: [
      {
        reviewerID: "requirements_surface",
        scope: "Requirement surface",
        verdict: "pass" as const,
        summary: "Requirements remain covered.",
        investigationPlan: {
          requestPromise: "Conversation replay preserves emitted integrity review events.",
          hypothesis: "The hydrate route could drop or mutate persisted event timestamps.",
          evidencePlan: ["Inspect the hydrated conversation event payload."],
          passCriteria: ["The replayed event keeps the original emittedAt timestamp."],
        },
        evidence: ["The replayed event preserves task/session identity."],
        findings: [],
        openQuestions: [],
      },
      {
        reviewerID: "acceptance_surface",
        scope: "Acceptance surface",
        verdict: "pass" as const,
        summary: "Acceptance remains covered.",
        investigationPlan: {
          requestPromise: "Conversation replay preserves emittedAt fidelity for acceptance events.",
          hypothesis: "The event projection could replace emittedAt with hydrate time.",
          evidencePlan: ["Compare emittedAt and timestamp on the hydrated event."],
          passCriteria: ["emittedAt is present and equals timestamp."],
        },
        evidence: ["The replayed event preserves emittedAt fidelity."],
        findings: [],
        openQuestions: [],
      },
    ],
    findings: [],
    rounds: [],
    requiredRepairs: [],
    unresolvedDisagreements: [],
    fact_check_items: [],
    attempts: 1,
  }
}

describe("task conversation routes", () => {
  afterEach(async () => {
    mock.restore()
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("task-list projection stream excludes conversation noise event types", () => {
    for (const type of ["message.part.delta", "session.status", "review.stream.chunk", "task.messages.changed"]) {
      expect(__taskListProjectionEventTypeForTest(type)).toBe(false)
    }
    for (const type of ["task.completed", "engine.task.updated", "run.output", "workflow.step.updated"]) {
      expect(__taskListProjectionEventTypeForTest(type)).toBe(true)
    }
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
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "panel",
              title: "hydrate fidelity replay",
              request: "hydrate fidelity replay",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const session = await Session.create({
          kind: "assistant",
          title: "fidelity replay session",
        })

        await EngineProtocol.emit(
          Event.IntegrityReviewCompleted,
          integrityReviewCompletedPayload({ taskID, sessionID: session.id }),
          { source: "test.server" },
        )

        const response = await app.request(`/task/${taskID}/conversation`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        if (response.status !== 200) {
          throw new Error(await response.text())
        }
        expect(response.status).toBe(200)
        const body = (await response.json()) as {
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

  test("GET /task/:taskID/conversation/session/:sessionID returns lifecycle events without blank sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "lifecycle route root",
        })
        const frontendResearch = await Session.create({
          kind: "frontend-research",
          parentID: root.id,
          title: "lifecycle-only frontend research",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "lifecycle-only session route",
              request: "lifecycle-only session route",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        await EngineProtocol.emit(
          SessionStatus.Event.Status,
          {
            sessionID: frontendResearch.id,
            status: { type: "terminal", reason: "error", error: "prepared evidence missing" },
          },
          { source: "test.server", taskID, sessionID: frontendResearch.id },
        )

        const response = await app.request(`/task/${taskID}/conversation/session/${frontendResearch.id}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          transcript: unknown[]
          timeline: unknown[]
          events?: Array<{ type?: string; payload?: Record<string, unknown> }>
          view?: { sessions?: Array<{ sessionID?: string; stage?: string; messageIDs?: string[] }> }
          history?: { limit?: number }
        }

        expect(body.transcript).toEqual([])
        expect(body.timeline).toEqual([])
        expect(body.history?.limit).toBe(1)
        expect(body.events?.map((event) => event.type)).toEqual(["session.status"])
        expect(body.events?.[0]?.payload?.sessionID).toBe(frontendResearch.id)
        expect(body.view?.sessions).toEqual([])
      },
    })
  })

  test("GET /task/:taskID/conversation/session/:sessionID does not use full task transcript", async () => {
    const source = await fs.readFile(new URL("../../src/server/routes/orchestrator.ts", import.meta.url), "utf8")
    const routeStart = source.indexOf('"/task/:taskID/conversation/session/:sessionID"')
    const routeEnd = source.indexOf('"/task/:taskID/conversation/history"', routeStart)
    const routeBlock = source.slice(routeStart, routeEnd)

    expect(routeBlock).toContain("loadTaskSessionTranscript(taskID, sessionID)")
    expect(routeBlock).not.toContain("loadFullTaskTranscript(taskID)")
  })

  test("GET /task/:taskID/conversation/session/:sessionID reads requested session without sibling transcript", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "session transcript root",
        })
        const requested = await Session.create({
          kind: "build",
          parentID: root.id,
          title: "requested session",
        })
        const sibling = await Session.create({
          kind: "build",
          parentID: root.id,
          title: "large sibling session",
        })

        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "single session transcript task",
              request: "single session transcript task",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()

          db.insert(MessageTable)
            .values({
              id: "msg_requested_session",
              session_id: requested.id,
              time_created: now + 1,
              time_updated: now + 1,
              data: {
                role: "assistant",
                time: { created: now + 1 },
              } as any,
            })
            .run()
          db.insert(PartTable)
            .values({
              id: "prt_requested_session",
              message_id: "msg_requested_session",
              session_id: requested.id,
              time_created: now + 1,
              time_updated: now + 1,
              data: {
                type: "text",
                text: "requested session text",
              } as any,
            })
            .run()

          for (let index = 0; index < 120; index++) {
            const suffix = String(index).padStart(3, "0")
            db.insert(MessageTable)
              .values({
                id: `msg_sibling_${suffix}`,
                session_id: sibling.id,
                time_created: now + 10 + index,
                time_updated: now + 10 + index,
                data: {
                  role: "assistant",
                  time: { created: now + 10 + index },
                } as any,
              })
              .run()
            db.insert(PartTable)
              .values({
                id: `prt_sibling_${suffix}`,
                message_id: `msg_sibling_${suffix}`,
                session_id: sibling.id,
                time_created: now + 10 + index,
                time_updated: now + 10 + index,
                data: {
                  type: "text",
                  text: `sibling transcript ${index}`,
                } as any,
              })
              .run()
          }
        })

        const response = await app.request(`/task/${taskID}/conversation/session/${requested.id}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        if (response.status !== 200) {
          throw new Error(await response.text())
        }
        const body = (await response.json()) as {
          transcript?: Array<{
            info?: { id?: string; sessionID?: string; channel?: string }
            parts?: Array<{ text?: string }>
          }>
        }

        expect(body.transcript?.map((message) => message.info?.id)).toEqual(["msg_requested_session"])
        expect(body.transcript?.[0]?.info?.sessionID).toBe(requested.id)
        expect(body.transcript?.[0]?.info?.channel).toBe("build")
        expect(body.transcript?.[0]?.parts?.[0]?.text).toBe("requested session text")
      },
    })
  })

  test("GET /task/:taskID/conversation/history returns lifecycle events in the visible history window", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "history lifecycle root",
        })
        const assistant = await Session.create({
          kind: "assistant",
          parentID: root.id,
          title: "history lifecycle assistant",
        })
        const frontendResearch = await Session.create({
          kind: "frontend-research",
          parentID: root.id,
          title: "history lifecycle frontend research",
        })

        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "history lifecycle window",
              request: "history lifecycle window",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
          db.insert(MessageTable)
            .values({
              id: "msg_history_old",
              session_id: assistant.id,
              time_created: now - 100,
              time_updated: now - 100,
              data: {
                role: "assistant",
                time: { created: now - 100 },
              } as any,
            })
            .run()
          db.insert(PartTable)
            .values({
              id: "prt_history_old",
              message_id: "msg_history_old",
              session_id: assistant.id,
              time_created: now - 100,
              time_updated: now - 100,
              data: {
                type: "text",
                text: "Older visible message.",
              } as any,
            })
            .run()
          db.insert(MessageTable)
            .values({
              id: "msg_history_latest",
              session_id: assistant.id,
              time_created: now + 1_000,
              time_updated: now + 1_000,
              data: {
                role: "assistant",
                time: { created: now + 1_000 },
              } as any,
            })
            .run()
          db.insert(PartTable)
            .values({
              id: "prt_history_latest",
              message_id: "msg_history_latest",
              session_id: assistant.id,
              time_created: now + 1_000,
              time_updated: now + 1_000,
              data: {
                type: "text",
                text: "Latest visible message.",
              } as any,
            })
            .run()
        })

        await EngineProtocol.emit(
          SessionStatus.Event.Status,
          {
            sessionID: frontendResearch.id,
            status: { type: "terminal", reason: "error", error: "history preparation failed" },
          },
          { source: "test.server", taskID, sessionID: frontendResearch.id },
        )

        const response = await app.request(
          `/task/${taskID}/conversation/history?before=${now + 1_000}&before_id=msg_history_latest&limit=1`,
          {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          },
        )

        if (response.status !== 200) {
          throw new Error(await response.text())
        }
        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          transcript: Array<{ info?: { id?: string } }>
          events?: Array<{ type?: string; payload?: Record<string, unknown> }>
          view?: { sessions?: Array<{ sessionID?: string; stage?: string; messageIDs?: string[] }> }
        }

        expect(body.transcript.map((message) => message.info?.id)).toEqual(["msg_history_old"])
        expect(body.events?.map((event) => event.type)).toEqual(["session.status"])
        expect(body.events?.[0]?.payload?.sessionID).toBe(frontendResearch.id)
        expect(body.view?.sessions?.some((session) => session.sessionID === frontendResearch.id)).toBe(false)
      },
    })
  })

  test("task message watermark follows nested build session message and part writes", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const root = await Session.create({
          kind: "root",
          title: "watermark root",
        })
        const build = await Session.create({
          kind: "build",
          parentID: root.id,
          title: "watermark build",
        })
        const now = Date.now()

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "watermark task",
              request: "watermark task",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        expect(__taskMessageWatermarkForTest(taskID)).toBe(0)

        Database.use((db) => {
          db.insert(MessageTable)
            .values({
              id: "msg_watermark",
              session_id: build.id,
              time_created: now + 1,
              time_updated: now + 2,
              data: {
                role: "assistant",
                agent: "build",
                time: { created: now + 1 },
              } as any,
            })
            .run()
          db.insert(PartTable)
            .values({
              id: "prt_watermark",
              message_id: "msg_watermark",
              session_id: build.id,
              time_created: now + 3,
              time_updated: now + 4,
              data: {
                type: "text",
                text: "tail changed",
              } as any,
            })
            .run()
        })

        expect(__taskMessageWatermarkForTest(taskID)).toBe(now + 4)
      },
    })
  })

  test("GET /task/:taskID/events emits task.messages.changed for nested DB message writes", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({
          kind: "root",
          title: "message change SSE root",
        })
        const build = await Session.create({
          kind: "build",
          parentID: root.id,
          title: "message change SSE build",
        })
        const now = Date.now()

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "message change SSE task",
              request: "message change SSE task",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const abort = new AbortController()
        const timeout = setTimeout(() => abort.abort("timed out waiting for task.messages.changed"), 6_000)
        try {
          const response = await app.request(`/task/${taskID}/events`, {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
            signal: abort.signal,
          })
          expect(response.status).toBe(200)
          const readEvent = sseReader(response)
          const connected = await readEvent()
          expect(connected.type).toBe("task.connected")

          Database.use((db) => {
            db.insert(MessageTable)
              .values({
                id: "msg_sse_watermark",
                session_id: build.id,
                time_created: now + 1,
                time_updated: now + 2,
                data: {
                  role: "assistant",
                  agent: "build",
                  time: { created: now + 1 },
                } as any,
              })
              .run()
            db.insert(PartTable)
              .values({
                id: "prt_sse_watermark",
                message_id: "msg_sse_watermark",
                session_id: build.id,
                time_created: now + 3,
                time_updated: now + 4,
                data: {
                  type: "text",
                  text: "SSE tail changed",
                } as any,
              })
              .run()
          })

          let changed: any
          while (!changed) {
            const event = await readEvent()
            if (event.type === "task.messages.changed") changed = event
          }
          expect(changed.task_id).toBe(taskID)
          expect(changed.payload?.taskID).toBe(taskID)
          expect(changed.payload?.watermark).toBe(now + 4)
        } finally {
          clearTimeout(timeout)
          abort.abort("test complete")
        }
      },
    })
  })

  test("GET /task/:taskID/events reports DB message writes after the client's hydrate watermark", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({
          kind: "root",
          title: "message watermark resume root",
        })
        const build = await Session.create({
          kind: "build",
          parentID: root.id,
          title: "message watermark resume build",
        })
        const now = Date.now()

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "message watermark resume task",
              request: "message watermark resume task",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        Database.use((db) => {
          db.insert(MessageTable)
            .values({
              id: "msg_resume_watermark",
              session_id: build.id,
              time_created: now + 1,
              time_updated: now + 2,
              data: {
                role: "assistant",
                agent: "build",
                time: { created: now + 1 },
              } as any,
            })
            .run()
          db.insert(PartTable)
            .values({
              id: "prt_resume_watermark",
              message_id: "msg_resume_watermark",
              session_id: build.id,
              time_created: now + 3,
              time_updated: now + 4,
              data: {
                type: "text",
                text: "SSE resume tail changed",
              } as any,
            })
            .run()
        })

        const abort = new AbortController()
        const timeout = setTimeout(() => abort.abort("timed out waiting for immediate task.messages.changed"), 6_000)
        try {
          const response = await app.request(
            `/task/${taskID}/events?after_message_watermark=${encodeURIComponent(String(now))}`,
            {
              headers: {
                "x-opencorvus-directory": tmp.path,
              },
              signal: abort.signal,
            },
          )
          expect(response.status).toBe(200)
          const readEvent = sseReader(response)
          expect((await readEvent()).type).toBe("task.connected")
          const changed = await readEvent()
          expect(changed.type).toBe("task.messages.changed")
          expect(changed.payload?.watermark).toBe(now + 4)
        } finally {
          clearTimeout(timeout)
          abort.abort("test complete")
        }
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
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "panel",
              title: "hydrate executor history",
              request: "hydrate executor history",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        await EngineProtocol.emit(
          Event.RunProgress,
          {
            taskID,
            runID,
            type: "tool_call",
            summary: "executor started tool",
            payload: {
              id: "call_1",
              name: "shell",
              input: { command: "echo hydrate" },
            },
          },
          { source: "test.server" },
        )
        await EngineProtocol.emit(
          Event.RunOutput,
          {
            taskID,
            runID,
            type: "stdout",
            text: "hydrate output\n",
          },
          { source: "test.server" },
        )

        const response = await app.request(`/task/${taskID}/conversation`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
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
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "panel",
              title: "paged executor history",
              request: "paged executor history",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        for (const text of ["one", "two", "three"]) {
          await EngineProtocol.emit(
            Event.RunOutput,
            {
              taskID,
              runID,
              type: "stdout",
              text,
            },
            { source: "test.server" },
          )
        }

        const first = await app.request(`/task/${taskID}/conversation/events?after=0&until=3&limit=2`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(first.status).toBe(200)
        const firstBody = (await first.json()) as {
          events?: Array<{ type?: string; payload?: { text?: string } }>
          eventReplay?: { cursor?: number; latestSequence?: number; complete?: boolean; limit?: number }
        }
        expect(firstBody.events?.map((event) => event.payload?.text)).toEqual(["one", "two"])
        expect(firstBody.eventReplay).toEqual({
          cursor: 2,
          latestSequence: 3,
          complete: false,
          limit: 2,
          sinceTimestamp: null,
        })

        const second = await app.request(`/task/${taskID}/conversation/events?after=2&until=3&limit=2`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(second.status).toBe(200)
        const secondBody = (await second.json()) as {
          events?: Array<{ type?: string; payload?: { text?: string } }>
          eventReplay?: { cursor?: number; latestSequence?: number; complete?: boolean; limit?: number }
        }
        expect(secondBody.events?.map((event) => event.payload?.text)).toEqual(["three"])
        expect(secondBody.eventReplay).toEqual({
          cursor: 3,
          latestSequence: 3,
          complete: true,
          limit: 2,
          sinceTimestamp: null,
        })
      },
    })
  })

  test("GET /task/:taskID/conversation hydrates transcript from the task project, not the request directory", async () => {
    await using taskProject = await tmpdir({ git: true })
    await using selectedProject = await tmpdir({ git: true })

    const app = Server.App()
    const ids = await Instance.provide({
      directory: taskProject.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "task root",
        })
        const orchestrator = await Session.create({
          kind: "orchestrator",
          parentID: root.id,
          title: "orchestrator",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "cross project hydrate",
              request: "cross project hydrate",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
              time_completed: now + 10,
            })
            .run(),
        )

        const messageID = Identifier.ascending("message")
        await Session.persistMessage({
          info: {
            id: messageID,
            sessionID: orchestrator.id,
            role: "user",
            time: { created: now + 1 },
            agent: "orchestrator",
            model: { providerID: "test-provider", modelID: "test-model" },
          },
          parts: [
            {
              id: Identifier.ascending("part"),
              sessionID: orchestrator.id,
              messageID,
              type: "text",
              text: "cross project hydrate message",
            },
          ],
        })

        return {
          taskID,
          rootSessionID: root.id,
          orchestratorSessionID: orchestrator.id,
        }
      },
    })
    await Instance.disposeAll()

    const response = await app.request(`/task/${ids.taskID}/conversation`, {
      headers: {
        "x-opencorvus-directory": selectedProject.path,
      },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      transcript?: Array<{ info?: { sessionID?: string; channel?: string; parentSessionID?: string } }>
      view?: { sessions?: Array<{ sessionID?: string; stage?: string; placement?: string }> }
    }

    expect(body.transcript?.map((message) => message.info?.sessionID)).toEqual([ids.orchestratorSessionID])
    expect(body.transcript?.[0]?.info?.channel).toBe("orchestrator")
    expect(body.transcript?.[0]?.info?.parentSessionID).toBe(ids.rootSessionID)
    expect(body.view?.sessions).toContainEqual(
      expect.objectContaining({
        sessionID: ids.orchestratorSessionID,
        stage: "orchestrator",
        placement: "top_level",
      }),
    )
  })

  test("GET /task/:taskID/conversation hydrates a stale record after the project directory is deleted", async () => {
    await using tmp = await tmpdir({ git: true })

    const app = Server.App()
    const ids = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "deleted project root",
        })
        const assistant = await Session.create({
          kind: "assistant",
          parentID: root.id,
          title: "deleted project assistant",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "deleted project hydrate",
              request: "deleted project hydrate",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
              time_completed: now + 10,
            })
            .run(),
        )

        const messageID = Identifier.ascending("message")
        await Session.persistMessage({
          info: {
            id: messageID,
            sessionID: assistant.id,
            role: "user",
            time: { created: now + 1 },
            agent: "assistant",
            model: { providerID: "test-provider", modelID: "test-model" },
          },
          parts: [
            {
              id: Identifier.ascending("part"),
              sessionID: assistant.id,
              messageID,
              type: "text",
              text: "stale project record remains readable",
            },
          ],
        })

        return { taskID, messageID, directory: tmp.path }
      },
    })
    await Instance.disposeAll()
    await fs.rm(ids.directory, { recursive: true, force: true })

    const response = await app.request(`/task/${ids.taskID}/conversation?tail_limit=8`)

    if (response.status !== 200) {
      throw new Error(await response.text())
    }
    const body = (await response.json()) as {
      board?: { task?: { directory?: string } }
      transcript?: Array<{ info?: { id?: string }; parts?: Array<{ text?: string }> }>
    }
    expect(body.board?.task?.directory).toBe(ids.directory)
    expect(body.transcript?.map((message) => message.info?.id)).toEqual([ids.messageID])
    expect(body.transcript?.[0]?.parts?.[0]?.text).toBe("stale project record remains readable")
  })

  test("GET /task/:taskID/conversation preserves sub-agent user authorship from persisted extra", async () => {
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
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "sub-agent authorship hydrate",
              request: "sub-agent authorship hydrate",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const internalMessageID = Identifier.ascending("message")
        await Session.persistMessage({
          info: {
            id: internalMessageID,
            sessionID: requirements.id,
            role: "user",
            time: { created: now + 1 },
            agent: "requirements",
            model: { providerID: "test-provider", modelID: "test-model" },
            extra: { resume_scope: "requirements" },
          },
          parts: [
            {
              id: Identifier.ascending("part"),
              sessionID: requirements.id,
              messageID: internalMessageID,
              type: "text",
              text: "internal requirements dispatch",
            },
          ],
        })

        const directReplyMessageID = Identifier.ascending("message")
        await Session.persistMessage({
          info: {
            id: directReplyMessageID,
            sessionID: requirements.id,
            role: "user",
            time: { created: now + 2 },
            agent: "requirements",
            model: { providerID: "test-provider", modelID: "test-model" },
            extra: {
              overlay_direct_reply: true,
              source: "overlay_direct_reply",
            },
          },
          parts: [
            {
              id: Identifier.ascending("part"),
              sessionID: requirements.id,
              messageID: directReplyMessageID,
              type: "text",
              text: "human requirements reply",
            },
          ],
        })

        const response = await app.request(`/task/${taskID}/conversation`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          transcript?: Array<{ info?: { id?: string; channel?: string; resolvedRole?: string } }>
        }
        expect(
          body.transcript?.map((message) => ({
            id: message.info?.id,
            channel: message.info?.channel,
            resolvedRole: message.info?.resolvedRole,
          })),
        ).toEqual([
          { id: internalMessageID, channel: "requirements", resolvedRole: "orchestrator" },
          { id: directReplyMessageID, channel: "requirements", resolvedRole: "user" },
        ])
      },
    })
  })

  test("GET /task/:taskID/conversation bounds hydrate transcript while preserving tail history state", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({
          kind: "root",
          title: "bounded hydrate root",
        })
        const assistant = await Session.create({
          kind: "assistant",
          parentID: root.id,
          title: "bounded hydrate assistant",
        })
        const now = Date.now()

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "bounded hydrate task",
              request: "bounded hydrate task",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        Database.use((db) => {
          for (let index = 0; index < 100; index++) {
            const suffix = index.toString().padStart(3, "0")
            const id = `msg_bounded_${suffix}`
            const created = now + index
            db.insert(MessageTable)
              .values({
                id,
                session_id: assistant.id,
                time_created: created,
                time_updated: created,
                data: {
                  role: "assistant",
                  time: { created },
                } as any,
              })
              .run()
            db.insert(PartTable)
              .values({
                id: `prt_bounded_${suffix}`,
                message_id: id,
                session_id: assistant.id,
                time_created: created,
                time_updated: created,
                data: {
                  type: "text",
                  text: `visible ${index}`,
                } as any,
              })
              .run()
          }
        })

        const response = await app.request(`/task/${taskID}/conversation?tail_limit=2`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        if (response.status !== 200) {
          throw new Error(await response.text())
        }
        const body = (await response.json()) as {
          transcript?: Array<{ info?: { id?: string } }>
          history?: { hasMore?: boolean; oldestMessageID?: string | null; limit?: number }
          agentView?: { sessions?: Array<{ sessionID?: string; messageIDs?: string[] }> }
        }

        expect(body.transcript?.map((message) => message.info?.id)).toEqual(["msg_bounded_098", "msg_bounded_099"])
        expect(body.history).toMatchObject({
          hasMore: true,
          oldestMessageID: "msg_bounded_098",
          limit: 2,
        })
        const assistantView = body.agentView?.sessions?.find((session) => session.sessionID === assistant.id)
        expect(assistantView?.messageIDs?.at(-1)).toBe("msg_bounded_099")
        expect(assistantView?.messageIDs?.length).toBeLessThanOrEqual(80)
      },
    })
  })

  test("GET /task/:taskID/conversation applies a global agentView message budget across many sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({
          kind: "root",
          title: "global bounded hydrate root",
        })
        const now = Date.now()
        const sessionCount = 45
        const messagesPerSession = 3
        const messageIDs: string[] = []

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "global bounded hydrate task",
              request: "global bounded hydrate task",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const sessions = []
        for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex += 1) {
          sessions.push(
            await Session.create({
              kind: "assistant",
              parentID: root.id,
              title: `global bounded assistant ${sessionIndex}`,
            }),
          )
        }

        Database.use((db) => {
          let sequence = 0
          for (let sessionIndex = 0; sessionIndex < sessions.length; sessionIndex += 1) {
            const session = sessions[sessionIndex]
            for (let messageIndex = 0; messageIndex < messagesPerSession; messageIndex += 1) {
              const suffix = `${sessionIndex.toString().padStart(2, "0")}_${messageIndex}`
              const id = `msg_global_bounded_${suffix}`
              const created = now + sequence
              sequence += 1
              messageIDs.push(id)
              db.insert(MessageTable)
                .values({
                  id,
                  session_id: session.id,
                  time_created: created,
                  time_updated: created,
                  data: {
                    role: "assistant",
                    time: { created },
                  } as any,
                })
                .run()
              db.insert(PartTable)
                .values({
                  id: `prt_global_bounded_${suffix}`,
                  message_id: id,
                  session_id: session.id,
                  time_created: created,
                  time_updated: created,
                  data: {
                    type: "text",
                    text: `visible ${suffix}`,
                  } as any,
                })
                .run()
            }
          }
        })

        const response = await app.request(`/task/${taskID}/conversation?tail_limit=2`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        if (response.status !== 200) {
          throw new Error(await response.text())
        }
        const body = (await response.json()) as {
          transcript?: Array<{ info?: { id?: string } }>
          history?: { hasMore?: boolean; oldestMessageID?: string | null; limit?: number }
          agentView?: { sessions?: Array<{ sessionID?: string; messageIDs?: string[] }> }
        }
        const hydratedAgentMessageCount =
          body.agentView?.sessions?.reduce((total, session) => total + (session.messageIDs?.length ?? 0), 0) ?? 0

        expect(body.transcript?.map((message) => message.info?.id)).toEqual(messageIDs.slice(-2))
        expect(body.history).toMatchObject({
          hasMore: true,
          oldestMessageID: messageIDs.at(-2),
          limit: 2,
        })
        expect(hydratedAgentMessageCount).toBeLessThanOrEqual(80)
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
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: {
            model: "overlay/default",
            agent: {
              // Codex review 2026-05-26: tagging a requirements
              // envelope with `agent: "build"` is no longer accepted as
              // a model-resolution hint — Message.User.agent is the
              // agent definition the next loop turn will resume under,
              // so envelope.agent === "build" on a non-build session
              // throws BuildSessionDirectReplyError. The test's
              // original intent (envelope carry-over preserves
              // system/tools/format + resolves model from overlay) is
              // preserved by tagging the envelope with the SAME kind
              // as the session and resolving the model via
              // agent.requirements.model.
              requirements: {
                model: "overlay/requirements",
              },
            },
          },
        })
        const requirements = await Session.create({
          kind: "requirements",
          parentID: root.id,
          title: "requirements",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
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
            })
            .run(),
        )

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: requirements.id,
          role: "user",
          time: { created: now + 1 },
          agent: "requirements",
          model: { providerID: "test-provider", modelID: "test-model" },
          system: "requirements system prompt",
          systemMode: "complete",
          tools: {
            register_requirement: true,
            submit_requirements: true,
          },
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                summary: { type: "string" },
              },
            },
            retryCount: 2,
          },
          variant: "worker",
          extra: {
            resume_scope: "requirements",
          },
        })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: requirements.id,
          role: "user",
          time: { created: now + 2 },
          agent: "requirements",
          model: { providerID: "test-provider", modelID: "test-model" },
          extra: {
            overlay_direct_reply: true,
            source: "overlay_direct_reply",
          },
        })
        SessionStatus.set(requirements.id, { type: "streaming" })

        // Resumable worker sessions require an in-memory runtime contract
        // (session/loop.ts:159 runtimeContractRequiredAgentKinds). Install
        // one whose identity.agentKind matches the envelope's `agent`
        // field (the validator compares against the envelope, not the
        // session kind, when the envelope sets one) so the resume passes
        // validateSessionRuntimeContractForContinuation.
        const descriptor = WorkerTurnDescriptor.create({
          sessionID: requirements.id,
          payload: {
            agent: "requirements",
            roleContractID: "requirements",
            model: { providerID: "overlay", modelID: "requirements" },
            prompt: { systemMode: "complete", rawSystemPrompt: false },
            tools: { enabled: [] },
            output: { format: "text", resultMode: "reply" },
            workflow: { taskID, sessionKind: "requirements" },
          },
        })

        SessionPrompt.setSessionRuntimeContract(requirements.id, {
          identity: {
            sessionID: requirements.id,
            agentKind: "requirements",
            contractKind: "stage-attempt",
            workerTurnDescriptorID: descriptor.id,
            workerTurnDescriptorHash: descriptor.hash,
            installedAt: Date.now(),
          },
          tools: {},
          // structuredOutputGuard is a function — its truthiness prevents
          // setSessionRuntimeContract's "empty contract" deleter from
          // wiping the install (loop.ts:128). The guard itself is never
          // invoked by the reply preflight, so a no-op suffices.
          structuredOutputGuard: () => undefined,
        })

        const response = await app.request(`/task/${taskID}/session/${requirements.id}/reply`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ message: "请把验收标准补充得更具体" }),
        })

        expect(response.status).toBe(202)
        const body = (await response.json()) as { message_id?: string; session_id?: string; task_id?: string }
        expect(body.task_id).toBe(taskID)
        expect(body.session_id).toBe(requirements.id)
        expect(body.message_id).toBeString()

        const message = await Message.get({ sessionID: requirements.id, messageID: body.message_id! })
        expect(message.info.role).toBe("user")
        if (message.info.role !== "user") throw new Error("expected user message")
        expect(message.info.extra?.overlay_direct_reply).toBe(true)
        expect(message.info.system).toBe("requirements system prompt")
        expect(message.info.systemMode).toBe("complete")
        expect(message.info.tools).toEqual({
          register_requirement: true,
          submit_requirements: true,
        })
        expect(message.info.format).toEqual({
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
            },
          },
          retryCount: 2,
        })
        expect(message.info.model).toEqual({ providerID: "overlay", modelID: "requirements" })
        expect(message.info.variant).toBeUndefined()
        expect(message.info.extra?.resume_scope).toBe("requirements")
        expect(message.parts[0]?.type).toBe("text")
        const part = message.parts[0]
        if (part?.type !== "text") throw new Error("expected text part")
        expect(part.metadata?.overlay_direct_reply).toBe(true)
        expect(part.text).toBe("请把验收标准补充得更具体")
      },
    })
  })

  test("POST /task/:taskID/session/:sessionID/reply rejects the root session", async () => {
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

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "direct reply root rejection",
              request: "direct reply root rejection",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/session/${root.id}/reply`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ message: "继续完成G3" }),
        })

        expect(response.status).not.toBe(202)
        const messages = await Session.messages({ sessionID: root.id })
        expect(messages).toHaveLength(0)
      },
    })
  })

  test("POST /task/:taskID/session/:sessionID/cancel reports incomplete cancellation when prompt state is missing", async () => {
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
          db
            .insert(EngineTaskTable)
            .values({
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
            })
            .run(),
        )
        SessionStatus.set(build.id, { type: "streaming" })

        const response = await app.request(`/task/${taskID}/session/${build.id}/cancel`, {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toMatchObject({
          name: "TaskCancellationIncompleteError",
          data: {
            taskID,
            handle: "SessionPrompt.cancel",
          },
        })
        expect(SessionStatus.get(build.id)).toEqual({ type: "streaming" })
      },
    })
  })

  test("POST /task/:taskID/cancel reports incomplete cancellation when session tree prompt state is missing", async () => {
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
        const build = await Session.create({
          kind: "build",
          parentID: requirements.id,
          title: "build",
        })

        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
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
            })
            .run()
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

        expect(response.status).toBe(409)
        expect(await response.json()).toMatchObject({
          name: "TaskCancellationIncompleteError",
          data: {
            taskID,
            handle: "SessionPrompt.cancel",
          },
        })
        expect(SessionStatus.get(root.id)).toEqual({ type: "streaming" })
        expect(SessionStatus.get(requirements.id)).toEqual({ type: "streaming" })
        expect(SessionStatus.get(build.id)).toEqual({ type: "streaming" })
      },
    })
  })
})
