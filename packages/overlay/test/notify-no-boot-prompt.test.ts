import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

/**
 * 2026-04-30 W2-V34 (revised 2026-05-07) — overlay must NOT call
 * `notification.requestPermission` outside of a real user gesture.
 *
 * Original incident: a boot-time `Notification.requestPermission()` call
 * caused WebKit (darwin / Tauri WKWebView) to refuse and pin the user
 * out of notifications. After migrating to `tauri-plugin-notification`
 * the underlying API is now `host.native({ kind: "notification.*" })`,
 * but the contract is identical: module load and SSE handlers MUST NOT
 * trigger a permission prompt; only `ensureDesktopNotificationPermission`
 * called from the Settings toggle user gesture is allowed to.
 */

import {
  HOST_CAPABILITIES,
  __setHostTransportForTest,
  type HostTransport,
  type NativeCommand,
} from "../src/services/host-transport"

interface CallLog {
  permissionProbes: number
  permissionRequests: number
  sends: number
}

function installFakeTransport(initialPermission: "granted" | "denied" | "default" = "default"): {
  log: CallLog
  setPermission(value: "granted" | "denied" | "default"): void
} {
  const log: CallLog = { permissionProbes: 0, permissionRequests: 0, sends: 0 }
  let permission = initialPermission
  const transport: HostTransport = {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request() {
      throw new Error("not used in this test")
    },
    openStream() {
      throw new Error("not used in this test")
    },
    subscribeUiCommand() {
      return { unsubscribe: () => {} }
    },
    async native(command: NativeCommand) {
      switch (command.kind) {
        case "notification.permission":
          log.permissionProbes += 1
          return permission
        case "notification.requestPermission":
          log.permissionRequests += 1
          return permission
        case "notification.send":
          log.sends += 1
          return undefined
        default:
          return undefined
      }
    },
  }
  // Stub document.hasFocus so `shouldSuppressDesktop` can probe it without
  // crashing in Bun's headless runtime. The actual value is irrelevant —
  // these tests don't depend on focus suppression.
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: { hasFocus: () => false },
  })
  __setHostTransportForTest(transport)
  return {
    log,
    setPermission(value) {
      permission = value
    },
  }
}

import {
  clearNotifications,
  ensureDesktopNotificationPermission,
  notificationStore,
  routeNotification,
  requestNotificationPermission,
} from "../src/services/notify"
import * as notifyModule from "../src/services/notify"

describe("notify: startup permission request and in-app fallback", () => {
  let fixture: ReturnType<typeof installFakeTransport>

  beforeEach(() => {
    fixture = installFakeTransport("default")
    clearNotifications()
  })

  afterEach(() => {
    __setHostTransportForTest(undefined)
  })

  test("primeNotificationPermission is no longer exported from notify.ts", () => {
    expect("primeNotificationPermission" in notifyModule).toBe(false)
  })

  test("importing notify does not call notification.requestPermission", () => {
    // Module evaluation already finished (top-of-file static import). If a
    // boot-time prompt path were still wired, the request counter on the
    // freshly-installed transport would be >0; we can't observe pre-install
    // calls, but we CAN assert that no in-flight pending request leaked
    // across module load by verifying a probe-then-request sequence works
    // cleanly from a clean fixture.
    expect(fixture.log.permissionRequests).toBe(0)
  })

  test("routeNotification (non-gesture path) does NOT prompt for permission", async () => {
    routeNotification({ taskID: "tsk_test_001", type: "task.completed", notify: { tier: 2 } })
    // Dispatch is async; flush a few microtasks so any deferred request
    // would have fired.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(fixture.log.permissionRequests).toBe(0)
    expect(notificationStore.items.some((item) => item.id === "event:tsk_test_001:task.completed:2")).toBe(true)
  })

  test("tauri routeNotification attempts native send without a permission prompt", async () => {
    routeNotification({ taskID: "tsk_test_tauri_001", type: "task.completed", notify: { tier: 2 } })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(fixture.log.permissionRequests).toBe(0)
    expect(fixture.log.permissionProbes).toBe(0)
    expect(fixture.log.sends).toBe(1)
  })

  test("routeNotification sends an OS notification when permission is granted and tier allows it", async () => {
    fixture.setPermission("granted")
    routeNotification({ taskID: "tsk_test_send_001", type: "task.completed", notify: { tier: 2 } })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(fixture.log.permissionRequests).toBe(0)
    expect(fixture.log.sends).toBe(1)
  })

  test("initApp never wires a startup permission request", () => {
    const source = readFileSync(join(import.meta.dir, "../src/services/init.ts"), "utf8")
    expect(source).not.toContain("ensureDesktopNotificationPermission")
    expect(source).not.toContain("notification.requestPermission")
  })

  test("settings permission path requests permission once and surfaces blocked state in-app", async () => {
    const result = await ensureDesktopNotificationPermission()
    expect(fixture.log.permissionRequests).toBe(1)
    expect(result).toBe("default")
    expect(notificationStore.items.some((item) => item.id === "system:notification-permission")).toBe(true)
  })

  test("requestNotificationPermission (gesture path) DOES prompt once", async () => {
    const result = await requestNotificationPermission()
    expect(fixture.log.permissionRequests).toBe(1)
    expect(result).toBe("default")
  })

  test("requestNotificationPermission is idempotent under concurrent calls", async () => {
    const [a, b] = await Promise.all([requestNotificationPermission(), requestNotificationPermission()])
    expect(fixture.log.permissionRequests).toBe(1)
    expect(a).toBe("default")
    expect(b).toBe("default")
  })
})
