import { afterEach, expect, mock, test } from "bun:test"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import { installRealOverlayI18n } from "./fixtures/i18n"
import { stampTestEvent, testBoardOrderKey, testEventOrderKey, testSessionOrderKey } from "./fixtures/timeline-order"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

mock.module("../src/utils/icon-html", () => ({
  hydrateIconPlaceholders() {},
  iconHtml() {
    return ""
  },
}))

const {
  routeSSEEvent: routeSSEEventRaw,
  handleEventStreamEvent,
  handleTaskListNotification,
  __resetEventTimersForTest,
} = await import("../src/services/events")
const { boardStore, clearBoard, clearTasksForMissingDirectory, loadMoreTasks, loadTasks, setBoardData, setBoardStore } =
  await import("../src/store/board")
const { appStore, setAppStore } = await import("../src/store/app")
const { resetWriter } = await import("../src/services/tree-writer")
const { cardTreeStore } = await import("../src/store/card-tree")
const { sessionConfigRefreshToken } = await import("../src/services/config")
const { configure } = await import("../src/services/api")
const { registerConversationSourceDirectory } = await import("../src/services/conversation")
const { HOST_CAPABILITIES, __setHostTransportForTest } = await import("../src/services/host-transport")
const { resetSelectedLiveCursor } = await import("../src/services/selected-stream-cursor")

if (typeof globalThis.requestAnimationFrame === "undefined") {
  ;(globalThis as any).requestAnimationFrame = (() => 1) as any
  ;(globalThis as any).cancelAnimationFrame = (() => {}) as any
}

const CONFIG_REFRESH_DIRECTORY = "D:/overlay/config-refresh"

installRealOverlayI18n()

function routeSSEEvent(event: any): boolean {
  return routeSSEEventRaw(stampRouteSSEEventForTest(event))
}

function stampRouteSSEEventForTest(event: any): any {
  const type = String(event?.type || "event")
  const props = event?.properties && typeof event.properties === "object" ? event.properties : event?.payload
  if (typeof event.orderKey !== "string" || event.orderKey.length === 0) {
    throw new Error(`test fixture event ${type} missing orderKey`)
  }
  const baseOrderKey = event.orderKey
  if (type === "message.updated" || type === "message.part.updated") {
    return stampTestEvent(event)
  }
  if (type === "session.status" || type === "session.error" || type === "session.idle") {
    const sessionID = String(props?.sessionID || event.sessionID || "")
    const orderKey = props?.orderKey
    if (typeof event.orderKey !== "string" || event.orderKey.length === 0) {
      throw new Error(`test fixture ${type} ${sessionID || "<unknown>"} envelope missing orderKey`)
    }
    if (typeof orderKey !== "string" || orderKey.length === 0) {
      throw new Error(`test fixture ${type} ${sessionID || "<unknown>"} properties missing orderKey`)
    }
    if (event.orderKey !== orderKey) {
      throw new Error(`test fixture ${type} ${sessionID || "<unknown>"} orderKey mismatch`)
    }
    return event
  }
  if (props?.task && typeof props.task === "object") {
    const taskID = String(props.task.id || props.taskID || event.taskID || "<unknown>")
    if (typeof props.task.orderKey !== "string" || props.task.orderKey.length === 0) {
      throw new Error(`test fixture task ${taskID} missing orderKey`)
    }
    return {
      ...event,
      orderKey: baseOrderKey,
      properties: {
        ...props,
        task: props.task,
      },
    }
  }
  return { ...event, orderKey: baseOrderKey }
}

function fakeConfigTransport(paths: string[]): HostTransport {
  return {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      paths.push(req.path)
      if (req.path === "config") {
        expect(req.query?.directory).toBe(CONFIG_REFRESH_DIRECTORY)
        return { status: 200, ok: true, headers: {}, body: { model: "openai/coalesced" } as T }
      }
      if (req.path === "channel") {
        expect(req.query?.directory).toBe(CONFIG_REFRESH_DIRECTORY)
        return { status: 200, ok: true, headers: {}, body: [] as T }
      }
      if (req.path === "provider") {
        return { status: 200, ok: true, headers: {}, body: { all: [] } as T }
      }
      if (req.path === "provider/auth") {
        return { status: 200, ok: true, headers: {}, body: {} as T }
      }
      if (req.path === "config/prompt") {
        return { status: 200, ok: true, headers: {}, body: [] as T }
      }
      throw new Error(`unexpected route ${req.path}`)
    },
    openStream() {
      throw new Error("openStream not used")
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  }
}

function fakeRecoveryTransport(
  streams: Array<{ path: string; query?: Record<string, string> }>,
  _sequence = 6,
): HostTransport {
  return {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      if (req.path === "global/tasks") {
        return { status: 200, ok: true, headers: {}, body: { tasks: [] } as T }
      }
      throw new Error(`unexpected route ${req.path}`)
    },
    openStream(input) {
      streams.push(input)
      return { close() {} }
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  }
}

function fakeGoalPhaseBoardRecoveryTransport(input: {
  streams: Array<{ path: string; query?: Record<string, string> }>
  requests: Array<{ path: string; query?: Record<string, string> }>
  calls?: string[]
  board?: Record<string, any>
  status?: number
}): HostTransport {
  return {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      input.requests.push({ path: req.path, query: req.query })
      input.calls?.push(`request:${req.path}`)
      if (req.path === "task/tsk_refresh/board") {
        const status = input.status ?? 200
        return {
          status,
          ok: status >= 200 && status < 300,
          headers: {},
          body: (status >= 200 && status < 300
            ? (input.board ?? goalPhaseBoard())
            : { message: "board refresh failed" }) as T,
        }
      }
      if (req.path === "global/tasks") {
        return { status: 200, ok: true, headers: {}, body: { tasks: [] } as T }
      }
      throw new Error(`unexpected route ${req.path}`)
    },
    openStream(stream) {
      input.streams.push(stream)
      input.calls?.push(`stream:${stream.path}`)
      return { close() {} }
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  }
}

