import { afterEach, beforeEach, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import {
  captureTaskBrowserPreviewEvidence,
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

  const target = await loadTaskBrowserPreviewTarget(TASK_ID)

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

  await selectTaskBrowserPreviewTarget({ taskID: TASK_ID, targetID: "art_previewtarget000000000001" })

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
            path: "D:/workspace/app/.opencorvus/browser-preview/desktop.png",
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
    evidenceID: "art_previewevidence00000001",
  })

  expect(evidence.status).toBe("passed")
  expect(evidence.capture?.path).toContain("desktop.png")
  expect(captured?.path).toBe(`task/${TASK_ID}/browser-preview/evidence/art_previewevidence00000001`)
  expect(captured?.query?.directory).toBe(SAVED_DIRECTORY)
})
