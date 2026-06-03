import { afterEach, expect, test } from "bun:test"
import { Hono } from "hono"
import { ProviderRoutes } from "../../src/server/routes/provider"
import { Log } from "../../src/util/log"

Log.init({ print: false })

let upstream: ReturnType<typeof Bun.serve> | undefined

function app() {
  return new Hono().route("/provider", ProviderRoutes())
}

afterEach(() => {
  upstream?.stop(true)
  upstream = undefined
})

test("POST /provider/discover-models reads OpenAI-compatible /models and sends bearer auth", async () => {
  const seen: { url?: string; authorization?: string | null } = {}
  upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      seen.url = new URL(req.url).pathname
      seen.authorization = req.headers.get("authorization")
      return Response.json({
        object: "list",
        data: [{ id: "zeta-model" }, { id: "alpha-model" }, { id: "alpha-model" }, { object: "model" }],
      })
    },
  })

  const response = await app().request("/provider/discover-models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api: `http://127.0.0.1:${upstream.port}/v1`,
      apiKey: "sk-test",
    }),
  })

  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual({
    ok: true,
    models: ["alpha-model", "zeta-model"],
    count: 2,
  })
  expect(seen).toEqual({
    url: "/v1/models",
    authorization: "Bearer sk-test",
  })
})

test("POST /provider/discover-models reports upstream model discovery failures", async () => {
  upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return new Response("bad key", { status: 401 })
    },
  })

  const response = await app().request("/provider/discover-models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api: `http://127.0.0.1:${upstream.port}/v1`,
      apiKey: "sk-test",
    }),
  })

  expect(response.status).toBe(200)
  const body = (await response.json()) as { ok: boolean; models: string[]; count: number; error?: string }
  expect(body.ok).toBe(false)
  expect(body.models).toEqual([])
  expect(body.count).toBe(0)
  expect(body.error).toContain("HTTP 401")
  expect(body.error).toContain("/v1/models")
})