async function waitForStreamCount(
  streams: Array<{ path: string; query?: Record<string, string> }>,
  count: number,
): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (streams.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function waitForRequestCount(requests: unknown[], count: number): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (requests.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function waitForBoardSyncIdle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (!boardStore.boardSyncPending) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function testOrderKey(id: string, index: number, domain: "task" | "message" | "part" | "protocol" = "message"): string {
  const rank = domain === "task" ? 10 : domain === "message" ? 30 : domain === "part" ? 31 : 40
  const safeID = id.replace(/:/g, "_")
  return `v1:${String(1_776_000_000_000 + index).padStart(16, "0")}:${String(rank).padStart(16, "0")}:0000000000000000:${domain}:${safeID}`
}

function assistantMessageInfo(id: string, index: number) {
  const created = 1_776_000_000_000 + index
  return {
    id,
    sessionID: "ses_refresh",
    role: "assistant",
    resolvedRole: "assistant",
    channel: "assistant",
    agent: "assistant",
    orderKey: testOrderKey(id, index, "message"),
    time: { created },
  }
}

function assistantPartMeta(messageID: string, index: number) {
  return {
    channel: "assistant",
    resolvedRole: "assistant",
    orderKey: testOrderKey(messageID, index, "message"),
  }
}

function goalPhaseBoard(
  input: { goalID?: string; buildSessionID?: string; snapshotVersion?: string } = {},
): Record<string, any> {
  const goalID = input.goalID ?? "goal_phase_stale"
  const buildSessionID = input.buildSessionID ?? "ses_phase_build"
  const stepStartedAt = 1_776_000_400_000
  const phaseStartedAt = 1_776_000_400_100
  return {
    snapshotVersion: input.snapshotVersion ?? `board:${goalID}:${buildSessionID}`,
    lastSequence: 6,
    task: {
      id: "tsk_refresh",
      orderKey: testOrderKey("tsk_refresh", 100_000, "task"),
      sessionID: "ses_root",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000, started: 1_776_000_100_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "build",
          orderKey: testBoardOrderKey(`${goalID}-workflow-build`, stepStartedAt, 61),
          label: "Executor",
          tool: "build",
          scope: "goal",
          phases: [{ id: "build", label: "Build", sessionKind: "build" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID,
        orderKey: testBoardOrderKey(`${goalID}-goal`, stepStartedAt - 1, 60),
        goalRunID: `gr_${goalID}`,
        goalTitle: "Goal Phase",
        goalStatus: "running",
        orderIndex: 0,
        retryCount: 0,
        steps: [
          {
            stepID: "build",
            orderKey: testBoardOrderKey(`${goalID}-build`, stepStartedAt, 61),
            label: "Executor",
            status: "running",
            startedAt: stepStartedAt,
            payload: { buildSessionID },
            phases: {
              build: {
                orderKey: testBoardOrderKey(`${goalID}-build-build`, phaseStartedAt, 62),
                status: "running",
                startedAt: phaseStartedAt,
              },
            },
          },
        ],
      },
    ],
    interactions: [],
  }
}

function boardWithoutGoalPhase(snapshotVersion = "board:goal-phase-empty"): Record<string, any> {
  return {
    ...goalPhaseBoard({ snapshotVersion }),
    goalWorkflows: [],
  }
}

function goalPhasePartEvent(
  input: {
    goalID?: string
    sessionID?: string
    messageID?: string
    partID?: string
    sequence?: number
    index?: number
  } = {},
): Record<string, any> {
  const goalID = input.goalID ?? "goal_phase_stale"
  const sessionID = input.sessionID ?? "ses_phase_build"
  const messageID = input.messageID ?? "msg_phase_stale"
  const partID = input.partID ?? "part_phase_stale"
  const index = input.index ?? 401_000
  const messageOrderKey = testOrderKey(messageID, index, "message")
  return {
    type: "message.part.updated",
    taskID: "tsk_refresh",
    sequence: input.sequence ?? 6,
    timestamp: 1_776_000_401_000,
    orderKey: messageOrderKey,
    properties: {
      taskID: "tsk_refresh",
      channel: "build",
      resolvedRole: "build",
      parentSessionID: "ses_root",
      goalID,
      orderKey: messageOrderKey,
      part: {
        id: partID,
        orderKey: testOrderKey(partID, index + 1, "part"),
        messageID,
        sessionID,
        type: "text",
        text: "build artifact ready",
      },
    },
  }
}

function selectTaskForTest(taskID: string): void {
  if (!taskID) {
    setBoardStore("selectedSource", null)
    return
  }
  const source = { kind: "task" as const, id: taskID, directory: CONFIG_REFRESH_DIRECTORY }
  registerConversationSourceDirectory(source, CONFIG_REFRESH_DIRECTORY)
  setBoardStore("selectedSource", source)
}

afterEach(() => {
  __resetEventTimersForTest()
  clearBoard()
  mock.clearAllMocks()
  __setHostTransportForTest(undefined)
  configure({ directory: "" })
  resetSelectedLiveCursor()
  selectTaskForTest("")
  setBoardStore("board", null)
  setBoardStore("boardSyncPending", false)
  setBoardStore("taskSequence", 0)
  setBoardStore("tasksError", "")
  setAppStore({
    config: null,
    providerCatalog: null,
    providerAuth: null,
    configLoadErrors: {},
    channels: [],
    promptEntries: [],
  })
})

test("selected-task message events update card tree without board refresh", () => {
  resetWriter()
  selectTaskForTest("tsk_refresh")
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  })
  setBoardStore("boardSyncPending", false)

  const handled = routeSSEEvent({
    type: "message.updated",
    orderKey: testOrderKey("msg_refresh", 200_000, "message"),
    properties: {
      taskID: "tsk_refresh",
      info: assistantMessageInfo("msg_refresh", 200_000),
    },
  })

  expect(handled).toBe(true)
  expect(boardStore.boardSyncPending).toBe(false)
})

test("selected-task message events advance the visible cursor without recovery", async () => {
  resetWriter()
  const streams: Array<{ path: string; query?: Record<string, string> }> = []
  __setHostTransportForTest(fakeRecoveryTransport(streams, 9))
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 5)
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  })
  expect(
    routeSSEEvent({
      type: "message.updated",
      taskID: "tsk_refresh",
      sequence: 6,
      orderKey: testOrderKey("msg_refresh_seq", 200_000, "message"),
      properties: {
        info: assistantMessageInfo("msg_refresh_seq", 200_000),
      },
    }),
  ).toBe(true)
  expect(boardStore.taskSequence).toBe(6)

  expect(
    routeSSEEvent({
      type: "message.part.updated",
      taskID: "tsk_refresh",
      sequence: 7,
      timestamp: 1_776_000_200_001,
      orderKey: testOrderKey("msg_refresh_seq", 200_000, "message"),
      properties: {
        ...assistantPartMeta("msg_refresh_seq", 200_000),
        part: {
          id: "part_refresh_seq",
          orderKey: testOrderKey("part_refresh_seq", 200_001, "part"),
          messageID: "msg_refresh_seq",
          sessionID: "ses_refresh",
          resolvedRole: "assistant",
          channel: "assistant",
          type: "text",
          text: "hello",
        },
      },
    }),
  ).toBe(true)
  expect(boardStore.taskSequence).toBe(7)

  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(streams).toEqual([])
})

