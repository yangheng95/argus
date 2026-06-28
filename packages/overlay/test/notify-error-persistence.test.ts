import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import {
  centerHistoryNotificationItems,
  clearNotifications,
  dismissNotification,
  formatErrorDetails,
  notificationStore,
  notifyError,
  notifyProgress,
  notifySuccess,
  notifyWarning,
  showNotification,
  visibleNotificationItems,
} from "../src/services/notify"
import { ApiError } from "../src/services/api"

// Mirrors the notify defaults — these tests pin the persistence contract so
// a future "rebalance" of toast timing cannot silently auto-dismiss error
// toasts again (root cause of the previous "no info" complaint).

beforeEach(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: { hasFocus: () => true },
  })
  clearNotifications()
})

afterEach(() => {
  clearNotifications()
})

describe("notify: error/warning toasts persist by default", () => {
  test("notifyError defaults to timeoutMs=0 (manual dismiss)", () => {
    notifyError({ title: "boom", message: "something exploded" })
    expect(notificationStore.items).toHaveLength(1)
    expect(notificationStore.items[0]?.timeoutMs).toBe(0)
  })

  test("notifyWarning defaults to timeoutMs=0", () => {
    notifyWarning({ title: "watch out" })
    expect(notificationStore.items[0]?.timeoutMs).toBe(0)
  })

  test("notifySuccess still auto-dismisses with a positive default", () => {
    notifySuccess({ title: "done" })
    expect(notificationStore.items[0]?.timeoutMs).toBeGreaterThan(0)
  })

  test("notifyProgress stays sticky (timeoutMs=0)", () => {
    notifyProgress({ title: "uploading" })
    expect(notificationStore.items[0]?.timeoutMs).toBe(0)
  })

  test("explicit timeoutMs overrides the persistent default", () => {
    notifyError({ title: "transient", timeoutMs: 1234 })
    expect(notificationStore.items[0]?.timeoutMs).toBe(1234)
  })
})

describe("notify: details payload round-trips", () => {
  test("details field is preserved on the stored item", () => {
    showNotification({
      tone: "error",
      title: "stack visible",
      message: "see details",
      details: "Error: bad\n  at frame:1:1",
    })
    expect(notificationStore.items[0]?.details).toBe("Error: bad\n  at frame:1:1")
  })

  test("details default to empty string when omitted", () => {
    notifyError({ title: "no detail" })
    expect(notificationStore.items[0]?.details).toBe("")
  })
})

describe("notify: task ownership is stored on the notification item", () => {
  test("showNotification preserves explicit task directory and title", () => {
    showNotification({
      tone: "error",
      title: "failed",
      taskID: "tsk_owned",
      taskDirectory: "D:/project-a",
      taskTitle: "Owned task",
    })

    expect(notificationStore.items[0]?.taskID).toBe("tsk_owned")
    expect(notificationStore.items[0]?.taskDirectory).toBe("D:/project-a")
    expect(notificationStore.items[0]?.taskTitle).toBe("Owned task")
  })
})

describe("notify: center history survives toast dismissal", () => {
  test("dismissNotification hides history notifications without deleting center history", () => {
    const id = notifyError({ title: "failed", message: "needs attention" })
    expect(notificationStore.items).toHaveLength(1)
    expect(visibleNotificationItems()).toHaveLength(1)
    expect(centerHistoryNotificationItems()).toHaveLength(1)

    dismissNotification(id)

    expect(notificationStore.items).toHaveLength(1)
    expect(notificationStore.items[0]?.dismissedAt).toBeGreaterThan(0)
    expect(visibleNotificationItems()).toHaveLength(0)
    expect(centerHistoryNotificationItems()).toHaveLength(1)
  })

  test("dismissNotification removes transient non-history notifications", () => {
    const id = notifySuccess({ title: "done", message: "saved" })
    expect(notificationStore.items).toHaveLength(1)
    expect(visibleNotificationItems()).toHaveLength(1)
    expect(centerHistoryNotificationItems()).toHaveLength(0)

    dismissNotification(id)

    expect(notificationStore.items).toHaveLength(0)
    expect(visibleNotificationItems()).toHaveLength(0)
    expect(centerHistoryNotificationItems()).toHaveLength(0)
  })

  test("showNotification can explicitly opt a transient tone into center history", () => {
    const id = showNotification({ tone: "success", title: "saved", centerHistory: true })
    dismissNotification(id)

    expect(notificationStore.items).toHaveLength(1)
    expect(notificationStore.items[0]?.centerHistory).toBe(true)
    expect(visibleNotificationItems()).toHaveLength(0)
    expect(centerHistoryNotificationItems()).toHaveLength(1)
  })

  test("showing the same notification id reopens the toast and replaces the history row", () => {
    notifyWarning({ id: "task:repeat", title: "first" })
    dismissNotification("task:repeat")
    showNotification({ id: "task:repeat", tone: "success", title: "second" })

    expect(notificationStore.items).toHaveLength(1)
    expect(notificationStore.items[0]?.title).toBe("second")
    expect(notificationStore.items[0]?.dismissedAt).toBe(0)
    expect(visibleNotificationItems()).toHaveLength(1)
    expect(centerHistoryNotificationItems()).toHaveLength(0)
  })
})

describe("formatErrorDetails", () => {
  test("returns stack for a plain Error", () => {
    const err = new Error("kaboom")
    const out = formatErrorDetails(err)
    expect(out).toContain("kaboom")
    // node/bun give a stack with the constructor frame
    expect(out.length).toBeGreaterThan("kaboom".length)
  })

  test("includes status/path/body for an ApiError", () => {
    const err = new ApiError(500, "task/abc/run", { error: "db unavailable" })
    const out = formatErrorDetails(err)
    expect(out).toContain("HTTP 500 task/abc/run")
    expect(out).toContain("db unavailable")
  })

  test("stringifies plain objects", () => {
    const out = formatErrorDetails({ code: "E_NET", reason: "timeout" })
    expect(out).toContain("E_NET")
    expect(out).toContain("timeout")
  })

  test("returns empty string for null/undefined", () => {
    expect(formatErrorDetails(null)).toBe("")
    expect(formatErrorDetails(undefined)).toBe("")
  })
})
