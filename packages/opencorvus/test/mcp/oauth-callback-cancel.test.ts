import { afterEach, describe, expect, test } from "bun:test"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { OAUTH_CALLBACK_PATH, OAUTH_CALLBACK_PORT } from "../../src/mcp/oauth-provider"
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

  test("ensureRunning rejects when the callback port is owned by another process", async () => {
    await McpOAuthCallback.stop()
    const external = Bun.serve({
      port: OAUTH_CALLBACK_PORT,
      fetch() {
        return new Response("external listener")
      },
    })

    try {
      await expect(McpOAuthCallback.ensureRunning()).rejects.toThrow(
        `OAuth callback port ${OAUTH_CALLBACK_PORT} is already in use by another process`,
      )
      expect(McpOAuthCallback.isRunning()).toBe(false)
    } finally {
      external.stop()
    }
  })

  test("oauth provider errors are escaped before rendering callback HTML", async () => {
    await McpOAuthCallback.stop()
    await McpOAuthCallback.ensureRunning()

    const oauthState = "html-error-state"
    const pending = McpOAuthCallback.waitForCallback(oauthState, "html-error-mcp").catch((error) => error)
    const url = new URL(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`)
    url.searchParams.set("state", oauthState)
    url.searchParams.set("error", `<img src=x onerror="alert('x')">`)
    url.searchParams.set("error_description", `<script>alert("owned")</script> & 'quote'`)

    const response = await fetch(url)
    const html = await response.text()
    const rejected = await pending

    expect(response.status).toBe(200)
    expect(rejected).toBeInstanceOf(Error)
    expect(rejected.message).toBe(`<script>alert("owned")</script> & 'quote'`)
    expect(html).toContain("&lt;script&gt;alert(&quot;owned&quot;)&lt;/script&gt; &amp; &#39;quote&#39;")
    expect(html).not.toContain(`<script>`)
    expect(html).not.toContain(`<img`)
    expect(html).not.toContain(`onerror=`)
  })

  test("oauth provider error code is escaped when description is absent", async () => {
    await McpOAuthCallback.stop()
    await McpOAuthCallback.ensureRunning()

    const oauthState = "html-error-code-state"
    const pending = McpOAuthCallback.waitForCallback(oauthState, "html-error-code-mcp").catch((error) => error)
    const url = new URL(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`)
    url.searchParams.set("state", oauthState)
    url.searchParams.set("error", `<img src=x onerror="alert('x')">`)

    const response = await fetch(url)
    const html = await response.text()
    const rejected = await pending

    expect(response.status).toBe(200)
    expect(rejected).toBeInstanceOf(Error)
    expect(rejected.message).toBe(`<img src=x onerror="alert('x')">`)
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;")
    expect(html).not.toContain(`<img`)
    expect(html).not.toContain(`onerror="`)
  })
})
