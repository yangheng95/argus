import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { PROTOCOL_VERSION, type ExtensionMessage, type WebviewMessage } from "@opencorvus-ai/transport-protocol"
import { TransportBridge } from "../src/transport/bridge"

/**
 * G1 coverage: bridge.driveStream SSE block parsing + batching.
 *
 * Pre-this-test the only stream-related coverage in the suite was
 * `bridge-lifecycle.test.ts` which opens a stream against an empty
 * body to verify dispose() emits stream.close — the actual SSE chunk
 * parser, batch flush, and 64 KiB byte-cap fast-path were 0%
 * covered. SSE is the LLM token stream → the highest-traffic code
 * path in production; a regression here is user-visible.
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
    },
  }
}

function mockSidecar(): any {
  return {
    baseUrl: "http://127.0.0.1:9999",
    token: "t",
    username: "u",
    pid: 1,
    workspace: "/tmp/ws",
    onExit() {},
    async stop() {},
  }
}

/**
 * Build a Response whose body emits the given chunks (string each)
 * via a ReadableStream. Each chunk is encoded as UTF-8 bytes.
 */
function chunkedSseResponse(chunks: string[]): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
}

function installSseFetch(response: Response): { restore: () => void } {
  const original = globalThis.fetch
  globalThis.fetch = (async () => response) as typeof fetch
  return {
    restore: () => {
      globalThis.fetch = original
    },
  }
}

function streamEventsFor(id: string, posted: ExtensionMessage[]): string[] {
  const out: string[] = []
  for (const m of posted) {
    if (m.type === "stream.event" && (m as any).id === id) {
      out.push(...(m as any).events)
    }
  }
  return out
}

async function openStream(webview: MockWebview, id: string) {
  await webview.receive({
    protocol: PROTOCOL_VERSION,
    type: "stream.open",
    id,
    method: "GET",
    path: "task/abc/events",
    query: {},
    headers: {},
    body: { kind: "none" },
  })
}

async function flush(): Promise<void> {
  // Wait long enough for the 16 ms batch timer to fire and for the
  // upstream fetch's ReadableStream consumption to complete.
  await new Promise((r) => setTimeout(r, 80))
}

describe("TransportBridge SSE chunk parsing (audit G1)", () => {
  let bridge: TransportBridge
  let webview: MockWebview

  beforeEach(() => {
    webview = mockWebview()
    bridge = new TransportBridge(webview as any, mockSidecar())
  })

  afterEach(() => {
    bridge.dispose()
  })

  test("parses standard SSE blocks (LF) into individual events", async () => {
    const fetchSpy = installSseFetch(chunkedSseResponse(["data: hello\n\n", "data: world\n\n"]))
    try {
      await openStream(webview, "g1-lf")
      await flush()
      expect(streamEventsFor("g1-lf", webview.postedMessages)).toEqual(["hello", "world"])
    } finally {
      fetchSpy.restore()
    }
  })

  test("parses CRLF SSE blocks (Windows-style)", async () => {
    const fetchSpy = installSseFetch(chunkedSseResponse(["data: a\r\n\r\n", "data: b\r\n\r\n"]))
    try {
      await openStream(webview, "g1-crlf")
      await flush()
      expect(streamEventsFor("g1-crlf", webview.postedMessages)).toEqual(["a", "b"])
    } finally {
      fetchSpy.restore()
    }
  })

  test("reassembles a single event split across two chunks", async () => {
    const fetchSpy = installSseFetch(chunkedSseResponse(["data: hello-", "world\n\n"]))
    try {
      await openStream(webview, "g1-split")
      await flush()
      expect(streamEventsFor("g1-split", webview.postedMessages)).toEqual(["hello-world"])
    } finally {
      fetchSpy.restore()
    }
  })

  test("multi-line data: blocks are joined with \\n (per SSE spec)", async () => {
    const fetchSpy = installSseFetch(chunkedSseResponse(["data: line1\ndata: line2\n\n"]))
    try {
      await openStream(webview, "g1-multi")
      await flush()
      expect(streamEventsFor("g1-multi", webview.postedMessages)).toEqual(["line1\nline2"])
    } finally {
      fetchSpy.restore()
    }
  })

  test("ignores comment / id / event lines that aren't `data:`", async () => {
    const fetchSpy = installSseFetch(chunkedSseResponse([":heartbeat\nid: 42\nevent: ping\ndata: payload\n\n"]))
    try {
      await openStream(webview, "g1-noise")
      await flush()
      expect(streamEventsFor("g1-noise", webview.postedMessages)).toEqual(["payload"])
    } finally {
      fetchSpy.restore()
    }
  })

  test("emits a final stream.close after the upstream ends", async () => {
    const fetchSpy = installSseFetch(chunkedSseResponse(["data: only-event\n\n"]))
    try {
      await openStream(webview, "g1-close")
      await flush()
      const closes = webview.postedMessages.filter((m) => m.type === "stream.close" && (m as any).id === "g1-close")
      expect(closes.length).toBe(1)
      expect((closes[0] as any).reason).toBe("upstream-end")
    } finally {
      fetchSpy.restore()
    }
  })

  test("byte-ceiling immediate flush: a large single event escapes 16 ms timer", async () => {
    // Single event > 64 KiB triggers the W2-P3 byte-cap immediate
    // flush path. Below ceiling: timer-based flush only.
    const big = "x".repeat(70 * 1024)
    const fetchSpy = installSseFetch(chunkedSseResponse([`data: ${big}\n\n`]))
    try {
      await openStream(webview, "g1-bigbyte")
      // Don't wait for the timer — sleep ~5 ms; if the byte ceiling
      // works the event is already flushed.
      await new Promise((r) => setTimeout(r, 5))
      const events = streamEventsFor("g1-bigbyte", webview.postedMessages)
      expect(events.length).toBe(1)
      expect(events[0]!.length).toBe(big.length)
      // Drain any late events to keep the test runner clean.
      await flush()
    } finally {
      fetchSpy.restore()
    }
  })

  test("trailing block without terminating blank line IS emitted on stream end", async () => {
    // Documented behaviour: when the upstream closes without a final
    // `\n\n`, the residual `data:` lines flush in the final
    // `consume(decoder.decode(), true)` call (driveStream `done`
    // branch). Hono's `streamSSE` writer always terminates with
    // `\n\n` so this matters only for irregular servers / network
    // truncation. Accepting the tail is the lenient choice — drop
    // it would lose user-visible data on a clean disconnect.
    const fetchSpy = installSseFetch(chunkedSseResponse(["data: complete\n\ndata: half-"]))
    try {
      await openStream(webview, "g1-trailing")
      await flush()
      const events = streamEventsFor("g1-trailing", webview.postedMessages)
      expect(events).toEqual(["complete", "half-"])
    } finally {
      fetchSpy.restore()
    }
  })
})
