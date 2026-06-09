import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { PROTOCOL_VERSION, type ExtensionMessage } from "@opencorvus-ai/transport-protocol"
import { __resetVsCodeTransportForTest, createVsCodeTransport } from "../src/services/vscode-transport"
import { DEFAULT_REQUEST_TIMEOUT_MILLISECONDS } from "../src/services/host-transport"

/**
 * Regression for audit-2026-04-29 transport F3 / overlay F1.
 *
 * Pre-fix: the webview's `handleIncoming` did
 *
 *     p.resolve(decodeResponse(msg))
 *
 * where `decodeResponse` THROWS on `body.kind === "error"`. The throw
 * propagated into the `window.message` listener and was swallowed by
 * the browser, leaving the pending Promise unresolved forever — every
 * `await transport.request(...)` that hit a server-error response
 * silently hung the UI.
 *
 * Post-fix: the resolve is wrapped in try/catch and the throw routes
 * to `p.reject`. This test drives an end-to-end response with
 * `kind: "error"` and asserts the Promise rejects within a generous
 * timeout (1s) instead of hanging.
 *
 * Implementation note: vscode-transport uses module-level state and
 * `acquireVsCodeApi()` (callable only inside a real VS Code webview).
 * We stub `globalThis.window` with a minimal MessageEvent dispatcher
 * + an `acquireVsCodeApi` that returns a no-op postMessage stub, so
 * the transport boots in our test runtime. Then we drive incoming
 * messages by manually invoking the registered listener.
 */

interface FakeVsCode {
  posted: unknown[]
}

function installFakeWindow(): { fake: FakeVsCode; trigger: (m: ExtensionMessage) => void; cleanup: () => void } {
  const posted: unknown[] = []
  let listener: ((e: MessageEvent) => void) | undefined
  const fakeWindow: any = {
    addEventListener(_type: string, fn: (e: MessageEvent) => void) {
      listener = fn
    },
    removeEventListener() {},
    location: { reload() {} },
    sessionStorage: {
      _data: new Map<string, string>(),
      getItem(k: string) {
        return this._data.get(k) ?? null
      },
      setItem(k: string, v: string) {
        this._data.set(k, v)
      },
      removeItem(k: string) {
        this._data.delete(k)
      },
    },
    acquireVsCodeApi() {
      return {
        postMessage(m: unknown) {
          posted.push(m)
        },
        setState() {},
        getState() {
          return null
        },
      }
    },
  }
  const prevWindow = (globalThis as any).window
  ;(globalThis as any).window = fakeWindow
  return {
    fake: { posted },
    trigger: (m) => {
      if (!listener) throw new Error("vscode-transport never installed a window message listener")
      listener({ data: m } as MessageEvent)
    },
    cleanup: () => {
      ;(globalThis as any).window = prevWindow
    },
  }
}

describe("vscode-transport response error envelope (audit transport F3 / overlay F1)", () => {
  let fakeCleanup: (() => void) | undefined

  afterEach(() => {
    fakeCleanup?.()
    fakeCleanup = undefined
  })

  beforeEach(() => {
    // Module-level state in vscode-transport persists across the test
    // runner's import cache. Reset it via the documented test seam.
    void Bun // keep imports
  })

  test("response with body.kind='error' rejects the pending Promise instead of hanging", async () => {
    const fake = installFakeWindow()
    fakeCleanup = fake.cleanup
    // Static-imported at top of file: `await import(...)` previously
    // tripped Bun's circular-load TDZ because host-transport eagerly
    // imports vscode-transport.
    try {
      __resetVsCodeTransportForTest()
    } catch {} // best-effort
    const transport = createVsCodeTransport()

    // Kick off a request; capture the id from the postMessage envelope.
    const reqPromise = transport.request({ path: "global/health" })
    // Yield once so the request envelope is posted.
    await new Promise((r) => setTimeout(r, 0))
    const sentRequest = fake.fake.posted[0] as { id: string; type: string }
    expect(sentRequest?.type).toBe("request")
    expect(typeof sentRequest?.id).toBe("string")

    // Server (extension) replies with an error envelope.
    fake.trigger({
      protocol: PROTOCOL_VERSION,
      type: "response",
      id: sentRequest.id,
      ok: false,
      status: 500,
      headers: {},
      body: { kind: "error", message: "upstream exploded" },
    })

    // Race the promise against a timeout — the bug was an indefinite
    // hang. 1 s is more than enough for a settled microtask.
    const verdict = await Promise.race([
      reqPromise
        .then(() => "resolved" as const)
        .catch((e) => ({ rejected: e instanceof Error ? e.message : String(e) })),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 1000)),
    ])
    expect(verdict).not.toBe("timeout")
    expect(verdict).not.toBe("resolved")
    expect((verdict as any).rejected).toMatch(/upstream exploded/)
  })

  test("response with valid body resolves normally", async () => {
    const fake = installFakeWindow()
    fakeCleanup = fake.cleanup
    // Static-import at top of file avoids the circular-load TDZ that
    // `await import(...)` triggers in Bun: host-transport eagerly
    // imports vscode-transport, so a deferred dynamic import sees the
    // partially-initialised module on first call. With the static
    // import below, the test runner finishes module initialisation
    // before any test runs.
    try {
      __resetVsCodeTransportForTest()
    } catch {} // best-effort
    const transport = createVsCodeTransport()

    const reqPromise = transport.request<{ ok: boolean }>({ path: "global/health" })
    await new Promise((r) => setTimeout(r, 0))
    const sent = fake.fake.posted[0] as { id: string }

    fake.trigger({
      protocol: PROTOCOL_VERSION,
      type: "response",
      id: sent.id,
      ok: true,
      status: 200,
      headers: {},
      body: { kind: "json", value: { ok: true } },
    })

    const result = await Promise.race([reqPromise, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 1000))])
    expect(result).not.toBe("timeout")
    expect((result as any).ok).toBe(true)
    expect((result as any).body).toEqual({ ok: true })
  })
})