test("selected-task protocol task_id envelope advances the visible cursor", async () => {
  resetWriter()
  const streams: Array<{ path: string; query?: Record<string, string> }> = []
  __setHostTransportForTest(fakeRecoveryTransport(streams, 9))
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 5)
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  })
  expect(
    routeSSEEvent({
      type: "message.updated",
      task_id: "tsk_refresh",
      sequence: 6,
      orderKey: testOrderKey("msg_snake_seq", 200_000, "message"),
      properties: {
        info: assistantMessageInfo("msg_snake_seq", 200_000),
      },
    }),
  ).toBe(true)
  expect(boardStore.taskSequence).toBe(6)

  expect(
    routeSSEEvent({
      type: "message.part.updated",
      task_id: "tsk_refresh",
      sequence: 7,
      timestamp: 1_776_000_200_001,
      orderKey: testOrderKey("msg_snake_seq", 200_000, "message"),
      properties: {
        ...assistantPartMeta("msg_snake_seq", 200_000),
        part: {
          id: "part_snake_seq",
          orderKey: testOrderKey("part_snake_seq", 200_001, "part"),
          messageID: "msg_snake_seq",
          sessionID: "ses_refresh",
          resolvedRole: "assistant",
          channel: "assistant",
          type: "text",
          text: "hello",
        },
      },
    }),
  ).toBe(true)
  expect(boardStore.taskSequence).toBe(7)

  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(streams).toEqual([])
})

test("selected-task part removal updates the card tree in real time", () => {
  resetWriter()
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 7)
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  })
  expect(
    routeSSEEvent({
      type: "message.updated",
      task_id: "tsk_refresh",
      sequence: 8,
      orderKey: testOrderKey("msg_remove_part", 200_000, "message"),
      properties: {
        info: assistantMessageInfo("msg_remove_part", 200_000),
      },
    }),
  ).toBe(true)
  expect(
    routeSSEEvent({
      type: "message.part.updated",
      task_id: "tsk_refresh",
      sequence: 9,
      timestamp: 1_776_000_200_001,
      orderKey: testOrderKey("msg_remove_part", 200_000, "message"),
      properties: {
        ...assistantPartMeta("msg_remove_part", 200_000),
        part: {
          id: "part_remove_me",
          orderKey: testOrderKey("part_remove_me", 200_001, "part"),
          messageID: "msg_remove_part",
          sessionID: "ses_refresh",
          resolvedRole: "assistant",
          channel: "assistant",
          type: "text",
          text: "remove me",
        },
      },
    }),
  ).toBe(true)

  const cardID = "assistant:session:ses_refresh:message:msg_remove_part"
  expect(cardTreeStore.cards[cardID]?.parts).toHaveLength(1)

  expect(
    routeSSEEvent({
      type: "message.part.removed",
      task_id: "tsk_refresh",
      sequence: 10,
      orderKey: testEventOrderKey("message.part.removed", 1, 10),
      properties: {
        sessionID: "ses_refresh",
        messageID: "msg_remove_part",
        partID: "part_remove_me",
      },
    }),
  ).toBe(true)

  expect(cardTreeStore.cards[cardID]?.parts).toEqual([])
  expect(boardStore.taskSequence).toBe(10)
})

test("selected-task message removal removes its visible card in real time", () => {
  resetWriter()
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 3)
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  })

  expect(
    routeSSEEvent({
      type: "message.updated",
      task_id: "tsk_refresh",
      sequence: 4,
      orderKey: testOrderKey("msg_remove_all", 200_000, "message"),
      properties: {
        info: assistantMessageInfo("msg_remove_all", 200_000),
      },
    }),
  ).toBe(true)
  expect(
    routeSSEEvent({
      type: "message.part.updated",
      task_id: "tsk_refresh",
      sequence: 5,
      timestamp: 1_776_000_200_001,
      orderKey: testOrderKey("msg_remove_all", 200_000, "message"),
      properties: {
        ...assistantPartMeta("msg_remove_all", 200_000),
        part: {
          id: "part_remove_all",
          orderKey: testOrderKey("part_remove_all", 200_001, "part"),
          messageID: "msg_remove_all",
          sessionID: "ses_refresh",
          resolvedRole: "assistant",
          channel: "assistant",
          type: "text",
          text: "remove card",
        },
      },
    }),
  ).toBe(true)

  const cardID = "assistant:session:ses_refresh:message:msg_remove_all"
  expect(cardTreeStore.cards[cardID]).toBeDefined()

  expect(
    routeSSEEvent({
      type: "message.removed",
      task_id: "tsk_refresh",
      sequence: 6,
      orderKey: testEventOrderKey("message.removed", 1, 6),
      properties: {
        sessionID: "ses_refresh",
        messageID: "msg_remove_all",
      },
    }),
  ).toBe(true)

  expect(cardTreeStore.cards[cardID]).toBeUndefined()
  expect(boardStore.taskSequence).toBe(6)
})

test("selected-task message payload is still applied when board cursor is ahead", () => {
  resetWriter()
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 10)
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  })

  expect(
    routeSSEEvent({
      type: "message.updated",
      task_id: "tsk_refresh",
      sequence: 7,
      orderKey: testOrderKey("msg_late_payload", 200_000, "message"),
      properties: {
        info: assistantMessageInfo("msg_late_payload", 200_000),
      },
    }),
  ).toBe(true)

  expect(boardStore.taskSequence).toBe(10)
  expect(cardTreeStore.cards["assistant:session:ses_refresh:message:msg_late_payload"]).toBeDefined()
})

test("board-owned run progress advances selected-task cursor", async () => {
  resetWriter()
  const streams: Array<{ path: string; query?: Record<string, string> }> = []
  __setHostTransportForTest(fakeRecoveryTransport(streams, 9))
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 5)
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  })

  expect(
    routeSSEEvent({
      type: "run.progress",
      task_id: "tsk_refresh",
      sequence: 6,
      orderKey: testEventOrderKey("run.progress", 1, 6),
      properties: { type: "executor.status", status: "running" },
    }),
  ).toBe(true)
  expect(boardStore.taskSequence).toBe(6)

  expect(
    routeSSEEvent({
      type: "message.updated",
      task_id: "tsk_refresh",
      sequence: 7,
      orderKey: testOrderKey("msg_after_run_progress", 200_000, "message"),
      properties: {
        info: assistantMessageInfo("msg_after_run_progress", 200_000),
      },
    }),
  ).toBe(true)
  expect(boardStore.taskSequence).toBe(7)

  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(streams).toEqual([])
})

test("message delta with missing tree prerequisites triggers selected-task recovery", async () => {
  resetWriter()
  const streams: Array<{ path: string; query?: Record<string, string> }> = []
  __setHostTransportForTest(fakeRecoveryTransport(streams))
  selectTaskForTest("tsk_refresh")
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  })
  const treeEpoch = cardTreeStore.treeEpoch

  expect(
    routeSSEEvent({
      type: "message.part.delta",
      orderKey: testEventOrderKey("message.part.delta", 1),
      properties: {
        sessionID: "ses_missing",
        messageID: "msg_missing",
        partID: "part_missing",
        field: "text",
        delta: "lost",
      },
    }),
  ).toBe(true)

  await waitForStreamCount(streams, 1)
  expect(cardTreeStore.treeEpoch).toBe(treeEpoch)
  expect(streams).toEqual([
    { path: "task/tsk_refresh/events", query: { directory: CONFIG_REFRESH_DIRECTORY, after_live: "0" } },
  ])
})

