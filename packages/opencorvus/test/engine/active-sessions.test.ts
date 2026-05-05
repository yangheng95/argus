import { beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { SessionTable } from "../../src/session/session.sql"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { ProtocolEventTable } from "../../src/protocol/protocol.sql"
import { listActiveSessionsForTask } from "../../src/engine/store"
import { resetDatabase } from "../fixture/db"

type IDs = {
  projectID: string
  taskID: string
  sessionID: string
}

function seedBase(ids: IDs, now: number) {
  Database.use((db) => {
    db.insert(ProjectTable).values({
      id: ids.projectID,
      worktree: "D:/tmp/project",
      name: "Active Session Test",
      sandboxes: "[]",
      time_created: now,
      time_updated: now,
    }).run()
    db.insert(SessionTable).values({
      id: ids.sessionID,
      project_id: ids.projectID,
      parent_id: null,
      slug: "active-build",
      directory: "D:/tmp/project",
      title: "Build",
      version: "1",
      kind: "build",
      goal_id: "gol_active",
      time_created: now,
      time_updated: now,
    }).run()
    db.insert(EngineTaskTable).values({
      id: ids.taskID,
      project_id: ids.projectID,
      session_id: ids.sessionID,
      source: "test",
      title: "Task",
      request: "Build",
      kind: "workflow",
      priority: "normal",
      time_created: now,
      time_updated: now,
      time_started: now,
    }).run()
  })
}

function insertStatus(ids: IDs, input: { seq: number; emittedAt: number; status: "streaming" | "retry" | "idle" | "terminal" }) {
  Database.use((db) => {
    db.insert(ProtocolEventTable).values({
      id: `evt_${ids.taskID}_${input.seq}`,
      kind: "event",
      type: "session.status",
      aggregate_type: "task",
      aggregate_id: ids.taskID,
      task_id: ids.taskID,
      run_id: null,
      goal_run_id: null,
      session_id: ids.sessionID,
      interaction_id: null,
      stream_id: null,
      source: "test",
      target: null,
      causation_id: null,
      correlation_id: null,
      reply_to: null,
      seq: input.seq,
      deadline_ms: null,
      emitted_at: input.emittedAt,
      payload: {
        sessionID: ids.sessionID,
        status: { type: input.status },
      },
      time_created: input.emittedAt,
      time_updated: input.emittedAt,
    }).run()
  })
}

describe("listActiveSessionsForTask", () => {
  beforeEach(() => {
    resetDatabase()
  })

  test("keeps old streaming sessions active until the latest status is idle or terminal", () => {
    const ids = { projectID: "proj_active_sessions_1", taskID: "tsk_active_sessions_1", sessionID: "ses_active_build_1" }
    const now = Date.now()
    seedBase(ids, now)
    insertStatus(ids, { seq: 1, emittedAt: now - 10 * 60_000, status: "streaming" })

    expect(listActiveSessionsForTask(ids.taskID)).toEqual([
      {
        sessionID: ids.sessionID,
        kind: "build",
        goalID: "gol_active",
        lastActivityMs: now - 10 * 60_000,
      },
    ])

    insertStatus(ids, { seq: 2, emittedAt: now, status: "idle" })
    expect(listActiveSessionsForTask(ids.taskID)).toEqual([])
  })

  test("uses the newest status event when timestamps tie", () => {
    const ids = { projectID: "proj_active_sessions_2", taskID: "tsk_active_sessions_2", sessionID: "ses_active_build_2" }
    const now = Date.now()
    seedBase(ids, now)
    insertStatus(ids, { seq: 1, emittedAt: now, status: "streaming" })
    insertStatus(ids, { seq: 2, emittedAt: now, status: "terminal" })

    expect(listActiveSessionsForTask(ids.taskID)).toEqual([])
  })
})
