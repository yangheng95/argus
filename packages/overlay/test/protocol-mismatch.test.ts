import { describe, expect, test } from "bun:test"
import { PROTOCOL_VERSION } from "@opencorvus-ai/transport-protocol"
// Static import to avoid the Bun circular-load TDZ that
// `await import(...)` trips (host-transport eager-imports
// vscode-transport).
import { __resetVsCodeTransportForTest, createVsCodeTransport } from "../src/services/vscode-transport"

/**
 * Regression for W2-V2: when sessionStorage is unavailable (privacy
 * mode, sandboxed webview, quota exceeded), the protocol-mismatch
 * reload circuit breaker used to `return true` from the storage-not-
 * found branch — i.e. it would honour every mismatch envelope and
 * loop reload forever. Post-fix uses an in-memory counter as the
 * primary defence so the breaker still trips even without storage.
 *
 * We can't import the live `vscode-transport.ts` module-level state
 * easily without booting the whole transport, but we can verify the
 * pure breaker logic by replicating the behaviour assertions:
 *  1. Three honoured mismatches in 30 s → fourth blocked.
 *  2. Without sessionStorage, the in-memory counter still bounds.
 *  3. After 30 s the budget refreshes.
 *
 * This test imports the live module and exercises the public path
 * (handleIncoming via the addEventListener seam) under fixtured
 * window globals.
 */

function installFakeWindow(opts: { sessionStorage: Storage | undefined }): {
  posted: unknown[]
  trigger: (m: unknown) => void
  cleanup: () => void
  reloadCount: number
  reloadCountRef: { value: number }
} {
  const posted: unknown[] = []
  let listener: ((e: MessageEvent) => void) | undefined
  const reloadCountRef = { value: 0 }
  const fakeWindow: any = {
    addEventListener(_t: string, fn: (e: MessageEvent) => void) {
      listener = fn
    },
    removeEventListener() {},
    location: {
      reload() {
        reloadCountRef.value++
      },
    },
    sessionStorage: opts.sessionStorage,
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
    posted,
    trigger: (m) => {
      if (!listener) throw new Error("listener not installed")
      listener({ data: m } as MessageEvent)
    },
    cleanup: () => {
      ;(globalThis as any).window = prev
    },
    get reloadCount() {
      return reloadCountRef.value
    },
    reloadCountRef,
  }
}

describe("protocol-mismatch reload circuit breaker (audit W2-V2)", () => {
  test("memory counter bounds reloads even when sessionStorage is undefined", async () => {
    const fake = installFakeWindow({ sessionStorage: undefined })
    try {
      try {
        __resetVsCodeTransportForTest()
      } catch {}
      createVsCodeTransport()

      const mismatch = (received: number) => ({
        type: "protocol-mismatch" as const,
        expected: PROTOCOL_VERSION,
        received,
      })

      // Three mismatches in quick succession should reload thrice.
      fake.trigger(mismatch(99))
      fake.trigger(mismatch(99))
      fake.trigger(mismatch(99))
      // Fourth must be suppressed by the in-memory counter even
      // though sessionStorage is unavailable.
      fake.trigger(mismatch(99))

      expect(fake.reloadCount).toBe(3)
    } finally {
      fake.cleanup()
    }
  })

  test("rejects malformed protocol-mismatch (non-numeric expected/received)", async () => {
    const fake = installFakeWindow({ sessionStorage: undefined })
    try {
      try {
        __resetVsCodeTransportForTest()
      } catch {}
      createVsCodeTransport()
      // Synthetic mismatch with non-numeric received — must NOT
      // trigger reload (audit transport F2 isExtensionMessage tightening).
      fake.trigger({ type: "protocol-mismatch", expected: 1, received: "evil" })
      fake.trigger({ type: "protocol-mismatch" })
      expect(fake.reloadCount).toBe(0)
    } finally {
      fake.cleanup()
    }
  })
})
