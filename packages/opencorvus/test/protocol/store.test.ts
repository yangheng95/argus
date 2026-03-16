import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { ProtocolStore } from "../../src/protocol/store"
import { StreamHub } from "../../src/protocol/stream-hub"
import { resetDatabase } from "../fixture/db"

let projectID = ""
let taskID = ""

function seed() {
  const now = Date.now()
  Database.use((db) =>
    db.insert(ProjectTable).values({
      id: projectID,
      worktree: process.cwd(),
      vcs: "git",
      name: "Protocol Store Test",
      sandboxes: "[]",
      time_created: now,
      time_updated: now,
    }).run(),
  )
  Database.use((db) =>
    db.insert(OrchestratorTaskTable).values({
      id: taskID,
      project_id: projectID,
      source: "test",
      title: "Protocol store task",
      request: "Verify protocol v2 store",
      status: "queued",
      priority: "normal",
      time_created: now,
      time_updated: now,
    }).run(),
  )
}

beforeEach(async () => {
  await resetDatabase()
  projectID = `project_store_${Date.now()}`
  taskID = `tsk_store_${Date.now().toString(16)}`
  seed()
})

afterEach(async () => {
  await resetDatabase()
})

describe("protocol.store", () => {
  test("appends and replays task-scoped events in sequence order", async () => {
    await ProtocolStore.appendEvent({
      kind: "event",
      type: "task.started",
      aggregate: "task",
      aggregate_id: taskID,
      task_id: taskID,
      source: "test.store",
      payload: { step: 1 },
    })
    await ProtocolStore.appendEvent({
      kind: "event",
      type: "task.progress",
      aggregate: "task",
      aggregate_id: taskID,
      task_id: taskID,
      source: "test.store",
      payload: { step: 2 },
    })

    expect(ProtocolStore.latestTaskSequence(taskID)).toBe(2)
    const events = ProtocolStore.listTaskEventsAfter(taskID, 0)
    expect(events.map((item) => item.sequence)).toEqual([1, 2])
    expect(events.map((item) => item.type)).toEqual(["task.started", "task.progress"])
  })

  test("appends and replays stream chunks in chunk order", async () => {
    const streamID = StreamHub.id({ taskID: taskID, sourceID: "assistant" })
    await StreamHub.append({
      streamID,
      kind: "text_delta",
      text: "hello",
      taskID: taskID,
    })
    await StreamHub.append({
      streamID,
      kind: "text_delta",
      text: " world",
      taskID: taskID,
    })

    const chunks = StreamHub.replay(streamID, -1)
    expect(chunks.map((item) => item.chunkSequence)).toEqual([0, 1])
    expect(chunks.map((item) => item.text).join("")).toBe("hello world")
  })

  test("delivers live protocol events without routing through bus", async () => {
    const seen: string[] = []
    const stop = ProtocolStore.subscribeEvents((event) => {
      seen.push(event.type)
    }, {
      taskID,
      types: ["task.progress"],
    })

    try {
      await ProtocolStore.appendEvent({
        kind: "event",
        type: "task.progress",
        aggregate: "task",
        aggregate_id: taskID,
        task_id: taskID,
        source: "test.store.live",
        payload: { step: 3 },
      })
      for (const _ of Array.from({ length: 20 })) {
        if (seen.length > 0) break
        await Bun.sleep(10)
      }
    } finally {
      stop()
    }

    expect(seen).toEqual(["task.progress"])
  })
})
