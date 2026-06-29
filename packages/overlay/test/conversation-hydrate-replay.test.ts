import { afterAll, afterEach, expect, test } from "bun:test"
import { installRealOverlayI18n } from "./fixtures/i18n"
import { setBoardStore as setBoardStoreRaw } from "../src/store/board"
import { cardTreeStore } from "../src/store/card-tree"
import { conversationAgentStore, hydrateConversationAgentView } from "../src/store/conversation-agents"
import {
  cancelConversationReplay,
  conversationCardContainsMessage,
  conversationSourceDirectory,
  hydrateTaskConversation,
  loadConversation,
  loadConversationHistoryUntilCard,
  loadConversationSessionHistory,
} from "../src/services/conversation"
import { replayTaskEventToTree } from "../src/services/events"
import {
  __setHostTransportForTest,
  type HostTransport,
  type StreamHandlers,
  type StreamOpenRequest,
  type TransportRequest,
  type TransportResponse,
} from "../src/services/host-transport"
import { flushBufferedPartDeltas, resetWriter } from "../src/services/tree-writer"

const originalRequestAnimationFrame = globalThis.requestAnimationFrame
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
const TEST_DIRECTORY = "D:/conversation-runtime"

installRealOverlayI18n()

globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
  callback(0)
  return 1
}) as any
globalThis.cancelAnimationFrame = (() => {}) as any

function testOrderKey(rank: number, time: number, id: string, sequence = 0, domain = "test"): string {
  return `v1:${String(time).padStart(16, "0")}:${String(rank).padStart(16, "0")}:${String(sequence).padStart(16, "0")}:${domain}:${id}`
}

function positiveFixtureTime(value: unknown, label: string): number {
  const time = Number(value)
  if (!Number.isFinite(time) || time <= 0) throw new Error(`test fixture ${label} missing positive time`)
  return time
}

function requireExplicitOrderKey(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`test fixture ${label} missing orderKey`)
  return value
}

function messageOrderKey(id: string, time: number): string {
  return testOrderKey(30, time, id, 0, "message")
}

function partOrderKey(id: string, time: number): string {
  return testOrderKey(31, time, id, 0, "part")
}

function protocolOrderKey(id: string, time: number, sequence = 0): string {
  return testOrderKey(40, time, id, sequence, "event")
}

function sessionOrderKey(id: string, time: number): string {
  return testOrderKey(50, time, id, 0, "session")
}

function boardOrderKey(id: string, time: number, rank: number): string {
  return testOrderKey(rank, time, id, 0, "board")
}

function taskOrderKey(id: string, time: number): string {
  return testOrderKey(10, time, id, 0, "task")
}

function interactionOrderKey(id: string, time: number): string {
  return testOrderKey(70, time, id, 0, "interaction")
}

function objectRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function stampBoard(board: any): any {
  if (!objectRecord(board)) return board
  const task = objectRecord(board.task) ? board.task : undefined
  const taskCreated = task ? positiveFixtureTime(task?.time?.created, `task ${task?.id || "<unknown>"}`) : 0
  return {
    ...board,
    ...(task
      ? {
          task: {
            ...task,
            orderKey: task.orderKey || taskOrderKey(String(task.id || ""), taskCreated),
          },
        }
      : {}),
    workflow: objectRecord(board.workflow)
      ? {
          ...board.workflow,
          steps: Array.isArray(board.workflow.steps)
            ? board.workflow.steps.map((step: any) => ({
                ...step,
                orderKey:
                  step.orderKey ||
                  boardOrderKey(`${String(task?.id || "task")}-${String(step?.id || "step")}`, taskCreated, 61),
              }))
            : board.workflow.steps,
        }
      : board.workflow,
    goalWorkflows: Array.isArray(board.goalWorkflows)
      ? board.goalWorkflows.map((goal: any) => {
          const goalCreated = positiveFixtureTime(
            goal?.time?.created || taskCreated,
            `goal ${goal?.goalID || "<unknown>"}`,
          )
          return {
            ...goal,
            orderKey: goal.orderKey || boardOrderKey(String(goal?.goalID || "goal"), goalCreated, 60),
            steps: Array.isArray(goal?.steps)
              ? goal.steps.map((step: any) => {
                  const stepTime = positiveFixtureTime(
                    step?.startedAt || step?.completedAt || goalCreated,
                    `goal step ${goal?.goalID || "goal"}/${step?.stepID || "step"}`,
                  )
                  return {
                    ...step,
                    orderKey:
                      step.orderKey ||
                      boardOrderKey(
                        `${String(goal?.goalID || "goal")}-${String(step?.stepID || "step")}`,
                        stepTime,
                        61,
                      ),
                    phases: objectRecord(step?.phases)
                      ? Object.fromEntries(
                          Object.entries(step.phases).map(([phaseID, phase]: [string, any]) => {
                            const phaseTime = positiveFixtureTime(
                              phase?.startedAt || phase?.completedAt || stepTime,
                              `goal phase ${goal?.goalID || "goal"}/${step?.stepID || "step"}/${phaseID}`,
                            )
                            return [
                              phaseID,
                              {
                                ...phase,
                                orderKey:
                                  phase?.orderKey ||
                                  boardOrderKey(
                                    `${String(goal?.goalID || "goal")}-${String(step?.stepID || "step")}-${phaseID}`,
                                    phaseTime,
                                    62,
                                  ),
                              },
                            ]
                          }),
                        )
                      : step?.phases,
                  }
                })
              : goal?.steps,
          }
        })
      : board.goalWorkflows,
    interactions: Array.isArray(board.interactions)
      ? board.interactions.map((interaction: any) => {
          const created = positiveFixtureTime(
            interaction?.time?.created || taskCreated,
            `interaction ${interaction?.id || "<unknown>"}`,
          )
          return {
            ...interaction,
            orderKey: interaction.orderKey || interactionOrderKey(String(interaction?.id || ""), created),
          }
        })
      : board.interactions,
  }
}

function setBoardStore(...args: any[]): any {
  if (args[0] === "board" && args.length === 2) return setBoardStoreRaw("board", stampBoard(args[1]))
  return (setBoardStoreRaw as any)(...args)
}

function stampTranscriptMessage(message: any): any {
  if (!objectRecord(message)) return message
  const info = objectRecord(message.info) ? message.info : {}
  const id = String(info.id || "")
  return {
    ...message,
    info: {
      ...info,
      orderKey: requireExplicitOrderKey(info.orderKey, `message ${id || "<unknown>"}`),
    },
    parts: Array.isArray(message.parts)
      ? message.parts.map((part: any) => {
          if (!objectRecord(part)) return part
          const partID = String(part.id || "")
          return {
            ...part,
            orderKey: requireExplicitOrderKey(part.orderKey, `part ${partID || "<unknown>"}`),
          }
        })
      : message.parts,
  }
}

function stampViewMessage(message: any): any {
  if (!objectRecord(message)) return message
  const id = String(message.messageID || "")
  return {
    ...message,
    orderKey: requireExplicitOrderKey(message.orderKey, `view message ${id || "<unknown>"}`),
  }
}

function stampViewSession(session: any): any {
  if (!objectRecord(session)) return session
  const id = String(session.sessionID || "")
  return {
    ...session,
    orderKey: requireExplicitOrderKey(session.orderKey, `view session ${id || "<unknown>"}`),
  }
}

function stampConversationView(view: any): any {
  if (!objectRecord(view)) return view
  return {
    ...view,
    messages: Array.isArray(view.messages) ? view.messages.map(stampViewMessage) : view.messages,
    sessions: Array.isArray(view.sessions) ? view.sessions.map(stampViewSession) : view.sessions,
  }
}