test("goal phase part waits for fresh board projection before selected-task recovery replay", async () => {
  resetWriter()
  const requests: Array<{ path: string; query?: Record<string, string> }> = []
  const streams: Array<{ path: string; query?: Record<string, string> }> = []
  const calls: string[] = []
  __setHostTransportForTest(
    fakeGoalPhaseBoardRecoveryTransport({
      requests,
      streams,
      calls,
      board: goalPhaseBoard({ goalID: "goal_phase_stale", buildSessionID: "ses_phase_build" }),
    }),
  )
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 5)
  setBoardStore("board", boardWithoutGoalPhase("board:stale-goal-phase"))
  setBoardStore("snapshotVersion", "board:stale-goal-phase")
  setBoardStore("boardSyncPending", true)

  const event = goalPhasePartEvent({ goalID: "goal_phase_stale", sessionID: "ses_phase_build" })
  expect(routeSSEEvent(event)).toBe(true)

  await waitForRequestCount(requests, 1)
  await waitForStreamCount(streams, 1)
  expect(calls).toEqual(["request:task/tsk_refresh/board", "stream:task/tsk_refresh/events"])
  expect(requests[0]?.query?.sync).toBe("1")
  expect(requests[0]?.query?.directory).toBe(CONFIG_REFRESH_DIRECTORY)
  expect(streams).toEqual([
    {
      path: "task/tsk_refresh/events",
      query: { directory: CONFIG_REFRESH_DIRECTORY, after: "5", after_live: "0" },
    },
  ])
  expect(boardStore.boardSyncPending).toBe(false)
  expect(cardTreeStore.cards["step:goal_phase_stale:build:phase:build"]?.phaseSessionID).toBe("ses_phase_build")
  expect(cardTreeStore.cards["step:goal_phase_stale:build:phase:build"]?.parts).toHaveLength(0)

  expect(routeSSEEvent(event)).toBe(true)
  expect(cardTreeStore.cards["step:goal_phase_stale:build:phase:build"]?.parts).toHaveLength(2)
  expect(cardTreeStore.cards["build:session:ses_phase_build:message:msg_phase_stale"]).toBeUndefined()
})

test("goal phase part without pending board sync stays visible top-level when the board no longer owns the goal", () => {
  resetWriter()
  const requests: Array<{ path: string; query?: Record<string, string> }> = []
  const streams: Array<{ path: string; query?: Record<string, string> }> = []
  __setHostTransportForTest(fakeGoalPhaseBoardRecoveryTransport({ requests, streams }))
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 5)
  setBoardStore("board", boardWithoutGoalPhase("board:no-pending-goal-phase"))
  setBoardStore("snapshotVersion", "board:no-pending-goal-phase")
  setBoardStore("boardSyncPending", false)

  expect(routeSSEEvent(goalPhasePartEvent())).toBe(true)
  expect(cardTreeStore.cards["step:goal_phase_stale:build:phase:build"]).toBeUndefined()
  expect(cardTreeStore.cards["build:session:ses_phase_build:message:msg_phase_stale"]).toEqual(
    expect.objectContaining({
      kind: "agent",
      sessionID: "ses_phase_build",
      messageID: "msg_phase_stale",
    }),
  )
  expect(requests).toEqual([])
  expect(streams).toEqual([])
})

test("goal phase part with a fresh board that still lacks the goal owner replays as top-level", async () => {
  resetWriter()
  const requests: Array<{ path: string; query?: Record<string, string> }> = []
  const streams: Array<{ path: string; query?: Record<string, string> }> = []
  __setHostTransportForTest(
    fakeGoalPhaseBoardRecoveryTransport({
      requests,
      streams,
      board: boardWithoutGoalPhase("board:fresh-missing-goal-phase"),
    }),
  )
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 5)
  setBoardStore("board", boardWithoutGoalPhase("board:stale-missing-goal-phase"))
  setBoardStore("snapshotVersion", "board:stale-missing-goal-phase")
  setBoardStore("boardSyncPending", true)

  const event = goalPhasePartEvent()
  expect(routeSSEEvent(event)).toBe(true)
  await waitForRequestCount(requests, 1)
  await waitForStreamCount(streams, 1)
  expect(boardStore.boardSyncPending).toBe(false)

  expect(routeSSEEvent(event)).toBe(true)
  expect(cardTreeStore.cards["step:goal_phase_stale:build:phase:build"]).toBeUndefined()
  expect(cardTreeStore.cards["build:session:ses_phase_build:message:msg_phase_stale"]).toEqual(
    expect.objectContaining({
      kind: "agent",
      sessionID: "ses_phase_build",
      messageID: "msg_phase_stale",
    }),
  )
})

test("goal phase fresh board failure does not reopen selected-task stream", async () => {
  resetWriter()
  const originalError = console.error
  let errorCalls = 0
  console.error = () => {
    errorCalls += 1
  }
  try {
    const requests: Array<{ path: string; query?: Record<string, string> }> = []
    const streams: Array<{ path: string; query?: Record<string, string> }> = []
    __setHostTransportForTest(fakeGoalPhaseBoardRecoveryTransport({ requests, streams, status: 500 }))
    selectTaskForTest("tsk_refresh")
    setBoardStore("taskSequence", 5)
    setBoardStore("board", boardWithoutGoalPhase("board:failed-goal-phase"))
    setBoardStore("snapshotVersion", "board:failed-goal-phase")
    setBoardStore("boardSyncPending", true)

    expect(routeSSEEvent(goalPhasePartEvent())).toBe(true)
    await waitForRequestCount(requests, 1)
    await Promise.resolve()
    await Promise.resolve()

    expect(requests[0]?.path).toBe("task/tsk_refresh/board")
    expect(streams).toEqual([])
    expect(boardStore.snapshotVersion).toBe("board:failed-goal-phase")
    expect(errorCalls).toBeGreaterThan(0)
  } finally {
    console.error = originalError
  }
})

