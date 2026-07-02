import { afterEach, beforeEach, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import {
  captureTaskBrowserPreviewEvidence,
  loadTaskBrowserPreviewEvidenceCaptureObjectUrl,
  loadTaskBrowserPreviewEvidence,
  loadTaskBrowserPreviewTarget,
  selectTaskBrowserPreviewTarget,
  type BrowserPreviewEvidence,
  type BrowserPreviewTarget,
} from "../src/services/browser-preview"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"

const SAVED_DIRECTORY = "D:/workspace/app"
const TASK_ID = "tsk_browserpreviewservice0001"
const EVIDENCE_CAPTURE_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
])

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
          id: "art_previewtarget000000000001",
          taskID: TASK_ID,
          kind: "task-url",
          status: "ready",
          projectRoot: SAVED_DIRECTORY,
          url: "http://127.0.0.1:5173/",
          viewports: [
            { id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1280, height: 800 },
            { id: "tablet", labelKey: "browser_preview.viewport.tablet", width: 834, height: 1112 },
            { id: "mobile", labelKey: "browser_preview.viewport.mobile", width: 390, height: 844 },
          ],
          diagnostics: [],
          candidates: [
            {
              id: "art_previewtarget000000000001",
              url: "http://127.0.0.1:5173/",
              source: "task-artifact",
              selected: true,
              timeUpdated: 100,
            },
          ],
          source: "task-artifact",
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

test("browser preview service loads the task-scoped target through HostTransport", async () => {
  let captured: TransportRequest | undefined
  __setHostTransportForTest(
    fakePreviewTransport((req) => {
      captured = req
    }),
  )

  const target = await loadTaskBrowserPreviewTarget({ taskID: TASK_ID, directory: SAVED_DIRECTORY })

  expect(target.status).toBe("ready")
  expect(captured?.path).toBe(`task/${TASK_ID}/browser-preview`)
  expect(captured?.query?.directory).toBe(SAVED_DIRECTORY)
})

test("browser preview service selects an existing backend target by ID", async () => {
  let captured: TransportRequest | undefined
  __setHostTransportForTest(
    fakePreviewTransport((req) => {
      captured = req
    }),
  )

  await selectTaskBrowserPreviewTarget({
    taskID: TASK_ID,
    directory: SAVED_DIRECTORY,
    targetID: "art_previewtarget000000000001",
  })

  expect(captured?.path).toBe(`task/${TASK_ID}/browser-preview/target`)
  expect(captured?.method).toBe("PUT")
  expect(captured?.query?.url).toBeUndefined()
  expect(captured?.query?.directory).toBe(SAVED_DIRECTORY)
  expect(captured?.body).toEqual({
    kind: "json",
    value: {
      targetID: "art_previewtarget000000000001",
    },
  })
})

test("browser preview service rejects failed backend target selection", async () => {
  let captured: TransportRequest | undefined
  __setHostTransportForTest({
    ...fakePreviewTransport((req) => {
      captured = req
    }),
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      captured = req
      return {
        status: 500,
        ok: false,
        headers: {},
        body: { message: "target selection unavailable" } as T,
      }
    },
  })

  await expect(
    selectTaskBrowserPreviewTarget({
      taskID: TASK_ID,
      directory: SAVED_DIRECTORY,
      targetID: "art_previewtarget_unavailable",
    }),
  ).rejects.toThrow(
    "API 500 task/tsk_browserpreviewservice0001/browser-preview/target?directory=D%3A%2Fworkspace%2Fapp: target selection unavailable",
  )
  expect(captured?.path).toBe(`task/${TASK_ID}/browser-preview/target`)
  expect(captured?.method).toBe("PUT")
  expect(captured?.query?.directory).toBe(SAVED_DIRECTORY)
  expect(captured?.body).toEqual({
    kind: "json",
    value: {
      targetID: "art_previewtarget_unavailable",
    },
  })
})

