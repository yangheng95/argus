import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { PROTOCOL_VERSION, type ExtensionMessage, type WebviewMessage } from "@opencorvus-ai/transport-protocol"
import { vscodeRuntimeMock } from "./vscode-runtime-mock"

mock.module("vscode", () => vscodeRuntimeMock)

const { TransportBridge } = await import("../src/transport/bridge")

/**
 * Lifecycle / contract regression tests for TransportBridge — guards
 * the audit-2026-04-29 findings:
 *
 *  - vscode-ext F1: handleStreamOpen on validation failure previously
 *    sent BOTH stream.error AND stream.close for an id that was never
 *    in the streams Map. Now it sends only stream.error.
 *  - transport F5: stream.open with a duplicate id used to overwrite
 *    the prior controller (silent leak). Now it rejects with
 *    stream.error and leaves the original alive.
 *  - vscode-ext F10: dispose() did not notify the webview that
 *    in-flight streams were being killed. Now sends stream.close per
 *    active stream; in-flight requests get an error response.
 *  - overlay F2: request.abort envelope is honoured by aborting the
 *    in-flight fetch (the previous protocol used stream.close which
 *    silently leaked the request).
 */

interface MockWebview {
  postedMessages: ExtensionMessage[]
  cspSource: string
  receive(message: WebviewMessage | unknown): Promise<void>
  postMessage(m: ExtensionMessage): Thenable<boolean>
  asWebviewUri(uri: any): any
  options: any
  html: string
  onDidDispose(fn: () => void): { dispose: () => void }
  onDidReceiveMessage(fn: (m: unknown) => void): { dispose: () => void }
  _receiveHandler?: (m: unknown) => void
}

function mockWebview(): MockWebview {
  const posted: ExtensionMessage[] = []
  let receiveHandler: ((m: unknown) => void) | undefined
  return {
    postedMessages: posted,
    cspSource: "vscode-test",
    options: {} as any,
    html: "",
    onDidDispose() {
      return { dispose() {} }
    },
    onDidReceiveMessage(fn) {
      receiveHandler = fn
      return { dispose() {} }
    },
    postMessage(m) {
      posted.push(m)
      return Promise.resolve(true) as any
    },
    asWebviewUri(uri) {
      return uri
    },
    async receive(message) {
      if (!receiveHandler) throw new Error("no message handler attached")
      receiveHandler(message)
      // Yield once so any async handlers (handleRequest, handleStreamOpen)
      // make progress.
      await new Promise((r) => setTimeout(r, 0))
    },
    get _receiveHandler() {
      return receiveHandler
    },
  }
}

interface MockSidecar {
  baseUrl: string
  token: string
  username: string
  pid: number
  workspace: string
  onExit(): void
  stop(): Promise<void>
}

function mockSidecar(baseUrl: string): MockSidecar {
  return {
    baseUrl,
    token: "t",
    username: "u",
    pid: 1,
    workspace: "/tmp/ws",
    onExit() {},
    async stop() {},
  }
}

describe("TransportBridge — stream open validation (audit vscode-ext F1)", () => {
  let webview: MockWebview
  let bridge: TransportBridge

  beforeEach(() => {
    webview = mockWebview()
    bridge = new TransportBridge(webview as any, mockSidecar("http://127.0.0.1:0") as any)
  })

  afterEach(() => {
    bridge.dispose()
  })

  test("rejected path emits exactly one stream.error and NO stream.close", async () => {
    await webview.receive({
      protocol: PROTOCOL_VERSION,
      type: "stream.open",
      id: "s1",
      method: "GET",
      path: "../etc/passwd",
      query: {},
      headers: {},
      body: { kind: "none" },
    })
    const errors = webview.postedMessages.filter((m) => m.type === "stream.error" && (m as any).id === "s1")
    const closes = webview.postedMessages.filter((m) => m.type === "stream.close" && (m as any).id === "s1")
    expect(errors.length).toBe(1)
    expect(closes.length).toBe(0)
  })
})

