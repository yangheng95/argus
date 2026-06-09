import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import {
  clearNotifications,
  ackTaskNotification,
  computeBadge,
  notificationStore,
  replaceBadgeAcksForTest,
  recomputeBadgeFromTasks,
  routeNotification,
  taskHasUnreadNotification,
} from "../src/services/notify"
import { __setHostTransportForTest, type HostTransport, type NativeCommand } from "../src/services/host-transport"
import { setBoardStore } from "../src/store/board"
import { setPageMode } from "../src/store/page-mode"
import { setSettingsStore } from "../src/store/settings"

;(globalThis as any).__OPENCORVUS_OVERLAY_VERSION__ = "test"

let events: typeof import("../src/services/events")

beforeAll(async () => {
  mock.module("../src/utils/icon-html", () => ({
    hydrateIconPlaceholders() {},
    iconHtml() {
      return ""
    },
  }))
  events = await import("../src/services/events")
})

function installTransport() {
  const calls = {
    sends: 0,
    permission: 0,
    badge: 0,
    attention: 0,
    lastBadge: undefined as number | undefined,
    lastAttention: undefined as boolean | undefined,
  }
  const transport: HostTransport = {
    kind: "tauri",
    async request() {
      throw new Error("not used")
    },
    openStream() {
      throw new Error("not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
    async native(command: NativeCommand) {
      if (command.kind === "notification.permission") {
        calls.permission += 1
        return "granted"
      }
      if (command.kind === "notification.send") {
        calls.sends += 1
        return undefined
      }
      if (command.kind === "badge.set") {
        calls.badge += 1
        calls.lastBadge = command.count
        return true
      }
      if (command.kind === "tray.attention.set") {
        calls.attention += 1
        calls.lastAttention = command.active
        return true
      }
      return undefined
    },
  }
  __setHostTransportForTest(transport)
  return calls
}

function setFocus(focused: boolean): void {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: { hasFocus: () => focused },
  })
}

