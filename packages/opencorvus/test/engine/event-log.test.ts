import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "path"
import { EngineEventLog } from "../../src/engine/event-log"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Event } from "../../src/engine/model"
import { EngineProtocol } from "../../src/engine/protocol"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { ProtocolStore } from "../../src/protocol/store"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { timelineOrderKey } from "../../src/timeline/order"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

function sessionOrderKey(sessionID: string, timeCreated: number) {
  return timelineOrderKey({ domain: "session", time: timeCreated, id: sessionID })
}

describe("engine event log", () => {
  afterEach(async () => {
    EngineEventLog.disposeForTest()
    await resetDatabase()
  })

  test("resolves task log paths from the task project without instance context", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_event_log_no_instance_context"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "event log task",
              request: "event log task",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
      },
    })

    expect(Instance.current()).toBeUndefined()

    const paths = EngineEventLog.eventLogPathsForTask(taskID)
    const runtimeRoot = path.join(tmp.path, ...ProjectRuntimePaths.relativeRuntimeRoot().split("/"))

    expect(paths.ndjson.startsWith(runtimeRoot)).toBe(true)
    expect(paths.timeline.startsWith(runtimeRoot)).toBe(true)
    expect(paths.ndjson.endsWith(path.join("logs", "events.ndjson"))).toBe(true)
    expect(paths.timeline.endsWith(path.join("logs", "timeline.log"))).toBe(true)
  })

  test("writes current protocol task events to task runtime log files", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_event_log_protocol_emit"
    let sessionID = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "event log task",
              request: "event log task",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        const session = await Session.create({ kind: "root", title: "event log root session" })
        sessionID = session.id
      },
    })

    EngineEventLog.init()
    await EngineProtocol.emit(Event.TaskCreated, {
      taskID,
      status: "queued",
      summary: "Task created for event log",
    })
    await EngineProtocol.emit(Event.AgentCoordinationActionUpdated, {
      taskID,
      requestID: Identifier.ascending("artifact"),
      responseID: Identifier.ascending("artifact"),
      actionID: Identifier.ascending("artifact"),
      sessionID,
      action: "continue_worker",
      status: "completed",
      summary: "A2A action completed for event log",
    })

    const paths = EngineEventLog.eventLogPathsForTask(taskID)
    const deadline = Date.now() + 2_500
    let ndjson = ""
    let timeline = ""
    while (Date.now() < deadline) {
      if (existsSync(paths.ndjson) && existsSync(paths.timeline)) {
        ndjson = readFileSync(paths.ndjson, "utf8")
        timeline = readFileSync(paths.timeline, "utf8")
        if (ndjson.includes('"type":"agent.coordination.action"')) break
      }
      await Bun.sleep(25)
    }

    expect(ndjson).toContain('"type":"task.created"')
    expect(ndjson).toContain('"summary":"Task created for event log"')
    expect(ndjson).toContain('"type":"agent.coordination.action"')
    expect(ndjson).toContain('"summary":"A2A action completed for event log"')
    expect(timeline).toContain("TASK created")
    expect(timeline).toContain("A2A action")
    expect(timeline).toContain(taskID)
  })

  test("writes task reports, session lifecycle, session errors, and bridge diagnostics to task runtime log files", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_event_log_a2a_observability"
    let sessionID = ""
    let sessionCreated = 0

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "event log A2A observability task",
              request: "event log A2A observability task",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        const root = await Session.create({ kind: "root", title: "event log A2A root session" })
        const worker = await Session.create({
          kind: "assistant",
          parentID: root.id,
          title: "event log A2A worker session",
        })
        sessionID = worker.id
        sessionCreated = worker.time.created
      },
    })

    EngineEventLog.init()
    await EngineProtocol.emit(Event.TaskReport, {
      taskID,
      sessionID,
      status: "need_input",
      summary: "Need operator choice before continuing",
      question: "Which source should the worker trust?",
    })
    await ProtocolStore.appendEvent({
      kind: "event",
      type: "session.status",
      aggregate: "task",
      aggregate_id: taskID,
      task_id: taskID,
      session_id: sessionID,
      run_id: null,
      goal_run_id: null,
      interaction_id: null,
      stream_id: null,
      source: "session.bridge",
      target: null,
      correlation_id: null,
      causation_id: null,
      reply_to: null,
      order_key: sessionOrderKey(sessionID, sessionCreated),
      payload: {
        orderKey: sessionOrderKey(sessionID, sessionCreated),
        sessionID,
        status: { type: "terminal", reason: "error" },
        summary: "session status: terminal (error)",
      },
    })
    await ProtocolStore.appendEvent({
      kind: "event",
      type: "session.error",
      aggregate: "task",
      aggregate_id: taskID,
      task_id: taskID,
      session_id: sessionID,
      run_id: null,
      goal_run_id: null,
      interaction_id: null,
      stream_id: null,
      source: "session.bridge",
      target: null,
      correlation_id: null,
      causation_id: null,
      reply_to: null,
      order_key: sessionOrderKey(sessionID, sessionCreated),
      payload: {
        orderKey: sessionOrderKey(sessionID, sessionCreated),
        sessionID,
        error: { name: "UnknownError", data: { message: "provider stream failed" } },
        summary: "provider stream failed",
      },
    })
    await ProtocolStore.appendEvent({
      kind: "event",
      type: "session.bridge.persist_failed",
      aggregate: "task",
      aggregate_id: taskID,
      task_id: taskID,
      session_id: null,
      run_id: null,
      goal_run_id: null,
      interaction_id: null,
      stream_id: null,
      source: "session.bridge",
      target: null,
      correlation_id: null,
      causation_id: null,
      reply_to: null,
      payload: {
        taskID,
        sessionID,
        failed_type: "session.error",
        error: "foreign key mismatch while persisting session.error",
        summary: "Session bridge failed to persist session.error",
      },
    })

    const paths = EngineEventLog.eventLogPathsForTask(taskID)
    const deadline = Date.now() + 2_500
    let ndjson = ""
    let timeline = ""
    while (Date.now() < deadline) {
      if (existsSync(paths.ndjson) && existsSync(paths.timeline)) {
        ndjson = readFileSync(paths.ndjson, "utf8")
        timeline = readFileSync(paths.timeline, "utf8")
        if (ndjson.includes('"type":"session.bridge.persist_failed"')) break
      }
      await Bun.sleep(25)
    }

    expect(ndjson).toContain('"type":"task.report"')
    expect(ndjson).toContain('"status":"need_input"')
    expect(ndjson).toContain('"question":"Which source should the worker trust?"')
    expect(ndjson).toContain('"type":"session.status"')
    expect(ndjson).toContain('"reason":"error"')
    expect(ndjson).toContain('"type":"session.error"')
    expect(ndjson).toContain("provider stream failed")
    expect(ndjson).toContain('"type":"session.bridge.persist_failed"')
    expect(ndjson).toContain('"failedType":"session.error"')
    expect(timeline).toContain("REPORT need_input")
    expect(timeline).toContain("status=terminal reason=error")
    expect(timeline).toContain("SESSION")
    expect(timeline).toContain("BRIDGE failed session.error")
  })
})