function stampHistory(history: any): any {
  if (!objectRecord(history)) return history
  if (!Object.prototype.hasOwnProperty.call(history, "oldestOrderKey")) {
    throw new Error("test fixture history missing oldestOrderKey")
  }
  const hasMore = history.hasMore === true
  if (!hasMore) return history
  const time = positiveFixtureTime(history.oldestTimestamp, "history oldestTimestamp")
  const id = String(history.oldestMessageID || "")
  if (!id) throw new Error("test fixture history missing oldestMessageID")
  const expectedOrderKey = messageOrderKey(id, time)
  if (history.oldestOrderKey !== expectedOrderKey) {
    throw new Error(`test fixture history oldestOrderKey mismatch for ${id}`)
  }
  return history
}

function stampTaskEvent(event: any): any {
  if (!objectRecord(event)) return event
  const timestamp = positiveFixtureTime(
    event.timestamp || event.emittedAt || event.emitted_at,
    `event ${event.type || ""}`,
  )
  const eventType = String(event.type || "")
  const props = objectRecord(event.properties) ? event.properties : objectRecord(event.payload) ? event.payload : undefined
  const sessionID = String(props?.sessionID || "")
  const lifecycleEvent =
    eventType === "session.status" || eventType === "session.error" || eventType === "session.idle"
  if (lifecycleEvent && !sessionID) throw new Error(`test fixture ${eventType} missing sessionID`)
  const orderKey = requireExplicitOrderKey(event.orderKey, `event ${eventType || "<unknown>"}`)
  const next: any = {
    ...event,
    orderKey,
  }
  if (!props) return next
  const stampedProps = { ...props }
  if (objectRecord(stampedProps.info)) {
    const id = String(stampedProps.info.id || "")
    const messageKey = requireExplicitOrderKey(
      stampedProps.info.orderKey,
      `event message ${id || "<unknown>"}`,
    )
    if (orderKey !== messageKey) throw new Error(`test fixture ${eventType} orderKey does not match message ${id}`)
    stampedProps.info = {
      ...stampedProps.info,
      orderKey: messageKey,
    }
  }
  if (objectRecord(stampedProps.part)) {
    const id = String(stampedProps.part.id || "")
    const messageID = String(stampedProps.part.messageID || "")
    const messageKey = requireExplicitOrderKey(
      stampedProps.orderKey,
      `event part owner ${messageID || "<unknown>"}`,
    )
    const partKey = requireExplicitOrderKey(stampedProps.part.orderKey, `event part ${id || "<unknown>"}`)
    if (orderKey !== messageKey) {
      throw new Error(`test fixture ${eventType} orderKey does not match owner message ${messageID}`)
    }
    stampedProps.orderKey = messageKey
    stampedProps.part = {
      ...stampedProps.part,
      orderKey: partKey,
    }
  }
  if (objectRecord(stampedProps.interaction)) {
    const id = String(stampedProps.interaction.id || "")
    stampedProps.interaction = {
      ...stampedProps.interaction,
      orderKey: requireExplicitOrderKey(stampedProps.interaction.orderKey, `event interaction ${id}`),
    }
  }
  return objectRecord(next.properties) ? { ...next, properties: stampedProps } : { ...next, payload: stampedProps }
}

function stampConversationBody(body: any): any {
  if (!objectRecord(body)) return body
  const transcript = Array.isArray(body.transcript)
    ? body.transcript.map((message: any) => stampTranscriptMessage(message))
    : body.transcript
  return {
    ...body,
    board: objectRecord(body.board) ? stampBoard(body.board) : body.board,
    transcript,
    view: objectRecord(body.view) ? stampConversationView(body.view) : body.view,
    agentView: objectRecord(body.agentView) ? stampConversationView(body.agentView) : body.agentView,
    history: objectRecord(body.history) ? stampHistory(body.history) : body.history,
    events: Array.isArray(body.events) ? body.events.map((event: any) => stampTaskEvent(event)) : body.events,
  }
}

function stampTransportResponse<T>(response: TransportResponse<T>): TransportResponse<T> {
  return {
    ...response,
    body: stampConversationBody(response.body) as T,
  }
}

function fakeTransport(
  responder: (req: TransportRequest) => Promise<TransportResponse<unknown>> | TransportResponse<unknown>,
): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      const response = await responder(req)
      return stampTransportResponse(response as TransportResponse<T>)
    },
    openStream(_input: StreamOpenRequest, _handlers: StreamHandlers) {
      throw new Error("openStream not used in conversation hydrate tests")
    },
    async native() {
      throw new Error("native not used in conversation hydrate tests")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  } satisfies HostTransport
}

afterEach(() => {
  cancelConversationReplay()
  __setHostTransportForTest(undefined)
  resetWriter()
  setBoardStore("selectedSource", null)
})

afterAll(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame
})

test("session conversation hydrate carries the explicit Mission row directory", async () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "session", id: "ses_mission" })

  let captured: TransportRequest | undefined
  __setHostTransportForTest(
    fakeTransport((req) => {
      captured = req
      if (req.path !== "session/ses_mission/conversation") {
        throw new Error(`unexpected request path: ${req.path}`)
      }
      return {
        status: 200,
        ok: true,
        headers: {},
        body: {
          board: {
            kind: "session",
            sessionID: "ses_mission",
            status: "active",
            title: "Mission Control",
            directory: "D:/mission-project",
          },
          transcript: [],
          timeline: [],
          events: [],
          view: { sessions: [] },
          agentView: { sessions: [] },
          history: { oldestTimestamp: null, oldestMessageID: null, oldestOrderKey: null, hasMore: false, limit: 160 },
        },
      }
    }),
  )

  await loadConversation(
    { kind: "session", id: "ses_mission" },
    {
      directory: "D:/mission-project",
    },
  )

  expect(captured?.query?.directory).toBe("D:/mission-project")
  expect(captured?.query?.tail_limit).toBe("80")
})

test("task conversation hydrate registers task directory from the hydrated board", async () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_deep_link" })

  let captured: TransportRequest | undefined
  __setHostTransportForTest(
    fakeTransport((req) => {
      captured = req
      if (req.path !== "task/tsk_deep_link/conversation") {
        throw new Error(`unexpected request path: ${req.path}`)
      }
      return {
        status: 200,
        ok: true,
        headers: {},
        body: {
          board: {
            snapshotVersion: "board:deep-link",
            task: {
              id: "tsk_deep_link",
              status: "active",
              request: "open linked task",
              sessionID: "ses_root",
              directory: TEST_DIRECTORY,
              time: { created: 1_776_000_000_000 },
              attachments: [],
            },
            goalWorkflows: [],
            interactions: [],
          },
          transcript: [],
          timeline: [],
          events: [],
          view: { sessions: [] },
          agentView: { sessions: [] },
          eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 10 },
          history: { oldestTimestamp: null, oldestMessageID: null, oldestOrderKey: null, hasMore: false, limit: 160 },
          lastSequence: 0,
        },
      }
    }),
  )

  await hydrateTaskConversation("tsk_deep_link", { tailLimit: 1 })

  expect(captured?.query?.directory).toBeUndefined()
  expect(captured?.query?.tail_limit).toBe("1")
  expect(conversationSourceDirectory({ kind: "task", id: "tsk_deep_link" })).toBe(TEST_DIRECTORY)
})

