import { afterEach, beforeEach, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import { loadBrowserPreviewTarget, type BrowserPreviewTarget } from "../src/services/browser-preview"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"

const SAVED_DIRECTORY = "D:/workspace/app"

function fakePreviewTransport(capture: (req: TransportRequest) => void): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      capture(req)
      return {
        status: 200,
        ok: true,
        headers: {},
        body: {
          kind: "explicit-url",
          status: "ready",
          projectRoot: SAVED_DIRECTORY,
          url: "http://127.0.0.1:5173/",
          viewports: [
            { id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1280, height: 800 },
            { id: "tablet", labelKey: "browser_preview.viewport.tablet", width: 834, height: 1112 },
            { id: "mobile", labelKey: "browser_preview.viewport.mobile", width: 390, height: 844 },
          ],
          diagnostics: [],
          source: "query",
        } satisfies BrowserPreviewTarget as T,
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
  }
}

beforeEach(() => {
  configure({ serverUrl: "http://127.0.0.1:7878", directory: SAVED_DIRECTORY })
})

afterEach(() => {
  __setHostTransportForTest(undefined)
  configure({ directory: "" })
})

test("browser preview service sends the explicit URL through HostTransport query", async () => {
  let captured: TransportRequest | undefined
  __setHostTransportForTest(fakePreviewTransport((req) => { captured = req }))

  const target = await loadBrowserPreviewTarget("  http://127.0.0.1:5173/dashboard?tab=one&view=wide  ")

  expect(target.status).toBe("ready")
  expect(captured?.path).toBe("browser-preview/target")
  expect(captured?.query?.url).toBe("http://127.0.0.1:5173/dashboard?tab=one&view=wide")
  expect(captured?.query?.directory).toBe(SAVED_DIRECTORY)
})

test("browser preview service omits the url query when no explicit URL is provided", async () => {
  let captured: TransportRequest | undefined
  __setHostTransportForTest(fakePreviewTransport((req) => { captured = req }))

  await loadBrowserPreviewTarget("   ")

  expect(captured?.path).toBe("browser-preview/target")
  expect(captured?.query?.url).toBeUndefined()
  expect(captured?.query?.directory).toBe(SAVED_DIRECTORY)
})

test("browser preview service asks the backend to capture Playwright evidence", async () => {
  let captured: TransportRequest | undefined
  __setHostTransportForTest({
    ...fakePreviewTransport((req) => { captured = req }),
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      captured = req
      return {
        status: 200,
        ok: true,
        headers: {},
        body: {
          status: "passed",
          projectRoot: SAVED_DIRECTORY,
          target: {
            kind: "explicit-url",
            status: "ready",
            projectRoot: SAVED_DIRECTORY,
            url: "http://127.0.0.1:5173/",
            viewports: [],
            diagnostics: [],
            source: "query",
          },
          viewport: { id: "mobile", labelKey: "browser_preview.viewport.mobile", width: 390, height: 844 },
          capture: {
            captured: true,
            passed: true,
            url: "http://127.0.0.1:5173/",
            summary: "all runtime capture layers passed",
          },
          diagnostics: ["all runtime capture layers passed"],
        } as T,
      }
    },
  })

  const { verifyBrowserPreviewTarget } = await import("../src/services/browser-preview")
  const result = await verifyBrowserPreviewTarget({
    url: "http://127.0.0.1:5173/",
    viewportID: "mobile",
  })

  expect(result.status).toBe("passed")
  expect(captured?.path).toBe("browser-preview/verify")
  expect(captured?.method).toBe("POST")
  expect(captured?.query?.directory).toBe(SAVED_DIRECTORY)
  expect(captured?.body).toEqual({
    kind: "json",
    value: {
      url: "http://127.0.0.1:5173/",
      viewportID: "mobile",
    },
  })
})