test("goal phase owner mismatch stays visible top-level instead of forcing stale phase recovery", () => {
  resetWriter()
  const requests: Array<{ path: string; query?: Record<string, string> }> = []
  const streams: Array<{ path: string; query?: Record<string, string> }> = []
  __setHostTransportForTest(fakeGoalPhaseBoardRecoveryTransport({ requests, streams }))
  selectTaskForTest("tsk_refresh")
  setBoardData(goalPhaseBoard({ goalID: "goal_phase_owner", buildSessionID: "ses_phase_owner" }))
  setBoardStore("taskSequence", 5)
  setBoardStore("boardSyncPending", true)

  expect(
    routeSSEEvent(
      goalPhasePartEvent({
        goalID: "goal_phase_owner",
        sessionID: "ses_phase_other",
        messageID: "msg_phase_owner",
        partID: "part_phase_owner",
      }),
    ),
  ).toBe(true)
  expect(cardTreeStore.cards["step:goal_phase_owner:build:phase:build"]?.phaseSessionID).toBe("ses_phase_owner")
  expect(cardTreeStore.cards["build:session:ses_phase_other:message:msg_phase_owner"]).toEqual(
    expect.objectContaining({
      kind: "agent",
      sessionID: "ses_phase_other",
      messageID: "msg_phase_owner",
    }),
  )
  expect(requests).toEqual([])
  expect(streams).toEqual([])
})

test("board-owned run progress still schedules board refresh", () => {
  resetWriter()
  setBoardStore("boardSyncPending", false)

  expect(
    routeSSEEvent({
      type: "run.progress",
      orderKey: testEventOrderKey("run.progress", 1),
      properties: { type: "executor.status", status: "running" },
    }),
  ).toBe(true)

  expect(boardStore.boardSyncPending).toBe(true)
})

test("selected-task session status updates cards without board refresh", () => {
  resetWriter()
  selectTaskForTest("tsk_refresh")
  setBoardStore("boardSyncPending", false)
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  })

  const event = {
    type: "session.status",
    taskID: "tsk_refresh",
    sequence: 6,
    orderKey: testSessionOrderKey("ses_refresh", 1),
    properties: {
      taskID: "tsk_refresh",
      sessionID: "ses_refresh",
      orderKey: testSessionOrderKey("ses_refresh", 1),
      channel: "main",
      status: { type: "streaming" },
    },
  }
  const handled = routeSSEEvent(event)
  if (!handled) handleEventStreamEvent(event)

  expect(boardStore.boardSyncPending).toBe(false)
  expect(boardStore.taskSequence).toBe(6)
})

test("task-list session status notification does not refresh selected board", () => {
  resetWriter()
  selectTaskForTest("tsk_refresh")
  setBoardStore("boardSyncPending", false)
  setBoardStore("taskSequence", 5)

  handleTaskListNotification({
    type: "session.status",
    taskID: "tsk_refresh",
    sequence: 6,
  })

  expect(boardStore.boardSyncPending).toBe(false)
  expect(boardStore.taskSequence).toBe(5)
})

test("consumed sequenced run progress advances selected cursor and avoids false recovery", async () => {
  resetWriter()
  const streams: Array<{ path: string; query?: Record<string, string> }> = []
  __setHostTransportForTest(fakeRecoveryTransport(streams, 9))
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 5)

  expect(
    routeSSEEvent({
      type: "run.progress",
      taskID: "tsk_refresh",
      sequence: 6,
      orderKey: testEventOrderKey("run.progress", 1, 6),
      properties: {
        type: "executor.status",
        taskID: "tsk_refresh",
        status: "running",
      },
    }),
  ).toBe(true)

  expect(boardStore.taskSequence).toBe(6)
  expect(cardTreeStore.cards["executor:session:ses_refresh:message:executor:msg:run_refresh"]).toBeUndefined()

  const event = {
    type: "goal.progress",
    taskID: "tsk_refresh",
    sequence: 7,
    orderKey: testEventOrderKey("goal.progress", 1, 7),
  }
  const handled = routeSSEEvent(event)
  if (!handled) handleEventStreamEvent(event)

  expect(boardStore.taskSequence).toBe(7)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(streams).toEqual([])
})

test("consumed sequenced run output advances selected cursor and avoids false recovery", async () => {
  resetWriter()
  const streams: Array<{ path: string; query?: Record<string, string> }> = []
  __setHostTransportForTest(fakeRecoveryTransport(streams, 9))
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 5)

  expect(
    routeSSEEvent({
      type: "run.output",
      taskID: "tsk_refresh",
      event_id: "evt_output_1",
      orderKey: testOrderKey("evt_output_1", 200_000, "protocol"),
      timestamp: 1_776_000_200_000,
      sequence: 6,
      summary: "partial output",
      properties: {
        taskID: "tsk_refresh",
        runID: "run_refresh",
        sessionID: "ses_refresh",
        text: "partial output",
      },
    }),
  ).toBe(true)

  expect(boardStore.taskSequence).toBe(6)

  const event = {
    type: "goal.progress",
    taskID: "tsk_refresh",
    sequence: 7,
    orderKey: testEventOrderKey("goal.progress", 1, 7),
  }
  const handled = routeSSEEvent(event)
  if (!handled) handleEventStreamEvent(event)

  expect(boardStore.taskSequence).toBe(7)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(streams).toEqual([])
})

test("consumed sequenced task rewound advances selected cursor and avoids false recovery", async () => {
  resetWriter()
  const streams: Array<{ path: string; query?: Record<string, string> }> = []
  __setHostTransportForTest(fakeRecoveryTransport(streams, 9))
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 5)

  expect(
    routeSSEEvent({
      type: "task.rewound",
      taskID: "tsk_refresh",
      sequence: 6,
      orderKey: testEventOrderKey("task.rewound", 1, 6),
      properties: {
        taskID: "tsk_refresh",
        cursorTime: 1_776_000_100_000,
        resetWorktree: false,
      },
    }),
  ).toBe(true)

  expect(boardStore.taskSequence).toBe(6)

  const event = {
    type: "goal.progress",
    taskID: "tsk_refresh",
    sequence: 7,
    orderKey: testEventOrderKey("goal.progress", 1, 7),
  }
  const handled = routeSSEEvent(event)
  if (!handled) handleEventStreamEvent(event)

  expect(boardStore.taskSequence).toBe(7)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(streams).toEqual([])
})

