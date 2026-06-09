import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { PROTOCOL_VERSION, type ExtensionMessage } from "@opencorvus-ai/transport-protocol"
import { UnsupportedNativeCommandError } from "../src/services/host-transport"
import { __resetVsCodeTransportForTest, createVsCodeTransport } from "../src/services/vscode-transport"

/**
 * audit-2026-04-29 W2-G3. Locks vscode-transport's ui-command
 * dispatch + stream lifecycle. Pre-this the only related coverage
 * was vscode-transport-decode.test.ts (response error envelope) and
 * auth-change-stream.test.ts (auth-change drain). Three contract
 * surfaces had zero direct tests:
 *
 *  1. Multi-subscriber dispatch — N handlers on the same kind must
 *     all receive the payload, in registration order, and a throw
 *     in handler[i] must not block handler[i+1] (CLAUDE.md §一-7).
 *  2. unsubscribe contract — after `.unsubscribe()` the handler
 *     must not be invoked; the kind's bucket must clean up when
 *     empty so a stale empty Set doesn't pin memory across long
 *     overlay sessions.
 *  3. Unknown kind — no subscriber must produce a console.warn
 *     (loud surface, plan §一-7) and not throw.
 *
 * Stream lifecycle (stream.event / stream.error / stream.close)
 * locks the postMessage envelope routing so a future schema change
 * is caught at this seam instead of in production logs.
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

describe("vscode-transport ui-command dispatch (audit W2-G3)", () => {
  let cleanupFake: (() => void) | undefined
  beforeEach(() => {
    try {
      __resetVsCodeTransportForTest()
    } catch {}
  })
  afterEach(() => {
    cleanupFake?.()
    cleanupFake = undefined
    try {
      __resetVsCodeTransportForTest()
    } catch {}
  })

  test("multi-subscriber dispatch fires every handler in order", () => {
    const fake = installFakeWindow()
    cleanupFake = fake.cleanup
    const t = createVsCodeTransport()
    const calls: Array<[number, unknown]> = []
    t.subscribeUiCommand("composer.attach", (p) => calls.push([1, p]))
    t.subscribeUiCommand("composer.attach", (p) => calls.push([2, p]))
    t.subscribeUiCommand("composer.attach", (p) => calls.push([3, p]))
    fake.trigger({
      protocol: PROTOCOL_VERSION,
      type: "ui-command",
      kind: "composer.attach",
      payload: { foo: "bar" },
    } as any)
    expect(calls.map(([n]) => n)).toEqual([1, 2, 3])
    expect(calls.every(([_, p]) => (p as any).foo === "bar")).toBe(true)
  })

  test("a handler throw does not block subsequent handlers (loud-but-survive contract)", () => {
    const fake = installFakeWindow()
    cleanupFake = fake.cleanup
    const t = createVsCodeTransport()
    const calls: number[] = []
    const errs: unknown[][] = []
    const origError = console.error
    console.error = (...args: unknown[]) => {
      errs.push(args)
    }
    try {
      t.subscribeUiCommand("composer.attach", () => calls.push(1))
      t.subscribeUiCommand("composer.attach", () => {
        throw new Error("boom")
      })
      t.subscribeUiCommand("composer.attach", () => calls.push(3))
      fake.trigger({
        protocol: PROTOCOL_VERSION,
        type: "ui-command",
        kind: "composer.attach",
        payload: null,
      } as any)
    } finally {
      console.error = origError
    }
    expect(calls).toEqual([1, 3])
    expect(errs.length).toBeGreaterThanOrEqual(1)
    const msg = errs[0]!.map(String).join(" ")
    expect(msg).toMatch(/composer\.attach/)
  })

  test("unsubscribe stops the handler from firing AND cleans the empty bucket", () => {
    const fake = installFakeWindow()
    cleanupFake = fake.cleanup
    const t = createVsCodeTransport()
    let count = 0
    const sub = t.subscribeUiCommand("composer.attach", () => count++)
    sub.unsubscribe()
    const warns: unknown[][] = []
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warns.push(args)
    }
    try {
      fake.trigger({
        protocol: PROTOCOL_VERSION,
        type: "ui-command",
        kind: "composer.attach",
        payload: null,
      } as any)
    } finally {
      console.warn = origWarn
    }
    expect(count).toBe(0)
    // Once the bucket is empty the dispatch path goes through the
    // "no subscriber" warn branch — that's the visible signal that
    // the bucket was cleaned up rather than left as a dangling Set.
    const msg = warns[0]?.map(String).join(" ") ?? ""
    expect(msg).toMatch(/no subscriber.*composer\.attach/)
  })

  test("unknown ui-command kind warns loudly, does not throw", () => {
    const fake = installFakeWindow()
    cleanupFake = fake.cleanup
    createVsCodeTransport()
    const warns: unknown[][] = []
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warns.push(args)
    }
    try {
      expect(() =>
        fake.trigger({
          protocol: PROTOCOL_VERSION,
          type: "ui-command",
          kind: "unknown.kind",
          payload: { x: 1 },
        } as any),
      ).not.toThrow()
    } finally {
      console.warn = origWarn
    }
    const msg = warns[0]!.map(String).join(" ")
    expect(msg).toMatch(/no subscriber.*unknown\.kind/)
  })

  test("unsubscribing one of many subscribers leaves the others firing", () => {
    const fake = installFakeWindow()
    cleanupFake = fake.cleanup
    const t = createVsCodeTransport()
    const calls: number[] = []
    t.subscribeUiCommand("composer.attach", () => calls.push(1))
    const subB = t.subscribeUiCommand("composer.attach", () => calls.push(2))
    t.subscribeUiCommand("composer.attach", () => calls.push(3))
    subB.unsubscribe()
    fake.trigger({
      protocol: PROTOCOL_VERSION,
      type: "ui-command",
      kind: "composer.attach",
      payload: null,
    } as any)
    expect(calls).toEqual([1, 3])
  })
})

describe("vscode-transport stream lifecycle envelopes (audit W2-G3)", () => {
  let cleanupFake: (() => void) | undefined
  beforeEach(() => {
    try {
      __resetVsCodeTransportForTest()
    } catch {}
  })
  afterEach(() => {
    cleanupFake?.()
    cleanupFake = undefined
    try {
      __resetVsCodeTransportForTest()
    } catch {}
  })

  test("stream.event delivers each event string to onEvent in order", async () => {
    const fake = installFakeWindow()
    cleanupFake = fake.cleanup
    const t = createVsCodeTransport()
    const events: string[] = []
    t.openStream({ path: "task/abc/events" }, { onEvent: (e) => events.push(e) })
    await new Promise((r) => setTimeout(r, 0))
    const sid = fake.fake.posted.find((m) => m.type === "stream.open")!.id
    fake.trigger({
      protocol: PROTOCOL_VERSION,
      type: "stream.event",
      id: sid,
      events: ["a", "b", "c"],
    } as any)
    expect(events).toEqual(["a", "b", "c"])
  })

  test("stream.error invokes onError with an Error carrying the message", async () => {
    const fake = installFakeWindow()
    cleanupFake = fake.cleanup
    const t = createVsCodeTransport()
    const errs: Error[] = []
    t.openStream({ path: "task/abc/events" }, { onEvent: () => {}, onError: (e) => errs.push(e) })
    await new Promise((r) => setTimeout(r, 0))
    const sid = fake.fake.posted.find((m) => m.type === "stream.open")!.id
    fake.trigger({
      protocol: PROTOCOL_VERSION,
      type: "stream.error",
      id: sid,
      message: "upstream 502",
    } as any)
    expect(errs.length).toBe(1)
    expect(errs[0]!.message).toBe("upstream 502")
  })

  test("stream.close invokes onClose with the supplied reason and idempotent", async () => {
    const fake = installFakeWindow()
    cleanupFake = fake.cleanup
    const t = createVsCodeTransport()
    const closeReasons: string[] = []
    t.openStream({ path: "task/abc/events" }, { onEvent: () => {}, onClose: (r) => closeReasons.push(r ?? "<undef>") })
    await new Promise((r) => setTimeout(r, 0))
    const sid = fake.fake.posted.find((m) => m.type === "stream.open")!.id
    fake.trigger({
      protocol: PROTOCOL_VERSION,
      type: "stream.close",
      id: sid,
      reason: "upstream-end",
    } as any)
    // Replaying the same close envelope must not double-fire onClose
    // (the streams Map entry was deleted on the first dispatch).
    fake.trigger({
      protocol: PROTOCOL_VERSION,
      type: "stream.close",
      id: sid,
      reason: "upstream-end",
    } as any)
    expect(closeReasons).toEqual(["upstream-end"])
  })

  test("stream.event with unknown id is silently dropped (late event after client-close race)", async () => {
    const fake = installFakeWindow()
    cleanupFake = fake.cleanup
    const t = createVsCodeTransport()
    const events: string[] = []
    const handle = t.openStream({ path: "task/abc/events" }, { onEvent: (e) => events.push(e) })
    await new Promise((r) => setTimeout(r, 0))
    handle.close()
    // Pretend the bridge sent a final batch after we already closed
    // — must NOT invoke onEvent (the handler may have been GC'd).
    fake.trigger({
      protocol: PROTOCOL_VERSION,
      type: "stream.event",
      id: "ghost-id",
      events: ["zombie"],
    } as any)
    expect(events).toEqual([])
  })
})

describe("vscode-transport native command bridge", () => {
  let cleanupFake: (() => void) | undefined
  beforeEach(() => {
    try {
      __resetVsCodeTransportForTest()
    } catch {}
  })
  afterEach(() => {
    cleanupFake?.()
    cleanupFake = undefined
    try {
      __resetVsCodeTransportForTest()
    } catch {}
  })

  test("supported native commands post native.request and resolve native.response", async () => {
    const fake = installFakeWindow()
    cleanupFake = fake.cleanup
    const t = createVsCodeTransport()
    const promise = t.native({ kind: "workspace.pickDir", start: "D:/workspace" })
    const request = fake.fake.posted.find((message) => message.type === "native.request")!
    expect(request.command).toEqual({ kind: "workspace.pickDir", start: "D:/workspace" })
    fake.trigger({
      protocol: PROTOCOL_VERSION,
      type: "native.response",
      id: request.id,
      ok: true,
      value: "D:/workspace/app",
    } as any)
    expect(await promise).toBe("D:/workspace/app")
  })

  test("native.response errors reject the pending native promise", async () => {
    const fake = installFakeWindow()
    cleanupFake = fake.cleanup
    const t = createVsCodeTransport()
    const promise = t.native({ kind: "open-path", path: "D:/missing" })
    const request = fake.fake.posted.find((message) => message.type === "native.request")!
    fake.trigger({
      protocol: PROTOCOL_VERSION,
      type: "native.response",
      id: request.id,
      ok: false,
      error: { name: "NativeCommandError", message: "missing path" },
    } as any)
    await expect(promise).rejects.toThrow("missing path")
  })

  test("unsupported native commands still fail locally without posting", async () => {
    const fake = installFakeWindow()
    cleanupFake = fake.cleanup
    const t = createVsCodeTransport()
    await expect(t.native({ kind: "server.restart" })).rejects.toBeInstanceOf(UnsupportedNativeCommandError)
    expect(fake.fake.posted.some((message) => message.type === "native.request")).toBe(false)
  })
})
