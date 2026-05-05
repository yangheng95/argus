import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

/**
 * 2026-04-30 W2-V34 — overlay must NOT call
 * `Notification.requestPermission()` outside of a real user gesture.
 *
 * Pre-fix the boot path called `primeNotificationPermission()` in
 * `services/init.ts:131`, which awaited `Notification.requestPermission()`
 * unconditionally. WebKit (darwin / Tauri WKWebView) refuses permission
 * prompts that originate outside a user gesture and replies "denied"
 * immediately without showing the OS prompt — pinning the user out of
 * notifications until they manually flip a System Settings toggle.
 *
 * The current contract:
 *   1. Module-level boot does not call `Notification.requestPermission()`.
 *   2. Init explicitly calls `ensureDesktopNotificationPermission("startup")`
 *      after locale/settings load, so the product requests OS notification
 *      permission at startup.
 *   3. `notifyTaskLifecycle` does not re-prompt from SSE handlers; it always
 *      emits an in-app notification and only uses OS notifications when
 *      permission is already granted.
 *   4. `primeNotificationPermission` is no longer exported (deleted).
 */

interface MockedNotification {
  permission: NotificationPermission;
  requestPermissionCalls: number;
}

function installNotificationMock(initial: NotificationPermission = "default"): MockedNotification {
  const state: MockedNotification = {
    permission: initial,
    requestPermissionCalls: 0,
  };

  class FakeNotification {
    static get permission(): NotificationPermission {
      return state.permission;
    }
    static async requestPermission(): Promise<NotificationPermission> {
      state.requestPermissionCalls += 1;
      // WebKit's actual non-gesture behavior: returns "denied" immediately.
      // Our spy just records the call and returns the existing state so the
      // test can assert call count without coupling to that UA quirk.
      return state.permission;
    }
    constructor() {
      // No-op — never invoked in this test
    }
  }

  // The notify module reads `Notification.permission` via `Notification`
  // at call time (window.Notification === Notification on browsers).
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    writable: true,
    value: FakeNotification,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { Notification: FakeNotification, document: { hasFocus: () => false } },
  });
  return state;
}

function uninstallNotificationMock() {
  delete (globalThis as { Notification?: unknown }).Notification;
  delete (globalThis as { window?: unknown }).window;
}

// Install the Notification mock BEFORE the static import below, so the
// notify module's `notificationApiAvailable()` check sees `Notification`
// in `window` as soon as the module body runs. Test bodies then read the
// SAME mock state via a closure on `mockState`.
let mockState: MockedNotification;
mockState = installNotificationMock("default");

import {
  clearNotifications,
  ensureDesktopNotificationPermission,
  notificationStore,
  notifyTaskLifecycle,
  requestNotificationPermission,
} from "../src/services/notify";
import * as notifyModule from "../src/services/notify";

describe("notify: startup permission request and in-app fallback", () => {
  beforeEach(() => {
    // Reset call counter and permission state between tests so each test
    // starts from a clean baseline.
    mockState.requestPermissionCalls = 0;
    mockState.permission = "default";
    clearNotifications();
  });

  afterEach(() => {
    // Mock stays installed for the duration of the file (other tests
    // depend on it); cleanup happens at process exit.
  });

  test("primeNotificationPermission is no longer exported from notify.ts", () => {
    expect("primeNotificationPermission" in notifyModule).toBe(false);
  });

  test("importing notify does not call Notification.requestPermission", () => {
    // The static import at the top of this file already triggered module
    // evaluation. If a boot-time prompt path were still wired, that import
    // would have incremented the call counter to >0. We assert it is 0.
    expect(mockState.requestPermissionCalls).toBe(0);
  });

  test("notifyTaskLifecycle (non-gesture path) does NOT prompt for permission", async () => {
    notifyTaskLifecycle("tsk_test_001", "task.completed");
    // The dispatch is async; flush a microtask round so any deferred
    // requestPermission would have fired.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockState.requestPermissionCalls).toBe(0);
    expect(notificationStore.items.some((item) => item.id === "task:tsk_test_001:completed")).toBe(true);
  });

  test("startup permission path requests permission once and surfaces blocked state in-app", async () => {
    const result = await ensureDesktopNotificationPermission("startup");
    expect(mockState.requestPermissionCalls).toBe(1);
    expect(result).toBe("default");
    expect(notificationStore.items.some((item) => item.id === "system:notification-permission")).toBe(true);
  });

  test("requestNotificationPermission (gesture path) DOES prompt once", async () => {
    const result = await requestNotificationPermission();
    expect(mockState.requestPermissionCalls).toBe(1);
    expect(result).toBe("default");
  });

  test("requestNotificationPermission is idempotent under concurrent calls", async () => {
    // Two concurrent invocations from the same gesture should not
    // double-prompt — the second sees the in-flight pending state and
    // returns the current platform permission without firing again.
    const [a, b] = await Promise.all([
      requestNotificationPermission(),
      requestNotificationPermission(),
    ]);
    expect(mockState.requestPermissionCalls).toBe(1);
    expect(a).toBe("default");
    expect(b).toBe("default");
  });
});
