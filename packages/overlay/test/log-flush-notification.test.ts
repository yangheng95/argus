import { afterEach, expect, test } from "bun:test"

import { __setHostTransportForTest, HOST_CAPABILITIES } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import { AppLog, waitForLogDrain } from "../src/utils/log"
import { clearNotifications, notificationStore } from "../src/services/notify"

function logTransport(responder: (req: TransportRequest) => TransportResponse<unknown> | Promise<TransportResponse<unknown>>): HostTransport {
  return {
    kind: "browser",
    capabilities: HOST_CAPABILITIES.browser,
    request: responder,
    openStream() {
      throw new Error("not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
    async native() {
      throw new Error("not used")
    },
  }
}

afterEach(async () => {
  __setHostTransportForTest(
    logTransport(() => ({
      status: 200,
      ok: true,
      headers: {},
      body: { ok: true },
    })),
  )
  await waitForLogDrain(2_500)
  __setHostTransportForTest(undefined)
  AppLog.clear()
  clearNotifications()
})

test("overlay error logs create notification-center diagnostics through AppLog", async () => {
  let requests = 0
  __setHostTransportForTest(
    logTransport((req) => {
      expect(req.path).toBe("log")
      requests++
      return {
        status: 200,
        ok: true,
        headers: {},
        body: { ok: true },
      }
    }),
  )

  AppLog.error("ui", "Failed to delete memory", { error: "database locked" })

  await waitForLogDrain(2_500)

  expect(requests).toBe(1)
  const item = notificationStore.items.find((entry) => entry.id === "log:error:ui:Failed to delete memory")
  expect(item?.tone).toBe("error")
  expect(item?.title).toBe("Overlay ui error")
  expect(item?.message).toBe("Failed to delete memory")
  expect(item?.details).toContain("database locked")
  expect(item?.centerHistory).toBe(true)
  expect(item?.timeoutMs).toBe(0)
})

test("overlay log upload failure creates a semantic notification and retries the queued entry", async () => {
  let requests = 0
  __setHostTransportForTest(
    logTransport((req) => {
      expect(req.path).toBe("log")
      requests++
      if (requests === 1) {
        return {
          status: 500,
          ok: false,
          headers: {},
          body: { error: "disk full", code: "LOG_WRITE_FAILED" },
        }
      }
      return {
        status: 200,
        ok: true,
        headers: {},
        body: { ok: true },
      }
    }),
  )

  AppLog.error("unit", "cannot persist overlay diagnostics", { taskID: "task-log-failure" })

  await waitForLogDrain(2_500)

  expect(requests).toBe(2)
  const loggedError = notificationStore.items.find(
    (entry) => entry.id === "log:error:unit:cannot persist overlay diagnostics",
  )
  expect(loggedError?.message).toBe("cannot persist overlay diagnostics")
  expect(loggedError?.details).toContain("task-log-failure")

  const item = notificationStore.items.find((entry) => entry.id === "system:overlay-log-upload-failed")
  expect(item?.id).toBe("system:overlay-log-upload-failed")
  expect(item?.tone).toBe("error")
  expect(item?.title).toBe("Overlay log upload failed")
  expect(item?.message).toContain("cannot persist overlay diagnostics")
  expect(item?.details).toContain("HTTP 500 log")
  expect(item?.details).toContain("LOG_WRITE_FAILED")
  expect(item?.centerHistory).toBe(true)
  expect(item?.timeoutMs).toBe(0)
})
