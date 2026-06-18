import { afterEach, expect, test } from "bun:test"
import { Hono } from "hono"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { ConfigRoutes } from "../../src/server/routes/config"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const originalFetch = globalThis.fetch

function app() {
  return new Hono().route("/config", ConfigRoutes())
}

afterEach(async () => {
  globalThis.fetch = originalFetch
  Config.global.reset()
  await Instance.disposeAll()
  await resetDatabase()
})

test("POST /config/proxy/test probes the submitted proxy draft and returns HTTP code", async () => {
  let seenProxy = ""
  globalThis.fetch = (async (_input, init) => {
    seenProxy = (init as RequestInit & { proxy?: string })?.proxy ?? ""
    return new Response(null, { status: 204, statusText: "No Content" })
  }) as typeof fetch

  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const response = await app().request("/config/proxy/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proxy: {
            url: "http://10.217.133.185:30100",
            username: "hexin",
            password: "hx300033",
            llmProvider: true,
            webResearch: false,
          },
        }),
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { ok: boolean; statusCode?: number; status: string }
      expect(body.ok).toBe(true)
      expect(body.status).toBe("connected")
      expect(body.statusCode).toBe(204)
    },
  })

  expect(seenProxy).toBe("http://hexin:hx300033@10.217.133.185:30100/")
})

test("POST /config/proxy/test rejects a missing proxy URL without touching the network", async () => {
  let fetchCalls = 0
  globalThis.fetch = (async () => {
    fetchCalls++
    throw new Error("missing URL route must not fetch")
  }) as typeof fetch

  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const response = await app().request("/config/proxy/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proxy: {
            llmProvider: false,
            webResearch: false,
          },
        }),
      })

      expect(response.status).toBe(400)
      const body = (await response.json()) as { ok: boolean; message: string }
      expect(body.ok).toBe(false)
      expect(body.message).toContain("network.proxy.url is required")
    },
  })

  expect(fetchCalls).toBe(0)
})