test("task conversation hydrate requires explicit agentView", async () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_missing_agent_view" })

  __setHostTransportForTest(
    fakeTransport((req) => {
      if (req.path !== "task/tsk_missing_agent_view/conversation") {
        throw new Error(`unexpected request path: ${req.path}`)
      }
      return {
        status: 200,
        ok: true,
        headers: {},
        body: {
          board: {
            snapshotVersion: "board:missing-agent-view",
            task: {
              id: "tsk_missing_agent_view",
              status: "active",
              request: "missing agent view",
              sessionID: "ses_root",
              directory: TEST_DIRECTORY,
              time: { created: 1_776_000_000_000 },
              attachments: [],
            },
            goalWorkflows: [],
            interactions: [],
          },
          transcript: [],
          timeline: [],
          events: [],
          view: { sessions: [] },
          eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 10 },
          history: { oldestTimestamp: null, oldestMessageID: null, oldestOrderKey: null, hasMore: false, limit: 160 },
          lastSequence: 0,
        },
      }
    }),
  )

  await expect(hydrateTaskConversation("tsk_missing_agent_view", { tailLimit: 1 })).rejects.toThrow(
    "conversation payload agentView must be an object",
  )
})

test("task conversation hydrate requires explicit history state", async () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_missing_history" })

  __setHostTransportForTest(
    fakeTransport((req) => {
      if (req.path !== "task/tsk_missing_history/conversation") {
        throw new Error(`unexpected request path: ${req.path}`)
      }
      return {
        status: 200,
        ok: true,
        headers: {},
        body: {
          board: {
            snapshotVersion: "board:missing-history",
            task: {
              id: "tsk_missing_history",
              status: "active",
              request: "missing history",
              sessionID: "ses_root",
              directory: TEST_DIRECTORY,
              time: { created: 1_776_000_000_000 },
              attachments: [],
            },
            goalWorkflows: [],
            interactions: [],
          },
          transcript: [],
          timeline: [],
          events: [],
          view: { sessions: [] },
          agentView: { sessions: [] },
          eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 10 },
          lastSequence: 0,
        },
      }
    }),
  )

  await expect(hydrateTaskConversation("tsk_missing_history", { tailLimit: 1 })).rejects.toThrow(
    "conversation hydrate missing history",
  )
})

test("hydration replay consumes persisted executor output without synthesizing a message card", () => {
  resetWriter()
  setBoardStore("board", {
    snapshotVersion: "board:hydrate",
    task: {
      id: "tsk_hydrate",
      status: "active",
      request: "restore conversation",
      sessionID: "ses_root",
      directory: TEST_DIRECTORY,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: "tsk_hydrate" })

  replayTaskEventToTree(
    stampTaskEvent({
      event_id: "pev_1",
      task_id: "tsk_hydrate",
      type: "run.output",
      timestamp: 1_776_000_001_000,
      sequence: 12,
      orderKey: protocolOrderKey("pev_1", 1_776_000_001_000, 12),
      summary: "Hydrated executor output",
      payload: {
        runID: "run_1",
        sessionID: "ses_executor",
        type: "text_delta",
        text: "Recovered streamed output.",
      },
    }),
  )
  flushBufferedPartDeltas()

  const cardID = "executor:session:ses_executor:message:executor:msg:run_1"
  expect(cardTreeStore.cards[cardID]).toBeUndefined()
})

test("hydrateTaskConversation waits for persisted event replay before returning resume sequence", async () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_replay" })

  let resolveReplayPage!: (body: unknown) => void
  const replayPage = new Promise<unknown>((resolve) => {
    resolveReplayPage = resolve
  })
  let replayPageRequested!: () => void
  const replayPageStarted = new Promise<void>((resolve) => {
    replayPageRequested = resolve
  })

  __setHostTransportForTest(
    fakeTransport(async (req) => {
      if (req.path === "task/tsk_replay/conversation") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            board: {
              snapshotVersion: "board:replay",
              task: {
                id: "tsk_replay",
                status: "active",
                request: "restore conversation",
                sessionID: "ses_root",
                directory: TEST_DIRECTORY,
                time: { created: 1_776_000_000_000, started: 1_776_000_000_000 },
                attachments: [],
              },
              goalWorkflows: [],
              interactions: [],
            },
            transcript: [],
            timeline: [],
            events: [],
            view: { sessions: [] },
            agentView: { sessions: [] },
            eventReplay: { cursor: 1, latestSequence: 2, complete: false, limit: 10 },
            history: { oldestTimestamp: null, oldestMessageID: null, oldestOrderKey: null, hasMore: false, limit: 160 },
            lastSequence: 1,
          },
        }
      }
      if (req.path === "task/tsk_replay/conversation/events") {
        replayPageRequested()
        return {
          status: 200,
          ok: true,
          headers: {},
          body: await replayPage,
        }
      }
      throw new Error(`unexpected request path: ${req.path}`)
    }),
  )

  let settled = false
  const hydration = hydrateTaskConversation("tsk_replay", { directory: TEST_DIRECTORY }).then((sequence) => {
    settled = true
    return sequence
  })

  await replayPageStarted
  await Promise.resolve()
  expect(settled).toBe(false)

  resolveReplayPage({
    events: [
      {
        event_id: "pev_replay",
        task_id: "tsk_replay",
        type: "run.output",
        timestamp: 1_776_000_002_000,
        sequence: 2,
        orderKey: protocolOrderKey("pev_replay", 1_776_000_002_000, 2),
        summary: "Replayed executor output",
        payload: {
          runID: "run_replay",
          sessionID: "ses_executor_replay",
          type: "text_delta",
          text: "Replay completed before resume.",
        },
      },
    ],
    eventReplay: { cursor: 2, latestSequence: 2, complete: true, limit: 10 },
  })

  await expect(hydration).resolves.toBe(2)
  expect(cardTreeStore.cards["executor:session:ses_executor_replay:message:executor:msg:run_replay"]).toBeUndefined()
})

test("hydrateTaskConversation preserves agent rail records until the replacement view arrives", async () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_preserve_agents" })
  hydrateConversationAgentView(
    "task:tsk_preserve_agents",
    stampConversationView({
      messages: [
        {
          sessionID: "ses_existing_agent",
          stage: "integrity",
          messageID: "msg_existing",
          time: 1_776_000_010_000,
          orderKey: messageOrderKey("msg_existing", 1_776_000_010_000),
          placement: "top_level",
        },
      ],
      sessions: [
        {
          sessionID: "ses_existing_agent",
          stage: "integrity",
          messageIDs: ["msg_existing"],
          firstMessageTime: 1_776_000_010_000,
          lastMessageTime: 1_776_000_010_100,
          orderKey: sessionOrderKey("ses_existing_agent", 1_776_000_010_000),
          placement: "top_level",
        },
      ],
    }),
  )

  let resolveHydrate!: (body: unknown) => void
  const hydrateResponse = new Promise<unknown>((resolve) => {
    resolveHydrate = resolve
  })
  __setHostTransportForTest(
    fakeTransport(async (req) => {
      if (req.path !== "task/tsk_preserve_agents/conversation") {
        throw new Error(`unexpected request path: ${req.path}`)
      }
      return {
        status: 200,
        ok: true,
        headers: {},
        body: await hydrateResponse,
      }
    }),
  )

  const hydration = hydrateTaskConversation("tsk_preserve_agents", { directory: TEST_DIRECTORY })
  await Promise.resolve()
  expect(conversationAgentStore.records.map((record) => record.sessionID)).toEqual(["ses_existing_agent"])

  resolveHydrate({
    board: {
      snapshotVersion: "board:preserve-agents",
      task: {
        id: "tsk_preserve_agents",
        status: "active",
        request: "preserve rail agents",
        sessionID: "ses_root",
        directory: TEST_DIRECTORY,
        time: { created: 1_776_000_000_000 },
        attachments: [],
      },
      goalWorkflows: [],
      interactions: [],
    },
    transcript: [],
    timeline: [],
    events: [],
    view: { sessions: [], messages: [], topLevelSessionIDs: [] },
    agentView: {
      messages: [
        {
          sessionID: "ses_new_agent",
          stage: "visual-qa",
          messageID: "msg_visual_qa",
          time: 1_776_000_020_000,
          orderKey: messageOrderKey("msg_visual_qa", 1_776_000_020_000),
          placement: "top_level",
        },
      ],
      sessions: [
        {
          sessionID: "ses_new_agent",
          stage: "visual-qa",
          messageIDs: ["msg_visual_qa"],
          firstMessageTime: 1_776_000_020_000,
          lastMessageTime: 1_776_000_020_100,
          orderKey: sessionOrderKey("ses_new_agent", 1_776_000_020_000),
          placement: "top_level",
        },
      ],
      topLevelSessionIDs: ["ses_new_agent"],
    },
    eventReplay: { cursor: 9, latestSequence: 9, complete: true, limit: 500 },
    history: { oldestTimestamp: null, oldestMessageID: null, oldestOrderKey: null, hasMore: false, limit: 160 },
    lastSequence: 9,
  })

  await expect(hydration).resolves.toBe(9)
  expect(conversationAgentStore.records.map((record) => record.sessionID)).toEqual(["ses_new_agent"])
  expect(conversationAgentStore.records[0]?.stage).toBe("visual-qa")
})

