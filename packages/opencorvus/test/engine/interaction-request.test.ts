import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { EngineInteractionRequestTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { insertEngineInteractionRequest, resolveEngineInteractionRequest } from "../../src/engine/interaction-request"
import { Event } from "../../src/engine/model"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { ProtocolStore } from "../../src/protocol/store"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase, TEST_DATABASE_LOCK_DIAGNOSTIC_TIMEOUT_MS } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let tmp: Awaited<ReturnType<typeof tmpdir>>
let taskID = ""
let sessionID = ""

beforeEach(async () => {
  await resetDatabase()
  tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({ kind: "root", title: "interaction request writer" })
      taskID = Identifier.ascending("task")
      sessionID = root.id
      const now = Date.now()
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: root.id,
            source: "test",
            title: "interaction request writer",
            request: "Verify interaction request write boundary.",
            priority: "normal",
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
    },
  })
})

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
  await tmp?.[Symbol.asyncDispose]?.()
})

describe("engine interaction request writer", () => {
  test("creates interaction rows and emits requested events from the writer", async () => {
    const now = Date.now()
    const interactionID = Database.transaction((db) =>
      insertEngineInteractionRequest(db, {
        taskID,
        runID: "run_writer",
        sessionID,
        externalID: "protocol:executor:req-1",
        requestType: "question",
        title: "Executor input required",
        body: "The executor requested additional input.",
        payload: {
          protocol_request: true,
          request_id: "req-1",
        },
        eventSource: "test.interaction.request",
        eventSummary: "Executor input required",
        timeCreated: now,
      }),
    )
    await Database.awaitEffectIdle(TEST_DATABASE_LOCK_DIAGNOSTIC_TIMEOUT_MS)

    const row = Database.use((db) =>
      db.select().from(EngineInteractionRequestTable).where(eq(EngineInteractionRequestTable.id, interactionID)).get(),
    )
    expect(row).toMatchObject({
      task_id: taskID,
      run_id: "run_writer",
      session_id: sessionID,
      external_id: "protocol:executor:req-1",
      request_type: "question",
      status: "pending",
      title: "Executor input required",
      body: "The executor requested additional input.",
      payload: {
        protocol_request: true,
        request_id: "req-1",
      },
      time_created: now,
      time_updated: now,
    })

    const requested = ProtocolStore.listTaskEventsAfter(taskID, 0).find(
      (event) => event.type === Event.InteractionRequested.type,
    )
    expect(requested?.source).toBe("test.interaction.request")
    expect(requested?.payload).toMatchObject({
      taskID,
      runID: "run_writer",
      interactionID,
      requestType: "question",
      summary: "Executor input required",
    })
  })

  test("resolves interaction rows and preserves explicit event emission scope", async () => {
    const interactionID = Database.transaction((db) =>
      insertEngineInteractionRequest(db, {
        taskID,
        runID: null,
        sessionID,
        externalID: "question:req-2",
        requestType: "question",
        title: "Question",
        body: "Need input?",
        payload: { questions: [] },
        eventSource: "test.interaction.question",
        eventSummary: "Question",
      }),
    )
    await Database.awaitEffectIdle(TEST_DATABASE_LOCK_DIAGNOSTIC_TIMEOUT_MS)
    const row = Database.use((db) =>
      db.select().from(EngineInteractionRequestTable).where(eq(EngineInteractionRequestTable.id, interactionID)).get(),
    )
    expect(row).toBeDefined()

    const resolvedAt = Date.now()
    Database.transaction((db) =>
      resolveEngineInteractionRequest(db, {
        row: row!,
        status: "answered",
        response: { answers: [["Root cause"]] },
        eventSource: "test.interaction.resolve",
        resolvedEventScope: "run",
        timeResolved: resolvedAt,
      }),
    )
    await Database.awaitEffectIdle(TEST_DATABASE_LOCK_DIAGNOSTIC_TIMEOUT_MS)

    const resolved = Database.use((db) =>
      db.select().from(EngineInteractionRequestTable).where(eq(EngineInteractionRequestTable.id, interactionID)).get(),
    )
    expect(resolved).toMatchObject({
      status: "answered",
      response: { answers: [["Root cause"]] },
      time_resolved: resolvedAt,
      time_updated: resolvedAt,
    })
    expect(
      ProtocolStore.listTaskEventsAfter(taskID, 0).filter((event) => event.type === Event.InteractionResolved.type),
    ).toHaveLength(0)

    Database.transaction((db) =>
      resolveEngineInteractionRequest(db, {
        row: resolved!,
        status: "rejected",
        response: { message: "Rejected by operator" },
        eventSource: "test.interaction.resolve",
        resolvedEventScope: "task",
      }),
    )
    await Database.awaitEffectIdle(TEST_DATABASE_LOCK_DIAGNOSTIC_TIMEOUT_MS)

    const resolvedEvent = ProtocolStore.listTaskEventsAfter(taskID, 0).find(
      (event) => event.type === Event.InteractionResolved.type,
    )
    expect(resolvedEvent?.source).toBe("test.interaction.resolve")
    expect(resolvedEvent?.payload).toMatchObject({
      taskID,
      interactionID,
      status: "rejected",
      summary: "Interaction rejected",
    })
  })
})
