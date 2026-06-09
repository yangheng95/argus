import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { PROTOCOL_VERSION, type ExtensionMessage } from "@opencorvus-ai/transport-protocol"
import { __resetVsCodeTransportForTest, createVsCodeTransport } from "../src/services/vscode-transport"
import { configure } from "../src/services/api"

/**
 * audit-2026-04-29 W2-V1 — when the user rotates the sidecar password,
 * any open SSE/long-poll stream is still authed against the old
 * credential. Pre-fix: streams silently 401/leak until the next route
 * change. Post-fix: api.ts onAuthChange() fires on credential change,
 * the host transports drain a force-close set, and the business
 * reconnect timer in services/sse.ts re-opens with fresh headers.
 *
 * These tests cover the vscode-transport side. tauri-transport's
 * EventSource branch isn't easily exercised under Bun (no native
 * EventSource), but the openPostStream branch shares the same
 * activeStreamForceClose plumbing — the vscode contract is enough to
 * lock the api.ts emitter behaviour and the close-and-cleanup loop.
 */

interface FakeVsCode {
  posted: any[]
}

function installFakeWindow(): {
  fake: FakeVsCode
  trigger: (m: ExtensionMessage) => void
  cleanup: () => void
} {
  const posted: any[] = []
  let listener: ((e: MessageEvent) => void) | undefined
  const fakeWindow: any = {
    addEventListener(_t: string, fn: (e: MessageEvent) => void) {
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
  const prev = (globalThis as any).window
  ;(globalThis as any).window = fakeWindow
  return {
    fake: { posted },
    trigger: (m) => {
      if (!listener) throw new Error("no listener installed")
      listener({ data: m } as MessageEvent)
    },
    cleanup: () => {
      ;(globalThis as any).window = prev
    },
  }
}

describe("auth-change drain: vscode-transport openStream (audit W2-V1)", () => {
  let cleanupFake: (() => void) | undefined
  beforeEach(() => {
    try {
      __resetVsCodeTransportForTest()
    } catch {}
    // Reset api credentials to a known baseline so the test's first
    // configure() registers as a real change.
    configure({ username: "opencorvus", password: "" })
  })
  afterEach(() => {
    cleanupFake?.()
    cleanupFake = undefined
    try {
      __resetVsCodeTransportForTest()
    } catch {}
  })

  test("configure({password}) drains the active stream with reason 'auth-changed'", async () => {
    const fake = installFakeWindow()
    cleanupFake = fake.cleanup
    const transport = createVsCodeTransport()

    const closeReasons: string[] = []
    const events: string[] = []
    transport.openStream(
      { path: "task/abc/events" },
      {
        onEvent: (d) => events.push(d),
        onClose: (r) => closeReasons.push(r ?? "<undefined>"),
      },
    )
    // Flush microtasks so the stream.open envelope is posted.
    await new Promise((r) => setTimeout(r, 0))
    const opens = fake.fake.posted.filter((m) => m.type === "stream.open")
    expect(opens.length).toBe(1)
    const streamId = opens[0].id

    // Rotate the password — should drain the active stream.
    configure({ password: "rotated-pwd" })
    await new Promise((r) => setTimeout(r, 0))

    expect(closeReasons).toEqual(["auth-changed"])
    // close() must also post a stream.close envelope so the bridge
    // tears down the upstream fetch (otherwise the ext-host keeps the
    // old auth-bearing connection alive — exact bug we're fixing).
    const closes = fake.fake.posted.filter((m) => m.type === "stream.close" && m.id === streamId)
    expect(closes.length).toBe(1)
  })

  test("idempotent: configure() with same password does NOT re-drain", async () => {
    const fake = installFakeWindow()
    cleanupFake = fake.cleanup
    const transport = createVsCodeTransport()

    // Move baseline so the next same-value configure is a no-op.
    configure({ password: "stable-pwd" })

    const closeReasons: string[] = []
    transport.openStream(
      { path: "task/abc/events" },
      { onEvent: () => {}, onClose: (r) => closeReasons.push(r ?? "?") },
    )
    await new Promise((r) => setTimeout(r, 0))

    // Re-applying the same password must NOT fire onAuthChange — the
    // emitter contract requires a real diff so saving the same form
    // twice doesn't kill in-flight streams.
    configure({ password: "stable-pwd" })
    configure({ username: "opencorvus" })
    configure({})
    await new Promise((r) => setTimeout(r, 0))
    expect(closeReasons).toEqual([])
  })

  test("after drain, opening a new stream is unaffected by stale forceClose closures", async () => {
    const fake = installFakeWindow()
    cleanupFake = fake.cleanup
    const transport = createVsCodeTransport()

    const reasonsA: string[] = []
    transport.openStream({ path: "task/a/events" }, { onEvent: () => {}, onClose: (r) => reasonsA.push(r ?? "?") })
    configure({ password: "rev1" })
    await new Promise((r) => setTimeout(r, 0))
    expect(reasonsA).toEqual(["auth-changed"])

    // Open a new stream AFTER the drain. A second configure() must
    // close THIS stream, not double-close the (already-closed) old one.
    const reasonsB: string[] = []
    transport.openStream({ path: "task/b/events" }, { onEvent: () => {}, onClose: (r) => reasonsB.push(r ?? "?") })
    configure({ password: "rev2" })
    await new Promise((r) => setTimeout(r, 0))
    expect(reasonsA).toEqual(["auth-changed"]) // unchanged
    expect(reasonsB).toEqual(["auth-changed"])
  })

  test("extension-side stream.close cleans up forceClose registration (no leak, no double-close)", async () => {
    const fake = installFakeWindow()
    cleanupFake = fake.cleanup
    const transport = createVsCodeTransport()

    const reasons: string[] = []
    transport.openStream({ path: "task/c/events" }, { onEvent: () => {}, onClose: (r) => reasons.push(r ?? "?") })
    await new Promise((r) => setTimeout(r, 0))
    const sid = fake.fake.posted.find((m) => m.type === "stream.open")!.id

    // Extension delivers a stream.close (e.g. upstream-end). After
    // this, configure() must NOT trigger another onClose — the
    // forceClose closure should already be removed from the set.
    fake.trigger({
      protocol: PROTOCOL_VERSION,
      type: "stream.close",
      id: sid,
      reason: "upstream-end",
    } as any)
    await new Promise((r) => setTimeout(r, 0))
    expect(reasons).toEqual(["upstream-end"])

    configure({ password: "rotated" })
    await new Promise((r) => setTimeout(r, 0))
    // No second close — forceClose was deregistered when stream.close arrived.
    expect(reasons).toEqual(["upstream-end"])
  })
})