test("hydrateTaskConversation renders the live tail first and prepends older history on demand", async () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_lazy" })
  const requests: TransportRequest[] = []

  const board = {
    snapshotVersion: "board:lazy",
    task: {
      id: "tsk_lazy",
      status: "active",
      request: "restore conversation lazily",
      sessionID: "ses_root",
      directory: TEST_DIRECTORY,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  }
  const oldMessage = {
    info: {
      id: "msg_old",
      sessionID: "ses_old",
      role: "assistant",
      resolvedRole: "assistant",
      channel: "integrity",
      orderKey: messageOrderKey("msg_old", 1_776_000_000_100),
      time: { created: 1_776_000_000_100 },
    },
    parts: [
      {
        id: "part_old",
        sessionID: "ses_old",
        messageID: "msg_old",
        resolvedRole: "integrity",
        type: "text",
        text: "Older history.",
        orderKey: partOrderKey("part_old", 1_776_000_000_100),
      },
    ],
  }
  const latestMessage = {
    info: {
      id: "msg_latest",
      sessionID: "ses_root",
      role: "assistant",
      resolvedRole: "assistant",
      channel: "assistant",
      orderKey: messageOrderKey("msg_latest", 1_776_000_000_900),
      time: { created: 1_776_000_000_900 },
    },
    parts: [
      {
        id: "part_latest",
        sessionID: "ses_root",
        messageID: "msg_latest",
        type: "text",
        text: "Latest tail.",
        orderKey: partOrderKey("part_latest", 1_776_000_000_900),
      },
    ],
  }

  __setHostTransportForTest(
    fakeTransport((req) => {
      requests.push(req)
      if (req.path === "task/tsk_lazy/conversation") {
        expect(req.query?.tail_limit).toBe("1")
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            board,
            transcript: [latestMessage],
            timeline: [],
            events: [],
            view: {
              messages: [
                {
                  sessionID: "ses_root",
                  stage: "assistant",
                  messageID: "msg_latest",
                  time: 1_776_000_000_900,
                  orderKey: messageOrderKey("msg_latest", 1_776_000_000_900),
                  placement: "top_level",
                },
              ],
              sessions: [
                {
                  sessionID: "ses_root",
                  stage: "assistant",
                  messageIDs: ["msg_latest"],
                  firstMessageTime: 1_776_000_000_900,
                  lastMessageTime: 1_776_000_000_900,
                  orderKey: sessionOrderKey("ses_root", 1_776_000_000_900),
                  placement: "top_level",
                },
              ],
              topLevelSessionIDs: ["ses_root"],
            },
            agentView: {
              messages: [
                {
                  sessionID: "ses_old",
                  stage: "integrity",
                  messageID: "msg_old",
                  time: 1_776_000_000_100,
                  orderKey: messageOrderKey("msg_old", 1_776_000_000_100),
                  placement: "top_level",
                },
                {
                  sessionID: "ses_root",
                  stage: "assistant",
                  messageID: "msg_latest",
                  time: 1_776_000_000_900,
                  orderKey: messageOrderKey("msg_latest", 1_776_000_000_900),
                  placement: "top_level",
                },
              ],
              sessions: [
                {
                  sessionID: "ses_old",
                  stage: "integrity",
                  messageIDs: ["msg_old"],
                  firstMessageTime: 1_776_000_000_100,
                  lastMessageTime: 1_776_000_000_100,
                  orderKey: sessionOrderKey("ses_old", 1_776_000_000_100),
                  placement: "top_level",
                },
                {
                  sessionID: "ses_root",
                  stage: "assistant",
                  messageIDs: ["msg_latest"],
                  firstMessageTime: 1_776_000_000_900,
                  lastMessageTime: 1_776_000_000_900,
                  orderKey: sessionOrderKey("ses_root", 1_776_000_000_900),
                  placement: "top_level",
                },
              ],
              topLevelSessionIDs: ["ses_old", "ses_root"],
            },
            eventReplay: { cursor: 5, latestSequence: 5, complete: true, limit: 500 },
            history: {
              oldestTimestamp: 1_776_000_000_900,
              oldestMessageID: "msg_latest",
              oldestOrderKey: messageOrderKey("msg_latest", 1_776_000_000_900),
              hasMore: true,
              limit: 1,
            },
            lastSequence: 5,
          },
        }
      }
      if (req.path === "task/tsk_lazy/conversation/history") {
        expect(req.query?.before).toBe("1776000000900")
        expect(req.query?.before_id).toBe("msg_latest")
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            transcript: [oldMessage],
            timeline: [],
            events: [],
            view: {
              messages: [
                {
                  sessionID: "ses_old",
                  stage: "integrity",
                  messageID: "msg_old",
                  time: 1_776_000_000_100,
                  orderKey: messageOrderKey("msg_old", 1_776_000_000_100),
                  placement: "top_level",
                },
              ],
              sessions: [
                {
                  sessionID: "ses_old",
                  stage: "integrity",
                  messageIDs: ["msg_old"],
                  firstMessageTime: 1_776_000_000_100,
                  lastMessageTime: 1_776_000_000_100,
                  orderKey: sessionOrderKey("ses_old", 1_776_000_000_100),
                  placement: "top_level",
                },
              ],
              topLevelSessionIDs: ["ses_old"],
            },
            history: {
              oldestTimestamp: 1_776_000_000_100,
              oldestMessageID: "msg_old",
              oldestOrderKey: null,
              hasMore: false,
              limit: 160,
            },
          },
        }
      }
      throw new Error(`unexpected request path: ${req.path}`)
    }),
  )

  await expect(hydrateTaskConversation("tsk_lazy", { tailLimit: 1, directory: TEST_DIRECTORY })).resolves.toBe(5)
  expect(cardTreeStore.order.filter((id) => id !== "ctx:user-request")).toEqual([
    "assistant:session:ses_root:message:msg_latest",
  ])
  expect(conversationAgentStore.records.map((record) => record.sessionID)).toEqual(["ses_old", "ses_root"])
  const oldCardID = "integrity:session:ses_old:message:msg_old"
  expect(conversationAgentStore.records[0]?.renderedCardID).toBeUndefined()
  expect(cardTreeStore.cards[oldCardID]).toBeUndefined()

  await expect(loadConversationHistoryUntilCard(oldCardID, "tsk_lazy")).resolves.toBe(true)
  expect(cardTreeStore.order.filter((id) => id !== "ctx:user-request")).toEqual([
    oldCardID,
    "assistant:session:ses_root:message:msg_latest",
  ])
  expect(conversationAgentStore.records[0]?.renderedCardID).toBe(oldCardID)
  expect(requests.map((req) => req.path)).toEqual(["task/tsk_lazy/conversation", "task/tsk_lazy/conversation/history"])
})

