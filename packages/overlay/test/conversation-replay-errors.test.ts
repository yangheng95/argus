import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  HOST_CAPABILITIES,
  __setHostTransportForTest,
  type HostTransport,
  type TransportRequest,
} from "../src/services/host-transport"
import {
  cancelConversationReplay,
  hydrateTaskConversation,
  loadOlderConversationHistory,
  registerConversationSourceDirectory,
  scheduleLatestConversationTailMerge,
} from "../src/services/conversation"
import { setBoardStore } from "../src/store/board"
import { resetWriter } from "../src/services/tree-writer"
import { AppLog } from "../src/utils/log"
import { clearNotifications, notificationStore } from "../src/services/notify"
import { setLocaleData } from "../src/utils/i18n"
import { testTaskOrderKey } from "./fixtures/timeline-order"

setLocaleData("en-US", JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")))

const TEST_DIRECTORY = "D:/conversation-errors"

function conversationPayload(taskID: string, overrides: Record<string, unknown> = {}) {
  return {
    lastSequence: 5,
    board: {
      snapshotVersion: `board:${taskID}`,
      task: {
        id: taskID,
        directory: TEST_DIRECTORY,
        orderKey: testTaskOrderKey(taskID, 1_780_000_000_000),
        sessionID: `ses_${taskID}`,
        status: "active",
        request: "conversation error visibility",
        time: { created: 1_780_000_000_000, started: 1_780_000_000_000 },
        attachments: [],
      },
      goalWorkflows: [],
      interactions: [],
    },
    transcript: [],
    timeline: [],
    events: [],
    eventReplay: { cursor: 5, latestSequence: 8, complete: true, limit: 500, sinceTimestamp: null },
    history: {
      oldestTimestamp: 1_780_000_000_000,
      oldestOrderKey: testTaskOrderKey(`${taskID}:oldest`, 1_780_000_000_000),
      oldestMessageID: "msg_oldest",
      hasMore: false,
      limit: 160,
    },
    view: { topLevelSessionIDs: [], sessions: [], messages: [] },
    agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
    messageWatermark: 5,
    ...overrides,
  }
}

function installConversationTransport(handler: (req: TransportRequest) => unknown): void {
  __setHostTransportForTest({
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest) {
      if (req.path === "log") return { status: 200, ok: true, headers: {}, body: { ok: true } as T }
      const body = await handler(req)
      return { status: 200, ok: true, headers: {}, body: body as T }
    },
    openStream() {
      throw new Error("stream not used")
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  } satisfies HostTransport)
}

async function waitForNotification(id: string): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    if (notificationStore.items.some((item) => item.id === id)) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

afterEach(() => {
  cancelConversationReplay()
  __setHostTransportForTest(undefined)
  AppLog.clear()
  clearNotifications()
  resetWriter()
  setBoardStore("selectedSource", null)
  setBoardStore("board", null)
})

test("background protocol replay failures are surfaced through AppLog", async () => {
  const taskID = "tsk_background_replay_error"
  installConversationTransport((req) => {
    if (req.path === `task/${taskID}/conversation`) {
      return conversationPayload(taskID, {
        eventReplay: { cursor: 5, latestSequence: 8, complete: false, limit: 500, sinceTimestamp: null },
        history: {
          oldestTimestamp: 1_780_000_000_000,
          oldestOrderKey: testTaskOrderKey(`${taskID}:oldest`, 1_780_000_000_000),
          oldestMessageID: "msg_oldest",
          hasMore: true,
          limit: 160,
        },
      })
    }
    if (req.path === `task/${taskID}/conversation/events`) {
      throw new Error("event replay endpoint failed")
    }
    throw new Error(`unexpected request: ${req.path}`)
  })

  setBoardStore("selectedSource", { kind: "task", id: taskID })
  registerConversationSourceDirectory({ kind: "task", id: taskID }, TEST_DIRECTORY)

  await expect(hydrateTaskConversation(taskID, { directory: TEST_DIRECTORY })).resolves.toBe(8)
  await waitForNotification(`conversation:background protocol replay failed:${taskID}`)

  expect(
    notificationStore.items.some((item) => item.id === `conversation:background protocol replay failed:${taskID}`),
  ).toBe(true)
})

test("scheduled tail merge failures are surfaced through AppLog", async () => {
  const taskID = "tsk_tail_merge_error"
  installConversationTransport((req) => {
    if (req.path === `task/${taskID}/conversation`) throw new Error("tail merge endpoint failed")
    throw new Error(`unexpected request: ${req.path}`)
  })
  setBoardStore("selectedSource", { kind: "task", id: taskID })
  registerConversationSourceDirectory({ kind: "task", id: taskID }, TEST_DIRECTORY)

  scheduleLatestConversationTailMerge(taskID)
  await waitForNotification(`conversation:scheduled tail merge failed:${taskID}`)

  expect(notificationStore.items.some((item) => item.id === `conversation:scheduled tail merge failed:${taskID}`)).toBe(
    true,
  )
})

test("older history load failures are surfaced through AppLog", async () => {
  const taskID = "tsk_older_history_error"
  installConversationTransport((req) => {
    if (req.path === `task/${taskID}/conversation`) {
      return conversationPayload(taskID, {
        history: {
          oldestTimestamp: 1_780_000_000_000,
          oldestOrderKey: testTaskOrderKey(`${taskID}:oldest`, 1_780_000_000_000),
          oldestMessageID: "msg_oldest",
          hasMore: true,
          limit: 160,
        },
      })
    }
    if (req.path === `task/${taskID}/conversation/history`) throw new Error("history endpoint failed")
    throw new Error(`unexpected request: ${req.path}`)
  })
  setBoardStore("selectedSource", { kind: "task", id: taskID })
  registerConversationSourceDirectory({ kind: "task", id: taskID }, TEST_DIRECTORY)

  await hydrateTaskConversation(taskID, { directory: TEST_DIRECTORY })
  await expect(loadOlderConversationHistory({ kind: "task", id: taskID })).rejects.toThrow(/history endpoint failed/)
  await waitForNotification(`conversation:older history load failed:${taskID}`)

  expect(notificationStore.items.some((item) => item.id === `conversation:older history load failed:${taskID}`)).toBe(
    true,
  )
})
