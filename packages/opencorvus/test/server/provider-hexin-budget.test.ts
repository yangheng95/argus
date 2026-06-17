import { afterEach, expect, test } from "bun:test"
import { Hono } from "hono"
import { Auth } from "../../src/auth"
import { Env } from "../../src/env"
import { Instance } from "../../src/project/instance"
import { HexinBudgetResponse, ProviderRoutes } from "../../src/server/routes/provider"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const originalFetch = globalThis.fetch

function app() {
  return new Hono().route("/provider", ProviderRoutes())
}

afterEach(async () => {
  globalThis.fetch = originalFetch
  await Instance.disposeAll().catch(() => undefined)
})

test("HexinBudgetResponse requires discriminated success and failure payloads", () => {
  expect(HexinBudgetResponse.safeParse({ ok: true }).success).toBe(false)
  expect(HexinBudgetResponse.safeParse({ ok: false }).success).toBe(false)
  expect(
    HexinBudgetResponse.safeParse({
      ok: true,
      budget: {
        maxBudget: 100,
        spend: 25,
        remaining: 75,
        overBudget: false,
      },
    }).success,
  ).toBe(true)
  expect(HexinBudgetResponse.safeParse({ ok: false, error: "HEXIN_API_KEY unset" }).success).toBe(true)
})

test("GET /provider/hexin/budget sends configured Hexin bearer key and maps LiteLLM budget fields", async () => {
  const previousAuth = await Auth.get("hexin")
  const seen: { url?: string; authorization?: string | null; accept?: string | null } = {}
  globalThis.fetch = (async (input, init) => {
    seen.url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const headers = new Headers(init?.headers)
    seen.authorization = headers.get("authorization")
    seen.accept = headers.get("accept")
    return Response.json({
      user_id: "user-1",
      max_budget: 4435.3,
      spend: 2980.312612080029,
      remaining: 1454.9873879199713,
      over_budget: false,
    })
  }) as typeof fetch

  try {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("HEXIN_API_KEY", "hexin-budget-key")
      },
      fn: async () => {
        const response = await app().request("/provider/hexin/budget")

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({
          ok: true,
          budget: {
            maxBudget: 4435.3,
            spend: 2980.312612080029,
            remaining: 1454.9873879199713,
            overBudget: false,
          },
        })
      },
    })

    expect(seen).toEqual({
      url: "https://aimemodeldev.myhexin.com/litellm/key/budget",
      authorization: "Bearer hexin-budget-key",
      accept: "application/json",
    })
  } finally {
    if (previousAuth) await Auth.set("hexin", previousAuth)
    else await Auth.remove("hexin").catch(() => undefined)
  }
})

test("GET /provider/hexin/budget reports missing Hexin key without touching the network", async () => {
  const previousAuth = await Auth.get("hexin")
  let fetchCalls = 0
  globalThis.fetch = (async () => {
    fetchCalls++
    throw new Error("budget route must not fetch without a Hexin key")
  }) as typeof fetch

  try {
    await Auth.remove("hexin").catch(() => undefined)
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.remove("HEXIN_API_KEY")
      },
      fn: async () => {
        const response = await app().request("/provider/hexin/budget")

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({
          ok: false,
          error: "HEXIN_API_KEY unset",
        })
        expect(fetchCalls).toBe(0)
      },
    })
  } finally {
    if (previousAuth) await Auth.set("hexin", previousAuth)
    else await Auth.remove("hexin").catch(() => undefined)
  }
})

test("GET /provider/hexin/budget reports malformed upstream budget JSON", async () => {
  const previousAuth = await Auth.get("hexin")
  globalThis.fetch = (async () => Response.json({ spend: 1 })) as typeof fetch

  try {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("HEXIN_API_KEY", "hexin-budget-key")
      },
      fn: async () => {
        const response = await app().request("/provider/hexin/budget")
        const body = (await response.json()) as { ok: boolean; error?: string }

        expect(response.status).toBe(200)
        expect(body.ok).toBe(false)
        expect(body.error).toContain("max_budget")
      },
    })
  } finally {
    if (previousAuth) await Auth.set("hexin", previousAuth)
    else await Auth.remove("hexin").catch(() => undefined)
  }
})

test("GET /provider/hexin/budget redacts upstream error bodies", async () => {
  const previousAuth = await Auth.get("hexin")
  globalThis.fetch = (async () =>
    new Response("upstream echoed Authorization: Bearer hexin-budget-key", {
      status: 401,
      statusText: "Unauthorized",
      headers: { "content-type": "text/plain" },
    })) as typeof fetch

  try {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("HEXIN_API_KEY", "hexin-budget-key")
      },
      fn: async () => {
        const response = await app().request("/provider/hexin/budget")
        const body = (await response.json()) as { ok: boolean; error?: string }

        expect(response.status).toBe(200)
        expect(body.ok).toBe(false)
        expect(body.error).toBe(
          "GET https://aimemodeldev.myhexin.com/litellm/key/budget returned HTTP 401 Unauthorized.",
        )
        expect(body.error).not.toContain("hexin-budget-key")
        expect(body.error).not.toContain("Authorization")
        expect(body.error).not.toContain("Bearer")
      },
    })
  } finally {
    if (previousAuth) await Auth.set("hexin", previousAuth)
    else await Auth.remove("hexin").catch(() => undefined)
  }
})
