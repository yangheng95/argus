import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { abortActiveTasksForProject, abortCurrentProcessLiveExecution } from "../../src/engine/writer"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { deriveTaskStatus, taskTerminalReason } from "../../src/engine/task-status"
import { ensureTaskMessageProtocolBridge } from "../../src/orchestrator/protocol/message-bridge"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { SessionStatus } from "../../src/session/status"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("shutdown aborts active task-owned sessions", () => {
  beforeEach(() => {
    resetDatabase()
  })

  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("interrupts a run-less direct build task session and errors pending tool parts", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ensureTaskMessageProtocolBridge()

        const now = Date.now()
        const taskID = "tsk_shutdown_direct_build"
        const root = await Session.create({
          kind: "root",
          title: "task root",
        })
        const orchestrator = await Session.create({
          kind: "orchestrator",
          parentID: root.id,
          title: "orchestrator",
        })
        const build = await Session.create({
          kind: "build",
          parentID: orchestrator.id,
          title: "build",
        })
        const messageID = "msg_shutdown_pending_write"
        await Session.updateMessage({
          id: messageID,
          sessionID: build.id,
          role: "assistant",
          time: { created: now },
          parentID: "msg_shutdown_user",
          agent: "build",
          providerID: "hexin",
          modelID: "kimi-k2.6",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            total: 0,
            cache: { read: 0, write: 0 },
          },
        })
        await Session.updatePart({
          id: "prt_shutdown_pending_write",
          messageID,
          sessionID: build.id,
          type: "tool",
          callID: "write:43",
          tool: "write",
          state: {
            status: "pending",
            input: {},
            raw: "",
            time: { start: now },
          },
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "direct build shutdown",
              request: "direct build shutdown",
              kind: "workflow",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        SessionStatus.set(root.id, { type: "streaming" })
        SessionStatus.set(orchestrator.id, { type: "streaming" })
        SessionStatus.set(build.id, { type: "streaming" })

        const reason = "Server shutdown: http.shutdown"
        const result = await abortActiveTasksForProject({
          projectID: Instance.project.id,
          reason,
        })

        expect(result).toEqual({ tasks: 1, sessions: 3, toolParts: 1 })
        expect(SessionStatus.get(root.id)).toEqual({ type: "terminal", reason: "aborted", error: reason })
        expect(SessionStatus.get(orchestrator.id)).toEqual({ type: "terminal", reason: "aborted", error: reason })
        expect(SessionStatus.get(build.id)).toEqual({ type: "terminal", reason: "aborted", error: reason })

        const task = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(task).toBeDefined()
        expect(deriveTaskStatus(task!)).toBe("active")
        expect(taskTerminalReason(task!)).toBeUndefined()
        expect(task?.time_completed).toBeNull()
        expect(task?.error).toBe(reason)
        expect(task?.metadata).toEqual(expect.objectContaining({ interrupted: true }))

        const part = (await Message.parts(messageID))[0]
        expect(part?.type).toBe("tool")
        if (part?.type !== "tool") throw new Error("expected tool part")
        expect(part.state.status).toBe("error")
        expect(part.state.failure.message).toBe(reason)
      },
    })
  })

  test("process shutdown terminates current-process task ownership without ambient project scope", async () => {
    await using tmp = await tmpdir({ git: true })
    let taskID = ""
    let rootID = ""
    let buildID = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ensureTaskMessageProtocolBridge()
        const now = Date.now()
        taskID = `tsk_shutdown_owned_${now}`
        const root = await Session.create({ kind: "root", title: "owned root" })
        const build = await Session.create({ kind: "build", parentID: root.id, title: "owned build" })
        rootID = root.id
        buildID = build.id
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "owned shutdown",
              request: "owned shutdown",
              kind: "workflow",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        SessionStatus.set(build.id, { type: "streaming" })
      },
    })

    await Instance.disposeAll()
    const reason = "Server shutdown: http.shutdown"
    const result = await abortCurrentProcessLiveExecution({ reason })

    expect(result.tasks).toBeGreaterThanOrEqual(1)
    expect(result.corruptTasks).toBe(0)
    expect(SessionStatus.get(rootID)).toEqual({ type: "terminal", reason: "aborted", error: reason })
    expect(SessionStatus.get(buildID)).toEqual({ type: "terminal", reason: "aborted", error: reason })
    const task = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
    expect(task).toBeDefined()
    expect(deriveTaskStatus(task!)).toBe("active")
    expect(taskTerminalReason(task!)).toBeUndefined()
    expect(task?.time_completed).toBeNull()
    expect(task?.error).toBe(reason)
    expect(task?.metadata).toEqual(expect.objectContaining({ interrupted: true }))
  })

  test("process shutdown records legacy global active task interruption instead of skipping it", async () => {
    await using tmp = await tmpdir({ git: true })
    let taskID = ""
    let rootID = ""
    let messageID = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ensureTaskMessageProtocolBridge()
        const now = Date.now()
        taskID = `tsk_shutdown_legacy_global_${now}`
        const root = await Session.create({
          kind: "root",
          title: "legacy global root",
        })
        rootID = root.id
        messageID = `msg_shutdown_legacy_global_${now}`
        await Session.updateMessage({
          id: messageID,
          sessionID: root.id,
          role: "assistant",
          time: { created: now },
          parentID: "msg_shutdown_legacy_global_user",
          agent: "orchestrator",
          providerID: "hexin",
          modelID: "kimi-k2.6",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            total: 0,
            cache: { read: 0, write: 0 },
          },
        })
        await Session.updatePart({
          id: `prt_shutdown_legacy_global_${now}`,
          messageID,
          sessionID: root.id,
          type: "tool",
          callID: "legacy:global",
          tool: "write",
          state: {
            status: "pending",
            input: {},
            raw: "",
            time: { start: now },
          },
        })
        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: "global",
              worktree: "/legacy-global-project",
              time_created: now,
              time_updated: now,
              sandboxes: [],
            })
            .onConflictDoNothing()
            .run()
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: "global",
              session_id: root.id,
              source: "panel",
              title: "legacy global shutdown",
              request: "legacy global shutdown",
              kind: "workflow",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run()
        })
        SessionStatus.set(root.id, { type: "streaming" })
      },
    })

    await Instance.disposeAll()
    const reason = "Server shutdown: http.shutdown"
    const result = await abortCurrentProcessLiveExecution({ reason })

    expect(result.corruptTasks).toBe(1)
    expect(result.tasks).toBe(1)
    expect(result.toolParts).toBe(1)
    expect(SessionStatus.get(rootID)).toEqual({ type: "terminal", reason: "aborted", error: reason })
    const task = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
    expect(task).toBeDefined()
    expect(deriveTaskStatus(task!)).toBe("active")
    expect(taskTerminalReason(task!)).toBeUndefined()
    expect(task?.time_completed).toBeNull()
    expect(task?.error).toBe(reason)
    expect(task?.metadata).toEqual(expect.objectContaining({ interrupted: true }))
    const part = (await Message.parts(messageID))[0]
    expect(part?.type).toBe("tool")
    if (part?.type !== "tool") throw new Error("expected tool part")
    expect(part.state.status).toBe("error")
    expect(part.state.failure.message).toBe(reason)
  })
})
