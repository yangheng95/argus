import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Auth } from "../../src/auth"
import { Env } from "../../src/env"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { discoverHexinModels, refreshHexinCache } from "../../src/provider/hexin-discovery"
import { tmpdir } from "../fixture/fixture"

const cacheFile = path.join(Global.Path.cache, "hexin-models.json")
const originalFetch = globalThis.fetch
const originalKey = process.env.HEXIN_API_KEY

beforeEach(async () => {
  await fs.rm(cacheFile, { force: true })
  process.env.HEXIN_API_KEY = "test-hexin-key"
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.HEXIN_API_KEY
  else process.env.HEXIN_API_KEY = originalKey
  await fs.rm(cacheFile, { force: true })
  await Instance.disposeAll().catch(() => undefined)
})

describe("hexin model discovery", () => {
  test("normal provider-list discovery never fetches live models", async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      throw new Error("live fetch must not run")
    }) as typeof fetch

    const models = await discoverHexinModels()

    expect(models).toEqual({})
    expect(called).toBe(false)
  })

  test("explicit refresh fetches live models and writes the cache", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "hexin-test-model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch

    const models = await refreshHexinCache()
    const cached = JSON.parse(await Bun.file(cacheFile).text()) as { ids: string[] }

    expect(Object.keys(models)).toEqual(["hexin-test-model"])
    expect(cached.ids).toEqual(["hexin-test-model"])
  })

  test("target reasoning models are exposed with provider-safe capabilities", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "kimi-k2.6" }, { id: "openai/glm-5.1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch

    const models = await refreshHexinCache()

    expect(models["kimi-k2.6"].capabilities).toMatchObject({
      reasoning: true,
      temperature: false,
      toolcall: true,
      interleaved: { field: "reasoning_content" },
    })
    expect(models["openai/glm-5.1"].capabilities).toMatchObject({
      reasoning: true,
      temperature: true,
      toolcall: true,
      interleaved: { field: "reasoning_content" },
    })
    expect(models["openai/glm-5.1"].limit).toMatchObject({
      context: 200_000,
      output: 128_000,
    })
  })

  test("provider refresh uses the API key saved in config and exposes models to config/providers", async () => {
    const previousAuth = await Auth.get("hexin")
    await Auth.remove("hexin").catch(() => undefined)
    await using tmp = await tmpdir({
      config: {
        provider: {
          hexin: {
            name: "Hexin OpenAI Gateway",
            api: "https://arsenal-openai.10jqka.com.cn:8443/ai-gateway/v1",
            env: ["HEXIN_API_KEY"],
            options: {
              apiKey: "config-hexin-key",
            },
          },
        },
      } as any,
    })

    const requests: Array<{ url: string; authorization: string | null }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
      })
      return new Response(
        JSON.stringify({
          data: [
            { id: "claude-sonnet-4-6" },
            { id: "qwen3-coder-plus" },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )
    }) as typeof fetch

    try {
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.remove("HEXIN_API_KEY")
        },
        fn: async () => {
          const ids = await Provider.refreshHexin()
          expect(ids).toEqual(["claude-sonnet-4-6", "qwen3-coder-plus"])
          expect(requests).toEqual([
            {
              url: "https://arsenal-openai.10jqka.com.cn:8443/ai-gateway/v1/models",
              authorization: "Bearer config-hexin-key",
            },
          ])

          const providers = await Provider.list()
          expect(Object.keys(providers.hexin.models).sort()).toEqual([
            "claude-sonnet-4-6",
            "qwen3-coder-plus",
          ])
        },
      })
    } finally {
      if (previousAuth) await Auth.set("hexin", previousAuth)
      else await Auth.remove("hexin").catch(() => undefined)
    }
  })
})