test("history paging preserves lifecycle-only frontend agent rail records without blank cards", async () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_lifecycle_history" })
  const requests: TransportRequest[] = []
  const cardID = "frontend-research:session:ses_frontend_lifecycle"

  const board = {
    snapshotVersion: "board:lifecycle-history",
    task: {
      id: "tsk_lifecycle_history",
      status: "active",
      request: "restore lifecycle-only frontend agent",
      sessionID: "ses_root",
      directory: TEST_DIRECTORY,
      time: { created: 1_776_000_030_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  }
  const latestMessage = {
    info: {
      id: "msg_lifecycle_latest",
      sessionID: "ses_root",
      role: "assistant",
      resolvedRole: "assistant",
      channel: "assistant",
      orderKey: messageOrderKey("msg_lifecycle_latest", 1_776_000_030_900),
      time: { created: 1_776_000_030_900 },
    },
    parts: [
      {
        id: "part_lifecycle_latest",
        sessionID: "ses_root",
        messageID: "msg_lifecycle_latest",
        type: "text",
        text: "Latest tail.",
        orderKey: partOrderKey("part_lifecycle_latest", 1_776_000_030_900),
      },
    ],
  }
  const lifecycleEvent = {
    event_id: "pev_lifecycle_history",
    task_id: "tsk_lifecycle_history",
    type: "session.status",
    emittedAt: 1_776_000_030_200,
    timestamp: 1_776_000_030_200,
    sequence: 7,
    orderKey: sessionOrderKey("ses_frontend_lifecycle", 1_776_000_030_200),
    summary: "Frontend research failed before writing a message",
    payload: {
      taskID: "tsk_lifecycle_history",
      sessionID: "ses_frontend_lifecycle",
      channel: "frontend-research",
      resolvedRole: "frontend-research",
      parentSessionID: "ses_root",
      orderKey: sessionOrderKey("ses_frontend_lifecycle", 1_776_000_030_200),
      status: { type: "terminal", reason: "error", error: "prepared evidence missing" },
    },
  }

  __setHostTransportForTest(
    fakeTransport((req) => {
      requests.push(req)
      if (req.path === "task/tsk_lifecycle_history/conversation") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            board,
            transcript: [latestMessage],
            timeline: [],
            events: [],
            view: {
              messages: [
                {
                  sessionID: "ses_root",
                  stage: "assistant",
                  messageID: "msg_lifecycle_latest",
                  time: 1_776_000_030_900,
                  orderKey: messageOrderKey("msg_lifecycle_latest", 1_776_000_030_900),
                  placement: "top_level",
                },
              ],
              sessions: [
                {
                  sessionID: "ses_root",
                  stage: "assistant",
                  messageIDs: ["msg_lifecycle_latest"],
                  firstMessageTime: 1_776_000_030_900,
                  lastMessageTime: 1_776_000_030_900,
                  orderKey: sessionOrderKey("ses_root", 1_776_000_030_900),
                  placement: "top_level",
                },
              ],
              topLevelSessionIDs: ["ses_root"],
            },
            agentView: {
              messages: [],
              sessions: [
                {
                  sessionID: "ses_frontend_lifecycle",
                  stage: "frontend-research",
                  parentSessionID: "ses_root",
                  messageIDs: [],
                  firstMessageTime: 1_776_000_030_200,
                  lastMessageTime: 1_776_000_030_200,
                  orderKey: sessionOrderKey("ses_frontend_lifecycle", 1_776_000_030_200),
                  placement: "top_level",
                },
              ],
              topLevelSessionIDs: ["ses_frontend_lifecycle"],
            },
            eventReplay: { cursor: 8, latestSequence: 8, complete: true, limit: 500 },
            history: {
              oldestTimestamp: 1_776_000_030_900,
              oldestMessageID: "msg_lifecycle_latest",
              oldestOrderKey: messageOrderKey("msg_lifecycle_latest", 1_776_000_030_900),
              hasMore: true,
              limit: 1,
            },
            lastSequence: 8,
          },
        }
      }
      if (req.path === "task/tsk_lifecycle_history/conversation/history") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            transcript: [],
            timeline: [],
            events: [lifecycleEvent],
            view: {
              messages: [],
              sessions: [
                {
                  sessionID: "ses_frontend_lifecycle",
                  stage: "frontend-research",
                  parentSessionID: "ses_root",
                  messageIDs: [],
                  firstMessageTime: 1_776_000_030_200,
                  lastMessageTime: 1_776_000_030_200,
                  orderKey: sessionOrderKey("ses_frontend_lifecycle", 1_776_000_030_200),
                  placement: "top_level",
                },
              ],
              topLevelSessionIDs: ["ses_frontend_lifecycle"],
            },
            history: {
              oldestTimestamp: null,
              oldestMessageID: null,
              oldestOrderKey: null,
              hasMore: false,
              limit: 160,
            },
          },
        }
      }
      throw new Error(`unexpected request path: ${req.path}`)
    }),
  )

  await expect(
    hydrateTaskConversation("tsk_lifecycle_history", { tailLimit: 1, directory: TEST_DIRECTORY }),
  ).resolves.toBe(8)
  expect(conversationAgentStore.records.map((record) => record.sessionID)).toEqual(["ses_frontend_lifecycle"])
  expect(conversationAgentStore.records[0]?.renderedCardID).toBeUndefined()
  expect(cardTreeStore.cards[cardID]).toBeUndefined()

  await expect(loadConversationHistoryUntilCard(cardID, "tsk_lifecycle_history")).resolves.toBe(false)
  expect(cardTreeStore.cards[cardID]).toBeUndefined()
  expect(requests.map((req) => req.path)).toEqual([
    "task/tsk_lifecycle_history/conversation",
    "task/tsk_lifecycle_history/conversation/history",
  ])
})

