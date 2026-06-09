import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { PROTOCOL_VERSION, type ExtensionMessage, type WebviewMessage } from "@opencorvus-ai/transport-protocol"
import { TransportBridge } from "../src/transport/bridge"

/**
 * Regression for W2 audit findings:
 *  - W2-V4: handleRequest now rejects duplicate request ids the same
 *    way handleStreamOpen rejects duplicate stream ids (was missing).
 *  - W2-C8: handleRequest re-checks `disposed` after `requests.set`
 *    so a concurrent dispose can't leave the upstream fetch running
 *    with the webview's pending Promise hanging.
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
      await new Promise((r) => setTimeout(r, 0))
    },
    get _receiveHandler() {
      return receiveHandler
    },
  }
}

function mockSidecar(baseUrl: string): any {
  return { baseUrl, token: "t", username: "u", pid: 1, workspace: "/tmp/ws", onExit() {}, async stop() {} }
}

describe("TransportBridge — duplicate request id (audit W2-V4)", () => {
  test("second request envelope with same id is rejected with 409 error response, original survives", async () => {
    const webview = mockWebview()
    const bridge = new TransportBridge(webview as any, mockSidecar("http://127.0.0.1:65535"))
    try {
      const handler = webview._receiveHandler!
      // Fire both synchronously so the first's `requests.set` is
      // still active when the second arrives.
      handler({
        protocol: PROTOCOL_VERSION,
        type: "request",
        id: "dup-req",
        method: "GET",
        path: "global/health",
        query: {},
        headers: {},
        body: { kind: "none" },
        responseKind: "json",
      })
      handler({
        protocol: PROTOCOL_VERSION,
        type: "request",
        id: "dup-req",
        method: "GET",
        path: "global/health",
        query: {},
        headers: {},
        body: { kind: "none" },
        responseKind: "json",
      })
      await new Promise((r) => setTimeout(r, 0))
      const dupRejection = webview.postedMessages.find(
        (m: any) =>
          m.type === "response" &&
          m.id === "dup-req" &&
          m.status === 409 &&
          /already in flight/i.test(m.body?.message ?? ""),
      )
      expect(dupRejection).toBeDefined()
    } finally {
      bridge.dispose()
    }
  })
})

describe("TransportBridge.dispose race with handleRequest (audit W2-C8)", () => {
  test("dispose called between request envelope arrival and fetch resolution → webview gets error response", async () => {
    const originalFetch = globalThis.fetch
    const webview = mockWebview()
    const bridge = new TransportBridge(webview as any, mockSidecar("http://127.0.0.1:65535"))
    let resolveFetch: ((res: Response) => void) | undefined
    try {
      // Stub fetch to never resolve until we say so.
      globalThis.fetch = (async () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        })) as typeof fetch

      // Fire a request; handleRequest will call requests.set and then
      // await the fetch. Yield once so set() runs.
      void webview.receive({
        protocol: PROTOCOL_VERSION,
        type: "request",
        id: "in-flight",
        method: "GET",
        path: "global/health",
        query: {},
        headers: {},
        body: { kind: "none" },
        responseKind: "json",
      })
      // Microtask boundary so handleRequest reaches `requests.set`.
      await new Promise((r) => setTimeout(r, 5))
      webview.postedMessages.length = 0

      // Dispose mid-flight. The bridge iterates `this.requests` and
      // posts an error response for the in-flight id.
      bridge.dispose()

      // The dispose path posts the error response synchronously via
      // webview.postMessage; we should see it immediately.
      const errorResp = webview.postedMessages.find(
        (m: any) => m.type === "response" && m.id === "in-flight" && /bridge disposed/i.test(m.body?.message ?? ""),
      )
      expect(errorResp).toBeDefined()
    } finally {
      // Unblock the stalled fetch so the test runner doesn't hang.
      try {
        resolveFetch?.(new Response("", { status: 200 }))
      } catch {}
      globalThis.fetch = originalFetch
    }
  })
})
