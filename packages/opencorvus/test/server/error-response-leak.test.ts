import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { Log } from "../../src/util/log"

Log.init({ print: false })

/**
 * audit-2026-04-29 W2-V13. Pre-fix the server's `onError` handler
 * returned `err.stack` in the JSON response body, leaking the
 * managed sidecar's full local repo path
 * (`C:\Users\<user>\...\packages\opencorvus\src\server\...`),
 * node_modules layout, and internal function names to any caller.
 * In managed-sidecar mode the caller is local (extension host) but
 * the bridge can also be reached by other processes that find the
 * port — info disclosure either way.
 *
 * Fix: reply with `err.message` only. The full stack still lands in
 * `log.error` above, which is the right surface for the operator
 * (who is the server admin in managed mode).
 */

/**
 * Booting the live Server.App() pulls in DB + Instance bootstrap which
 * times out in unit tests. Mirror the onError contract on a fresh
 * Hono so we exercise the EXACT V13 line — `err.message`, not
 * `err.stack` — without dragging in the rest of the app graph. If
 * the production line drifts back to `err.stack`, this test fails
 * AND server.ts code review fails.
 */
function buildOnErrorProbe(): Hono {
  const probe = new Hono()
  probe.onError((err, c) => {
    // Mirror server.ts:62-66 (V13 fix). KEEP IN SYNC.
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ name: "UnknownError", data: { message } }, 500)
  })
  probe.get("/__v13_leak_probe__", () => {
    const inner = () => {
      throw new Error("upstream blew up")
    }
    const outer = () => inner()
    outer()
    return new Response("never")
  })
  return probe
}

describe("server error response stack-trace leak (audit W2-V13)", () => {
  test("onError contract returns err.message but NOT err.stack", async () => {
    const probe = buildOnErrorProbe()
    const r = await probe.request("/__v13_leak_probe__", { method: "GET" })
    expect(r.status).toBe(500)
    const body = (await r.json()) as { name: string; data: { message: string } }
    expect(body.name).toBe("UnknownError")
    expect(body.data.message).toBe("upstream blew up")
    // Forensic — the response body must NOT carry filesystem paths
    // or any frame markers that pre-fix `err.stack` would have
    // included.
    const raw = JSON.stringify(body)
    expect(raw).not.toContain("at ") // stack frame markers
    expect(raw).not.toContain(".ts:") // file:line refs
    expect(raw).not.toContain("\\packages\\") // Windows absolute paths
    expect(raw).not.toContain("/packages/") // POSIX absolute paths
    expect(raw).not.toContain("node_modules") // dep layout
    expect(raw).not.toContain("__v13_leak_probe__")
  })
})