test("history paging continues when a goal phase card exists but its target message is not loaded", async () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_phase_history" })
  const requests: TransportRequest[] = []
  const phaseCardID = "step:gol_phase:build:phase:build"

  const board = {
    snapshotVersion: "board:phase-history",
    task: {
      id: "tsk_phase_history",
      status: "active",
      request: "restore phase conversation lazily",
      sessionID: "ses_root",
      directory: TEST_DIRECTORY,
      time: { created: 1_776_000_010_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "build",
          phases: [{ id: "build", label: "Build", sessionKind: "build" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: "gol_phase",
        goalTitle: "Phase goal",
        goalObjective: "Keep build output visible",
        orderIndex: 0,
        retryCount: 0,
        steps: [
          {
            stepID: "build",
            label: "Executor",
            status: "completed",
            startedAt: 1_776_000_010_100,
            phases: {
              build: {
                status: "completed",
                startedAt: 1_776_000_010_120,
                completedAt: 1_776_000_010_700,
              },
            },
          },
        ],
      },
    ],
    interactions: [],
  }

  const latestMessage = {
    info: {
      id: "msg_latest_phase",
      sessionID: "ses_root",
      role: "assistant",
      resolvedRole: "assistant",
      channel: "assistant",
      orderKey: messageOrderKey("msg_latest_phase", 1_776_000_010_900),
      time: { created: 1_776_000_010_900 },
    },
    parts: [
      {
        id: "part_latest_phase",
        sessionID: "ses_root",
        messageID: "msg_latest_phase",
        type: "text",
        text: "Latest tail.",
        orderKey: partOrderKey("part_latest_phase", 1_776_000_010_900),
      },
    ],
  }
  const oldBuildMessage = {
    info: {
      id: "msg_build_old",
      sessionID: "ses_build_old",
      parentSessionID: "ses_root",
      goalID: "gol_phase",
      role: "assistant",
      resolvedRole: "build",
      channel: "build",
      orderKey: messageOrderKey("msg_build_old", 1_776_000_010_200),
      time: { created: 1_776_000_010_200, completed: 1_776_000_010_700 },
    },
    parts: [
      {
        id: "part_build_old",
        sessionID: "ses_build_old",
        messageID: "msg_build_old",
        type: "text",
        text: "Build output from older history.",
        orderKey: partOrderKey("part_build_old", 1_776_000_010_200),
      },
    ],
  }

  __setHostTransportForTest(
    fakeTransport((req) => {
      requests.push(req)
      if (req.path === "task/tsk_phase_history/conversation") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            board,
            transcript: [latestMessage],
            timeline: [],
            events: [],
            view: {
              messages: [
                {
                  sessionID: "ses_root",
                  stage: "assistant",
                  messageID: "msg_latest_phase",
                  time: 1_776_000_010_900,
                  orderKey: messageOrderKey("msg_latest_phase", 1_776_000_010_900),
                  placement: "top_level",
                },
              ],
              sessions: [
                {
                  sessionID: "ses_root",
                  stage: "assistant",
                  messageIDs: ["msg_latest_phase"],
                  firstMessageTime: 1_776_000_010_900,
                  lastMessageTime: 1_776_000_010_900,
                  orderKey: sessionOrderKey("ses_root", 1_776_000_010_900),
                  placement: "top_level",
                },
              ],
              topLevelSessionIDs: ["ses_root"],
            },
            agentView: {
              messages: [
                {
                  sessionID: "ses_build_old",
                  stage: "build",
                  parentSessionID: "ses_root",
                  goalID: "gol_phase",
                  messageID: "msg_build_old",
                  time: 1_776_000_010_200,
                  orderKey: messageOrderKey("msg_build_old", 1_776_000_010_200),
                  placement: "goal_phase",
                  phase: { stepID: "build", phaseID: "build" },
                },
                {
                  sessionID: "ses_root",
                  stage: "assistant",
                  messageID: "msg_latest_phase",
                  time: 1_776_000_010_900,
                  orderKey: messageOrderKey("msg_latest_phase", 1_776_000_010_900),
                  placement: "top_level",
                },
              ],
              sessions: [
                {
                  sessionID: "ses_build_old",
                  stage: "build",
                  parentSessionID: "ses_root",
                  goalID: "gol_phase",
                  messageIDs: ["msg_build_old"],
                  firstMessageTime: 1_776_000_010_200,
                  lastMessageTime: 1_776_000_010_700,
                  orderKey: sessionOrderKey("ses_build_old", 1_776_000_010_200),
                  placement: "goal_phase",
                  phase: { stepID: "build", phaseID: "build" },
                },
                {
                  sessionID: "ses_root",
                  stage: "assistant",
                  messageIDs: ["msg_latest_phase"],
                  firstMessageTime: 1_776_000_010_900,
                  lastMessageTime: 1_776_000_010_900,
                  orderKey: sessionOrderKey("ses_root", 1_776_000_010_900),
                  placement: "top_level",
                },
              ],
              topLevelSessionIDs: ["ses_root"],
            },
            eventReplay: { cursor: 7, latestSequence: 7, complete: true, limit: 500 },
            history: {
              oldestTimestamp: 1_776_000_010_900,
              oldestMessageID: "msg_latest_phase",
              oldestOrderKey: messageOrderKey("msg_latest_phase", 1_776_000_010_900),
              hasMore: true,
              limit: 1,
            },
            lastSequence: 7,
          },
        }
      }
      if (req.path === "task/tsk_phase_history/conversation/history") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            transcript: [oldBuildMessage],
            timeline: [],
            events: [],
            view: {
              messages: [
                {
                  sessionID: "ses_build_old",
                  stage: "build",
                  parentSessionID: "ses_root",
                  goalID: "gol_phase",
                  messageID: "msg_build_old",
                  time: 1_776_000_010_200,
                  orderKey: messageOrderKey("msg_build_old", 1_776_000_010_200),
                  placement: "goal_phase",
                  phase: { stepID: "build", phaseID: "build" },
                },
              ],
              sessions: [
                {
                  sessionID: "ses_build_old",
                  stage: "build",
                  parentSessionID: "ses_root",
                  goalID: "gol_phase",
                  messageIDs: ["msg_build_old"],
                  firstMessageTime: 1_776_000_010_200,
                  lastMessageTime: 1_776_000_010_700,
                  orderKey: sessionOrderKey("ses_build_old", 1_776_000_010_200),
                  placement: "goal_phase",
                  phase: { stepID: "build", phaseID: "build" },
                },
              ],
              topLevelSessionIDs: [],
            },
            history: {
              oldestTimestamp: 1_776_000_010_200,
              oldestMessageID: "msg_build_old",
              oldestOrderKey: null,
              hasMore: false,
              limit: 160,
            },
          },
        }
      }
      throw new Error(`unexpected request path: ${req.path}`)
    }),
  )

  await expect(hydrateTaskConversation("tsk_phase_history", { tailLimit: 1, directory: TEST_DIRECTORY })).resolves.toBe(
    7,
  )
  expect(cardTreeStore.cards[phaseCardID]).toBeDefined()
  expect(conversationCardContainsMessage(phaseCardID, "msg_build_old")).toBe(false)

  await expect(
    loadConversationHistoryUntilCard(phaseCardID, "tsk_phase_history", { messageID: "msg_build_old" }),
  ).resolves.toBe(true)
  expect(conversationCardContainsMessage(phaseCardID, "msg_build_old")).toBe(true)
  expect(requests.map((req) => req.path)).toEqual([
    "task/tsk_phase_history/conversation",
    "task/tsk_phase_history/conversation/history",
  ])
})

