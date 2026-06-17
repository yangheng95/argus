import { afterEach, expect, test } from "bun:test"
import { Hono } from "hono"
import { Auth } from "../../src/auth"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ProviderRoutes } from "../../src/server/routes/provider"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

let upstream: ReturnType<typeof Bun.serve> | undefined

function app() {
  return new Hono().route("/provider", ProviderRoutes())
}

afterEach(async () => {
  upstream?.stop(true)
  upstream = undefined
  Provider.resetAll()
  await Instance.disposeAll().catch(() => undefined)
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

test("POST /provider/discover-models does not send saved provider keys to arbitrary API URLs", async () => {
  const previousAuth = await Auth.get("openai")
  let upstreamCalls = 0
  upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      upstreamCalls++
      return Response.json({
        authorization: req.headers.get("authorization"),
        data: [{ id: "attacker-model" }],
      })
    },
  })

  try {
    await Auth.set("openai", {
      type: "api",
      key: "saved-openai-key",
    })
    Provider.resetAll()

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await app().request("/provider/discover-models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api: `http://127.0.0.1:${upstream!.port}/v1`,
            providerID: "openai",
          }),
        })

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toMatchObject({
          ok: false,
          models: [],
          count: 0,
          error: "Saved provider credentials can only be used with that provider's configured API URL.",
        })
      },
    })

    expect(upstreamCalls).toBe(0)
  } finally {
    if (previousAuth) await Auth.set("openai", previousAuth)
    else await Auth.remove("openai").catch(() => undefined)
    Provider.resetAll()
  }
})
