import { afterEach, expect, test } from "bun:test"

import { __setHostTransportForTest, HOST_CAPABILITIES } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import { AppLog, waitForLogDrain } from "../src/utils/log"
import { clearNotifications, notificationStore } from "../src/services/notify"

function logTransport(
  responder: (req: TransportRequest) => TransportResponse<unknown> | Promise<TransportResponse<unknown>>,
): HostTransport {
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

function transportBody(req: TransportRequest): Record<string, unknown> {
  const body = req.body as { kind?: string; value?: unknown } | undefined
  if (body?.kind === "json" && body.value && typeof body.value === "object") {
    return body.value as Record<string, unknown>
  }
  throw new Error("expected JSON transport body")
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

test("overlay log upload failure creates a semantic notification and retries without recursive upload", async () => {
  let requests = 0
  const bodies: Array<Record<string, unknown>> = []
  __setHostTransportForTest(
    logTransport((req) => {
      expect(req.path).toBe("log")
      requests++
      bodies.push(transportBody(req))
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
  expect(bodies).not.toContainEqual(
    expect.objectContaining({
      service: "overlay:system",
      level: "error",
      message: "Overlay log upload failed",
    }),
  )
  expect(
    bodies.some((body) => {
      const extra = body.extra as Record<string, unknown> | undefined
      return (
        extra?.notificationID === "system:overlay-log-upload-failed" ||
        String(extra?.notificationDetails || "").includes("LOG_WRITE_FAILED")
      )
    }),
  ).toBe(false)
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
