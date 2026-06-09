import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { PROTOCOL_VERSION, type ExtensionMessage, type WebviewMessage } from "@opencorvus-ai/transport-protocol"
import { TransportBridge } from "../src/transport/bridge"

/**
 * G2 coverage: buildRequestInit + handleRequest's auth & body
 * encoding paths. Verifies the security boundary at plan §6.2 / §7:
 *
 *  - Authorization header is always injected from sidecar.token, even
 *    when the webview tries to spoof one.
 *  - Each RequestBodyEncoding kind translates to the right
 *    Content-Type and fetch body shape.
 *
 * Driven via the public `webview.onDidReceiveMessage` seam by
 * intercepting `globalThis.fetch` so we can inspect the prepared
 * RequestInit without booting a real server.
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
  }
}

function mockSidecar(): any {
  return {
    baseUrl: "http://127.0.0.1:9999",
    token: "secret-token",
    username: "opencorvus",
    pid: 1,
    workspace: "/tmp/ws",
    onExit() {},
    async stop() {},
  }
}

interface CapturedFetch {
  url: string
  init: RequestInit
}

function installFetchSpy(): { captured: CapturedFetch[]; restore: () => void } {
  const captured: CapturedFetch[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: input.toString(), init: init ?? {} })
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
  }) as typeof fetch
  return {
    captured,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

function expectedAuthHeader(token: string): string {
  return `Basic ${Buffer.from(`opencorvus:${token}`).toString("base64")}`
}

describe("TransportBridge buildRequestInit auth + body (audit G2)", () => {
  let bridge: TransportBridge
  let webview: MockWebview
  let spy: { captured: CapturedFetch[]; restore: () => void }

  beforeEach(() => {
    webview = mockWebview()
    bridge = new TransportBridge(webview as any, mockSidecar())
    spy = installFetchSpy()
  })

  afterEach(() => {
    spy.restore()
    bridge.dispose()
  })

  async function send(
    body: WebviewMessage["body"],
    extraHeaders: Record<string, string> = {},
    method: "GET" | "POST" = "POST",
  ) {
    await webview.receive({
      protocol: PROTOCOL_VERSION,
      type: "request",
      id: `req-${Math.random()}`,
      method,
      path: "task/abc/board",
      query: {},
      headers: extraHeaders,
      body,
      responseKind: "json",
    })
  }

  test("Authorization is always sidecar token, even when webview supplies a fake one", async () => {
    await send({ kind: "none" }, { Authorization: "Bearer evil-stolen-token" }, "GET")
    expect(spy.captured.length).toBe(1)
    const headers = spy.captured[0]!.init.headers as Record<string, string>
    // Must be the sidecar token, never the webview-supplied value.
    expect(headers.Authorization).toBe(expectedAuthHeader("secret-token"))
    expect(headers.Authorization).not.toContain("evil-stolen-token")
  })

  test("body kind=json sets Content-Type and JSON-stringified body", async () => {
    await send({ kind: "json", value: { a: 1, b: "x" } })
    const cap = spy.captured[0]!.init
    const headers = cap.headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/json")
    expect(cap.body).toBe(JSON.stringify({ a: 1, b: "x" }))
  })

  test("body kind=text sets text/plain Content-Type", async () => {
    await send({ kind: "text", value: "raw body" })
    const cap = spy.captured[0]!.init
    const headers = cap.headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("text/plain;charset=utf-8")
    expect(cap.body).toBe("raw body")
  })

  test("body kind=form encodes URL-encoded form data", async () => {
    await send({
      kind: "form",
      entries: [
        ["k1", "v1"],
        ["k2", "value with spaces"],
      ],
    })
    const cap = spy.captured[0]!.init
    const headers = cap.headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded")
    const body = String(cap.body)
    expect(body).toContain("k1=v1")
    expect(body).toContain("value+with+spaces")
  })

  test("body kind=binary decodes base64 to a Uint8Array body and respects contentType", async () => {
    // base64 for [1, 2, 3, 4]
    const base64 = Buffer.from(new Uint8Array([1, 2, 3, 4])).toString("base64")
    await send({ kind: "binary", base64, contentType: "image/png" })
    const cap = spy.captured[0]!.init
    const headers = cap.headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("image/png")
    expect(cap.body).toBeInstanceOf(Uint8Array)
    expect(Array.from(cap.body as unknown as Uint8Array)).toEqual([1, 2, 3, 4])
  })

  test("body kind=none has no body and no Content-Type", async () => {
    await send({ kind: "none" }, {}, "GET")
    const cap = spy.captured[0]!.init
    const headers = cap.headers as Record<string, string>
    expect(cap.body).toBeUndefined()
    expect(headers["Content-Type"]).toBeUndefined()
  })

  test("user-supplied headers are preserved alongside auth/content-type", async () => {
    await send({ kind: "json", value: { x: 1 } }, { "X-Custom-Trace": "abc-123" })
    const headers = spy.captured[0]!.init.headers as Record<string, string>
    expect(headers["X-Custom-Trace"]).toBe("abc-123")
    expect(headers.Authorization).toBe(expectedAuthHeader("secret-token"))
    expect(headers["Content-Type"]).toBe("application/json")
  })
})
