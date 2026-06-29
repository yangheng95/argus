import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import {
  completeAgentCoordinationAction,
  cancelPendingAgentCoordinationRequest,
  createAgentCoordinationRequest,
  createAgentCoordinationResponse,
  findAgentCoordinationRequest,
  listAgentCoordinationActions,
  listPendingAgentCoordinationRequests,
} from "../../src/engine/agent-coordination"
import { EngineArtifactTable, EngineInteractionRequestTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { EngineInteraction } from "../../src/engine/interaction"
import { Event } from "../../src/engine/model"
import { EngineProtocol } from "../../src/engine/protocol"
import { dispatchTaskLoop, drainPendingQueuedOperatorWakes, queuedTaskEventStats } from "../../src/engine/queue"
import { hooks } from "../../src/engine/state"
import { findTask } from "../../src/engine/store"
import { deriveTaskStatus } from "../../src/engine/task-status"
import {
  completeOrchestratorToolOwnership,
  createOrchestratorToolOwnershipPayload,
  insertOrchestratorToolOwnershipArtifact,
  listLatestOrchestratorToolOwnership,
  listLiveOrchestratorToolOwnership,
} from "../../src/engine/tool-ownership"
import { describeTask, renderTaskDescription } from "../../src/engine/describe"
import { Identifier } from "../../src/id/id"
import * as TaskLoop from "../../src/orchestrator/loop"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { Instance } from "../../src/project/instance"
import { Question } from "../../src/question"
import { ProtocolStore } from "../../src/protocol/store"
import {
  __taskListProjectionEventTypeForTest,
  __taskMessageWatermarkForTest,
} from "../../src/server/routes/orchestrator"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { MessageTable, PartTable } from "../../src/session/session.sql"
import { SessionStatus } from "../../src/session/status"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionPromptState } from "../../src/session/prompt/state"
import { Message } from "../../src/session/message"
import { WorkerTurnDescriptor } from "../../src/agent/worker-turn-descriptor"
import { ensureTaskMessageProtocolBridge } from "../../src/orchestrator/protocol/message-bridge"
import { Database, and, eq } from "../../src/storage/db"
import { timelineMessageOrderKey, timelineOrderKey } from "../../src/timeline/order"
import { executeRequestOrchestratorDecision } from "../../src/tool/request-orchestrator-decision"
import { TaskReportTool } from "../../src/tool/task-report"
import type { Tool } from "../../src/tool/tool"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function sessionOrderKey(sessionID: string, timeCreated: number) {
  return timelineOrderKey({ domain: "session", time: timeCreated, id: sessionID })
}

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

async function readSseUntil(input: {
  label: string
  abort: AbortController
  readEvent: () => Promise<any>
  predicate: (event: any, events: any[]) => boolean
  inactivityMs?: number
}) {
  const events: any[] = []
  const inactivityMs = input.inactivityMs ?? 6_000
  let timeout = setTimeout(() => input.abort.abort(`inactive waiting for ${input.label}`), inactivityMs)
  const refresh = () => {
    clearTimeout(timeout)
    timeout = setTimeout(() => input.abort.abort(`inactive waiting for ${input.label}`), inactivityMs)
  }
  try {
    while (true) {
      const event = await input.readEvent()
      events.push(event)
      if (input.predicate(event, events)) return { event, events }
      refresh()
    }
  } finally {
    clearTimeout(timeout)
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

async function waitForTaskProtocolEvents(taskID: string, count: number) {
  let observed = 0
  let inactiveSince = Date.now()
  while (Date.now() - inactiveSince < 2_000) {
    const events = ProtocolStore.listTaskEvents(taskID).filter((event) => event.type.startsWith("agent.coordination."))
    if (events.length >= count) return events
    if (events.length > observed) {
      observed = events.length
      inactiveSince = Date.now()
    }
    await Bun.sleep(25)
  }
  const events = ProtocolStore.listTaskEvents(taskID).filter((event) => event.type.startsWith("agent.coordination."))
  throw new Error(`A2A protocol events were inactive for 2000ms; expected=${count}; observed=${events.length}`)
}

async function waitForMockCalls(mockFn: { mock: { calls: unknown[] } }, count: number) {
  let observed = mockFn.mock.calls.length
  let inactiveSince = Date.now()
  while (Date.now() - inactiveSince < 2_000) {
    const current = mockFn.mock.calls.length
    if (current >= count) return
    if (current > observed) {
      observed = current
      inactiveSince = Date.now()
    }
    await Bun.sleep(25)
  }
  throw new Error(`Mock calls were inactive for 2000ms; expected=${count}; observed=${mockFn.mock.calls.length}`)
}

async function waitForTaskEventTypes(taskID: string, types: string[]) {
  let observed = 0
  let inactiveSince = Date.now()
  while (Date.now() - inactiveSince < 2_000) {
    const events = ProtocolStore.listTaskEvents(taskID).filter((event) => types.includes(event.type))
    if (events.length >= types.length) return events
    if (events.length > observed) {
      observed = events.length
      inactiveSince = Date.now()
    }
    await Bun.sleep(25)
  }
  const events = ProtocolStore.listTaskEvents(taskID).filter((event) => types.includes(event.type))
  throw new Error(
    `Task protocol event types were inactive for 2000ms; expected=${types.join(",")}; observed=${events
      .map((event) => event.type)
      .join(",")}`,
  )
}

function buildToolOptions(label = "task_conversation") {
  const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  return {
    toolCallId: `cal_${label}_${stamp}`,
    opencorvus: {
      sessionID: `ses_${label}_${stamp}`,
      messageID: `msg_${label}_${stamp}`,
      toolCallID: `cal_${label}_${stamp}`,
      toolPartID: `prt_${label}_${stamp}`,
    },
  } as any
}

async function buildPersistedToolOptions(input: { sessionID: string; label: string; toolName?: string }) {
  const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  const toolName = input.toolName ?? "respond_agent_coordination"
  const messageID = `msg_${input.label}_${stamp}`
  const toolCallID = `cal_${input.label}_${stamp}`
  const toolPartID = `prt_${input.label}_${stamp}`
  const now = Date.now()
  await Session.persistMessage({
    info: {
      id: messageID,
      sessionID: input.sessionID,
      role: "assistant",
      time: { created: now },
      parentID: `msg_user_${input.label}_${stamp}`,
      providerID: "test-provider",
      modelID: "test-model",
      agent: "orchestrator",
      path: { cwd: Instance.directory, root: Instance.worktree },
      cost: 0,
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      {
        id: toolPartID,
        messageID,
        sessionID: input.sessionID,
        type: "tool",
        callID: toolCallID,
        tool: toolName,
        state: {
          status: "running",
          input: {},
          time: { start: now },
        },
      },
    ],
    touchSessionID: input.sessionID,
  })
  return {
    toolCallId: toolCallID,
    opencorvus: {
      sessionID: input.sessionID,
      messageID,
      toolCallID,
      toolPartID,
    },
  } as any
}

function toolText(result: unknown): string {
  if (typeof result === "string") return result
  if (result && typeof result === "object" && typeof (result as { output?: unknown }).output === "string") {
    return (result as { output: string }).output
  }
  throw new Error(`Expected tool text result, got ${JSON.stringify(result)}`)
}

function toolContext(input: {
  taskID: string
  sessionID: string
  agent?: string
  messageID?: string
  callID?: string
}): Tool.Context {
  return {
    sessionID: input.sessionID,
    messageID: input.messageID ?? Identifier.ascending("message"),
    callID: input.callID,
    agent: input.agent ?? "coding",
    abort: new AbortController().signal,
    extra: { taskID: input.taskID },
    messages: [],
    metadata: () => {},
    ask: async () => {},
  }
}

function queuedOperatorWakeLabels(taskID: string): string[] {
  return Database.use((db) =>
    db
      .select({ label: EngineArtifactTable.label })
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "queued_operator_wake")))
      .orderBy(EngineArtifactTable.time_created, EngineArtifactTable.id)
      .all()
      .map((row) => row.label),
  )
}

function queuedOperatorWakePayloads(taskID: string): Array<{
  source_kind?: string
  request_id?: string
  queued_by_process_id?: number
  queued_by_instance_directory?: string
  queued_by_project_id?: string
  event: { note?: string; coordinationRequest?: { requestID?: string } }
}> {
  return Database.use((db) =>
    db
      .select({ payload: EngineArtifactTable.payload })
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "queued_operator_wake")))
      .orderBy(EngineArtifactTable.time_created, EngineArtifactTable.id)
      .all()
      .map(
        (row) =>
          row.payload as {
            source_kind?: string
            request_id?: string
            queued_by_process_id?: number
            queued_by_instance_directory?: string
            queued_by_project_id?: string
            event: { note?: string; coordinationRequest?: { requestID?: string } }
          },
      ),
  )
}

type A2ARestartSeedResult = {
  processID: number
  owner: string
  taskID: string
  rootID: string
  workerID: string
  requestID: string
  ownershipID: string
}

