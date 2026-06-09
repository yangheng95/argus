import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Identifier } from "../../src/id/id"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Event, TaskEvent } from "../../src/engine/model"
import { EngineProtocol } from "../../src/engine/protocol"
import { EngineService } from "@/task-api"
import { ProtocolStore } from "../../src/protocol/store"
import { findTask } from "../../src/engine/store"
import { updateTask } from "../../src/engine/state"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { ensureTaskMessageProtocolBridge } from "../../src/orchestrator/protocol/message-bridge"
import { SessionStatus } from "../../src/session/status"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { protocolTaskEvent, taskListProtocolEvent, TaskListEvent } from "../../src/server/routes/orchestrator"

let projectID = ""
let taskID = ""
let tmp: Awaited<ReturnType<typeof tmpdir>>

function seedTask() {
  const now = Date.now()
  Database.use((db) =>
    db.insert(ProjectTable).values({
      id: projectID,
      worktree: process.cwd(),
      name: "Protocol Test",
      sandboxes: "[]",
      time_created: now,
      time_updated: now,
    }).run(),
  )
  Database.use((db) =>
    db.insert(EngineTaskTable).values({
      id: taskID,
      project_id: projectID,
      source: "test",
      title: "Protocol task",
      request: "Verify protocol persistence",
      priority: "normal",
      time_created: now,
      time_updated: now,
    }).run(),
  )
}

beforeEach(async () => {
  await resetDatabase()
  tmp = await tmpdir()
  projectID = `project_protocol_${Date.now()}`
  taskID = `tsk_${Date.now().toString(16)}ProtocolTest`
  seedTask()
})

afterEach(async () => {
  await resetDatabase()
  await tmp?.[Symbol.asyncDispose]?.()
})

