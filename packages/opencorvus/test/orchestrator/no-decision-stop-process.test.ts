import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { recordOrchestratorStreamError } from "../../src/engine/persist"
import * as EngineQueue from "../../src/engine/queue"
import { findRun } from "../../src/engine/store"
import { deriveTaskStatus } from "../../src/engine/task-status"
import { Identifier } from "../../src/id/id"
import { Orchestrator } from "../../src/orchestrator/agent"
import * as TaskLoop from "../../src/orchestrator/loop"
import { ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY } from "../../src/orchestrator/stateful-tool-names"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { SessionPrompt } from "../../src/session/prompt"
import { Database, and, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { installControlModel } from "../workspace/mock-control-model"

function insertActiveRun(input: { taskID: string; runID: string; rootSessionID: string; now: number }) {
  Database.use((db) => {
    db.insert(EngineTaskTable)
      .values({
        id: input.taskID,
        project_id: Instance.project.id,
        session_id: input.rootSessionID,
        source: "test",
        title: "Orchestrator no-decision stop",
        request: "do work",
        kind: "workflow",
        priority: "normal",
        time_created: input.now,
        time_updated: input.now,
        time_started: input.now,
      })
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: input.runID,
        task_id: input.taskID,
        run_id: input.runID,
        kind: "run",
        label: "run-running",
        payload: {
          plan_version_id: null,
          session_id: input.rootSessionID,
          executor: "opencorvus",
          status: "running",
          phase: "dispatch",
          blocking_reason: null,
          error: null,
          retry_count: 0,
          executor_ref: null,
          metadata: null,
          time_started: input.now,
          time_completed: null,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  })
}

function streamErrorArtifacts(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "orchestrator-stream-error")))
      .all(),
  )
}

async function persistOrchestratorToolMessage(input: {
  sessionID: string
  tool: string
  callID: string
  now: number
  decisionEffect: "decision" | "observation" | "none"
  output?: string
}) {
  const messageID = Identifier.ascending("message")
  await Session.persistMessage({
    info: {
      id: messageID,
      sessionID: input.sessionID,
      role: "assistant",
      time: { created: input.now, completed: input.now },
      parentID: "",
      modelID: "control",
      providerID: "mock-control",
      agent: "orchestrator",
      path: { cwd: Instance.directory, root: Instance.directory },
      cost: 0,
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "tool-calls",
    },
    parts: [
      {
        id: Identifier.ascending("part"),
        sessionID: input.sessionID,
        messageID,
        type: "tool",
        callID: input.callID,
        tool: input.tool,
        state: {
          status: "completed",
          input: {},
          output: input.output ?? `${input.tool} completed`,
          title: input.tool,
          metadata: { [ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY]: input.decisionEffect },
          time: { start: input.now, end: input.now },
        },
      } satisfies Message.ToolPart,
    ],
    touchSessionID: input.sessionID,
  })
}

async function createOrchestratorSessionWithHistoricalBuild(input: { rootSessionID: string; now: number }) {
  const orchestratorSession = await Session.createNext({
    kind: "orchestrator",
    parentID: input.rootSessionID,
    directory: Instance.directory,
    title: "orchestrator",
  })
  await persistOrchestratorToolMessage({
    sessionID: orchestratorSession.id,
    tool: "build",
    callID: "historical-build",
    now: input.now,
    decisionEffect: "decision",
    output: "historical build dispatched",
  })
  return orchestratorSession
}

function finalAssistantText(input: Parameters<typeof SessionPrompt.prompt>[0], text: string, finish = "stop") {
  const messageID = Identifier.ascending("message")
  const time = Date.now()
  return {
    info: {
      id: messageID,
      sessionID: input.sessionID,
      role: "assistant",
      time: { created: time, completed: time },
      parentID: "",
      modelID: "control",
      providerID: "mock-control",
      agent: "orchestrator",
      path: { cwd: Instance.directory, root: Instance.directory },
      cost: 0,
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      finish,
    },
    parts: [
      {
        id: Identifier.ascending("part"),
        sessionID: input.sessionID,
        messageID,
        type: "text",
        text,
      },
    ],
  } satisfies Message.WithParts
}

