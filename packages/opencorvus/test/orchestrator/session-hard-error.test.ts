import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { findRun } from "../../src/engine/store"
import { Identifier } from "../../src/id/id"
import { Orchestrator } from "../../src/orchestrator/agent"
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
        title: "Hard error task",
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

async function persistDecisionToolMessage(input: { sessionID: string; now: number }) {
  const messageID = Identifier.ascending("message")
  await Session.persistMessage({
    info: {
      id: messageID,
      role: "assistant",
      sessionID: input.sessionID,
      time: { created: input.now, completed: input.now },
      parentID: "",
      finish: "tool-calls",
      agent: "orchestrator",
      providerID: "mock-control",
      modelID: "control",
      path: { cwd: Instance.directory, root: Instance.directory },
      cost: 0,
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      {
        id: Identifier.ascending("part"),
        sessionID: input.sessionID,
        messageID,
        type: "tool",
        callID: "normal-build",
        tool: "build",
        state: {
          status: "completed",
          input: {},
          output: "build dispatched",
          title: "build",
          metadata: { [ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY]: "decision" },
          time: { start: input.now, end: input.now },
        },
      } satisfies Message.ToolPart,
    ],
    touchSessionID: input.sessionID,
  })
}

function finalAssistantMessage(
  input: Parameters<typeof SessionPrompt.prompt>[0],
  now: number,
  options?: {
    text?: string
    error?: unknown
  },
): Message.WithParts {
  return {
    info: {
      id: Identifier.ascending("message"),
      role: "assistant",
      sessionID: input.sessionID,
      time: { created: now, completed: now },
      finish: "stop",
      agent: "orchestrator",
      providerID: "mock-control",
      modelID: "control",
      ...(options?.error ? { error: options.error } : {}),
    },
    parts: options?.text ? [{ type: "text", text: options.text }] : [],
  } as never
}

function structuredOutputPayloadError(message: string) {
  return new Message.StructuredOutputPayloadError({
    message,
    reason: message,
  })
}

describe("orchestrator session hard-error funnel", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("normal final text, stamped hard error, and duplicate event paths", async () => {
    installControlModel()
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompt = spyOn(SessionPrompt, "prompt")
        const createActiveTask = async (title: string) => {
          const now = Date.now()
          const taskID = Identifier.ascending("task")
          const runID = Identifier.ascending("run")
          const root = await Session.create({ kind: "root", title })
          await Session.mergeConfigOverlay({
            sessionID: root.id,
            patch: { model: "mock-control/control" },
          })
          insertActiveRun({ taskID, runID, rootSessionID: root.id, now })
          return { now, taskID, runID }
        }

        const normal = await createActiveTask("Normal orchestrator task")
        prompt.mockImplementation((async (input) => {
          await persistDecisionToolMessage({ sessionID: input.sessionID, now: Date.now() })
          return finalAssistantMessage(input, normal.now, { text: "Current task state recorded." })
        }) as never)

        await Orchestrator.processTask(normal.taskID)

        const normalRun = findRun(normal.runID)
        expect(normalRun?.status).toBe("running")
        expect(normalRun?.blocking_reason).toBeNull()
        expect(streamErrorArtifacts(normal.taskID)).toHaveLength(0)

        const hard = await createActiveTask("Hard error task")
        const stampedError = structuredOutputPayloadError(
          "StructuredOutput payload must be a JSON object; received undefined",
        )
        prompt.mockImplementation((async (input) =>
          finalAssistantMessage(input, hard.now, { error: stampedError })) as never)

        await Orchestrator.processTask(hard.taskID)

        const hardRun = findRun(hard.runID)
        expect(hardRun?.status).toBe("blocked")
        expect(hardRun?.blocking_reason).toBe("orchestrator_stream_error")
        expect(hardRun?.error).toContain("StructuredOutputPayloadError")

        const artifacts = streamErrorArtifacts(hard.taskID)
        const artifact = artifacts[0]
        expect(artifacts).toHaveLength(1)
        expect(artifact).toBeDefined()
        expect((artifact!.payload as { errorName?: string }).errorName).toBe("StructuredOutputPayloadError")
        expect((artifact!.payload as { reason?: string }).reason).toContain("StructuredOutputPayloadError")
        expect((artifact!.payload as { reason?: string }).reason).toContain(
          "StructuredOutput payload must be a JSON object",
        )

        const duplicate = await createActiveTask("Duplicate hard error task")
        const duplicateError = structuredOutputPayloadError("StructuredOutput payload failed during compaction")
        prompt.mockImplementation((async (input) => {
          await Bus.publish(Session.Event.Error, {
            sessionID: input.sessionID,
            error: duplicateError as never,
          })
          return finalAssistantMessage(input, duplicate.now, { error: duplicateError })
        }) as never)

        await Orchestrator.processTask(duplicate.taskID)

        const duplicateRun = findRun(duplicate.runID)
        expect(duplicateRun?.status).toBe("blocked")
        expect(duplicateRun?.blocking_reason).toBe("orchestrator_stream_error")

        const duplicateArtifacts = streamErrorArtifacts(duplicate.taskID)
        expect(duplicateArtifacts).toHaveLength(1)
        expect((duplicateArtifacts[0]!.payload as { errorName?: string }).errorName).toBe(
          "StructuredOutputPayloadError",
        )
        expect((duplicateArtifacts[0]!.payload as { reason?: string }).reason).toContain(
          "StructuredOutput payload failed during compaction",
        )

        const provider = await createActiveTask("Provider validation error task")
        const providerError = new Error(
          "Type validation failed: Value: {\"object\":\"chat.completion\",\"status_code\":66049,\"status_msg\":\"引擎结果格式错误:{'error': {'message': \"'NoneType' object is not iterable\", 'type': 'BadRequestError', 'param': None, 'code': 400}}\"}",
        )
        providerError.name = "AI_TypeValidationError"
        prompt.mockImplementation((async () => {
          throw providerError
        }) as never)

        await Orchestrator.processTask(provider.taskID)

        const providerRun = findRun(provider.runID)
        expect(providerRun?.status).toBe("blocked")
        expect(providerRun?.blocking_reason).toBe("orchestrator_stream_error")
        expect(providerRun?.error).toContain("AI_TypeValidationError")

        const providerArtifacts = streamErrorArtifacts(provider.taskID)
        expect(providerArtifacts).toHaveLength(1)
        expect((providerArtifacts[0]!.payload as { errorName?: string }).errorName).toBe("AI_TypeValidationError")
        expect((providerArtifacts[0]!.payload as { reason?: string }).reason).toContain("NoneType")
      },
    })
  })
})