test("reset-worktree task rewound schedules authoritative board sync without fake snapshot version", async () => {
  resetWriter()
  const requests: Array<{ path: string; query?: Record<string, string> }> = []
  configure({ directory: CONFIG_REFRESH_DIRECTORY })
  __setHostTransportForTest({
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      requests.push({ path: req.path, query: req.query })
      if (req.path === "task/tsk_refresh/board") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            snapshotVersion: "board-reset",
            task: {
              id: "tsk_refresh",
              sessionID: "ses_refresh",
              status: "active",
              request: "reset worktree rewind",
              orderKey: testOrderKey("tsk_refresh", 100_000, "task"),
              time: { created: 1_776_000_000_000 },
              attachments: [],
            },
            goalWorkflows: [],
            interactions: [],
          } as T,
        }
      }
      throw new Error(`unexpected route ${req.path}`)
    },
    openStream() {
      throw new Error("openStream not used")
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  } satisfies HostTransport)
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 5)
  setBoardStore("snapshotVersion", "board-before")
  setBoardStore("board", {
    snapshotVersion: "board-before",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "before reset",
      orderKey: testOrderKey("tsk_refresh", 100_000, "task"),
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })

  expect(
    routeSSEEvent({
      type: "task.rewound",
      taskID: "tsk_refresh",
      sequence: 6,
      orderKey: testEventOrderKey("task.rewound", 1, 6),
      properties: {
        taskID: "tsk_refresh",
        cursorTime: 1_776_000_100_000,
        resetWorktree: true,
      },
    }),
  ).toBe(true)

  expect(boardStore.taskSequence).toBe(6)
  await waitForRequestCount(requests, 1)
  await Promise.resolve()
  expect(requests).toHaveLength(1)
  expect(requests[0]?.path).toBe("task/tsk_refresh/board")
  expect(requests[0]?.query?.sync).toBe("1")
  expect(requests[0]?.query?.directory).toBe(CONFIG_REFRESH_DIRECTORY)
  expect(boardStore.snapshotVersion).toBe("board-reset")
  await waitForBoardSyncIdle()
  expect(boardStore.boardSyncPending).toBe(false)
})

test("selected task sequence gap triggers recovery without advancing cursor", async () => {
  resetWriter()
  const streams: Array<{ path: string; query?: Record<string, string> }> = []
  __setHostTransportForTest(fakeRecoveryTransport(streams, 9))
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 5)

  handleEventStreamEvent({
    type: "goal.progress",
    taskID: "tsk_refresh",
    sequence: 7,
  })

  expect(boardStore.taskSequence).toBe(5)
  await waitForStreamCount(streams, 1)
  expect(streams).toEqual([
    {
      path: "task/tsk_refresh/events",
      query: { directory: CONFIG_REFRESH_DIRECTORY, after: "5", after_live: "0" },
    },
  ])
  expect(boardStore.taskSequence).toBe(5)
})

test("production dispatch gates sequence gap before tree writer prerequisites can throw", async () => {
  resetWriter()
  const streams: Array<{ path: string; query?: Record<string, string> }> = []
  __setHostTransportForTest(fakeRecoveryTransport(streams, 12))
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 5)

  const event = {
    type: "review.stream.chunk",
    taskID: "tsk_refresh",
    sequence: 7,
    orderKey: testEventOrderKey("review.stream.chunk", 1, 7),
    properties: {
      taskID: "tsk_refresh",
      reviewID: "integrity:missing-started",
      phase: "integrity",
      kind: "dimension",
      dimensionID: "missing-started",
      delta: "would throw if routed before gap recovery",
    },
  }
  const handled = routeSSEEvent(event)
  if (!handled) handleEventStreamEvent(event)

  expect(boardStore.taskSequence).toBe(5)
  await waitForStreamCount(streams, 1)
  expect(streams).toEqual([
    {
      path: "task/tsk_refresh/events",
      query: { directory: CONFIG_REFRESH_DIRECTORY, after: "5", after_live: "0" },
    },
  ])
  expect(boardStore.taskSequence).toBe(5)
})

test("task-list notification does not advance visible cursor before per-task payload", async () => {
  resetWriter()
  const streams: Array<{ path: string; query?: Record<string, string> }> = []
  __setHostTransportForTest(fakeRecoveryTransport(streams, 13))
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 5)

  handleTaskListNotification({
    type: "message.part.delta",
    taskID: "tsk_refresh",
    sequence: 6,
  })
  expect(boardStore.taskSequence).toBe(5)

  const event = {
    type: "review.stream.chunk",
    taskID: "tsk_refresh",
    sequence: 7,
    orderKey: testEventOrderKey("review.stream.chunk", 1, 7),
    properties: {
      taskID: "tsk_refresh",
      reviewID: "integrity:missing-started",
      phase: "integrity",
      kind: "dimension",
      dimensionID: "missing-started",
      delta: "would throw if task-list advanced the cursor",
    },
  }
  const handled = routeSSEEvent(event)
  if (!handled) handleEventStreamEvent(event)

  expect(boardStore.taskSequence).toBe(5)
  await waitForStreamCount(streams, 1)
  expect(streams).toEqual([
    {
      path: "task/tsk_refresh/events",
      query: { directory: CONFIG_REFRESH_DIRECTORY, after: "5", after_live: "0" },
    },
  ])
  expect(boardStore.taskSequence).toBe(5)
})

test("task-list selected sequence gap triggers selected-task recovery", async () => {
  resetWriter()
  const streams: Array<{ path: string; query?: Record<string, string> }> = []
  __setHostTransportForTest(fakeRecoveryTransport(streams, 10))
  selectTaskForTest("tsk_refresh")
  setBoardStore("taskSequence", 5)

  handleTaskListNotification({
    type: "message.part.delta",
    taskID: "tsk_refresh",
    sequence: 8,
  })

  expect(boardStore.taskSequence).toBe(5)
  await waitForStreamCount(streams, 1)
  expect(streams).toEqual([
    {
      path: "task/tsk_refresh/events",
      query: { directory: CONFIG_REFRESH_DIRECTORY, after: "5", after_live: "0" },
    },
  ])
  expect(boardStore.taskSequence).toBe(5)
})

test("task-list lifecycle notifications still reload global tasks", async () => {
  const paths: string[] = []
  __setHostTransportForTest({
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      paths.push(req.path)
      return { status: 200, ok: true, headers: {}, body: { tasks: [] } as T }
    },
    openStream() {
      throw new Error("openStream not used")
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 650))
  paths.length = 0

  handleTaskListNotification({
    type: "task.completed",
    taskID: "tsk_sidebar_refresh",
    sequence: 7,
  })

  await new Promise((resolve) => setTimeout(resolve, 650))
  expect(paths).toEqual(["global/tasks"])
})

test("task-list notification refresh failures stay out of runtime unhandled rejection toasts", async () => {
  const paths: string[] = []
  const consoleErrors: unknown[][] = []
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args)
  }
  __setHostTransportForTest({
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      paths.push(req.path)
      throw new Error("signal timed out")
    },
    openStream() {
      throw new Error("openStream not used")
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  })

  try {
    handleTaskListNotification({
      type: "task.completed",
      taskID: "tsk_sidebar_refresh_timeout",
      sequence: 8,
    })

    await new Promise((resolve) => setTimeout(resolve, 650))
  } finally {
    console.error = originalConsoleError
  }

  expect(paths).toEqual(["global/tasks"])
  expect(boardStore.tasksError).toBe("signal timed out")
  expect(consoleErrors).toHaveLength(1)
  expect(consoleErrors[0]?.[0]).toBe("[task-list-sse] task refresh failed")
})

