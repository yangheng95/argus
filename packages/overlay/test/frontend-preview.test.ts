import { expect, test } from "bun:test"
import {
  isBoardInvalidatingEventType,
  isTreeWriterPassThroughEventType,
} from "../src/services/event-policy"
import {
  isLoopbackHttpUrl,
  nextTabForPreviewResolution,
  previewRequestKey,
  resolveFrontendPreviewFromBoard,
  structuredPreviewUrlFromBoard,
} from "../src/services/frontend-preview"

test("preview request key uses the backend board snapshot version", () => {
  expect(previewRequestKey("tsk_preview", "board-revision-1")).toBe("tsk_preview:board-revision-1")
  expect(previewRequestKey(undefined, undefined)).toBe("no-task")
  expect(previewRequestKey("", "")).toBe("no-task")
  expect(() => previewRequestKey("tsk_preview", "")).toThrow(/snapshotVersion/)
  expect(() => previewRequestKey("tsk_preview", undefined)).toThrow(/snapshotVersion/)
})

test("structured preview URL prefers delivery.previewUrl over runtime flow rows", () => {
  const result = structuredPreviewUrlFromBoard({
    candidateDelivery: {
      previewUrl: "http://127.0.0.1:3000/",
      evidenceManifest: {
        runtimeFlows: [
          {
            id: "runtime:web:.",
            evidence: ["Rendered http://127.0.0.1:9999 but this text is not a source"],
          },
          {
            id: "runtime:web:app",
            previewUrl: "http://127.0.0.1:5173/",
          },
        ],
      },
    },
  })
  expect(result?.url).toBe("http://127.0.0.1:3000/")
  expect(result?.source).toBe("delivery")
})

test("structured preview URL can read from runtime flow when delivery.previewUrl is absent", () => {
  const result = structuredPreviewUrlFromBoard({
    candidateDelivery: {
      evidenceManifest: {
        runtimeFlows: [
          {
            id: "runtime:web:app",
            previewUrl: "http://127.0.0.1:5173/",
          },
        ],
      },
    },
  })
  expect(result?.url).toBe("http://127.0.0.1:5173/")
  expect(result?.source).toBe("delivery")
})

test("structured preview URL rejects non-loopback URLs", () => {
  expect(isLoopbackHttpUrl("https://example.com")).toBe(false)
  expect(isLoopbackHttpUrl("http://localhost:3000")).toBe(true)
  expect(
    structuredPreviewUrlFromBoard({
      candidateDelivery: {
        evidenceManifest: {
          runtimeFlows: [{ previewUrl: "https://example.com" }],
        },
      },
    }),
  ).toBeNull()
})

test("preview resolver does not call the port-probe route when board has no delivery URL", async () => {
  const result = await resolveFrontendPreviewFromBoard({ candidateDelivery: {} })
  expect(result).toEqual({
    url: null,
    source: null,
    port: null,
    checkedPorts: [],
    reason: "no_delivery_preview_url",
  })
})

test("preview tab auto-activates from inspector when delivery preview is ready", () => {
  expect(
    nextTabForPreviewResolution({
      activeTab: "inspector",
      manualKey: "task:old",
      requestKey: "task:new",
      resolution: {
        url: "http://127.0.0.1:5173/",
        source: "delivery",
        port: 5173,
      },
    }),
  ).toBe("preview")

  expect(
    nextTabForPreviewResolution({
      activeTab: "inspector",
      manualKey: "task:new",
      requestKey: "task:new",
      resolution: {
        url: "http://127.0.0.1:5173/",
        source: "delivery",
        port: 5173,
      },
    }),
  ).toBe("inspector")
})

test("static html preview path is absent", async () => {
  const service = await Bun.file(new URL("../src/services/frontend-preview.ts", import.meta.url)).text()
  const component = await Bun.file(new URL("../src/components/FrontendPreviewPanel.tsx", import.meta.url)).text()
  expect(service).not.toContain("DOMParser")
  expect(service).not.toContain("/file/content")
  expect(component).not.toContain("srcdoc")
})

test("preview iframe preserves same-origin for Vite module scripts", async () => {
  const component = await Bun.file(new URL("../src/components/FrontendPreviewPanel.tsx", import.meta.url)).text()
  expect(component).toContain('sandbox="allow-scripts allow-forms allow-same-origin"')
})

test("delivery preview update refreshes board without creating a card", () => {
  expect(isBoardInvalidatingEventType("delivery.preview.updated")).toBe(true)
  expect(isTreeWriterPassThroughEventType("delivery.preview.updated")).toBe(true)
})
