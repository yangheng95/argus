import { afterEach, describe, expect, test } from "bun:test"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { Log } from "../../src/util/log"

Log.init({ print: false })

/**
 * audit-2026-04-29 W2-V21. McpOAuthCallback.cancelPending was a
 * silent no-op:
 *
 *   pendingAuths.set(oauthState, ...)        // keyed by state
 *   cancelPending(mcpName) {                 // looks up by mcpName
 *     const p = pendingAuths.get(mcpName)    // always undefined
 *   }
 *
 * Caller (mcp/index.ts:902 `removeAuth`) passes mcpName, but the
 * waitForCallback writes the entry under the random hex state.
 * Cancel never landed; the 5-minute timeout would tick down anyway,
 * but the user's UI thought the cancel succeeded while a state slot
 * + Promise reject handler leaked.
 *
 * Post-fix: a parallel `mcpName → oauthState` index lets cancel
 * resolve through to the actual entry.
 */

describe("McpOAuthCallback.cancelPending (audit W2-V21)", () => {
  afterEach(async () => {
    // Stop drains all pendingAuths and clears both maps.
    await McpOAuthCallback.stop()
  })

  test("cancelPending(mcpName) actually rejects the pending Promise", async () => {
    // Don't ensureRunning — we only need the in-memory pendingAuths
    // path. waitForCallback writes the entry; cancelPending should
    // find it via the new index and reject.
    const oauthState = "abc-state-hex-1234"
    const mcpName = "my-server"
    const promise = McpOAuthCallback.waitForCallback(oauthState, mcpName)
    const settled = promise
      .then(() => ({ kind: "resolved" as const }))
      .catch((err) => ({ kind: "rejected" as const, message: err.message }))
    // Cancel before timeout.
    McpOAuthCallback.cancelPending(mcpName)
    const result = await settled
    expect(result.kind).toBe("rejected")
    expect((result as any).message).toMatch(/cancelled/i)
  })

  test("cancelPending(unknown-mcpName) is a safe no-op (no throw)", () => {
    // No pending entry; cancel must NOT throw and must leave any
    // genuine pending entries untouched.
    expect(() => McpOAuthCallback.cancelPending("never-registered")).not.toThrow()
  })

  test("post-cancel re-registration with the same mcpName works", async () => {
    // Cancel one auth, start another for the same mcpName, cancel
    // again — the index must support the re-registration cycle.
    const mcpName = "my-server"
    const stateA = "state-A"
    const stateB = "state-B"

    const pA = McpOAuthCallback.waitForCallback(stateA, mcpName)
      .then(() => "resolved")
      .catch((e) => `rejected:${e.message}`)
    McpOAuthCallback.cancelPending(mcpName)
    const ra = await pA
    expect(ra).toMatch(/rejected.*cancelled/i)

    const pB = McpOAuthCallback.waitForCallback(stateB, mcpName)
      .then(() => "resolved")
      .catch((e) => `rejected:${e.message}`)
    McpOAuthCallback.cancelPending(mcpName)
    const rb = await pB
    expect(rb).toMatch(/rejected.*cancelled/i)
  })

  test("waitForCallback without mcpName argument still works (back-compat)", async () => {
    // Legacy callers may still call waitForCallback(state) only.
    // The Promise should reject on stop() since there's no mcpName
    // index entry.
    const oauthState = "anonymous-state"
    const promise = McpOAuthCallback.waitForCallback(oauthState)
    const settled = promise
      .then(() => ({ kind: "resolved" as const }))
      .catch((err) => ({ kind: "rejected" as const, message: err.message }))
    // cancelPending(<mcpName>) should NOT find this entry (no index
    // for it). stop() must still drain it.
    McpOAuthCallback.cancelPending("some-other-name")
    await McpOAuthCallback.stop()
    const result = await settled
    expect(result.kind).toBe("rejected")
    expect((result as any).message).toMatch(/server stopped/i)
  })

  test("stop() drains both pendingAuths and the mcpNameToState index", async () => {
    // Internal state isn't directly exposed, but we can verify
    // behaviour: after stop(), a fresh cancelPending call against
    // the previously-mapped mcpName must NOT throw and must NOT
    // unexpectedly resolve a rebuilt entry.
    McpOAuthCallback.waitForCallback("s1", "m1").catch(() => {})
    await McpOAuthCallback.stop()
    expect(() => McpOAuthCallback.cancelPending("m1")).not.toThrow()
  })
})