async function waitForSeedOutputWithActivity(input: {
  process: ReturnType<typeof Bun.spawn>
  outputPath: string
  activityPath: string
  label: string
}): Promise<{ seed: A2ARestartSeedResult; exitedBeforeKill: boolean }> {
  let exited = false
  let exitCode: number | null = null
  input.process.exited.then((code) => {
    exited = true
    exitCode = code
  })
  let lastActivity = Date.now()
  let lastSignature = ""
  while (true) {
    const stat = await fs.stat(input.activityPath).catch(() => undefined)
    const signature = stat ? `${stat.mtimeMs}:${stat.size}` : ""
    if (signature && signature !== lastSignature) {
      lastSignature = signature
      lastActivity = Date.now()
    }
    const activityText = await fs.readFile(input.activityPath, "utf8").catch(() => "")
    let activity: { stage?: string } | undefined
    try {
      activity = activityText ? (JSON.parse(activityText) as { stage?: string }) : undefined
    } catch {
      activity = undefined
    }
    if (activity?.stage === "complete") {
      const outputText = await fs.readFile(input.outputPath, "utf8").catch(() => "")
      if (outputText) {
        return { seed: JSON.parse(outputText) as A2ARestartSeedResult, exitedBeforeKill: exited }
      }
    }
    if (exited) {
      throw new Error(
        `${input.label} exited ${exitCode} before durable seed output was complete; last activity=${activityText}`,
      )
    }
    if (Date.now() - lastActivity > 10_000) {
      input.process.kill()
      const latestActivity = await fs.readFile(input.activityPath, "utf8").catch(() => "(missing activity file)")
      throw new Error(`${input.label} was inactive for 10000ms; last activity=${latestActivity}`)
    }
    await Bun.sleep(50)
  }
}