test("goal phase history can hydrate a build session directly by session id", async () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_phase_session" })
  const requests: TransportRequest[] = []
  const phaseCardID = "step:gol_phase_session:build:phase:build"

  const board = {
    snapshotVersion: "board:phase-session",
    task: {
      id: "tsk_phase_session",
      status: "active",
      request: "restore build session directly",
      sessionID: "ses_root",
      directory: TEST_DIRECTORY,
      time: { created: 1_776_000_020_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "build",
          phases: [{ id: "build", label: "Build", sessionKind: "build" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: "gol_phase_session",
        goalTitle: "Phase session goal",
        goalObjective: "Load old build transcript by session id",
        orderIndex: 0,
        retryCount: 0,
        steps: [
          {
            stepID: "build",
            label: "Executor",
            status: "completed",
            startedAt: 1_776_000_020_100,
            payload: { buildSessionID: "ses_build_session" },
            phases: {
              build: {
                status: "completed",
                startedAt: 1_776_000_020_120,
                completedAt: 1_776_000_020_700,
              },
            },
          },
        ],
      },
    ],
    interactions: [],
  }
  const latestMessage = {
    info: {
      id: "msg_latest_session",
      sessionID: "ses_root",
      role: "assistant",
      resolvedRole: "assistant",
      channel: "assistant",
      orderKey: messageOrderKey("msg_latest_session", 1_776_000_020_900),
      time: { created: 1_776_000_020_900 },
    },
    parts: [
      {
        id: "part_latest_session",
        sessionID: "ses_root",
        messageID: "msg_latest_session",
        type: "text",
        text: "Latest tail.",
        orderKey: partOrderKey("part_latest_session", 1_776_000_020_900),
      },
    ],
  }
  const buildMessage = {
    info: {
      id: "msg_build_session",
      sessionID: "ses_build_session",
      parentSessionID: "ses_root",
      goalID: "gol_phase_session",
      role: "assistant",
      resolvedRole: "build",
      channel: "build",
      orderKey: messageOrderKey("msg_build_session", 1_776_000_020_200),
      time: { created: 1_776_000_020_200, completed: 1_776_000_020_700 },
    },
    parts: [
      {
        id: "part_build_session",
        sessionID: "ses_build_session",
        messageID: "msg_build_session",
        type: "text",
        text: "Build output loaded directly by session.",
        orderKey: partOrderKey("part_build_session", 1_776_000_020_200),
      },
    ],
  }

  __setHostTransportForTest(
    fakeTransport((req) => {
      requests.push(req)
      if (req.path === "task/tsk_phase_session/conversation") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            board,
            transcript: [latestMessage],
            timeline: [],
            events: [],
            view: {
              messages: [
                {
                  sessionID: "ses_root",
                  stage: "assistant",
                  messageID: "msg_latest_session",
                  time: 1_776_000_020_900,
                  orderKey: messageOrderKey("msg_latest_session", 1_776_000_020_900),
                  placement: "top_level",
                },
              ],
              sessions: [
                {
                  sessionID: "ses_root",
                  stage: "assistant",
                  messageIDs: ["msg_latest_session"],
                  firstMessageTime: 1_776_000_020_900,
                  lastMessageTime: 1_776_000_020_900,
                  orderKey: sessionOrderKey("ses_root", 1_776_000_020_900),
                  placement: "top_level",
                },
              ],
              topLevelSessionIDs: ["ses_root"],
            },
            agentView: {
              messages: [
                {
                  sessionID: "ses_build_session",
                  stage: "build",
                  parentSessionID: "ses_root",
                  goalID: "gol_phase_session",
                  messageID: "msg_build_session",
                  time: 1_776_000_020_200,
                  orderKey: messageOrderKey("msg_build_session", 1_776_000_020_200),
                  placement: "goal_phase",
                  phase: { stepID: "build", phaseID: "build" },
                },
              ],
              sessions: [
                {
                  sessionID: "ses_build_session",
                  stage: "build",
                  parentSessionID: "ses_root",
                  goalID: "gol_phase_session",
                  messageIDs: ["msg_build_session"],
                  lastDisplayMessageID: "msg_build_session",
                  firstMessageTime: 1_776_000_020_200,
                  lastMessageTime: 1_776_000_020_700,
                  orderKey: sessionOrderKey("ses_build_session", 1_776_000_020_200),
                  placement: "goal_phase",
                  phase: { stepID: "build", phaseID: "build" },
                },
              ],
              topLevelSessionIDs: ["ses_root"],
            },
            eventReplay: { cursor: 8, latestSequence: 8, complete: true, limit: 500 },
            history: {
              oldestTimestamp: 1_776_000_020_900,
              oldestMessageID: "msg_latest_session",
              oldestOrderKey: messageOrderKey("msg_latest_session", 1_776_000_020_900),
              hasMore: true,
              limit: 1,
            },
            lastSequence: 8,
          },
        }
      }
      if (req.path === "task/tsk_phase_session/conversation/session/ses_build_session") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            transcript: [buildMessage],
            timeline: [],
            events: [],
            view: {
              messages: [
                {
                  sessionID: "ses_build_session",
                  stage: "build",
                  parentSessionID: "ses_root",
                  goalID: "gol_phase_session",
                  messageID: "msg_build_session",
                  time: 1_776_000_020_200,
                  orderKey: messageOrderKey("msg_build_session", 1_776_000_020_200),
                  placement: "goal_phase",
                  phase: { stepID: "build", phaseID: "build" },
                },
              ],
              sessions: [
                {
                  sessionID: "ses_build_session",
                  stage: "build",
                  parentSessionID: "ses_root",
                  goalID: "gol_phase_session",
                  messageIDs: ["msg_build_session"],
                  lastDisplayMessageID: "msg_build_session",
                  firstMessageTime: 1_776_000_020_200,
                  lastMessageTime: 1_776_000_020_700,
                  orderKey: sessionOrderKey("ses_build_session", 1_776_000_020_200),
                  placement: "goal_phase",
                  phase: { stepID: "build", phaseID: "build" },
                },
              ],
              topLevelSessionIDs: [],
            },
            history: {
              oldestTimestamp: 1_776_000_020_200,
              oldestMessageID: "msg_build_session",
              oldestOrderKey: null,
              hasMore: false,
              limit: 1,
            },
          },
        }
      }
      throw new Error(`unexpected request path: ${req.path}`)
    }),
  )

  await expect(hydrateTaskConversation("tsk_phase_session", { tailLimit: 1, directory: TEST_DIRECTORY })).resolves.toBe(
    8,
  )
  expect(cardTreeStore.cards[phaseCardID]?.phaseSessionID).toBe("ses_build_session")
  expect(conversationCardContainsMessage(phaseCardID, "msg_build_session")).toBe(false)

  await expect(
    loadConversationHistoryUntilCard(phaseCardID, "tsk_phase_session", {
      messageID: "msg_build_session",
      sessionID: "ses_build_session",
    }),
  ).resolves.toBe(true)
  expect(conversationCardContainsMessage(phaseCardID, "msg_build_session")).toBe(true)
  expect(requests.map((req) => req.path)).toEqual([
    "task/tsk_phase_session/conversation",
    "task/tsk_phase_session/conversation/session/ses_build_session",
  ])
})

test("session-scoped history load failures propagate to locate owners", async () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_phase_history_fail" })
  const requests: TransportRequest[] = []

  __setHostTransportForTest(
    fakeTransport((req) => {
      requests.push(req)
      if (req.path === "task/tsk_phase_history_fail/conversation/session/ses_build_fail") {
        return {
          status: 503,
          ok: false,
          headers: {},
          body: { error: "history unavailable" },
        }
      }
      throw new Error(`unexpected request path: ${req.path}`)
    }),
  )

  await expect(
    loadConversationHistoryUntilCard("frontend-research:session:ses_build_fail", "tsk_phase_history_fail", {
      sessionID: "ses_build_fail",
      directory: TEST_DIRECTORY,
    }),
  ).rejects.toThrow(/history unavailable|API 503/)

  expect(requests.map((req) => req.path)).toEqual(["task/tsk_phase_history_fail/conversation/session/ses_build_fail"])
})