describe("vscode-transport request abort uses request.abort envelope (audit overlay F2)", () => {
  let fakeCleanup: (() => void) | undefined
  const originalAbortSignalTimeout = AbortSignal.timeout
  afterEach(() => {
    fakeCleanup?.()
    fakeCleanup = undefined
    AbortSignal.timeout = originalAbortSignalTimeout
    try {
      __resetVsCodeTransportForTest()
    } catch {}
  })

  test("aborting an in-flight request posts request.abort, not stream.close", async () => {
    const fake = installFakeWindow()
    fakeCleanup = fake.cleanup
    // Static-import at top of file avoids the circular-load TDZ that
    // `await import(...)` triggers in Bun: host-transport eagerly
    // imports vscode-transport, so a deferred dynamic import sees the
    // partially-initialised module on first call. With the static
    // import below, the test runner finishes module initialisation
    // before any test runs.
    try {
      __resetVsCodeTransportForTest()
    } catch {} // best-effort
    const transport = createVsCodeTransport()

    const controller = new AbortController()
    const reqPromise = transport
      .request({ path: "task/abc/board", signal: controller.signal })
      .then(() => "resolved" as const)
      .catch((e) => ({ rejected: e instanceof Error ? e.name : String(e) }))
    await new Promise((r) => setTimeout(r, 0))
    fake.fake.posted.length = 1 // keep the initial request envelope; clear afterwards
    const sentRequest = fake.fake.posted[0] as { id: string }

    controller.abort()
    await new Promise((r) => setTimeout(r, 0))

    // Find the abort envelope; pre-fix this would be `stream.close`,
    // post-fix it must be `request.abort` with the same id.
    const abortMsg = fake.fake.posted.slice(1).find((m: any) => m && m.id === sentRequest.id)
    expect((abortMsg as any)?.type).toBe("request.abort")

    const verdict = await reqPromise
    expect((verdict as any).rejected).toBe("AbortError")
  })

  test("default request timeout aborts hung bridge requests", async () => {
    const fake = installFakeWindow()
    fakeCleanup = fake.cleanup
    const timeoutController = new AbortController()
    let timeoutMilliseconds = 0
    AbortSignal.timeout = ((milliseconds: number) => {
      timeoutMilliseconds = milliseconds
      return timeoutController.signal
    }) as typeof AbortSignal.timeout
    try {
      __resetVsCodeTransportForTest()
    } catch {}
    const transport = createVsCodeTransport()

    const reqPromise = transport
      .request({ path: "task/abc/board" })
      .then(() => "resolved" as const)
      .catch((e) => ({ rejected: e instanceof Error ? e.name : String(e) }))
    await new Promise((r) => setTimeout(r, 0))
    const sentRequest = fake.fake.posted.find((m: any) => m?.type === "request") as { id: string }

    expect(timeoutMilliseconds).toBe(DEFAULT_REQUEST_TIMEOUT_MILLISECONDS)

    timeoutController.abort()
    await new Promise((r) => setTimeout(r, 0))

    const abortMsg = fake.fake.posted.find((m: any) => m?.type === "request.abort" && m.id === sentRequest.id)
    expect((abortMsg as any)?.type).toBe("request.abort")

    const verdict = await reqPromise
    expect((verdict as any).rejected).toBe("AbortError")
  })
})