test("task-list reloads are single-flight across refresh triggers", async () => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const paths: string[] = []
  const transport = {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      paths.push(req.path)
      await pending
      return { status: 200, ok: true, headers: {}, body: { tasks: [] } as T }
    },
    openStream() {
      throw new Error("openStream not used")
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  } satisfies HostTransport
  __setHostTransportForTest(transport)

  const first = loadTasks()
  const second = loadTasks()
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(paths).toEqual(["global/tasks"])

  release()
  await Promise.all([first, second])
})

test("required task-list reload starts after an older in-flight refresh settles", async () => {
  let releaseFirst!: () => void
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const paths: string[] = []
  let requestIndex = 0
  const taskItem = (id: string, created: number) => ({
    task: {
      id,
      title: id,
      status: "active",
      time: { created, updated: created },
    },
  })
  const transport = {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      paths.push(req.path)
      requestIndex += 1
      const current = requestIndex
      if (current === 1) await firstPending
      const body =
        current === 1
          ? { tasks: [taskItem("tsk_stale_before_mutation", 1)] }
          : { tasks: [taskItem("tsk_fresh_after_mutation", 2)] }
      return { status: 200, ok: true, headers: {}, body: body as T }
    },
    openStream() {
      throw new Error("openStream not used")
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  } satisfies HostTransport
  __setHostTransportForTest(transport)

  const stale = loadTasks()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(paths).toEqual(["global/tasks"])

  const requiredFresh = loadTasks({ requireFresh: true })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(paths).toEqual(["global/tasks"])

  releaseFirst()
  await Promise.all([stale, requiredFresh])

  expect(paths).toEqual(["global/tasks", "global/tasks"])
  expect(boardStore.tasks.map((item) => item.task.id)).toEqual(["tsk_fresh_after_mutation"])
})

test("project-scope task clear disowns in-flight first-page reload before fresh project reload", async () => {
  let releaseFirst!: () => void
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const requests: Array<{ path: string; query?: Record<string, string | number | boolean> }> = []
  let requestIndex = 0
  const taskItem = (id: string, created: number) => ({
    task: {
      id,
      title: id,
      status: "active",
      time: { created, updated: created },
    },
  })
  const transport = {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      requests.push({ path: req.path, query: req.query })
      if (req.path !== "global/tasks") throw new Error(`unexpected route ${req.path}`)
      requestIndex += 1
      if (requestIndex === 1) {
        await firstPending
        return { status: 200, ok: true, headers: {}, body: { tasks: [taskItem("tsk_stale_first_page", 1)] } as T }
      }
      return { status: 200, ok: true, headers: {}, body: { tasks: [taskItem("tsk_fresh_project", 2)] } as T }
    },
    openStream() {
      throw new Error("openStream not used")
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  } satisfies HostTransport
  __setHostTransportForTest(transport)

  const staleFirstPage = loadTasks()
  await waitForRequestCount(requests, 1)
  clearTasksForMissingDirectory()
  expect(boardStore.tasks).toEqual([])

  const freshProject = loadTasks()
  await waitForRequestCount(requests, 2)
  await freshProject
  expect(boardStore.tasks.map((item) => item.task.id)).toEqual(["tsk_fresh_project"])

  releaseFirst()
  await staleFirstPage

  expect(requests.map((request) => request.path)).toEqual(["global/tasks", "global/tasks"])
  expect(boardStore.tasks.map((item) => item.task.id)).toEqual(["tsk_fresh_project"])
  expect(boardStore.tasksError).toBe("")
})

test("stale pagination response cannot append after a required fresh task-list reload", async () => {
  let releaseMore!: () => void
  const morePending = new Promise<void>((resolve) => {
    releaseMore = resolve
  })
  const requests: Array<{ path: string; query?: Record<string, string | number | boolean> }> = []
  const taskItem = (id: string, created: number) => ({
    task: {
      id,
      title: id,
      status: "active",
      time: { created, updated: created },
    },
  })
  const transport = {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      requests.push({ path: req.path, query: req.query })
      if (req.path !== "global/tasks") throw new Error(`unexpected route ${req.path}`)
      if (req.query?.cursor !== undefined) {
        await morePending
        return { status: 200, ok: true, headers: {}, body: { tasks: [taskItem("tsk_stale_page", 3)] } as T }
      }
      return { status: 200, ok: true, headers: {}, body: { tasks: [taskItem("tsk_required_fresh", 4)] } as T }
    },
    openStream() {
      throw new Error("openStream not used")
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  } satisfies HostTransport
  __setHostTransportForTest(transport)
  setBoardStore("tasks", [taskItem("tsk_first_page", 5)])
  setBoardStore("tasksHasMore", true)
  setBoardStore("tasksCursorCreated", 5)
  setBoardStore("tasksCursorTaskID", "tsk_first_page")
  setBoardStore("tasksLoadingMore", false)

  const stalePage = loadMoreTasks()
  await waitForRequestCount(requests, 1)
  expect(requests[0]?.query).toMatchObject({ cursor: "5", cursorTaskID: "tsk_first_page" })

  const requiredFresh = loadTasks({ requireFresh: true })
  await waitForRequestCount(requests, 2)
  await requiredFresh
  expect(boardStore.tasks.map((item) => item.task.id)).toEqual(["tsk_required_fresh"])
  expect(boardStore.tasksLoadingMore).toBe(false)

  releaseMore()
  await stalePage

  expect(requests.map((request) => request.path)).toEqual(["global/tasks", "global/tasks"])
  expect(boardStore.tasks.map((item) => item.task.id)).toEqual(["tsk_required_fresh"])
  expect(boardStore.tasksCursorTaskID).toBe("tsk_required_fresh")
  expect(boardStore.tasksLoadingMore).toBe(false)
  expect(boardStore.tasksError).toBe("")
})