test("session-scoped history preserves lifecycle-only frontend agent rail records without blank cards", async () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_lifecycle_session" })
  const requests: TransportRequest[] = []
  const cardID = "frontend-research:session:ses_frontend_session"

  const board = {
    snapshotVersion: "board:lifecycle-session",
    task: {
      id: "tsk_lifecycle_session",
      status: "active",
      request: "restore lifecycle-only session card",
      sessionID: "ses_root",
      directory: TEST_DIRECTORY,
      time: { created: 1_776_000_040_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  }
  const latestMessage = {
    info: {
      id: "msg_lifecycle_session_latest",
      sessionID: "ses_root",
      role: "assistant",
      resolvedRole: "assistant",
      channel: "assistant",
      orderKey: messageOrderKey("msg_lifecycle_session_latest", 1_776_000_040_900),
      time: { created: 1_776_000_040_900 },
    },
    parts: [
      {
        id: "part_lifecycle_session_latest",
        sessionID: "ses_root",
        messageID: "msg_lifecycle_session_latest",
        type: "text",
        text: "Latest tail.",
        orderKey: partOrderKey("part_lifecycle_session_latest", 1_776_000_040_900),
      },
    ],
  }
  const lifecycleEvent = {
    event_id: "pev_lifecycle_session",
    task_id: "tsk_lifecycle_session",
    type: "session.status",
    emittedAt: 1_776_000_040_200,
    timestamp: 1_776_000_040_200,
    sequence: 6,
    orderKey: sessionOrderKey("ses_frontend_session", 1_776_000_040_200),
    summary: "Frontend research failed before writing a message",
    payload: {
      taskID: "tsk_lifecycle_session",
      sessionID: "ses_frontend_session",
      channel: "frontend-research",
      resolvedRole: "frontend-research",
      parentSessionID: "ses_root",
      orderKey: sessionOrderKey("ses_frontend_session", 1_776_000_040_200),
      status: { type: "terminal", reason: "error", error: "browser evidence failed" },
    },
  }

  __setHostTransportForTest(
    fakeTransport((req) => {
      requests.push(req)
      if (req.path === "task/tsk_lifecycle_session/conversation") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            board,
            transcript: [latestMessage],
            timeline: [],
            events: [],
            view: {
              messages: [
                {
                  sessionID: "ses_root",
                  stage: "assistant",
                  messageID: "msg_lifecycle_session_latest",
                  time: 1_776_000_040_900,
                  orderKey: messageOrderKey("msg_lifecycle_session_latest", 1_776_000_040_900),
                  placement: "top_level",
                },
              ],
              sessions: [
                {
                  sessionID: "ses_root",
                  stage: "assistant",
                  messageIDs: ["msg_lifecycle_session_latest"],
                  firstMessageTime: 1_776_000_040_900,
                  lastMessageTime: 1_776_000_040_900,
                  orderKey: sessionOrderKey("ses_root", 1_776_000_040_900),
                  placement: "top_level",
                },
              ],
              topLevelSessionIDs: ["ses_root"],
            },
            agentView: {
              messages: [],
              sessions: [
                {
                  sessionID: "ses_frontend_session",
                  stage: "frontend-research",
                  parentSessionID: "ses_root",
                  messageIDs: [],
                  firstMessageTime: 1_776_000_040_200,
                  lastMessageTime: 1_776_000_040_200,
                  orderKey: sessionOrderKey("ses_frontend_session", 1_776_000_040_200),
                  placement: "top_level",
                },
              ],
              topLevelSessionIDs: ["ses_frontend_session"],
            },
            eventReplay: { cursor: 7, latestSequence: 7, complete: true, limit: 500 },
            history: {
              oldestTimestamp: 1_776_000_040_900,
              oldestMessageID: "msg_lifecycle_session_latest",
              oldestOrderKey: messageOrderKey("msg_lifecycle_session_latest", 1_776_000_040_900),
              hasMore: true,
              limit: 1,
            },
            lastSequence: 7,
          },
        }
      }
      if (req.path === "task/tsk_lifecycle_session/conversation/session/ses_frontend_session") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            transcript: [],
            timeline: [],
            events: [lifecycleEvent],
            view: {
              messages: [],
              sessions: [
                {
                  sessionID: "ses_frontend_session",
                  stage: "frontend-research",
                  parentSessionID: "ses_root",
                  messageIDs: [],
                  firstMessageTime: 1_776_000_040_200,
                  lastMessageTime: 1_776_000_040_200,
                  orderKey: sessionOrderKey("ses_frontend_session", 1_776_000_040_200),
                  placement: "top_level",
                },
              ],
              topLevelSessionIDs: ["ses_frontend_session"],
            },
            history: {
              oldestTimestamp: 1_776_000_040_200,
              oldestMessageID: null,
              oldestOrderKey: null,
              hasMore: false,
              limit: 1,
            },
          },
        }
      }
      throw new Error(`unexpected request path: ${req.path}`)
    }),
  )

  await expect(
    hydrateTaskConversation("tsk_lifecycle_session", { tailLimit: 1, directory: TEST_DIRECTORY }),
  ).resolves.toBe(7)
  expect(conversationAgentStore.records.map((record) => record.sessionID)).toEqual(["ses_frontend_session"])
  expect(conversationAgentStore.records[0]?.renderedCardID).toBeUndefined()
  expect(cardTreeStore.cards[cardID]).toBeUndefined()

  await expect(loadConversationSessionHistory("ses_frontend_session", "tsk_lifecycle_session")).resolves.toBe(true)
  expect(cardTreeStore.cards[cardID]).toBeUndefined()
  expect(requests.map((req) => req.path)).toEqual([
    "task/tsk_lifecycle_session/conversation",
    "task/tsk_lifecycle_session/conversation/session/ses_frontend_session",
  ])
})

test("stale session-history response after task switch does not hydrate the current task tree", async () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_history_old" })
  let resolveHistory!: (body: unknown) => void
  const historyResponse = new Promise<unknown>((resolve) => {
    resolveHistory = resolve
  })
  const requests: TransportRequest[] = []

  __setHostTransportForTest(
    fakeTransport(async (req) => {
      requests.push(req)
      if (req.path === "task/tsk_history_old/conversation/session/ses_old_build") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: await historyResponse,
        }
      }
      throw new Error(`unexpected request path: ${req.path}`)
    }),
  )

  const history = loadConversationSessionHistory("ses_old_build", "tsk_history_old", { directory: TEST_DIRECTORY })
  await Promise.resolve()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_history_new" })

  resolveHistory({
    transcript: [
      {
        info: {
          id: "msg_old_build",
          sessionID: "ses_old_build",
          role: "assistant",
          resolvedRole: "assistant",
          channel: "build",
          orderKey: messageOrderKey("msg_old_build", 1_776_000_060_000),
          time: { created: 1_776_000_060_000 },
        },
        parts: [
          {
            id: "part_old_build",
            sessionID: "ses_old_build",
            messageID: "msg_old_build",
            type: "text",
            text: "Old task build history must not appear.",
            orderKey: partOrderKey("part_old_build", 1_776_000_060_000),
          },
        ],
      },
    ],
    timeline: [],
    events: [],
    view: {
      sessions: [
        {
          sessionID: "ses_old_build",
          stage: "build",
          messageIDs: ["msg_old_build"],
          firstMessageTime: 1_776_000_060_000,
          lastMessageTime: 1_776_000_060_000,
          orderKey: sessionOrderKey("ses_old_build", 1_776_000_060_000),
          placement: "top_level",
        },
      ],
      topLevelSessionIDs: ["ses_old_build"],
    },
  })

  await expect(history).rejects.toThrow("Conversation history source changed")
  expect(requests.map((req) => req.path)).toEqual(["task/tsk_history_old/conversation/session/ses_old_build"])
  expect(
    Object.values(cardTreeStore.cards).some((card: any) =>
      card?.parts?.some((part: any) => String(part.text || "").includes("Old task build history must not appear.")),
    ),
  ).toBe(false)
})