async function flushNotifications(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function taskItem(input: {
  id: string
  status?: string
  pending?: number
  completed?: number
  updated?: number
  evaluation?: any
}) {
  return {
    task: {
      id: input.id,
      title: input.id,
      status: input.status ?? "active",
      time: {
        updated: input.updated ?? 10,
        completed: input.completed,
      },
    },
    pending_interactions: input.pending ?? 0,
    evaluation: input.evaluation,
  }
}

beforeEach(() => {
  installTransport()
  setSettingsStore("desktopNotifications", true)
  setPageMode("panel")
  setFocus(false)
  clearNotifications()
  setBoardStore("selectedTaskID", "")
  setBoardStore("selectedSource", null)
  setBoardStore("tasks", [taskItem({ id: "tsk_notify" })])
  replaceBadgeAcksForTest([])
})

afterEach(() => {
  __setHostTransportForTest(undefined)
  clearNotifications()
  setBoardStore("selectedTaskID", "")
  setBoardStore("selectedSource", null)
  setBoardStore("tasks", [])
  setPageMode("panel")
  replaceBadgeAcksForTest([])
})

describe("routeNotification tier matrix", () => {
  test("tier 1 shows in-app but suppresses OS when focused selected task detail is visible", async () => {
    const calls = installTransport()
    setFocus(true)
    setBoardStore("selectedTaskID", "tsk_notify")
    setBoardStore("selectedSource", { kind: "task", id: "tsk_notify" })

    routeNotification({ type: "task.failed", taskID: "tsk_notify", notify: { tier: 1, badge: true } })
    await flushNotifications()

    expect(notificationStore.items).toHaveLength(1)
    expect(notificationStore.items[0]?.taskID).toBe("tsk_notify")
    expect(notificationStore.items[0]?.centerHistory).toBe(true)
    expect(calls.sends).toBe(0)
  })

  test("tier 2 shows in-app and sends OS only while unfocused", async () => {
    const calls = installTransport()
    setFocus(true)
    routeNotification({ type: "task.completed", taskID: "tsk_notify", notify: { tier: 2 } })
    await flushNotifications()
    expect(notificationStore.items).toHaveLength(1)
    expect(notificationStore.items[0]?.centerHistory).toBe(true)
    expect(calls.sends).toBe(0)

    clearNotifications()
    setFocus(false)
    routeNotification({ type: "task.completed", taskID: "tsk_notify", notify: { tier: 2 } })
    await flushNotifications()
    expect(notificationStore.items).toHaveLength(1)
    expect(calls.sends).toBe(1)
  })

  test("tier 3 stays out of toast and OS notification paths", async () => {
    const calls = installTransport()
    routeNotification({ type: "message.part.delta", taskID: "tsk_notify", notify: { tier: 3 } })
    await flushNotifications()
    expect(notificationStore.items).toHaveLength(0)
    expect(calls.sends).toBe(0)
  })

  test("events without notify metadata, including interaction.resolved, do not toast", async () => {
    const calls = installTransport()
    routeNotification({ type: "interaction.resolved", taskID: "tsk_notify" })
    await flushNotifications()
    expect(notificationStore.items).toHaveLength(0)
    expect(calls.sends).toBe(0)
  })

  test("routeNotification never mutates badge or attention channels", async () => {
    const calls = installTransport()
    routeNotification({ type: "task.failed", taskID: "tsk_notify", notify: { tier: 1, badge: true } })
    await flushNotifications()
    expect(calls.badge).toBe(0)
    expect(calls.attention).toBe(0)
  })

  test("routeNotification preserves copyable diagnostic details", async () => {
    routeNotification({
      type: "session.error",
      taskID: "tsk_notify",
      notify: { tier: 1 },
      notificationDetails: '{"error":"provider quota exceeded"}',
    })
    await flushNotifications()
    expect(notificationStore.items).toHaveLength(1)
    expect(notificationStore.items[0]?.details).toBe('{"error":"provider quota exceeded"}')
  })
})

test("single owner: same aggregate event through both streams produces one notification", async () => {
  const calls = installTransport()
  const perTaskEvent = {
    type: "interaction.requested",
    taskID: "tsk_notify",
    payload: {
      taskID: "tsk_notify",
      interactionID: "int_notify",
      requestType: "question",
      summary: "needs input",
    },
  }

  const handled = events.routeSSEEvent(perTaskEvent)
  if (!handled) events.handleEventStreamEvent(perTaskEvent)
  events.handleTaskListNotification({
    type: "interaction.requested",
    taskID: "tsk_notify",
    sequence: 1,
    notify: { tier: 1, badge: true },
  })
  await flushNotifications()

  expect(notificationStore.items).toHaveLength(1)
  expect(calls.sends).toBe(1)
})

describe("computeBadge projection", () => {
  test("counts pending interactions, failed tasks, and rejected evaluations from summary facts only", () => {
    const summary = [
      taskItem({ id: "tsk_waiting", pending: 2 }),
      taskItem({ id: "tsk_failed", status: "failed", completed: 100 }),
      taskItem({
        id: "tsk_eval",
        evaluation: {
          id: "evl_rejected",
          verdict: "rejected",
          time: { completed: 200, updated: 190 },
        },
      }),
    ]
    expect(computeBadge(summary, new Set()).count).toBe(4)
  })

  test("typed acks subtract only their matching fact and fresh versions reappear", () => {
    const failed = taskItem({ id: "tsk_failed", status: "failed", completed: 100 })
    const rejected = taskItem({
      id: "tsk_eval",
      evaluation: {
        id: "evl_rejected",
        verdict: "rejected",
        time: { completed: 200, updated: 190 },
      },
    })
    const failedAck = new Set(["task-failed:tsk_failed:100"])
    expect(computeBadge([failed, rejected], failedAck).count).toBe(1)

    const retriedFailure = taskItem({ id: "tsk_failed", status: "failed", completed: 300 })
    expect(computeBadge([retriedFailure, rejected], failedAck).count).toBe(2)

    const allAcks = new Set(["task-failed:tsk_failed:100", "evaluation-rejected:evl_rejected:200"])
    expect(computeBadge([failed, rejected], allAcks).count).toBe(0)
  })

  test("pending interaction acks clear task unread highlight until the task version changes", () => {
    const waiting = taskItem({ id: "tsk_waiting", pending: 2, updated: 100 })
    expect(taskHasUnreadNotification(waiting)).toBe(true)
    expect(computeBadge([waiting], new Set()).count).toBe(2)

    const acks = new Set(["task-interactions:tsk_waiting:100"])
    expect(computeBadge([waiting], acks).count).toBe(0)

    const updatedWaiting = taskItem({ id: "tsk_waiting", pending: 1, updated: 300 })
    expect(computeBadge([updatedWaiting], acks).count).toBe(1)
  })

  test("ackTaskNotification clears all current notification facts for a task", () => {
    const waitingRejectedFailure = taskItem({
      id: "tsk_notify",
      pending: 1,
      status: "failed",
      updated: 100,
      completed: 120,
      evaluation: {
        id: "evl_notify",
        verdict: "rejected",
        time: { completed: 140, updated: 130 },
      },
    })
    setBoardStore("tasks", [waitingRejectedFailure])

    expect(taskHasUnreadNotification(waitingRejectedFailure)).toBe(true)
    const projection = ackTaskNotification("tsk_notify")

    expect(projection.count).toBe(0)
    expect(taskHasUnreadNotification(waitingRejectedFailure)).toBe(false)
  })

  test("recompute pushes dock badge and derives tray attention from count", async () => {
    const calls = installTransport()
    const projection = recomputeBadgeFromTasks([
      taskItem({ id: "tsk_waiting", pending: 1 }),
      taskItem({ id: "tsk_failed", status: "failed", completed: 100 }),
    ])
    expect(projection.count).toBe(2)
    await flushNotifications()
    expect(calls.lastBadge).toBe(2)
    expect(calls.lastAttention).toBe(true)
  })

  test("focused selected task facts are acked before pushing tray attention", async () => {
    const calls = installTransport()
    const visible = taskItem({ id: "tsk_visible", pending: 1, updated: 100 })
    setFocus(true)
    setBoardStore("selectedTaskID", "tsk_visible")
    setBoardStore("selectedSource", { kind: "task", id: "tsk_visible" })
    setBoardStore("tasks", [visible])

    const projection = recomputeBadgeFromTasks([visible])

    expect(projection.count).toBe(0)
    expect(taskHasUnreadNotification(visible)).toBe(false)
    await flushNotifications()
    expect(calls.lastBadge).toBe(0)
    expect(calls.lastAttention).toBe(false)
  })
})