test("stale pagination completion cannot clear a newer pagination request loading state", async () => {
  let releaseOldPage!: () => void
  const oldPagePending = new Promise<void>((resolve) => {
    releaseOldPage = resolve
  })
  let releaseNewPage!: () => void
  const newPagePending = new Promise<void>((resolve) => {
    releaseNewPage = resolve
  })
  const requests: Array<{ path: string; query?: Record<string, string | number | boolean> }> = []
  const taskItem = (id: string, created: number) => ({
    task: {
      id,
      title: id,
      status: "active",
      time: { created, updated: created },
    },
  })
  const transport = {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      requests.push({ path: req.path, query: req.query })
      if (req.path !== "global/tasks") throw new Error(`unexpected route ${req.path}`)
      if (req.query?.cursorTaskID === "tsk_first_page") {
        await oldPagePending
        return { status: 200, ok: true, headers: {}, body: { tasks: [taskItem("tsk_old_page", 3)] } as T }
      }
      if (req.query?.cursorTaskID === "tsk_required_fresh") {
        await newPagePending
        return { status: 200, ok: true, headers: {}, body: { tasks: [taskItem("tsk_new_page", 6)] } as T }
      }
      const freshFirstPage = [
        ...Array.from({ length: 9 }, (_, index) => taskItem(`tsk_fresh_${index + 1}`, 20 - index)),
        taskItem("tsk_required_fresh", 11),
        taskItem("tsk_hidden_more", 10),
      ]
      return {
        status: 200,
        ok: true,
        headers: {},
        body: { tasks: freshFirstPage } as T,
      }
    },
    openStream() {
      throw new Error("openStream not used")
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  } satisfies HostTransport
  __setHostTransportForTest(transport)
  setBoardStore("tasks", [taskItem("tsk_first_page", 5)])
  setBoardStore("tasksHasMore", true)
  setBoardStore("tasksCursorCreated", 5)
  setBoardStore("tasksCursorTaskID", "tsk_first_page")
  setBoardStore("tasksLoadingMore", false)

  const oldPage = loadMoreTasks()
  await waitForRequestCount(requests, 1)

  const requiredFresh = loadTasks({ requireFresh: true })
  await waitForRequestCount(requests, 2)
  await requiredFresh
  expect(boardStore.tasks.map((item) => item.task.id)).toContain("tsk_required_fresh")
  expect(boardStore.tasksLoadingMore).toBe(false)

  const newPage = loadMoreTasks()
  await waitForRequestCount(requests, 3)
  expect(requests[2]?.query).toMatchObject({ cursor: "11", cursorTaskID: "tsk_required_fresh" })
  expect(boardStore.tasksLoadingMore).toBe(true)

  releaseOldPage()
  await oldPage
  expect(boardStore.tasksLoadingMore).toBe(true)
  expect(boardStore.tasks.map((item) => item.task.id)).toContain("tsk_required_fresh")

  releaseNewPage()
  await newPage
  expect(boardStore.tasksLoadingMore).toBe(false)
  expect(boardStore.tasks.map((item) => item.task.id)).toContain("tsk_required_fresh")
  expect(boardStore.tasks.map((item) => item.task.id)).toContain("tsk_new_page")
})

test("stale pagination response cannot append after missing-directory task clear", async () => {
  let releaseMore!: () => void
  const morePending = new Promise<void>((resolve) => {
    releaseMore = resolve
  })
  const requests: Array<{ path: string; query?: Record<string, string | number | boolean> }> = []
  const taskItem = (id: string, created: number) => ({
    task: {
      id,
      title: id,
      status: "active",
      time: { created, updated: created },
    },
  })
  const transport = {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      requests.push({ path: req.path, query: req.query })
      if (req.path !== "global/tasks") throw new Error(`unexpected route ${req.path}`)
      await morePending
      return { status: 200, ok: true, headers: {}, body: { tasks: [taskItem("tsk_stale_page", 3)] } as T }
    },
    openStream() {
      throw new Error("openStream not used")
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  } satisfies HostTransport
  __setHostTransportForTest(transport)
  setBoardStore("tasks", [taskItem("tsk_first_page", 5)])
  setBoardStore("tasksHasMore", true)
  setBoardStore("tasksCursorCreated", 5)
  setBoardStore("tasksCursorTaskID", "tsk_first_page")
  setBoardStore("tasksLoadingMore", false)

  const stalePage = loadMoreTasks()
  await waitForRequestCount(requests, 1)
  clearTasksForMissingDirectory()
  expect(boardStore.tasks).toEqual([])
  expect(boardStore.tasksHasMore).toBe(false)
  expect(boardStore.tasksCursorCreated).toBeNull()
  expect(boardStore.tasksCursorTaskID).toBe("")
  expect(boardStore.tasksLoadingMore).toBe(false)

  releaseMore()
  await stalePage

  expect(requests[0]?.query).toMatchObject({ cursor: "5", cursorTaskID: "tsk_first_page" })
  expect(boardStore.tasks).toEqual([])
  expect(boardStore.tasksHasMore).toBe(false)
  expect(boardStore.tasksCursorCreated).toBeNull()
  expect(boardStore.tasksCursorTaskID).toBe("")
  expect(boardStore.tasksLoadingMore).toBe(false)
  expect(boardStore.tasksError).toBe("")
})

test("config.changed SSE burst coalesces into one config refresh", async () => {
  resetWriter()
  const paths: string[] = []
  __setHostTransportForTest(fakeConfigTransport(paths))
  configure({ directory: CONFIG_REFRESH_DIRECTORY })
  const beforeToken = sessionConfigRefreshToken()

  expect(routeSSEEvent({ type: "config.changed", orderKey: testEventOrderKey("config.changed", 1, 0) })).toBe(true)
  expect(routeSSEEvent({ type: "config.changed", orderKey: testEventOrderKey("config.changed", 1, 1) })).toBe(true)
  expect(routeSSEEvent({ type: "config.changed", orderKey: testEventOrderKey("config.changed", 1, 2) })).toBe(true)
  expect(sessionConfigRefreshToken()).toBe(beforeToken + 3)

  await new Promise((resolve) => setTimeout(resolve, 90))

  expect(paths.filter((path) => path === "config").length).toBe(1)
  expect(appStore.config).toEqual({ model: "openai/coalesced" })
})

test("session.updated invalidates session config resources", () => {
  const beforeSession = sessionConfigRefreshToken()
  expect(
    routeSSEEvent({
      type: "session.updated",
      orderKey: testEventOrderKey("session.updated", 1),
      properties: {
        info: {
          id: "ses_config_refresh",
        },
      },
    }),
  ).toBe(true)
  expect(sessionConfigRefreshToken()).toBe(beforeSession + 1)
})

test("session.diff SSE is consumed without card or board refresh", () => {
  resetWriter()
  selectTaskForTest("tsk_session_diff")
  setBoardStore("board", {
    snapshotVersion: "board:session-diff",
    task: {
      id: "tsk_session_diff",
      sessionID: "ses_session_diff",
      status: "active",
      request: "session diff",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  })
  const beforeOrder = [...cardTreeStore.order]
  const beforeCards = Object.keys(cardTreeStore.cards)

  expect(
    routeSSEEvent({
      event_id: "ephemeral-session-diff",
      session_id: "ses_session_diff",
      type: "session.diff",
      emittedAt: 1_780_163_309_731,
      timestamp: 1_780_163_309_731,
      sequence: 0,
      orderKey: testEventOrderKey("session.diff", 1_780_163_309_731),
      summary: "session.diff",
      payload: {
        sessionID: "ses_session_diff",
        diff: [],
        summary: "session.diff",
      },
    }),
  ).toBe(true)

  expect(cardTreeStore.order).toEqual(beforeOrder)
  expect(Object.keys(cardTreeStore.cards)).toEqual(beforeCards)
  expect(boardStore.boardSyncPending).toBe(false)
})