function spySelfWakeDispatch() {
  return spyOn(EngineQueue, "dispatchTaskLoop").mockResolvedValue("started")
}

async function waitForCount(read: () => number, count: number, idleTimeoutMs = 15_000) {
  let last = read()
  let deadline = Date.now() + idleTimeoutMs
  while (Date.now() <= deadline) {
    const current = read()
    if (current >= count) return
    if (current !== last) {
      last = current
      deadline = Date.now() + idleTimeoutMs
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for count ${count}; last=${read()}`)
}

describe("orchestrator no-decision stop process", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("plain-text stop on an active task is recorded as a visible orchestrator error", async () => {
    installControlModel()
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const root = await Session.create({ kind: "root", title: "no-decision root" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: { model: "mock-control/control" },
        })
        insertActiveRun({ taskID, runID, rootSessionID: root.id, now })

        const dispatchTaskLoop = spySelfWakeDispatch()
        spyOn(SessionPrompt, "prompt").mockImplementation((async (input) =>
          finalAssistantText(input, "I will keep going, but I am not calling a tool.")) as never)

        await Orchestrator.processTask(taskID)

        const refreshed = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(refreshed?.error ?? null).toBeNull()
        const artifacts = streamErrorArtifacts(taskID)
        expect(artifacts).toHaveLength(1)
        const payload = artifacts[0]!.payload as { errorName?: string; reason?: string }
        expect(payload.errorName).toBe("OrchestratorNoDecisionStopError")
        expect(payload.reason).toContain("OrchestratorNoDecisionStopError")

        const run = findRun(runID)
        expect(run?.status).toBe("running")
        expect(run?.blocking_reason).toBeNull()
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
        const dispatch = dispatchTaskLoop.mock.calls[0]?.[0]
        expect(dispatch?.taskID).toBe(taskID)
        expect(dispatch?.event?.note).toContain("not a user-authored message")
        expect(dispatch?.event?.note).toContain("OrchestratorNoDecisionStopError")
      },
    })
  }, 30_000)

  test("historical action tools do not excuse a later plain-text stop", async () => {
    installControlModel()
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const root = await Session.create({ kind: "root", title: "no-decision root with history" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: { model: "mock-control/control" },
        })
        insertActiveRun({ taskID, runID, rootSessionID: root.id, now })
        await createOrchestratorSessionWithHistoricalBuild({ rootSessionID: root.id, now })

        const dispatchTaskLoop = spySelfWakeDispatch()
        spyOn(SessionPrompt, "prompt").mockImplementation((async (input) =>
          finalAssistantText(input, "There is a previous build in history, but this wake calls no tool.")) as never)

        await Orchestrator.processTask(taskID)

        const artifacts = streamErrorArtifacts(taskID)
        expect(artifacts).toHaveLength(1)
        const payload = artifacts[0]!.payload as { reason?: string }
        expect(payload.reason).toContain("without calling any tool")
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
      },
    })
  }, 30_000)

  test("current read_context after historical build is still no-decision", async () => {
    installControlModel()
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const root = await Session.create({ kind: "root", title: "no-decision root with read context" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: { model: "mock-control/control" },
        })
        insertActiveRun({ taskID, runID, rootSessionID: root.id, now })
        await createOrchestratorSessionWithHistoricalBuild({ rootSessionID: root.id, now })

        const dispatchTaskLoop = spySelfWakeDispatch()
        spyOn(SessionPrompt, "prompt").mockImplementation((async (input) => {
          await persistOrchestratorToolMessage({
            sessionID: input.sessionID,
            tool: "read_context",
            callID: "current-read-context",
            now: Date.now(),
            decisionEffect: "observation",
            output: "current task snapshot",
          })
          return finalAssistantText(input, "The next dispatchable goals are visible, but I am stopping.")
        }) as never)

        await Orchestrator.processTask(taskID)

        const artifacts = streamErrorArtifacts(taskID)
        expect(artifacts).toHaveLength(1)
        const payload = artifacts[0]!.payload as { reason?: string }
        expect(payload.reason).toContain("only observation or pause tools")
        const run = findRun(runID)
        expect(run?.status).toBe("running")
        expect(run?.blocking_reason).toBeNull()
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
      },
    })
  }, 60_000)

  test("no-decision self-wake re-enters through the real task queue", async () => {
    installControlModel()
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const root = await Session.create({ kind: "root", title: "no-decision real queue root" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: { model: "mock-control/control" },
        })
        insertActiveRun({ taskID, runID, rootSessionID: root.id, now })

        const promptInputs: Array<Parameters<typeof SessionPrompt.prompt>[0]> = []
        spyOn(SessionPrompt, "prompt").mockImplementation((async (input) => {
          promptInputs.push(input)
          if (promptInputs.length === 1) {
            return finalAssistantText(input, "I saw the task, but I stopped without calling a tool.")
          }
          await persistOrchestratorToolMessage({
            sessionID: input.sessionID,
            tool: "build",
            callID: "second-wake-build",
            now: Date.now(),
            decisionEffect: "decision",
            output: "second wake dispatched build",
          })
          return finalAssistantText(input, "The second wake made a workflow decision.")
        }) as never)

        const dispatchResult = await EngineQueue.dispatchTaskLoop({ taskID })
        expect(dispatchResult).toBe("started")
        await waitForCount(() => promptInputs.length, 2)
        await TaskLoop.awaitTaskLoopIdle(taskID, 15_000)

        expect(promptInputs).toHaveLength(2)
        const secondText = promptInputs[1]?.parts
          ?.filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text)
          .join("\n")
        expect(secondText).toContain("not a user-authored message")
        expect(secondText).toContain("OrchestratorNoDecisionStopError")
        expect(streamErrorArtifacts(taskID)).toHaveLength(1)
        const run = findRun(runID)
        expect(run?.status).toBe("running")
        expect(run?.blocking_reason).toBeNull()
      },
    })
  }, 30_000)

  test("repeated no-decision failures trip the stream-error fuse instead of self-waking forever", async () => {
    installControlModel()
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const root = await Session.create({ kind: "root", title: "no-decision fuse root" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: { model: "mock-control/control" },
        })
        insertActiveRun({ taskID, runID, rootSessionID: root.id, now })
        recordOrchestratorStreamError({
          taskID,
          reason: "OrchestratorNoDecisionStopError: previous no-decision 1",
          errorName: "OrchestratorNoDecisionStopError",
          sessionID: root.id,
          now: now - 2_000,
        })
        recordOrchestratorStreamError({
          taskID,
          reason: "OrchestratorNoDecisionStopError: previous no-decision 2",
          errorName: "OrchestratorNoDecisionStopError",
          sessionID: root.id,
          now: now - 1_000,
        })

        const dispatchTaskLoop = spySelfWakeDispatch()
        spyOn(SessionPrompt, "prompt").mockImplementation((async (input) =>
          finalAssistantText(input, "I still did not call a tool.")) as never)

        await Orchestrator.processTask(taskID)

        const refreshed = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(refreshed ? deriveTaskStatus(refreshed) : undefined).toBe("failed")
        expect(refreshed?.error).toContain("Orchestrator stream failed 3 consecutive times")
        const run = findRun(runID)
        expect(run?.status).toBe("failed")
        expect(streamErrorArtifacts(taskID)).toHaveLength(3)
        expect(dispatchTaskLoop).not.toHaveBeenCalled()
      },
    })
  }, 30_000)
})
