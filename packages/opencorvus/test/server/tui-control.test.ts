import { describe, expect, test } from "bun:test"
import { type Context } from "hono"
import { TuiRoutes, callTui } from "../../src/server/routes/tui"

function ctx(path: string, body: unknown) {
  return {
    req: {
      path,
      json: async () => body,
    },
  } as unknown as Context
}

describe("server.tui-control", () => {
  test("routes responses by request id under concurrency", async () => {
    const app = TuiRoutes()
    const left = callTui(ctx("/left", { value: "L" }))
    const right = callTui(ctx("/right", { value: "R" }))

    const firstRes = await app.request("/control/next")
    const secondRes = await app.request("/control/next")
    const first = (await firstRes.json()) as { id: string; path: string }
    const second = (await secondRes.json()) as { id: string; path: string }

    const leftId = first.path === "/left" ? first.id : second.id
    const rightId = first.path === "/right" ? first.id : second.id

    await app.request("/control/response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: rightId, body: { ok: "R" } }),
    })
    await app.request("/control/response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: leftId, body: { ok: "L" } }),
    })

    await expect(right).resolves.toEqual({ ok: "R" })
    await expect(left).resolves.toEqual({ ok: "L" })
  })

  test("returns false for unknown response id", async () => {
    const app = TuiRoutes()
    const res = await app.request("/control/response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "missing", body: { ok: true } }),
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toBe(false)
  })

  test("rejects pending request on error response", async () => {
    const app = TuiRoutes()
    const pending = callTui(ctx("/left", { value: "L" }))
    const req = await app.request("/control/next")
    const body = (await req.json()) as { id: string }
    await app.request("/control/response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: body.id, error: "boom" }),
    })
    await expect(pending).rejects.toThrow("boom")
  })

  test("returns 400 for malformed response payload", async () => {
    const app = TuiRoutes()
    const res = await app.request("/control/response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "missing" }),
    })
    expect(res.status).toBe(400)
  })

  test("removes timed out requests from the queue", async () => {
    const old = process.env.OPENCORVUS_TUI_CONTROL_TIMEOUT_MS
    process.env.OPENCORVUS_TUI_CONTROL_TIMEOUT_MS = "1000"
    try {
      const app = TuiRoutes()
      const stale = callTui(ctx("/stale", { value: "stale" }))
      await expect(stale).rejects.toThrow("tui control response timeout")

      const fresh = callTui(ctx("/fresh", { value: "fresh" }))
      const next = await app.request("/control/next")
      const body = (await next.json()) as { id: string; path: string }
      expect(body.path).toBe("/fresh")

      await app.request("/control/response", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: body.id, body: { ok: true } }),
      })
      await expect(fresh).resolves.toEqual({ ok: true })
    } finally {
      if (old === undefined) {
        delete process.env.OPENCORVUS_TUI_CONTROL_TIMEOUT_MS
      } else {
        process.env.OPENCORVUS_TUI_CONTROL_TIMEOUT_MS = old
      }
    }
  })
})