describe("orchestrator protocol", () => {
  test("stamps notify metadata onto per-task and task-list protocol events", () => {
    const event = {
      id: "pev_notify",
      type: "task.failed",
      taskID,
      runID: undefined,
      sequence: 7,
      summary: "Task failed",
      payload: { taskID, status: "failed", summary: "Task failed" },
      time: { emitted: Date.now(), created: Date.now(), updated: Date.now() },
    } as any

    const perTask = protocolTaskEvent(event)
    expect(perTask.notify).toEqual({ tier: 1, badge: true })
    expect(TaskEvent.parse(perTask).notify).toEqual({ tier: 1, badge: true })

    const taskList = taskListProtocolEvent(event)
    expect(taskList.notify).toEqual({ tier: 1, badge: true })
    expect(TaskListEvent.parse(taskList).notify).toEqual({ tier: 1, badge: true })
    expect(TaskListEvent.parse(taskList).notificationDetails).toContain('"type": "task.failed"')
    expect(TaskListEvent.parse(taskList).notificationDetails).toContain('"summary": "Task failed"')
  })

  test("omits notify metadata for NOOP protocol events", () => {
    const event = {
      id: "pev_noop",
      type: "spec.approved",
      taskID,
      sequence: 8,
      summary: "Spec approved",
      payload: { taskID, specID: "spc_test", summary: "Spec approved" },
      time: { emitted: Date.now(), created: Date.now(), updated: Date.now() },
    } as any

    expect(protocolTaskEvent(event)).not.toHaveProperty("notify")
    expect(taskListProtocolEvent(event)).not.toHaveProperty("notify")
    expect(taskListProtocolEvent(event)).not.toHaveProperty("notificationDetails")
  })

  test("evaluation.completed notify tier is resolved from payload at the protocol stamp seam", () => {
    const base = {
      id: "pev_eval",
      type: "evaluation.completed",
      taskID,
      runID: "run_eval",
      sequence: 9,
      summary: "Evaluation completed",
      time: { emitted: Date.now(), created: Date.now(), updated: Date.now() },
    }

    expect(protocolTaskEvent({
      ...base,
      payload: {
        taskID,
        runID: "run_eval",
        evaluationID: "art_rejected",
        status: "failed",
        verdict: "rejected",
        summary: "Rejected",
      },
    } as any).notify).toEqual({ tier: 1, badge: true })

    expect(protocolTaskEvent({
      ...base,
      payload: {
        taskID,
        runID: "run_eval",
        evaluationID: "art_accepted",
        status: "passed",
        verdict: "accepted",
        summary: "Accepted",
      },
    } as any).notify).toEqual({ tier: 2 })
  })

  test("ephemeral task events carry live cursors and replay without task-list cursor leakage", async () => {
    const seen: any[] = []
    const stop = ProtocolStore.subscribeEvents((event) => {
      seen.push(event)
    }, { aggregate: "task", taskID })

    ProtocolStore.dispatchEphemeral({
      type: "message.updated",
      aggregate: "task",
      taskID,
      sessionID: "ses_live",
      source: "test.protocol",
      payload: {
        info: {
          id: "msg_live",
          sessionID: "ses_live",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    })
    ProtocolStore.dispatchEphemeral({
      type: "message.part.updated",
      aggregate: "task",
      taskID,
      sessionID: "ses_live",
      source: "test.protocol",
      payload: {
        part: {
          id: "part_live",
          messageID: "msg_live",
          sessionID: "ses_live",
          type: "text",
          text: "",
        },
      },
    })
    ProtocolStore.dispatchEphemeral({
      type: "message.part.delta",
      aggregate: "task",
      taskID,
      sessionID: "ses_live",
      source: "test.protocol",
      payload: {
        sessionID: "ses_live",
        messageID: "msg_live",
        partID: "part_live",
        field: "text",
        delta: "hello",
      },
    })
    for (const _ of Array.from({ length: 10 })) {
      if (seen.length >= 3) break
      await Bun.sleep(5)
    }
    stop()
    expect(seen.map((event) => event.liveSequence)).toEqual([1, 2, 3])
    expect(seen.every((event) => event.liveEpoch === ProtocolStore.currentTaskLiveEpoch())).toBe(true)

    const replay = ProtocolStore.listTaskLiveEventsAfter(taskID, 0)
    expect(replay.expired).toBe(false)
    if (replay.expired) throw new Error("unexpected expired replay")
    expect(replay.events.map((event) => event.type)).toEqual([
      "message.updated",
      "message.part.updated",
      "message.part.delta",
    ])
    const perTask = protocolTaskEvent(replay.events[2] as any)
    expect(perTask.live_sequence).toBe(3)
    expect(perTask.live_epoch).toBe(ProtocolStore.currentTaskLiveEpoch())
    expect(TaskEvent.parse(perTask).live_sequence).toBe(3)
    expect(taskListProtocolEvent(replay.events[2] as any)).not.toHaveProperty("live_sequence")
  })

  test("live replay prunes deltas once a text part reaches a durable boundary", () => {
    ProtocolStore.dispatchEphemeral({
      type: "message.part.delta",
      aggregate: "task",
      taskID,
      sessionID: "ses_prune",
      source: "test.protocol",
      payload: {
        sessionID: "ses_prune",
        messageID: "msg_prune",
        partID: "part_prune",
        field: "text",
        delta: "hel",
      },
    })
    ProtocolStore.dispatchEphemeral({
      type: "message.part.updated",
      aggregate: "task",
      taskID,
      sessionID: "ses_prune",
      source: "test.protocol",
      payload: {
        part: {
          id: "part_prune",
          messageID: "msg_prune",
          sessionID: "ses_prune",
          type: "text",
          text: "hello",
          time: { end: Date.now() },
        },
      },
    })

    const replay = ProtocolStore.listTaskLiveEventsAfter(taskID, 0)
    expect(replay.expired).toBe(false)
    if (replay.expired) throw new Error("unexpected expired replay")
    expect(replay.events.map((event) => event.type)).toEqual(["message.part.updated"])
    expect(replay.events[0]?.payload).toMatchObject({
      part: { id: "part_prune", text: "hello" },
    })
  })

  test("live replay compaction releases idle task payloads without another task event", () => {
    ProtocolStore.compactLiveReplay(Date.now() + 1_000_000)
    const before = ProtocolStore.liveReplayStats()
    expect(before).toMatchObject({ tasks: 0, events: 0 })
    ProtocolStore.dispatchEphemeral({
      type: "message.part.updated",
      aggregate: "task",
      taskID,
      sessionID: "ses_idle_release",
      source: "test.protocol",
      payload: {
        part: {
          id: "part_idle_release",
          messageID: "msg_idle_release",
          sessionID: "ses_idle_release",
          type: "text",
          text: "x".repeat(1_000_000),
        },
      },
    })

    const active = ProtocolStore.listTaskLiveEventsAfter(taskID, 0)
    expect(active.expired).toBe(false)
    if (active.expired) throw new Error("unexpected expired replay")
    expect(active.events).toHaveLength(1)
    const emitted = active.events[0]!.time.emitted
    expect(ProtocolStore.liveReplayStats().events).toBeGreaterThan(before.events)

    ProtocolStore.compactLiveReplay(emitted + 30_001)

    expect(ProtocolStore.liveReplayStats()).toMatchObject({
      tasks: 0,
      events: 0,
    })
    const replay = ProtocolStore.listTaskLiveEventsAfter(taskID, 0)
    expect(replay.expired).toBe(true)
    if (!replay.expired) throw new Error("expected expired replay")
    expect(protocolTaskEvent(replay.event as any)).toMatchObject({
      type: "task.live_replay_expired",
      payload: {
        taskID,
        reason: "selected task live replay retention expired",
      },
    })
  })

  test("live replay epoch mismatch fails loudly", () => {
    const replay = ProtocolStore.listTaskLiveEventsAfter(taskID, 0, {
      liveEpoch: ProtocolStore.currentTaskLiveEpoch() + 1,
    })
    expect(replay.expired).toBe(true)
    if (!replay.expired) throw new Error("expected expired replay")
    expect(protocolTaskEvent(replay.event as any)).toMatchObject({
      type: "task.live_replay_expired",
      sequence: 0,
      payload: {
        taskID,
        reason: "selected task live replay epoch changed",
      },
    })
  })

  test("persists emitted control-plane events in task order", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await EngineProtocol.emit(Event.TaskCreated, {
          taskID,
          status: "queued",
          summary: "Task created",
        }, { source: "test.protocol" })

        await EngineProtocol.emit(Event.TaskUpdated, {
          taskID,
          status: "active",
          summary: "Task started",
        }, { source: "test.protocol" })

        const events = await EngineService.listProtocolEvents(taskID)
        expect(events).toHaveLength(2)
        expect(events.map((item) => item.sequence)).toEqual([1, 2])
        expect(events.map((item) => item.type)).toEqual([
          "task.created",
          "task.updated",
        ])
        expect(events.map((item) => item.source)).toEqual([
          "test.protocol",
          "test.protocol",
        ])
        expect(events[1]?.payload).toMatchObject({
          taskID,
          status: "active",
          summary: "Task started",
        })
      },
    })
  })

  test("records protocol messages for state-driven updates", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const row = findTask(taskID)
        if (!row) throw new Error("missing seeded task")

        await updateTask(row, {
          status: "failed",
          error: "something went wrong",
        }, "Task failed")

        // The state writer emits task.updated AND the terminal counterpart
        // (task.failed here) on every status transition. Both must land in
        // the protocol log so OS-toast / channel-runtime consumers can
        // subscribe to the terminal event directly without re-deriving the
        // transition from a stream of task.updated.
        let events = await EngineService.listProtocolEvents(taskID)
        for (const _ of Array.from({ length: 40 })) {
          if (events.length >= 2) break
          await Bun.sleep(20)
          events = await EngineService.listProtocolEvents(taskID)
        }
        expect(events.map((event) => event.type)).toEqual([
          "task.updated",
          "task.failed",
        ])
        expect(events[0]).toMatchObject({
          type: "task.updated",
          source: "state.task",
          summary: "Task failed",
          sequence: 1,
        })
        expect(events[1]).toMatchObject({
          type: "task.failed",
          source: "state.task",
          summary: "Task failed",
          sequence: 2,
        })
        expect(events[1]?.payload).toMatchObject({
          taskID,
          status: "failed",
          error: "something went wrong",
        })

        // Phase-6-f-2: task.status column deleted; derive status from
        // time_completed + error per engine/task-status.ts.
        const stored = findTask(taskID)
        const { deriveTaskStatus } = await import("../../src/engine/task-status")
        expect(stored ? deriveTaskStatus(stored) : undefined).toBe("failed")
      },
    })
  })

  test("emits task.completed when transition is queued → completed", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const row = findTask(taskID)
        if (!row) throw new Error("missing seeded task")

        await updateTask(row, { status: "completed" }, "Task done")

        let events = await EngineService.listProtocolEvents(taskID)
        for (const _ of Array.from({ length: 40 })) {
          if (events.length >= 2) break
          await Bun.sleep(20)
          events = await EngineService.listProtocolEvents(taskID)
        }
        expect(events.map((event) => event.type)).toEqual([
          "task.updated",
          "task.completed",
        ])
      },
    })
  })

  test("emits task.cancelled when transition is queued → cancelled", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const row = findTask(taskID)
        if (!row) throw new Error("missing seeded task")

        await updateTask(row, {
          status: "cancelled",
          error: "Operator cancelled",
        }, "Task cancelled")

        let events = await EngineService.listProtocolEvents(taskID)
        for (const _ of Array.from({ length: 40 })) {
          if (events.length >= 2) break
          await Bun.sleep(20)
          events = await EngineService.listProtocolEvents(taskID)
        }
        expect(events.map((event) => event.type)).toEqual([
          "task.updated",
          "task.cancelled",
        ])
      },
    })
  })

  test("does NOT emit a terminal event when status does not change", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const row = findTask(taskID)
        if (!row) throw new Error("missing seeded task")

        await updateTask(row, {
          status: "failed",
          error: "first failure",
        }, "Task failed")
        // Re-call updateTask on a task already in failed state with a new
        // summary. deriveTaskStatus is still "failed", so the terminal event
        // must NOT fire again — only the task.updated pulse should land.
        const after = findTask(taskID)
        if (!after) throw new Error("task disappeared")
        await updateTask(after, { error: "still failing, retried" }, "Retried")

        let events = await EngineService.listProtocolEvents(taskID)
        for (const _ of Array.from({ length: 40 })) {
          if (events.length >= 3) break
          await Bun.sleep(20)
          events = await EngineService.listProtocolEvents(taskID)
        }
        const types = events.map((event) => event.type)
        expect(types.filter((type) => type === "task.failed")).toHaveLength(1)
        // task.updated may fire once or twice depending on the second call's
        // no-op guard; the point is only ONE task.failed in either case.
      },
    })
  })

  test("bridges root and child session message events into task protocol events", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ensureTaskMessageProtocolBridge()

        const now = Date.now()
        // Authoritative session role lives in `session.kind`; bridge reads
        // it via sessionRole() = SELECT kind. No registry write needed.
        const root = await Session.create({ kind: "root", title: "Task root" })
        const child = await Session.create({ kind: "evaluator", parentID: root.id, title: "Judge child" })
        Database.use((db) =>
          db.update(EngineTaskTable)
            .set({
              session_id: root.id,
              time_updated: now,
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )

        const liveEvents: Array<{
          type: string
          sessionID?: string
          payload?: Record<string, unknown>
        }> = []
        const stop = ProtocolStore.subscribeEvents((event) => {
          liveEvents.push({
            type: event.type,
            sessionID: event.sessionID,
            payload: event.payload,
          })
        }, { aggregate: "task", taskID })

        const rootMessageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: rootMessageID,
          sessionID: root.id,
          role: "user",
          time: { created: now },
          agent: "architect",
          model: { providerID: "test", modelID: "test" },
        } satisfies Message.User)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: root.id,
          messageID: rootMessageID,
          type: "text",
          text: "architect output",
        } satisfies Message.TextPart)

        const childMessageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: childMessageID,
          sessionID: child.id,
          role: "user",
          time: { created: now + 2 },
          agent: "judge",
          model: { providerID: "test", modelID: "test" },
        } satisfies Message.User)
        await Bus.publish(Message.Event.PartDelta, {
          sessionID: child.id,
          messageID: childMessageID,
          partID: Identifier.ascending("part"),
          field: "text",
          delta: "judge delta",
        })

        for (const _ of Array.from({ length: 25 })) {
          if (
            liveEvents.some((item) => item.type === "message.updated" && item.sessionID === root.id) &&
            liveEvents.some((item) => item.type === "message.part.updated" && item.sessionID === root.id)
          ) break
          await Bun.sleep(20)
        }
        stop()

        const rootMessage = liveEvents.find((item) => item.type === "message.updated" && item.sessionID === root.id)
        const rootPart = liveEvents.find((item) => item.type === "message.part.updated" && item.sessionID === root.id)
        // message.* events are live-only; reconnect hydrates from message/part tables.
        expect(rootMessage).toBeTruthy()
        expect(rootPart).toBeTruthy()
        expect(rootMessage?.payload).toMatchObject({ channel: "main", resolvedRole: "user" })
        expect(rootPart?.payload).toMatchObject({ channel: "main", resolvedRole: "user" })
        const persisted = await EngineService.listProtocolEvents(taskID)
        expect(persisted.filter((item) => item.type.startsWith("message."))).toEqual([])
      },
    })
  })

  test("bridges session terminal status without message role metadata", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ensureTaskMessageProtocolBridge()

        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "Task root" })
        const requirements = await Session.create({
          kind: "requirements",
          parentID: root.id,
          title: "Requirements",
        })
        Database.use((db) =>
          db.update(EngineTaskTable)
            .set({
              session_id: root.id,
              time_updated: now,
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )

        SessionStatus.set(requirements.id, { type: "terminal", reason: "completed" })

        let events = await EngineService.listProtocolEvents(taskID)
        for (const _ of Array.from({ length: 25 })) {
          if (events.some((item) => item.type === "session.status" && item.sessionID === requirements.id)) break
          await Bun.sleep(20)
          events = await EngineService.listProtocolEvents(taskID)
        }

        const statusEvent = events.find((item) => item.type === "session.status" && item.sessionID === requirements.id)
        expect(statusEvent).toBeTruthy()
        expect(statusEvent?.payload).toMatchObject({
          sessionID: requirements.id,
          channel: "requirements",
          resolvedRole: "requirements",
          parentSessionID: root.id,
          status: {
            type: "terminal",
            reason: "completed",
          },
        })
      },
    })
  })

  test("preserves saveMessage root user part events instead of dropping them", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ensureTaskMessageProtocolBridge()

        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "Task root" })
        Database.use((db) =>
          db.update(EngineTaskTable)
            .set({
              session_id: root.id,
              time_updated: now,
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )

        const rootMessageID = Identifier.ascending("message")
        const rootPartID = Identifier.ascending("part")
        const rootMessage = {
          id: rootMessageID,
          sessionID: root.id,
          role: "user" as const,
          time: { created: now },
          agent: "architect",
          model: { providerID: "test", modelID: "test" },
        } satisfies Message.User

        const liveEvents: Array<{
          type: string
          sessionID?: string
          payload?: Record<string, any>
        }> = []
        const stop = ProtocolStore.subscribeEvents((event) => {
          liveEvents.push({
            type: event.type,
            sessionID: event.sessionID,
            payload: event.payload as Record<string, any> | undefined,
          })
        }, { aggregate: "task", taskID })

        await Session.saveMessage(rootMessage)
        await Session.updatePart({
          id: rootPartID,
          sessionID: root.id,
          messageID: rootMessageID,
          type: "text",
          text: "root prompt before message.updated",
        } satisfies Message.TextPart)
        await Session.updateMessage(rootMessage)

        for (const _ of Array.from({ length: 25 })) {
          if (
            liveEvents.some((item) => item.type === "message.part.updated" && item.sessionID === root.id) &&
            liveEvents.some((item) => item.type === "message.updated" && item.sessionID === root.id)
          ) break
          await Bun.sleep(20)
        }
        stop()

        const rootEvents = liveEvents.filter((item) => item.sessionID === root.id)
        expect(rootEvents.map((item) => item.type)).toEqual([
          "message.part.updated",
          "message.updated",
        ])

        const partEvent = rootEvents[0]
        expect(partEvent?.payload).toMatchObject({
          resolvedRole: "user",
          channel: "main",
          part: {
            resolvedRole: "user",
            channel: "main",
            messageID: rootMessageID,
          },
        })
      },
    })
  })
})