describe("TransportBridge — duplicate stream id (audit transport F5)", () => {
  test("second stream.open with same id is rejected with stream.error, original survives", async () => {
    const webview = mockWebview()
    const bridge = new TransportBridge(webview as any, mockSidecar("http://127.0.0.1:65535") as any)
    try {
      // Fire BOTH opens synchronously without yielding so the first
      // stream is still registered (driveStream's fetch hasn't
      // finished failing) when the second arrives. handleStreamOpen
      // registers the id in the Map synchronously before
      // `void driveStream(...)`, so the second open's `streams.has`
      // check sees the duplicate.
      const handler = webview._receiveHandler!
      handler({
        protocol: PROTOCOL_VERSION,
        type: "stream.open",
        id: "dup",
        method: "GET",
        path: "task/abc/events",
        query: {},
        headers: {},
        body: { kind: "none" },
      })
      // Synchronously, before any yield, the second open arrives:
      handler({
        protocol: PROTOCOL_VERSION,
        type: "stream.open",
        id: "dup",
        method: "GET",
        path: "global/event",
        query: {},
        headers: {},
        body: { kind: "none" },
      })
      // Yield once so any sync-emitted stream.error envelopes land.
      await new Promise((r) => setTimeout(r, 0))
      // The duplicate-id rejection should appear before any fetch
      // failure (which is async after a yield).
      const dupErrors = webview.postedMessages.filter(
        (m) => m.type === "stream.error" && /already open/.test((m as any).message ?? ""),
      )
      expect(dupErrors.length).toBe(1)
    } finally {
      bridge.dispose()
    }
  })
})

describe("TransportBridge.dispose (audit vscode-ext F10)", () => {
  test("emits stream.close for each active stream when bridge is disposed", async () => {
    const originalFetch = globalThis.fetch
    const webview = mockWebview()
    const bridge = new TransportBridge(webview as any, mockSidecar("http://127.0.0.1:65535") as any)
    try {
      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start() {
            init?.signal?.addEventListener("abort", () => undefined, { once: true })
          },
        })
        return new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      }) as typeof fetch

      void webview.receive({
        protocol: PROTOCOL_VERSION,
        type: "stream.open",
        id: "s-active",
        method: "GET",
        path: "global/event",
        query: {},
        headers: {},
        body: { kind: "none" },
      })
      await new Promise((r) => setTimeout(r, 0))
      webview.postedMessages.length = 0
      bridge.dispose()
      const closes = webview.postedMessages.filter(
        (m) => m.type === "stream.close" && (m as any).reason === "bridge-dispose",
      )
      expect(closes.length).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("TransportBridge request.abort (audit overlay F2)", () => {
  test("aborts the in-flight fetch and resolves the pending request with an error envelope", async () => {
    const originalFetch = globalThis.fetch
    const webview = mockWebview()
    const bridge = new TransportBridge(webview as any, mockSidecar("http://127.0.0.1:65535") as any)
    let abortObserved = false
    try {
      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              abortObserved = true
              reject(new DOMException("aborted", "AbortError"))
            },
            { once: true },
          )
        })
      }) as typeof fetch

      void webview.receive({
        protocol: PROTOCOL_VERSION,
        type: "request",
        id: "r-active",
        method: "GET",
        path: "global/health",
        query: {},
        headers: {},
        body: { kind: "none" },
        responseKind: "json",
      })
      await new Promise((r) => setTimeout(r, 0))
      await webview.receive({
        protocol: PROTOCOL_VERSION,
        type: "request.abort",
        id: "r-active",
      })
      await new Promise((r) => setTimeout(r, 0))

      expect(abortObserved).toBe(true)
      const responses = webview.postedMessages.filter((m) => m.type === "response" && (m as any).id === "r-active")
      expect(responses.length).toBe(1)
      expect((responses[0] as any).ok).toBe(false)
      expect((responses[0] as any).body.kind).toBe("error")
    } finally {
      bridge.dispose()
      globalThis.fetch = originalFetch
    }
  })
})