test("browser preview service asks the backend to persist Playwright evidence", async () => {
  let captured: TransportRequest | undefined
  __setHostTransportForTest({
    ...fakePreviewTransport((req) => {
      captured = req
    }),
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
            id: "art_previewtarget000000000001",
            taskID: TASK_ID,
            kind: "task-url",
            status: "ready",
            projectRoot: SAVED_DIRECTORY,
            url: "http://127.0.0.1:5173/",
            viewports: [],
            diagnostics: [],
            candidates: [
              {
                id: "art_previewtarget000000000001",
                url: "http://127.0.0.1:5173/",
                source: "task-artifact",
                selected: true,
                timeUpdated: 100,
              },
            ],
            source: "task-artifact",
          },
          viewports: [{ id: "mobile", labelKey: "browser_preview.viewport.mobile", width: 390, height: 844 }],
          captures: {
            mobile: {
              captured: true,
              passed: true,
              url: "http://127.0.0.1:5173/",
              summary: "all runtime capture layers passed",
            },
          },
          evidenceIDs: { mobile: "art_previewevidence00000001" },
          diagnostics: ["all runtime capture layers passed"],
        } as T,
      }
    },
  })

  const result = await captureTaskBrowserPreviewEvidence({
    taskID: TASK_ID,
    directory: SAVED_DIRECTORY,
    targetID: "art_previewtarget000000000001",
    viewportIDs: ["mobile"],
  })

  expect(result.status).toBe("passed")
  expect(captured?.path).toBe(`task/${TASK_ID}/browser-preview/capture`)
  expect(captured?.method).toBe("POST")
  expect(captured?.query?.directory).toBe(SAVED_DIRECTORY)
  expect(captured?.body).toEqual({
    kind: "json",
    value: {
      targetID: "art_previewtarget000000000001",
      viewportIDs: ["mobile"],
    },
  })
})

test("browser preview service loads persisted evidence through the task-scoped artifact endpoint", async () => {
  let captured: TransportRequest | undefined
  __setHostTransportForTest({
    ...fakePreviewTransport((req) => {
      captured = req
    }),
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      captured = req
      return {
        status: 200,
        ok: true,
        headers: {},
        body: {
          id: "art_previewevidence00000001",
          taskID: TASK_ID,
          targetID: "art_previewtarget000000000001",
          viewportID: "desktop",
          status: "passed",
          summary: "all runtime capture layers passed",
          capture: {
            captured: true,
            passed: true,
            url: "http://127.0.0.1:5173/",
          },
          diagnostics: ["all runtime capture layers passed"],
          timeCompleted: 100,
          timeCreated: 90,
        } satisfies BrowserPreviewEvidence as T,
      }
    },
  })

  const evidence = await loadTaskBrowserPreviewEvidence({
    taskID: TASK_ID,
    directory: SAVED_DIRECTORY,
    evidenceID: "art_previewevidence00000001",
  })

  expect(evidence.status).toBe("passed")
  expect(evidence.capture?.captured).toBe(true)
  expect(captured?.path).toBe(`task/${TASK_ID}/browser-preview/evidence/art_previewevidence00000001`)
  expect(captured?.query?.directory).toBe(SAVED_DIRECTORY)
})

test("browser preview service loads persisted evidence screenshot bytes through HostTransport", async () => {
  let captured: TransportRequest | undefined
  __setHostTransportForTest({
    ...fakePreviewTransport((req) => {
      captured = req
    }),
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      captured = req
      return {
        status: 200,
        ok: true,
        headers: { "content-type": "image/png" },
        body: EVIDENCE_CAPTURE_BYTES as T,
      }
    },
  })

  const objectUrl = await loadTaskBrowserPreviewEvidenceCaptureObjectUrl({
    taskID: TASK_ID,
    directory: SAVED_DIRECTORY,
    evidenceID: "art_previewevidence00000001",
  })

  expect(objectUrl).toStartWith("blob:")
  URL.revokeObjectURL(objectUrl)
  expect(captured?.path).toBe(`task/${TASK_ID}/browser-preview/evidence/art_previewevidence00000001/capture.png`)
  expect(captured?.method).toBe("GET")
  expect(captured?.responseKind).toBe("binary")
  expect(captured?.query?.directory).toBe(SAVED_DIRECTORY)
})

test("browser preview service decodes JSON error bodies from evidence capture binary responses", async () => {
  __setHostTransportForTest({
    ...fakePreviewTransport(() => {}),
    async request<T>(): Promise<TransportResponse<T>> {
      return {
        status: 404,
        ok: false,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: new TextEncoder().encode(
          JSON.stringify({ message: "Browser preview evidence capture not found: art_previewevidence_missing" }),
        ) as T,
      }
    },
  })

  await expect(
    loadTaskBrowserPreviewEvidenceCaptureObjectUrl({
      taskID: TASK_ID,
      directory: SAVED_DIRECTORY,
      evidenceID: "art_previewevidence_missing",
    }),
  ).rejects.toThrow(
    "API 404 task/tsk_browserpreviewservice0001/browser-preview/evidence/art_previewevidence_missing/capture.png?directory=D%3A%2Fworkspace%2Fapp: Browser preview evidence capture not found: art_previewevidence_missing",
  )
})