async function seedA2ARestartProcess(input: {
  directory: string
  outputPath: string
  activityPath: string
}): Promise<A2ARestartSeedResult> {
  const home = process.env.OPENCORVUS_HOME
  if (!home) throw new Error("OPENCORVUS_HOME is required for A2A restart seed process")
  const fixture = path.resolve(import.meta.dir, "../fixture/a2a-restart-seed.ts")
  const packageRoot = path.resolve(import.meta.dir, "../..")
  const proc = Bun.spawn(
    ["bun", "run", fixture, home, input.directory, input.outputPath, input.activityPath, "--hold-after-complete"],
    {
      cwd: packageRoot,
      env: { ...process.env, OPENCORVUS_HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const stdoutPromise = new Response(proc.stdout).text()
  const stderrPromise = new Response(proc.stderr).text()
  let seed: A2ARestartSeedResult | undefined
  try {
    const result = await waitForSeedOutputWithActivity({
      process: proc,
      outputPath: input.outputPath,
      activityPath: input.activityPath,
      label: "A2A restart seed process",
    })
    seed = result.seed
    if (result.exitedBeforeKill) {
      throw new Error("A2A restart seed process exited before the destructive kill boundary")
    }
    proc.kill()
    const killedExit = await Promise.race([proc.exited, Bun.sleep(10_000).then(() => null)])
    if (killedExit === null) {
      proc.kill()
      throw new Error("A2A restart seed process did not exit within 10000ms after kill")
    }
  } catch (error) {
    proc.kill()
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
    const activity = await fs.readFile(input.activityPath, "utf8").catch(() => "(missing activity file)")
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nactivity=${activity}\nstdout=${stdout}\nstderr=${stderr}`,
    )
  }
  await Promise.all([stdoutPromise, stderrPromise])
  if (!seed) throw new Error("A2A restart seed process produced no seed result")
  return seed
}

async function waitForQuestionForSession(sessionID: string) {
  let observed = 0
  let inactiveSince = Date.now()
  while (Date.now() - inactiveSince < 2_000) {
    const questions = await Question.list()
    if (questions.length > observed) {
      observed = questions.length
      inactiveSince = Date.now()
    }
    const match = questions.find((question) => question.sessionID === sessionID)
    if (match) return match
    await Bun.sleep(25)
  }
  throw new Error(`Question for session ${sessionID} was inactive for 2000ms`)
}

async function expectA2AActionConversationReplay(input: {
  app: ReturnType<typeof Server.App>
  directory: string
  taskID: string
  decision: string
  action: string
}) {
  await waitForTaskProtocolEvents(input.taskID, 4)
  const latestSequence = ProtocolStore.latestTaskSequence(input.taskID)
  const eventShape = (event: { type?: string; payload?: Record<string, any> }) => ({
    type: event.type,
    decision: event.payload?.decision,
    action: event.payload?.action,
    status: event.payload?.status,
  })
  const expectedResponded = {
    type: "agent.coordination.responded",
    decision: input.decision,
    action: undefined,
    status: undefined,
  }
  const expectedPending = {
    type: "agent.coordination.action",
    decision: undefined,
    action: input.action,
    status: "pending",
  }
  const expectedCompleted = {
    type: "agent.coordination.action",
    decision: undefined,
    action: input.action,
    status: "completed",
  }

  const hydrate = await input.app.request(`/task/${input.taskID}/conversation`, {
    headers: {
      "x-opencorvus-directory": input.directory,
    },
  })
  const hydrateText = await hydrate.text()
  expect({ status: hydrate.status, body: hydrateText }).toMatchObject({ status: 200 })
  const hydrateBody = JSON.parse(hydrateText) as {
    events?: Array<{ type?: string; payload?: Record<string, any> }>
  }
  const hydratedA2A = (hydrateBody.events ?? [])
    .filter((event) => String(event.type || "").startsWith("agent.coordination."))
    .map(eventShape)
  expect(hydratedA2A).toContainEqual(expectedResponded)
  expect(hydratedA2A).toContainEqual(expectedPending)
  expect(hydratedA2A).toContainEqual(expectedCompleted)

  const paged = await input.app.request(
    `/task/${input.taskID}/conversation/events?after=0&until=${latestSequence}&limit=30`,
    {
      headers: {
        "x-opencorvus-directory": input.directory,
      },
    },
  )
  expect(paged.status).toBe(200)
  const pagedBody = (await paged.json()) as {
    events?: Array<{ type?: string; payload?: Record<string, any> }>
    eventReplay?: { latestSequence?: number; complete?: boolean }
  }
  const pagedA2A = (pagedBody.events ?? [])
    .filter((event) => String(event.type || "").startsWith("agent.coordination."))
    .map(eventShape)
  expect(pagedA2A).toContainEqual(expectedResponded)
  expect(pagedA2A).toContainEqual(expectedPending)
  expect(pagedA2A).toContainEqual(expectedCompleted)
  expect(pagedBody.eventReplay).toMatchObject({ latestSequence, complete: true })
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

  test("task conversation routes replay A2A request response and action events", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "A2A replay root",
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: root.id,
          title: "A2A replay worker",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "A2A replay task",
              request: "A2A replay task",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: Identifier.ascending("message"),
          callID: Identifier.ascending("call"),
          summary: "Worker needs scheduler guidance",
          details: "The worker is blocked on a durable A2A decision.",
          blocking: true,
          requestedDecision: "continue",
          severity: "blocked",
        })
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: root.id,
          orchestratorMessageID: Identifier.ascending("message"),
          orchestratorToolCallID: Identifier.ascending("call"),
          orchestratorToolPartID: Identifier.ascending("part"),
          decision: "continue",
          reason: "Continue with the root-cause repair.",
          message: "Use the proven repair path.",
        })
        await completeAgentCoordinationAction({
          taskID,
          actionID: response.payload.action_id,
          workerMessageID: Identifier.ascending("message"),
          result: { session_id: worker.id, resumed: true },
          summary: "continue_worker completed for replay",
        })

        const protocolEvents = await waitForTaskProtocolEvents(taskID, 4)
        const latestSequence = ProtocolStore.latestTaskSequence(taskID)
        expect(protocolEvents.map((event) => event.type)).toEqual([
          "agent.coordination.requested",
          "agent.coordination.responded",
          "agent.coordination.action",
          "agent.coordination.action",
        ])

        const abort = new AbortController()
        let timeout = setTimeout(() => abort.abort("inactive waiting for A2A task event replay"), 6_000)
        const refreshTimeout = () => {
          clearTimeout(timeout)
          timeout = setTimeout(() => abort.abort("inactive waiting for A2A task event replay"), 6_000)
        }
        try {
          const responseStream = await app.request(`/task/${taskID}/events`, {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
            signal: abort.signal,
          })
          expect(responseStream.status).toBe(200)
          const readEvent = sseReader(responseStream)
          const replayed: Array<{ type?: string; payload?: Record<string, unknown> }> = []
          while (replayed.length < 4) {
            const event = await readEvent()
            refreshTimeout()
            if (String(event.type || "").startsWith("agent.coordination.")) replayed.push(event)
          }
          expect(replayed.map((event) => event.type)).toEqual([
            "agent.coordination.requested",
            "agent.coordination.responded",
            "agent.coordination.action",
            "agent.coordination.action",
          ])
          expect(replayed[0]?.payload?.requestID).toBe(request.payload.request_id)
          expect(replayed[1]?.payload?.responseID).toBe(response.payload.response_id)
          expect(replayed[2]?.payload?.status).toBe("pending")
          expect(replayed[3]?.payload?.status).toBe("completed")
        } finally {
          clearTimeout(timeout)
          abort.abort("test complete")
        }

        const hydrate = await app.request(`/task/${taskID}/conversation`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const hydrateText = await hydrate.text()
        expect({ status: hydrate.status, body: hydrateText }).toMatchObject({ status: 200 })
        const hydrateBody = JSON.parse(hydrateText) as {
          events?: Array<{ type?: string; payload?: Record<string, unknown> }>
        }
        const hydrated = (hydrateBody.events ?? []).filter((event) =>
          String(event.type || "").startsWith("agent.coordination."),
        )
        expect(hydrated.map((event) => event.type)).toEqual([
          "agent.coordination.requested",
          "agent.coordination.responded",
          "agent.coordination.action",
          "agent.coordination.action",
        ])

        const paged = await app.request(
          `/task/${taskID}/conversation/events?after=0&until=${latestSequence}&limit=10`,
          {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          },
        )
        expect(paged.status).toBe(200)
        const pagedBody = (await paged.json()) as {
          events?: Array<{ type?: string; payload?: Record<string, unknown> }>
          eventReplay?: { cursor?: number; latestSequence?: number; complete?: boolean }
        }
        const pagedA2A = (pagedBody.events ?? []).filter((event) =>
          String(event.type || "").startsWith("agent.coordination."),
        )
        expect(pagedA2A.map((event) => event.type)).toEqual([
          "agent.coordination.requested",
          "agent.coordination.responded",
          "agent.coordination.action",
          "agent.coordination.action",
        ])
        expect(pagedBody.eventReplay?.latestSequence).toBe(latestSequence)
        expect(pagedBody.eventReplay?.complete).toBe(true)
      },
    })
  })

  test("A2A E2E drives worker request durable wake continue response and conversation replay", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "A2A E2E root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: root.id,
          title: "A2A E2E worker",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "A2A E2E task",
              request: "A worker asks the task orchestrator for a durable scheduling decision.",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const ownership = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: root.id,
          orchestratorMessageID: Identifier.ascending("message"),
          toolPartID: Identifier.ascending("part"),
          toolCallID: Identifier.ascending("call"),
          childSessionID: worker.id,
          toolName: "build",
          scope: "task",
          now,
        })
        insertOrchestratorToolOwnershipArtifact({
          taskID,
          payload: ownership,
          now,
        })

        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const loopSpy = spyOn(SessionPrompt, "loop").mockImplementation(async (input: any) => {
          const sessionID = String(input.sessionID)
          SessionStatus.set(sessionID, { type: "terminal", reason: "completed" })
          return {
            info: {
              id: Identifier.ascending("message"),
              role: "assistant",
              sessionID,
            },
            parts: [],
          } as any
        })

        const requestToolResult = await executeRequestOrchestratorDecision(
          {
            summary: "Need continuation decision",
            details: "The worker has reached a scheduling boundary and must not continue silently.",
            blocking: true,
            requested_decision: "continue this same worker session",
            evidence_refs: ["artifact:a2a-e2e"],
            severity: "blocked",
          },
          toolContext({
            taskID,
            sessionID: worker.id,
            agent: "coding",
            messageID: Identifier.ascending("message"),
            callID: Identifier.ascending("call"),
          }),
          dispatchTaskLoop,
        )
        const requestOutput = JSON.parse(requestToolResult.output) as {
          request_id: string
          orchestrator_wake: string
        }
        const requestID = requestOutput.request_id

        expect(requestOutput.orchestrator_wake).toBe("queued")
        expect(findAgentCoordinationRequest({ taskID, requestID })?.payload.status).toBe("pending")
        expect(queuedTaskEventStats(taskID)).toMatchObject({ tasks: 1, events: 1 })
        expect(queuedOperatorWakePayloads(taskID)).toEqual([
          expect.objectContaining({
            source_kind: "coordination_request",
            request_id: requestID,
            event: expect.objectContaining({
              coordinationRequest: { requestID },
            }),
          }),
        ])
        expect(runTaskLoop).not.toHaveBeenCalled()

        const taskDescription = renderTaskDescription(await describeTask(taskID))
        expect(taskDescription).toContain("Pending agent coordination requests")
        expect(taskDescription).toContain(`request=${requestID}`)
        expect(taskDescription).toContain("Need continuation decision")

        completeOrchestratorToolOwnership({
          taskID,
          ownershipID: ownership.ownership_id,
          outcome: "completed",
          now: now + 1,
        })
        await waitForMockCalls(runTaskLoop, 1)
        expect(await drainPendingQueuedOperatorWakes()).toBe(0)
        expect(queuedTaskEventStats(taskID)).toMatchObject({ tasks: 0, events: 0 })
        expect(queuedOperatorWakeLabels(taskID)).toEqual(["drained"])
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          event: {
            coordinationRequest: { requestID },
          },
        })

        const abort = new AbortController()
        const responseStream = await app.request(`/task/${taskID}/events`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
          signal: abort.signal,
        })
        expect(responseStream.status).toBe(200)
        const readEvent = sseReader(responseStream)
        const streamEvents: Array<{ type?: string; sequence?: number; payload?: any }> = []
        let workerMessageID = ""
        const readUntil = async (label: string, predicate: () => boolean) => {
          let timeout = setTimeout(() => abort.abort(`inactive waiting for ${label}`), 6_000)
          const refresh = () => {
            clearTimeout(timeout)
            timeout = setTimeout(() => abort.abort(`inactive waiting for ${label}`), 6_000)
          }
          try {
            while (true) {
              const event = await readEvent()
              streamEvents.push(event)
              refresh()
              if (predicate()) return
            }
          } finally {
            clearTimeout(timeout)
          }
        }

        try {
          await readUntil("A2A E2E stream connection", () =>
            streamEvents.some((event) => event.type === "task.connected"),
          )

          const orchestrator = await Session.create({
            kind: "orchestrator",
            parentID: root.id,
            title: "A2A E2E orchestrator",
          })
          const { tools } = createOrchestratorTools({
            taskID,
            agentSessionID: orchestrator.id,
            signal: new AbortController().signal,
          })
          const responseText = toolText(
            await tools.respond_agent_coordination.execute(
              {
                request_id: requestID,
                decision: "continue",
                message: "Continue the same worker session and finish with terminal status evidence.",
                reason: "The worker request is valid and the existing session remains the correct execution handle.",
              },
              await buildPersistedToolOptions({
                sessionID: orchestrator.id,
                label: "respond_agent_coordination_e2e",
              }),
            ),
          )
          expect(responseText).toContain(`Responded to coordination request ${requestID} with continue`)

          const actions = listAgentCoordinationActions(taskID)
          expect(actions).toHaveLength(1)
          const action = actions[0]!
          expect(action.payload).toMatchObject({
            request_id: requestID,
            action: "continue_worker",
            status: "completed",
            target_session_id: worker.id,
            result: { session_id: worker.id, resumed: true },
          })
          workerMessageID = String(action.payload.worker_message_id ?? "")
          expect(typeof workerMessageID).toBe("string")
          expect(workerMessageID.length).toBeGreaterThan(0)
          expect(findAgentCoordinationRequest({ taskID, requestID })?.payload.status).toBe("responded")
          expect(loopSpy).toHaveBeenCalledWith({ sessionID: worker.id, resume_existing: true })

          await readUntil(
            "A2A E2E worker message and terminal status",
            () =>
              streamEvents.some(
                (event) =>
                  event.type === "message.updated" &&
                  event.payload?.info?.id === workerMessageID &&
                  event.payload?.info?.sessionID === worker.id,
              ) &&
              streamEvents.some(
                (event) =>
                  event.type === "session.status" &&
                  event.payload?.sessionID === worker.id &&
                  event.payload?.status?.type === "terminal" &&
                  event.payload?.status?.reason === "completed",
              ),
          )

          const protocolEvents = await waitForTaskProtocolEvents(taskID, 5)
          expect(protocolEvents.map((event) => event.type)).toEqual([
            "agent.coordination.requested",
            "agent.coordination.responded",
            "agent.coordination.action",
            "agent.coordination.action",
            "agent.coordination.action",
          ])
          expect(
            protocolEvents
              .filter((event) => event.type === "agent.coordination.action")
              .map((event) => event.payload.status),
          ).toEqual(["pending", "pending", "completed"])
          await waitForTaskEventTypes(taskID, ["session.status"])

          const liveWorkerMessage = streamEvents.find(
            (event) => event.type === "message.updated" && event.payload?.info?.id === workerMessageID,
          )
          expect(liveWorkerMessage?.sequence).toBe(0)
          expect(liveWorkerMessage?.payload?.info?.channel).toBe("assistant")
          expect(liveWorkerMessage?.payload?.info?.resolvedRole).toBe("orchestrator")
        } finally {
          abort.abort("test complete")
        }

        const workerMessages: Message.WithParts[] = []
        for await (const item of Message.stream(worker.id)) workerMessages.push(item)
        const continuationMessage = workerMessages.find((item) => item.info.id === workerMessageID)
        expect(
          continuationMessage?.parts.some(
            (part) => part.type === "text" && part.text.includes("Orchestrator Coordination Response"),
          ),
        ).toBe(true)

        const latestSequence = ProtocolStore.latestTaskSequence(taskID)
        const hydrate = await app.request(`/task/${taskID}/conversation`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const hydrateText = await hydrate.text()
        expect({ status: hydrate.status, body: hydrateText }).toMatchObject({ status: 200 })
        const hydrateBody = JSON.parse(hydrateText) as {
          transcript?: Array<{
            info?: { id?: string; sessionID?: string; channel?: string; resolvedRole?: string }
            parts?: Array<{ type?: string; text?: string }>
          }>
          events?: Array<{ type?: string; payload?: Record<string, any> }>
          agentView?: { sessions?: Array<{ sessionID?: string; messageIDs?: string[]; status?: string }> }
        }
        const hydratedWorkerMessage = hydrateBody.transcript?.find((message) => message.info?.id === workerMessageID)
        expect(hydratedWorkerMessage?.info).toMatchObject({
          sessionID: worker.id,
          channel: "assistant",
          resolvedRole: "orchestrator",
        })
        expect(
          hydratedWorkerMessage?.parts?.some(
            (part) => part.type === "text" && part.text?.includes("Orchestrator Coordination Response"),
          ),
        ).toBe(true)
        const hydratedA2AEvents =
          hydrateBody.events?.filter((event) => String(event.type || "").startsWith("agent.coordination.")) ?? []
        expect(hydratedA2AEvents.map((event) => event.type)).toEqual([
          "agent.coordination.requested",
          "agent.coordination.responded",
          "agent.coordination.action",
          "agent.coordination.action",
          "agent.coordination.action",
        ])
        expect(
          hydratedA2AEvents
            .filter((event) => event.type === "agent.coordination.action")
            .map((event) => event.payload?.status),
        ).toEqual(["pending", "pending", "completed"])
        expect(hydrateBody.events?.some((event) => event.type === "session.status")).toBe(true)
        expect(hydrateBody.agentView?.sessions).toContainEqual(
          expect.objectContaining({
            sessionID: worker.id,
            messageIDs: expect.arrayContaining([workerMessageID]),
            status: "completed",
          }),
        )

        const paged = await app.request(
          `/task/${taskID}/conversation/events?after=0&until=${latestSequence}&limit=20`,
          {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          },
        )
        expect(paged.status).toBe(200)
        const pagedBody = (await paged.json()) as {
          events?: Array<{ type?: string; payload?: Record<string, any> }>
          eventReplay?: { latestSequence?: number; complete?: boolean }
        }
        const pagedTypes = (pagedBody.events ?? []).map((event) => event.type)
        const pagedA2AEvents =
          pagedBody.events?.filter((event) => String(event.type || "").startsWith("agent.coordination.")) ?? []
        expect(pagedA2AEvents.map((event) => event.type)).toEqual([
          "agent.coordination.requested",
          "agent.coordination.responded",
          "agent.coordination.action",
          "agent.coordination.action",
          "agent.coordination.action",
        ])
        expect(
          pagedA2AEvents
            .filter((event) => event.type === "agent.coordination.action")
            .map((event) => event.payload?.status),
        ).toEqual(["pending", "pending", "completed"])
        expect(pagedTypes).toContain("session.status")
        expect(pagedBody.events?.find((event) => event.type === "session.status")?.payload).toMatchObject({
          sessionID: worker.id,
          status: { type: "terminal", reason: "completed" },
        })
        expect(pagedBody.eventReplay).toMatchObject({ latestSequence, complete: true })
      },
    })
  }, 60_000)

  test("A2A E2E recovers queued coordination request across a process restart boundary", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })
    const outputPath = path.join(tmp.path, ".a2a-restart-seed.json")
    const activityPath = path.join(tmp.path, ".a2a-restart-seed.activity.json")
    const seed = await seedA2ARestartProcess({
      directory: tmp.path,
      outputPath,
      activityPath,
    })
    expect(seed.processID).not.toBe(process.pid)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const loopSpy = spyOn(SessionPrompt, "loop").mockImplementation(async (input: any) => {
          const sessionID = String(input.sessionID)
          SessionStatus.set(sessionID, { type: "terminal", reason: "completed" })
          return {
            info: {
              id: Identifier.ascending("message"),
              role: "assistant",
              sessionID,
            },
            parts: [],
          } as any
        })

        expect(findAgentCoordinationRequest({ taskID: seed.taskID, requestID: seed.requestID })?.payload.status).toBe(
          "pending",
        )
        expect(queuedTaskEventStats(seed.taskID)).toMatchObject({ tasks: 1, events: 1 })
        expect(queuedOperatorWakePayloads(seed.taskID)).toEqual([
          expect.objectContaining({
            source_kind: "coordination_request",
            request_id: seed.requestID,
            queued_by_process_id: seed.processID,
            queued_by_instance_directory: tmp.path,
            queued_by_project_id: Instance.project.id,
            event: expect.objectContaining({
              coordinationRequest: { requestID: seed.requestID },
            }),
          }),
        ])
        const latestOwnership = listLatestOrchestratorToolOwnership(seed.taskID).find(
          (row) => row.ownershipID === seed.ownershipID,
        )
        expect(latestOwnership?.payload.owner).toBe(seed.owner)
        expect(listLiveOrchestratorToolOwnership(seed.taskID).map((row) => row.ownershipID)).not.toContain(
          seed.ownershipID,
        )
        expect(runTaskLoop).not.toHaveBeenCalled()

        expect(await drainPendingQueuedOperatorWakes()).toBe(1)
        await waitForMockCalls(runTaskLoop, 1)
        expect(queuedTaskEventStats(seed.taskID)).toMatchObject({ tasks: 0, events: 0 })
        expect(queuedOperatorWakeLabels(seed.taskID)).toEqual(["drained"])
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID: seed.taskID,
          event: {
            coordinationRequest: { requestID: seed.requestID },
          },
        })

        const abort = new AbortController()
        const responseStream = await app.request(`/task/${seed.taskID}/events`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
          signal: abort.signal,
        })
        expect(responseStream.status).toBe(200)
        const readEvent = sseReader(responseStream)
        const streamEvents: Array<{ type?: string; sequence?: number; payload?: any }> = []
        let workerMessageID = ""
        const readUntil = async (label: string, predicate: () => boolean) => {
          let timeout = setTimeout(() => abort.abort(`inactive waiting for ${label}`), 6_000)
          const refresh = () => {
            clearTimeout(timeout)
            timeout = setTimeout(() => abort.abort(`inactive waiting for ${label}`), 6_000)
          }
          try {
            while (true) {
              const event = await readEvent()
              streamEvents.push(event)
              refresh()
              if (predicate()) return
            }
          } finally {
            clearTimeout(timeout)
          }
        }

        try {
          await readUntil("A2A restart stream connection", () =>
            streamEvents.some((event) => event.type === "task.connected"),
          )

          const orchestrator = await Session.create({
            kind: "orchestrator",
            parentID: seed.rootID,
            title: "A2A restart orchestrator",
          })
          const { tools } = createOrchestratorTools({
            taskID: seed.taskID,
            agentSessionID: orchestrator.id,
            signal: new AbortController().signal,
          })
          const responseText = toolText(
            await tools.respond_agent_coordination.execute(
              {
                request_id: seed.requestID,
                decision: "continue",
                message: "Continue the recovered worker session and finish with terminal status evidence.",
                reason: "The request survived the original host process boundary and the same worker remains valid.",
              },
              await buildPersistedToolOptions({
                sessionID: orchestrator.id,
                label: "respond_agent_coordination_restart_e2e",
              }),
            ),
          )
          expect(responseText).toContain(`Responded to coordination request ${seed.requestID} with continue`)

          const actions = listAgentCoordinationActions(seed.taskID)
          expect(actions).toHaveLength(1)
          const action = actions[0]!
          expect(action.payload).toMatchObject({
            request_id: seed.requestID,
            action: "continue_worker",
            status: "completed",
            target_session_id: seed.workerID,
            result: { session_id: seed.workerID, resumed: true },
          })
          workerMessageID = String(action.payload.worker_message_id ?? "")
          expect(workerMessageID.length).toBeGreaterThan(0)
          expect(findAgentCoordinationRequest({ taskID: seed.taskID, requestID: seed.requestID })?.payload.status).toBe(
            "responded",
          )
          expect(loopSpy).toHaveBeenCalledWith({ sessionID: seed.workerID, resume_existing: true })

          await readUntil(
            "A2A restart worker message and terminal status",
            () =>
              streamEvents.some(
                (event) =>
                  event.type === "message.updated" &&
                  event.payload?.info?.id === workerMessageID &&
                  event.payload?.info?.sessionID === seed.workerID,
              ) &&
              streamEvents.some(
                (event) =>
                  event.type === "session.status" &&
                  event.payload?.sessionID === seed.workerID &&
                  event.payload?.status?.type === "terminal" &&
                  event.payload?.status?.reason === "completed",
              ),
          )

          const protocolEvents = await waitForTaskProtocolEvents(seed.taskID, 5)
          expect(protocolEvents.map((event) => event.type)).toEqual([
            "agent.coordination.requested",
            "agent.coordination.responded",
            "agent.coordination.action",
            "agent.coordination.action",
            "agent.coordination.action",
          ])
          expect(
            protocolEvents
              .filter((event) => event.type === "agent.coordination.action")
              .map((event) => event.payload.status),
          ).toEqual(["pending", "pending", "completed"])
          await waitForTaskEventTypes(seed.taskID, ["session.status"])
        } finally {
          abort.abort("test complete")
        }

        const workerMessages: Message.WithParts[] = []
        for await (const item of Message.stream(seed.workerID)) workerMessages.push(item)
        const continuationMessage = workerMessages.find((item) => item.info.id === workerMessageID)
        expect(
          continuationMessage?.parts.some(
            (part) => part.type === "text" && part.text.includes("Orchestrator Coordination Response"),
          ),
        ).toBe(true)

        const latestSequence = ProtocolStore.latestTaskSequence(seed.taskID)
        const hydrate = await app.request(`/task/${seed.taskID}/conversation`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const hydrateText = await hydrate.text()
        expect({ status: hydrate.status, body: hydrateText }).toMatchObject({ status: 200 })
        const hydrateBody = JSON.parse(hydrateText) as {
          transcript?: Array<{
            info?: { id?: string; sessionID?: string; channel?: string; resolvedRole?: string }
            parts?: Array<{ type?: string; text?: string }>
          }>
          events?: Array<{ type?: string; payload?: Record<string, any> }>
          agentView?: { sessions?: Array<{ sessionID?: string; messageIDs?: string[]; status?: string }> }
        }
        const hydratedWorkerMessage = hydrateBody.transcript?.find((message) => message.info?.id === workerMessageID)
        expect(hydratedWorkerMessage?.info).toMatchObject({
          sessionID: seed.workerID,
          channel: "assistant",
          resolvedRole: "orchestrator",
        })
        expect(
          hydratedWorkerMessage?.parts?.some(
            (part) => part.type === "text" && part.text?.includes("Orchestrator Coordination Response"),
          ),
        ).toBe(true)
        const hydratedA2AEvents =
          hydrateBody.events?.filter((event) => String(event.type || "").startsWith("agent.coordination.")) ?? []
        expect(hydratedA2AEvents.map((event) => event.type)).toEqual([
          "agent.coordination.requested",
          "agent.coordination.responded",
          "agent.coordination.action",
          "agent.coordination.action",
          "agent.coordination.action",
        ])
        expect(
          hydratedA2AEvents
            .filter((event) => event.type === "agent.coordination.action")
            .map((event) => event.payload?.status),
        ).toEqual(["pending", "pending", "completed"])
        expect(hydrateBody.events?.some((event) => event.type === "session.status")).toBe(true)
        expect(hydrateBody.agentView?.sessions).toContainEqual(
          expect.objectContaining({
            sessionID: seed.workerID,
            messageIDs: expect.arrayContaining([workerMessageID]),
            status: "completed",
          }),
        )

        const paged = await app.request(
          `/task/${seed.taskID}/conversation/events?after=0&until=${latestSequence}&limit=20`,
          {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          },
        )
        expect(paged.status).toBe(200)
        const pagedBody = (await paged.json()) as {
          events?: Array<{ type?: string; payload?: Record<string, any> }>
          eventReplay?: { latestSequence?: number; complete?: boolean }
        }
        const pagedA2AEvents =
          pagedBody.events?.filter((event) => String(event.type || "").startsWith("agent.coordination.")) ?? []
        expect(pagedA2AEvents.map((event) => event.type)).toEqual([
          "agent.coordination.requested",
          "agent.coordination.responded",
          "agent.coordination.action",
          "agent.coordination.action",
          "agent.coordination.action",
        ])
        expect(
          pagedA2AEvents
            .filter((event) => event.type === "agent.coordination.action")
            .map((event) => event.payload?.status),
        ).toEqual(["pending", "pending", "completed"])
        expect(pagedBody.events?.find((event) => event.type === "session.status")?.payload).toMatchObject({
          sessionID: seed.workerID,
          status: { type: "terminal", reason: "completed" },
        })
        expect(pagedBody.eventReplay).toMatchObject({ latestSequence, complete: true })
      },
    })
  }, 60_000)

  test("A2A sibling decisions expose visible action chains through conversation replay", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        EngineInteraction.subscribe(hooks())
        const loopSpy = spyOn(SessionPrompt, "loop").mockImplementation(async (input: any) => {
          const sessionID = String(input.sessionID)
          SessionStatus.set(sessionID, { type: "terminal", reason: "completed" })
          return {
            info: {
              id: Identifier.ascending("message"),
              role: "assistant",
              sessionID,
            },
            parts: [],
          } as any
        })
        const interruptTaskLoop = spyOn(TaskLoop, "interruptTaskLoop")

        async function seedTask(label: string, workerKind = "assistant") {
          const now = Date.now()
          const taskID = Identifier.ascending("task")
          const root = await Session.create({
            kind: "root",
            title: `A2A ${label} root`,
            metadata: { configOverlay: { model: "openai/gpt-5.5" } },
          })
          const worker = await Session.create({
            kind: workerKind as any,
            parentID: root.id,
            title: `A2A ${label} worker`,
          })
          const orchestrator = await Session.create({
            kind: "orchestrator",
            parentID: root.id,
            title: `A2A ${label} orchestrator`,
          })
          Database.use((db) =>
            db
              .insert(EngineTaskTable)
              .values({
                id: taskID,
                project_id: Instance.project.id,
                session_id: root.id,
                source: "panel",
                title: `A2A ${label} task`,
                request: `A2A ${label} visible action route coverage.`,
                kind: "workflow",
                priority: "normal",
                time_created: now,
                time_updated: now,
                time_started: now,
              })
              .run(),
          )
          return { taskID, root, worker, orchestrator }
        }

        async function createRequest(input: {
          taskID: string
          sessionID: string
          summary: string
          requestedDecision: string
          severity?: "blocked" | "failure"
          agent?: string
        }) {
          return createAgentCoordinationRequest({
            taskID: input.taskID,
            sessionID: input.sessionID,
            agent: input.agent ?? "coding",
            messageID: Identifier.ascending("message"),
            callID: Identifier.ascending("call"),
            summary: input.summary,
            details: `${input.summary} requires a concrete orchestrator-visible A2A action.`,
            blocking: true,
            requestedDecision: input.requestedDecision,
            severity: input.severity ?? "blocked",
          })
        }

        const cancel = await seedTask("cancel")
        const cancelRequest = await createRequest({
          taskID: cancel.taskID,
          sessionID: cancel.worker.id,
          summary: "Cancel the invalid worker path",
          requestedDecision: "cancel_worker",
        })
        const cancelTools = createOrchestratorTools({
          taskID: cancel.taskID,
          agentSessionID: cancel.orchestrator.id,
          signal: new AbortController().signal,
        }).tools
        const cancelResult = toolText(
          await cancelTools.respond_agent_coordination.execute(
            {
              request_id: cancelRequest.payload.request_id,
              decision: "cancel_worker",
              reason: "The worker path is invalid and should stop before redispatch.",
            },
            await buildPersistedToolOptions({
              sessionID: cancel.orchestrator.id,
              label: "a2a_route_cancel",
            }),
          ),
        )
        expect(cancelResult).toContain(`Responded to coordination request ${cancelRequest.payload.request_id}`)
        const cancelAction = listAgentCoordinationActions(cancel.taskID)[0]
        expect(cancelAction?.payload).toMatchObject({
          request_id: cancelRequest.payload.request_id,
          action: "cancel_worker",
          status: "completed",
          target_session_id: cancel.worker.id,
          result: { session_id: cancel.worker.id, kind: "assistant" },
        })
        await expectA2AActionConversationReplay({
          app,
          directory: tmp.path,
          taskID: cancel.taskID,
          decision: "cancel_worker",
          action: "cancel_worker",
        })

        const ask = await seedTask("ask-user")
        const askRequest = await createRequest({
          taskID: ask.taskID,
          sessionID: ask.worker.id,
          summary: "Ask the user for the implementation approach",
          requestedDecision: "ask_user",
        })
        const askTools = createOrchestratorTools({
          taskID: ask.taskID,
          agentSessionID: ask.orchestrator.id,
          signal: new AbortController().signal,
        }).tools
        const askPromise = askTools.respond_agent_coordination.execute(
          {
            request_id: askRequest.payload.request_id,
            decision: "ask_user",
            questions: [
              {
                header: "Approach",
                question: "Which A2A repair approach should the worker use?",
                options: [
                  { label: "Minimal", description: "Use the smallest safe change." },
                  { label: "Root cause", description: "Use the deeper root-cause repair." },
                ],
              },
            ],
            reason: "The worker needs a user-owned policy choice.",
          },
          await buildPersistedToolOptions({
            sessionID: ask.orchestrator.id,
            label: "a2a_route_ask_user",
          }),
        )
        const question = await waitForQuestionForSession(ask.orchestrator.id)
        await Question.reply({ requestID: question.id, answers: [["Root cause"]] })
        const askResult = toolText(await askPromise)
        expect(askResult).toContain(`Responded to coordination request ${askRequest.payload.request_id}`)
        const askAction = listAgentCoordinationActions(ask.taskID)[0]
        const interactionID = String(askAction?.payload.result?.interaction_id ?? "")
        expect(interactionID.length).toBeGreaterThan(0)
        const interaction = Database.use((db) =>
          db
            .select()
            .from(EngineInteractionRequestTable)
            .where(eq(EngineInteractionRequestTable.id, interactionID))
            .get(),
        )
        expect(interaction).toMatchObject({
          task_id: ask.taskID,
          status: "answered",
          external_id: question.id,
        })
        expect(askAction?.payload).toMatchObject({
          request_id: askRequest.payload.request_id,
          action: "ask_user",
          status: "completed",
          target_session_id: ask.worker.id,
          result: {
            question_id: question.id,
            interaction_id: interactionID,
            interaction_status: "answered",
            answers: [["Root cause"]],
          },
        })
        await expectA2AActionConversationReplay({
          app,
          directory: tmp.path,
          taskID: ask.taskID,
          decision: "ask_user",
          action: "ask_user",
        })

        const redispatch = await seedTask("generic-redispatch")
        const redispatchRequest = await createRequest({
          taskID: redispatch.taskID,
          sessionID: redispatch.worker.id,
          summary: "Start a replacement same-kind worker pass",
          requestedDecision: "redispatch",
        })
        const redispatchTools = createOrchestratorTools({
          taskID: redispatch.taskID,
          agentSessionID: redispatch.orchestrator.id,
          signal: new AbortController().signal,
        }).tools
        const loopCallCountBeforeRedispatch = loopSpy.mock.calls.length
        const redispatchResult = toolText(
          await redispatchTools.respond_agent_coordination.execute(
            {
              request_id: redispatchRequest.payload.request_id,
              decision: "redispatch",
              message: "Start a fresh pass with the clarified scope.",
              reason: "Exercise generic redispatch refusal.",
            },
            await buildPersistedToolOptions({
              sessionID: redispatch.orchestrator.id,
              label: "a2a_route_redispatch",
            }),
          ),
        )
        expect(redispatchResult).toContain("refused redispatch")
        expect(redispatchResult).toContain("same-kind session redispatch is not an accepted A2A action")
        expect(
          findAgentCoordinationRequest({
            taskID: redispatch.taskID,
            requestID: redispatchRequest.payload.request_id,
          })?.payload.status,
        ).toBe("pending")
        expect(listAgentCoordinationActions(redispatch.taskID)).toHaveLength(0)
        expect(loopSpy.mock.calls.length).toBe(loopCallCountBeforeRedispatch)
        const redispatchHydrate = await app.request(`/task/${redispatch.taskID}/conversation`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(redispatchHydrate.status).toBe(200)
        const redispatchHydrateBody = (await redispatchHydrate.json()) as {
          events?: Array<{ type?: string; payload?: Record<string, any> }>
        }
        const redispatchA2A = (redispatchHydrateBody.events ?? []).filter((event) =>
          String(event.type || "").startsWith("agent.coordination."),
        )
        expect(redispatchA2A.map((event) => event.type)).toEqual(["agent.coordination.requested"])

        const acceptedRedispatch = await seedTask("accepted-redispatch", "explore")
        const acceptedRedispatchRequest = await createRequest({
          taskID: acceptedRedispatch.taskID,
          sessionID: acceptedRedispatch.worker.id,
          agent: "explore",
          summary: "Start a replacement explore stage",
          requestedDecision: "redispatch",
        })
        const acceptedRedispatchOptions = await buildPersistedToolOptions({
          sessionID: acceptedRedispatch.orchestrator.id,
          label: "a2a_route_accepted_redispatch",
        })
        const acceptedRedispatchResponse = await createAgentCoordinationResponse({
          taskID: acceptedRedispatch.taskID,
          requestID: acceptedRedispatchRequest.payload.request_id,
          orchestratorSessionID: acceptedRedispatchOptions.opencorvus.sessionID,
          orchestratorMessageID: acceptedRedispatchOptions.opencorvus.messageID,
          orchestratorToolCallID: acceptedRedispatchOptions.opencorvus.toolCallID,
          orchestratorToolPartID: acceptedRedispatchOptions.opencorvus.toolPartID,
          decision: "redispatch",
          reason: "Replacement explore stage has a concrete dispatcher binding.",
          message: "Run the replacement explore stage.",
          redispatchBinding: {
            dispatcher: "explore_stage",
            stage: "explore",
            target_kind: "explore",
          },
        })
        const acceptedRedispatchAction = listAgentCoordinationActions(acceptedRedispatch.taskID)[0]
        expect(acceptedRedispatchAction?.payload).toMatchObject({
          request_id: acceptedRedispatchRequest.payload.request_id,
          response_id: acceptedRedispatchResponse.payload.response_id,
          action: "redispatch_worker",
          status: "pending",
          target_session_id: acceptedRedispatch.worker.id,
          target_agent: "explore",
          result: {
            redispatch_binding: {
              dispatcher: "explore_stage",
              stage: "explore",
              target_kind: "explore",
            },
          },
        })
        await completeAgentCoordinationAction({
          taskID: acceptedRedispatch.taskID,
          actionID: acceptedRedispatchResponse.payload.action_id,
          result: {
            dispatcher: "explore_stage",
            replacement_session_id: "ses_replacement_explore",
          },
          summary: "redispatch_worker replacement explore stage completed",
        })
        await expectA2AActionConversationReplay({
          app,
          directory: tmp.path,
          taskID: acceptedRedispatch.taskID,
          decision: "redispatch",
          action: "redispatch_worker",
        })

        const cancelled = await seedTask("cancelled-request")
        const cancelledRequest = await createRequest({
          taskID: cancelled.taskID,
          sessionID: cancelled.worker.id,
          summary: "Cancel the pending coordination request",
          requestedDecision: "cancel_worker",
        })
        const abortCancelledStream = new AbortController()
        const cancelledStream = await app.request(`/task/${cancelled.taskID}/events`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
          signal: abortCancelledStream.signal,
        })
        expect(cancelledStream.status).toBe(200)
        const readCancelledEvent = sseReader(cancelledStream)
        const cancelledStreamEvents: Array<{ type?: string; payload?: any }> = []
        const readCancelledUntil = async (label: string, predicate: () => boolean) => {
          let timeout = setTimeout(() => abortCancelledStream.abort(`inactive waiting for ${label}`), 6_000)
          const refresh = () => {
            clearTimeout(timeout)
            timeout = setTimeout(() => abortCancelledStream.abort(`inactive waiting for ${label}`), 6_000)
          }
          try {
            while (true) {
              const event = await readCancelledEvent()
              cancelledStreamEvents.push(event)
              refresh()
              if (predicate()) return
            }
          } finally {
            clearTimeout(timeout)
          }
        }
        try {
          await readCancelledUntil("A2A cancelled stream connection", () =>
            cancelledStreamEvents.some((event) => event.type === "task.connected"),
          )
          const cancelledCount = await cancelPendingAgentCoordinationRequest({
            taskID: cancelled.taskID,
            requestID: cancelledRequest.payload.request_id,
            reason: "operator rejected the pending worker request",
          })
          expect(cancelledCount).toBe(1)
          await readCancelledUntil("A2A cancelled live event", () =>
            cancelledStreamEvents.some(
              (event) =>
                event.type === "agent.coordination.cancelled" &&
                event.payload?.requestID === cancelledRequest.payload.request_id,
            ),
          )
        } finally {
          abortCancelledStream.abort("test complete")
        }
        const cancelledHydrate = await app.request(`/task/${cancelled.taskID}/conversation`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(cancelledHydrate.status).toBe(200)
        const cancelledHydrateBody = (await cancelledHydrate.json()) as {
          events?: Array<{ type?: string; payload?: Record<string, any> }>
        }
        const cancelledHydrateA2A = (cancelledHydrateBody.events ?? []).filter((event) =>
          String(event.type || "").startsWith("agent.coordination."),
        )
        expect(cancelledHydrateA2A.map((event) => event.type)).toEqual([
          "agent.coordination.requested",
          "agent.coordination.cancelled",
        ])
        expect(cancelledHydrateA2A[1]?.payload?.requestID).toBe(cancelledRequest.payload.request_id)
        const cancelledReplay = await app.request(
          `/task/${cancelled.taskID}/conversation/events?after=0&until=${ProtocolStore.latestTaskSequence(
            cancelled.taskID,
          )}&limit=10`,
          {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          },
        )
        expect(cancelledReplay.status).toBe(200)
        const cancelledReplayBody = (await cancelledReplay.json()) as {
          events?: Array<{ type?: string; payload?: Record<string, any> }>
          eventReplay?: { complete?: boolean }
        }
        const cancelledReplayA2A = (cancelledReplayBody.events ?? []).filter((event) =>
          String(event.type || "").startsWith("agent.coordination."),
        )
        expect(cancelledReplayA2A.map((event) => event.type)).toEqual([
          "agent.coordination.requested",
          "agent.coordination.cancelled",
        ])
        expect(cancelledReplayA2A[1]?.payload?.requestID).toBe(cancelledRequest.payload.request_id)
        expect(cancelledReplayBody.eventReplay).toMatchObject({ complete: true })

        const fail = await seedTask("fail")
        const failRequest = await createRequest({
          taskID: fail.taskID,
          sessionID: fail.worker.id,
          summary: "Fail the task from worker evidence",
          requestedDecision: "fail_task",
          severity: "failure",
        })
        const failTools = createOrchestratorTools({
          taskID: fail.taskID,
          agentSessionID: fail.orchestrator.id,
          signal: new AbortController().signal,
        }).tools
        const failResult = toolText(
          await failTools.respond_agent_coordination.execute(
            {
              request_id: failRequest.payload.request_id,
              decision: "fail_task",
              message: "External blocker proven by worker evidence.",
              reason: "No responsible same-task repair remains.",
            },
            await buildPersistedToolOptions({
              sessionID: fail.orchestrator.id,
              label: "a2a_route_fail_task",
            }),
          ),
        )
        expect(failResult).toContain(`Responded to coordination request ${failRequest.payload.request_id}`)
        expect(deriveTaskStatus(findTask(fail.taskID)!)).toBe("failed")
        expect(findTask(fail.taskID)?.error).toContain(`A2A request ${failRequest.payload.request_id}`)
        expect(interruptTaskLoop).toHaveBeenCalledWith(fail.taskID, "task failed")
        const failAction = listAgentCoordinationActions(fail.taskID)[0]
        expect(failAction?.payload).toMatchObject({
          request_id: failRequest.payload.request_id,
          action: "fail_task",
          status: "completed",
          target_session_id: fail.worker.id,
          result: {
            task_id: fail.taskID,
            task_status: "failed",
          },
        })
        await waitForTaskEventTypes(fail.taskID, ["task.failed"])
        await expectA2AActionConversationReplay({
          app,
          directory: tmp.path,
          taskID: fail.taskID,
          decision: "fail_task",
          action: "fail_task",
        })
        const failHydrate = await app.request(`/task/${fail.taskID}/conversation`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(failHydrate.status).toBe(200)
        const failHydrateBody = (await failHydrate.json()) as {
          events?: Array<{ type?: string; payload?: Record<string, any> }>
        }
        expect(failHydrateBody.events?.map((event) => event.type)).toContain("task.failed")
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
            orderKey: sessionOrderKey(frontendResearch.id, frontendResearch.time.created),
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

  test("GET /task/:taskID/conversation exposes session.error through hydrate, session view, and replay", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "session error route root",
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: root.id,
          title: "session error route worker",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "session error route",
              request: "session error route",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )
        const workerOrderKey = sessionOrderKey(worker.id, worker.time.created)
        await ProtocolStore.appendEvent({
          kind: "event",
          type: "session.error",
          aggregate: "task",
          aggregate_id: taskID,
          task_id: taskID,
          session_id: worker.id,
          source: "session.bridge",
          emitted_at: now + 1,
          order_key: workerOrderKey,
          payload: {
            orderKey: workerOrderKey,
            sessionID: worker.id,
            channel: "assistant",
            resolvedRole: "assistant",
            parentSessionID: root.id,
            error: {
              name: "UnknownError",
              data: { message: "provider stream failed before terminal status" },
            },
            summary: "provider stream failed before terminal status",
          },
        })
        await ProtocolStore.appendEvent({
          kind: "event",
          type: "session.bridge.persist_failed",
          aggregate: "task",
          aggregate_id: taskID,
          task_id: taskID,
          session_id: null,
          source: "session.bridge",
          emitted_at: now + 2,
          payload: {
            taskID,
            sessionID: worker.id,
            failed_type: "session.error",
            error: "foreign key mismatch while persisting session.error",
            summary: "Session bridge failed to persist session.error",
          },
        })

        const hydrate = await app.request(`/task/${taskID}/conversation`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        if (hydrate.status !== 200) {
          throw new Error(await hydrate.text())
        }
        expect(hydrate.status).toBe(200)
        const hydrateBody = (await hydrate.json()) as {
          events?: Array<{ type?: string; payload?: Record<string, unknown> }>
        }
        expect(hydrateBody.events?.find((event) => event.type === "session.error")?.payload).toMatchObject({
          sessionID: worker.id,
          orderKey: workerOrderKey,
          channel: "assistant",
          resolvedRole: "assistant",
          parentSessionID: root.id,
          summary: "provider stream failed before terminal status",
        })
        expect(
          hydrateBody.events?.find((event) => event.type === "session.bridge.persist_failed")?.payload,
        ).toMatchObject({
          sessionID: worker.id,
          failed_type: "session.error",
          error: "foreign key mismatch while persisting session.error",
        })

        const sessionView = await app.request(`/task/${taskID}/conversation/session/${worker.id}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(sessionView.status).toBe(200)
        const sessionBody = (await sessionView.json()) as {
          events?: Array<{ type?: string; payload?: Record<string, unknown> }>
        }
        expect(sessionBody.events?.map((event) => event.type)).toEqual(["session.error"])
        expect(sessionBody.events?.[0]?.payload).toMatchObject({
          sessionID: worker.id,
          orderKey: workerOrderKey,
          channel: "assistant",
          resolvedRole: "assistant",
          parentSessionID: root.id,
        })

        const latestSequence = ProtocolStore.latestTaskSequence(taskID)
        const replay = await app.request(
          `/task/${taskID}/conversation/events?after=0&until=${latestSequence}&limit=10`,
          {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          },
        )
        expect(replay.status).toBe(200)
        const replayBody = (await replay.json()) as {
          events?: Array<{ type?: string; payload?: Record<string, unknown> }>
          eventReplay?: { latestSequence?: number; complete?: boolean }
        }
        expect(replayBody.events?.find((event) => event.type === "session.error")?.payload).toMatchObject({
          sessionID: worker.id,
          orderKey: workerOrderKey,
          channel: "assistant",
          resolvedRole: "assistant",
          parentSessionID: root.id,
          summary: "provider stream failed before terminal status",
        })
        expect(
          replayBody.events?.find((event) => event.type === "session.bridge.persist_failed")?.payload,
        ).toMatchObject({
          sessionID: worker.id,
          failed_type: "session.error",
          error: "foreign key mismatch while persisting session.error",
        })
        expect(replayBody.eventReplay).toMatchObject({ latestSequence, complete: true })
      },
    })
  })

  test("GET /task/:taskID/conversation agentView is seeded from session ledger without messages or status", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "ledger root",
        })
        const frontendResearch = await Session.create({
          kind: "frontend-research",
          parentID: root.id,
          title: "ledger-only frontend research",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "ledger-only agent rail",
              request: "ledger-only agent rail",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/conversation`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        if (response.status !== 200) {
          throw new Error(await response.text())
        }
        const body = (await response.json()) as {
          transcript?: unknown[]
          view?: { sessions?: Array<{ sessionID?: string }> }
          agentView?: {
            sessions?: Array<{
              sessionID?: string
              stage?: string
              parentSessionID?: string
              messageIDs?: string[]
              status?: string
            }>
          }
        }

        expect(body.transcript).toEqual([])
        expect(body.view?.sessions).toEqual([])
        expect(body.agentView?.sessions).toContainEqual(
          expect.objectContaining({
            sessionID: frontendResearch.id,
            stage: "frontend-research",
            parentSessionID: root.id,
            messageIDs: [],
            status: "pending",
          }),
        )
      },
    })
  })

  test("GET /task/:taskID/conversation agentView status uses latest durable status outside replay page", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "status ledger root",
        })
        const build = await Session.create({
          kind: "build",
          parentID: root.id,
          title: "status ledger build",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "status ledger agent rail",
              request: "status ledger agent rail",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        for (let index = 0; index < 520; index++) {
          await ProtocolStore.appendEvent({
            kind: "event",
            type: "test.noop",
            aggregate: "task",
            aggregate_id: taskID,
            task_id: taskID,
            source: "test",
            emitted_at: now + index + 1,
            payload: {
              index,
            },
          })
        }
        const buildOrderKey = sessionOrderKey(build.id, build.time.created)
        await ProtocolStore.appendEvent({
          kind: "event",
          type: "session.status",
          aggregate: "session",
          aggregate_id: build.id,
          task_id: taskID,
          session_id: build.id,
          source: "test",
          emitted_at: now + 1_000,
          order_key: buildOrderKey,
          payload: {
            orderKey: buildOrderKey,
            sessionID: build.id,
            channel: "build",
            parentSessionID: root.id,
            status: {
              type: "terminal",
              reason: "completed",
            },
          },
        })

        const response = await app.request(`/task/${taskID}/conversation`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        if (response.status !== 200) {
          throw new Error(await response.text())
        }
        const body = (await response.json()) as {
          events?: Array<{ type?: string }>
          eventReplay?: { complete?: boolean; limit?: number }
          agentView?: {
            sessions?: Array<{
              sessionID?: string
              status?: string
              lastObservedAt?: number
            }>
          }
        }

        expect(body.eventReplay).toMatchObject({ complete: false, limit: 500 })
        expect(body.events?.some((event) => event.type === "session.status")).toBe(false)
        expect(body.agentView?.sessions).toContainEqual(
          expect.objectContaining({
            sessionID: build.id,
            status: "completed",
            lastObservedAt: now + 1_000,
          }),
        )
      },
    })
  })

  test("GET /task/:taskID/conversation/session/:sessionID does not use full task transcript", async () => {
    const source = await fs.readFile(new URL("../../src/server/routes/orchestrator.ts", import.meta.url), "utf8")
    const routeStart = source.indexOf('"/task/:taskID/conversation/session/:sessionID"')
    const routeEnd = source.indexOf('"/task/:taskID/conversation/history"', routeStart)
    const routeBlock = source.slice(routeStart, routeEnd)

    expect(routeBlock).toContain('loadTaskSessionTranscript(taskID, sessionID, { scope: "task" })')
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
            orderKey: sessionOrderKey(frontendResearch.id, frontendResearch.time.created),
            status: { type: "terminal", reason: "error", error: "history preparation failed" },
          },
          { source: "test.server", taskID, sessionID: frontendResearch.id },
        )

        const beforeOrderKey = timelineMessageOrderKey({
          info: {
            id: "msg_history_latest",
            time: { created: now + 1_000 },
          },
        })
        const response = await app.request(
          `/task/${taskID}/conversation/history?before=${now + 1_000}&before_order_key=${encodeURIComponent(beforeOrderKey)}&before_id=msg_history_latest&limit=1`,
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

  test("GET /task/:taskID/conversation/history bounds lifecycle events by order key", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "history order-key root",
        })
        const assistant = await Session.create({
          kind: "assistant",
          parentID: root.id,
          title: "history order-key assistant",
        })
        const lifecycleOnly = await Session.create({
          kind: "frontend-research",
          parentID: root.id,
          title: "history order-key lifecycle",
        })

        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "history order-key window",
              request: "history order-key window",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
          for (const id of ["msg_history_order_a", "msg_history_order_z"]) {
            db.insert(MessageTable)
              .values({
                id,
                session_id: assistant.id,
                time_created: now,
                time_updated: now,
                data: {
                  role: "assistant",
                  time: { created: now },
                } as any,
              })
              .run()
            db.insert(PartTable)
              .values({
                id: `prt_${id}`,
                message_id: id,
                session_id: assistant.id,
                time_created: now,
                time_updated: now,
                data: {
                  type: "text",
                  text: `${id} text`,
                } as any,
              })
              .run()
          }
        })

        const lifecycleOrderKey = sessionOrderKey(lifecycleOnly.id, lifecycleOnly.time.created)
        await ProtocolStore.appendEvent({
          kind: "event",
          type: SessionStatus.Event.Status.type,
          aggregate: "task",
          aggregate_id: taskID,
          task_id: taskID,
          session_id: lifecycleOnly.id,
          source: "test.server",
          emitted_at: now,
          order_key: lifecycleOrderKey,
          payload: {
            orderKey: lifecycleOrderKey,
            sessionID: lifecycleOnly.id,
            status: { type: "terminal", reason: "error", error: "same millisecond boundary" },
          },
        })

        const beforeOrderKey = timelineMessageOrderKey({
          info: {
            id: "msg_history_order_z",
            time: { created: now },
          },
        })
        const response = await app.request(
          `/task/${taskID}/conversation/history?before=${now + 1_000}&before_order_key=${encodeURIComponent(beforeOrderKey)}&before_id=msg_history_order_z&limit=1`,
          {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          },
        )

        if (response.status !== 200) {
          throw new Error(await response.text())
        }
        const body = (await response.json()) as {
          transcript: Array<{ info?: { id?: string } }>
          events?: Array<{ type?: string; payload?: Record<string, unknown> }>
        }

        expect(body.transcript.map((message) => message.info?.id)).toEqual(["msg_history_order_a"])
        expect(body.events).toEqual([])
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
          const { event: connected } = await readSseUntil({
            label: "task.messages.changed stream connection",
            abort,
            readEvent,
            predicate: (event) => event.type === "task.connected",
          })
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
          expect(
            (
              await readSseUntil({
                label: "immediate task.messages.changed stream connection",
                abort,
                readEvent,
                predicate: (event) => event.type === "task.connected",
              })
            ).event.type,
          ).toBe("task.connected")
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

  test("GET /task/:taskID/events reports same-millisecond DB writes at the client's hydrate watermark", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({
          kind: "root",
          title: "message watermark same millisecond root",
        })
        const build = await Session.create({
          kind: "build",
          parentID: root.id,
          title: "message watermark same millisecond build",
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
              title: "message watermark same millisecond task",
              request: "message watermark same millisecond task",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const abort = new AbortController()
        const timeout = setTimeout(() => abort.abort("timed out waiting for same-ms task.messages.changed"), 10_000)
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
          expect(
            (
              await readSseUntil({
                label: "same-ms task.messages.changed stream connection",
                abort,
                readEvent,
                predicate: (event) => event.type === "task.connected",
              })
            ).event.type,
          ).toBe("task.connected")

          Database.use((db) => {
            db.insert(MessageTable)
              .values({
                id: "msg_same_ms_watermark",
                session_id: build.id,
                time_created: now,
                time_updated: now,
                data: {
                  role: "assistant",
                  agent: "build",
                  time: { created: now },
                } as any,
              })
              .run()
            db.insert(PartTable)
              .values({
                id: "prt_same_ms_watermark",
                message_id: "msg_same_ms_watermark",
                session_id: build.id,
                time_created: now,
                time_updated: now,
                data: {
                  type: "text",
                  text: "SSE same millisecond tail changed",
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
          expect(changed.payload?.watermark).toBe(now)

          Database.use((db) =>
            db
              .update(PartTable)
              .set({
                time_updated: now,
                data: {
                  type: "text",
                  text: "SSE same millisecond tail changed again",
                } as any,
              })
              .where(eq(PartTable.id, "prt_same_ms_watermark"))
              .run(),
          )

          let updated: any
          while (!updated) {
            const event = await readEvent()
            if (event.type === "task.messages.changed") updated = event
          }
          expect(updated.task_id).toBe(taskID)
          expect(updated.payload?.taskID).toBe(taskID)
          expect(updated.payload?.watermark).toBe(now)
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

  test("task_report is a durable task conversation event and replay entry", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        ensureTaskMessageProtocolBridge()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "task report root",
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: root.id,
          title: "task report worker",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "task report projection",
              request: "task report projection",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const reportTool = await TaskReportTool.init()
        await reportTool.execute(
          {
            status: "need_input",
            summary: "Need user choice before continuing",
            question: "Which evidence source should the worker trust?",
          },
          toolContext({ taskID, sessionID: worker.id, agent: "coding" }),
        )

        await waitForTaskEventTypes(taskID, ["task.report"])
        const persisted = ProtocolStore.listTaskEvents(taskID).find((event) => event.type === "task.report")
        expect(persisted?.sessionID).toBe(worker.id)
        expect(persisted?.payload).toMatchObject({
          taskID,
          sessionID: worker.id,
          status: "need_input",
          summary: "Need user choice before continuing",
          question: "Which evidence source should the worker trust?",
          channel: "assistant",
          resolvedRole: "assistant",
          parentSessionID: root.id,
        })

        const hydrate = await app.request(`/task/${taskID}/conversation`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(hydrate.status).toBe(200)
        const hydrateBody = (await hydrate.json()) as {
          events?: Array<{ type?: string; payload?: Record<string, unknown> }>
        }
        expect(hydrateBody.events?.find((event) => event.type === "task.report")?.payload).toMatchObject({
          taskID,
          sessionID: worker.id,
          status: "need_input",
          question: "Which evidence source should the worker trust?",
        })

        const latestSequence = ProtocolStore.latestTaskSequence(taskID)
        const paged = await app.request(
          `/task/${taskID}/conversation/events?after=0&until=${latestSequence}&limit=10`,
          {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          },
        )
        expect(paged.status).toBe(200)
        const pagedBody = (await paged.json()) as {
          events?: Array<{ type?: string; payload?: Record<string, unknown> }>
          eventReplay?: { latestSequence?: number; complete?: boolean }
        }
        expect(pagedBody.events?.map((event) => event.type)).toContain("task.report")
        expect(pagedBody.events?.find((event) => event.type === "task.report")?.payload).toMatchObject({
          taskID,
          sessionID: worker.id,
          status: "need_input",
          summary: "Need user choice before continuing",
        })
        expect(pagedBody.eventReplay).toMatchObject({ latestSequence, complete: true })
      },
    })
  })

  test("task_report rejects sessions that cannot be projected to a task conversation", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const standalone = await Session.create({
          kind: "assistant",
          title: "unowned task report worker",
        })
        const reportTool = await TaskReportTool.init()
        const ctx = toolContext({
          taskID: Identifier.ascending("task"),
          sessionID: standalone.id,
          agent: "coding",
        })
        ctx.extra = {}

        await expect(
          reportTool.execute(
            {
              status: "progress",
              summary: "This report has no task projection target",
            },
            ctx,
          ),
        ).rejects.toThrow("task_report requires task-owned session")
        expect(ProtocolStore.listTaskEvents(Identifier.ascending("task"))).toEqual([])
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

  test("current-project transcript and direct session cancel reject foreign tasks while conversation reads the task project", async () => {
    await using projectA = await tmpdir({ git: true })
    await using projectB = await tmpdir({ git: true })
    let taskID = ""
    let buildID = ""

    await Instance.provide({
      directory: projectA.path,
      fn: async () => {
        taskID = Identifier.ascending("task")
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
        buildID = build.id
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "project scoped route leak",
              request: "project scoped route leak",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )
        SessionStatus.set(build.id, { type: "streaming" })
      },
    })

    const app = Server.App()
    const transcript = await app.request(`/task/${taskID}/transcript`, {
      headers: {
        "x-opencorvus-directory": projectB.path,
      },
    })
    const conversation = await app.request(`/task/${taskID}/conversation`, {
      headers: {
        "x-opencorvus-directory": projectB.path,
      },
    })
    const conversationSession = await app.request(`/task/${taskID}/conversation/session/${buildID}`, {
      headers: {
        "x-opencorvus-directory": projectB.path,
      },
    })
    const conversationHistory = await app.request(
      `/task/${taskID}/conversation/history?${new URLSearchParams({
        before: String(Date.now() + 1_000),
        before_order_key: "9999999999999:foreign-project-history",
        limit: "1",
      })}`,
      {
        headers: {
          "x-opencorvus-directory": projectB.path,
        },
      },
    )
    const cancel = await app.request(`/task/${taskID}/session/${buildID}/cancel`, {
      method: "POST",
      headers: {
        "x-opencorvus-directory": projectB.path,
      },
    })

    expect(transcript.status).toBe(404)
    expect(conversation.status).toBe(200)
    expect(conversationSession.status).toBe(200)
    expect(conversationHistory.status).toBe(200)
    expect(cancel.status).toBe(404)
    expect((await conversation.json())?.board?.task?.id).toBe(taskID)
    expect(SessionStatus.get(buildID)).toEqual({ type: "streaming" })
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

  test("POST /task/:taskID/session/:sessionID/cancel refuses to bypass a pending A2A request", async () => {
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
              title: "cancel build with pending A2A",
              request: "cancel build with pending A2A",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )
        SessionStatus.set(build.id, { type: "streaming" })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: build.id,
          agent: "build",
          messageID: "msg_http_cancel_pending_a2a",
          callID: "cal_http_cancel_pending_a2a",
          summary: "Worker asks to be cancelled",
          details: "The worker has explicitly asked the orchestrator to cancel it.",
          blocking: true,
          requestedDecision: "cancel_worker",
          now: now + 1,
        })

        const response = await app.request(`/task/${taskID}/session/${build.id}/cancel`, {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(409)
        const body = await response.text()
        expect(body).toContain("pending A2A")
        expect(body).toContain(request.payload.request_id)
        expect(body).toContain("respond_agent_coordination")
        expect(SessionStatus.get(build.id)).toEqual({ type: "streaming" })
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "pending",
        )
        expect(listPendingAgentCoordinationRequests(taskID).map((row) => row.payload.request_id)).toEqual([
          request.payload.request_id,
        ])
      },
    })
  }, 30_000)

  test("POST /task/:taskID/session/:sessionID/cancel cancels descendant prompt states before success", async () => {
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
        const descendant = await Session.create({
          kind: "build",
          parentID: build.id,
          title: "build descendant",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "cancel build subtree",
              request: "cancel build subtree",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const aborts = new Map<string, AbortSignal>()
        for (const sessionID of [build.id, descendant.id]) {
          const abort = SessionPromptState.start(sessionID, tmp.path)
          expect(abort).toBeDefined()
          aborts.set(sessionID, abort!)
          SessionStatus.set(sessionID, { type: "streaming" })
        }
        const cancelled: string[] = []
        spyOn(SessionPrompt, "cancel").mockImplementation((sessionID, directory) => {
          const result = SessionPromptState.cancel(sessionID, directory)
          cancelled.push(sessionID)
          const abort = aborts.get(sessionID)
          if (abort) queueMicrotask(() => SessionPromptState.finish(sessionID, abort, directory))
          return result
        })

        try {
          const response = await app.request(`/task/${taskID}/session/${build.id}/cancel`, {
            method: "POST",
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          })

          expect(response.status).toBe(200)
          expect(await response.json()).toMatchObject({
            task_id: taskID,
            session_id: build.id,
            cancelled: true,
          })
          expect(cancelled).toEqual([descendant.id, build.id])
          expect(SessionPromptState.isActive(build.id, tmp.path)).toBe(false)
          expect(SessionPromptState.isActive(descendant.id, tmp.path)).toBe(false)
        } finally {
          for (const [sessionID, abort] of aborts) {
            SessionPromptState.finish(sessionID, abort, tmp.path)
          }
        }
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
