import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { streamText } from "ai"
import fs from "fs/promises"
import path from "path"
import { Auth } from "../../src/auth"
import { Env } from "../../src/env"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { ModelsDev } from "../../src/provider/models"
import { Provider } from "../../src/provider/provider"
import { discoverHexinModels, refreshHexinCache } from "../../src/provider/hexin-discovery"
import { GLM_EVALUATION_TEMPERATURE, THINKING_MODEL_TOP_P } from "../../src/provider/sampling"
import { tmpdir } from "../fixture/fixture"

const legacyHexinCacheFile = path.join(Global.Path.cache, "hexin-models.json")
const modelsCacheFile = path.join(Global.Path.cache, "models.json")
const originalFetch = globalThis.fetch
const originalKey = process.env.HEXIN_API_KEY
let originalModelsCache: string | undefined

beforeEach(async () => {
  originalModelsCache = await fs.readFile(modelsCacheFile, "utf8").catch(() => undefined)
  await fs.rm(legacyHexinCacheFile, { force: true })
  await fs.rm(modelsCacheFile, { force: true })
  ModelsDev.Data.reset()
  Provider.resetAll()
  process.env.HEXIN_API_KEY = "test-hexin-key"
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.HEXIN_API_KEY
  else process.env.HEXIN_API_KEY = originalKey
  await fs.rm(legacyHexinCacheFile, { force: true })
  if (originalModelsCache === undefined) await fs.rm(modelsCacheFile, { force: true })
  else {
    await fs.mkdir(path.dirname(modelsCacheFile), { recursive: true })
    await fs.writeFile(modelsCacheFile, originalModelsCache)
  }
  ModelsDev.Data.reset()
  Provider.resetAll()
  await Instance.disposeAll().catch(() => undefined)
})

describe("hexin model discovery", () => {
  test("normal discovery reads the ModelsDev catalog and never uses the legacy hexin cache", async () => {
    await fs.mkdir(path.dirname(legacyHexinCacheFile), { recursive: true })
    await fs.writeFile(legacyHexinCacheFile, JSON.stringify({ fetched: Date.now(), ids: ["legacy-only-model"] }))
    let called = false
    globalThis.fetch = (async () => {
      called = true
      throw new Error("live fetch must not run")
    }) as typeof fetch

    const models = await discoverHexinModels()

    expect(called).toBe(false)
    expect(models["legacy-only-model"]).toBeUndefined()
    expect(models["gpt-5.5"]).toBeDefined()
    expect(models["kimi-k2.7-code"].capabilities.input.image).toBe(true)
  })

  test("explicit refresh fetches live models and writes the ModelsDev cache", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "hexin-test-model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch

    const models = await refreshHexinCache("test-hexin-key")
    const cached = JSON.parse(await Bun.file(modelsCacheFile).text()) as Record<string, ModelsDev.Provider>
    ModelsDev.Data.reset()
    const catalog = await ModelsDev.get()

    expect(Object.keys(models)).toEqual(["hexin-test-model"])
    expect(Object.keys(cached.hexin.models)).toEqual(["hexin-test-model"])
    expect(Object.keys(catalog.hexin.models)).toEqual(["hexin-test-model"])
  })

  test("explicit refresh surfaces live fetch failure and preserves the catalog", async () => {
    await ModelsDev.refreshHexinProvider(["stale-model"])
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "bad key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as typeof fetch

    await expect(refreshHexinCache("test-hexin-key")).rejects.toThrow("hexin /models HTTP 401")

    const models = await discoverHexinModels()
    expect(Object.keys(models)).toEqual(["stale-model"])
  })

  test("explicit refresh requires an explicit apiKey and never reads process.env", async () => {
    expect(process.env.HEXIN_API_KEY).toBe("test-hexin-key")
    let called = false
    globalThis.fetch = (async () => {
      called = true
      throw new Error("network must not be touched without an explicit key")
    }) as typeof fetch

    await expect(refreshHexinCache()).rejects.toThrow("HEXIN_API_KEY unset")
    expect(called).toBe(false)
  })

  test("target reasoning models are exposed with provider-safe capabilities", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ data: [{ id: "kimi-k2.6" }, { id: "kimi-k2.7-code" }, { id: "openai/glm-5.1" }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as typeof fetch

    const models = await refreshHexinCache("test-hexin-key")

    expect(models["kimi-k2.6"].capabilities).toMatchObject({
      reasoning: true,
      temperature: false,
      attachment: true,
      toolcall: true,
      input: {
        image: true,
      },
      interleaved: { field: "reasoning_content" },
    })
    expect(models["kimi-k2.7-code"].capabilities).toMatchObject({
      reasoning: true,
      temperature: false,
      attachment: true,
      toolcall: true,
      input: {
        image: true,
      },
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
    expect(models["openai/glm-5.1"].transform).toEqual({
      sampling: {
        temperature: GLM_EVALUATION_TEMPERATURE,
        topP: THINKING_MODEL_TOP_P,
      },
      options: {
        thinking: {
          type: "enabled",
          clear_thinking: false,
        },
      },
    })
  })

  test("provider list uses the catalog and never hydrates Hexin from live startup", async () => {
    const previousAuth = await Auth.get("hexin")
    await Auth.set("hexin", {
      type: "api",
      key: "auth-hexin-key",
    })
    let liveFetchCalls = 0
    globalThis.fetch = (async () => {
      liveFetchCalls++
      throw new Error("Provider.list must not fetch hexin live models")
    }) as typeof fetch

    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.remove("HEXIN_API_KEY")
        },
        fn: async () => {
          const providers = await Provider.list()
          expect(liveFetchCalls).toBe(0)
          expect(providers.hexin.models["gpt-5.5"]).toBeDefined()
          expect(providers.hexin.models["kimi-k2.6"].capabilities.attachment).toBe(true)
          expect(providers.hexin.models["kimi-k2.6"].capabilities.input.image).toBe(true)
          expect(providers.hexin.models["kimi-k2.7-code"].capabilities.attachment).toBe(true)
          expect(providers.hexin.models["kimi-k2.7-code"].capabilities.input.image).toBe(true)
        },
      })
    } finally {
      if (previousAuth) await Auth.set("hexin", previousAuth)
      else await Auth.remove("hexin").catch(() => undefined)
    }
  })

  test("Provider.getModel does not refresh Hexin on model miss", async () => {
    const previousAuth = await Auth.get("hexin")
    await Auth.set("hexin", {
      type: "api",
      key: "auth-hexin-key",
    })
    let liveFetchCalls = 0
    globalThis.fetch = (async () => {
      liveFetchCalls++
      throw new Error("model miss must not fetch hexin live models")
    }) as typeof fetch

    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.remove("HEXIN_API_KEY")
        },
        fn: async () => {
          await expect(Provider.getModel("hexin", "late-model")).rejects.toThrow()
          expect(liveFetchCalls).toBe(0)
        },
      })
    } finally {
      if (previousAuth) await Auth.set("hexin", previousAuth)
      else await Auth.remove("hexin").catch(() => undefined)
    }
  })

  test("startup ignores Hexin live budget errors because startup never calls live discovery", async () => {
    const previousAuth = await Auth.get("hexin")
    await Auth.set("hexin", {
      type: "api",
      key: "auth-hexin-key",
    })
    let liveFetchCalls = 0
    globalThis.fetch = (async () => {
      liveFetchCalls++
      return new Response(
        JSON.stringify({
          error: {
            message: "Budget has been exceeded! Current cost: 1000.95, Max budget: 1000.0",
            type: "budget_exceeded",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      )
    }) as typeof fetch

    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.remove("HEXIN_API_KEY")
        },
        fn: async () => {
          const providers = await Provider.list()
          const database = await Provider.database()
          expect(liveFetchCalls).toBe(0)
          expect(providers.hexin.models["gpt-5.5"]).toBeDefined()
          expect(database.hexin.models["gpt-5.5"]).toBeDefined()
        },
      })
    } finally {
      if (previousAuth) await Auth.set("hexin", previousAuth)
      else await Auth.remove("hexin").catch(() => undefined)
    }
  })

  test("Provider.refreshHexin throws HEXIN_API_KEY unset when Env-scoped key is masked and never reads process.env", async () => {
    const previousAuth = await Auth.get("hexin")
    await Auth.remove("hexin").catch(() => undefined)
    let liveFetchCalls = 0
    globalThis.fetch = (async () => {
      liveFetchCalls++
      throw new Error("Provider.refreshHexin must not touch network without an Env-scoped key")
    }) as typeof fetch

    try {
      expect(process.env.HEXIN_API_KEY).toBe("test-hexin-key")
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.remove("HEXIN_API_KEY")
        },
        fn: async () => {
          await expect(Provider.refreshHexin()).rejects.toThrow("HEXIN_API_KEY unset")
          expect(liveFetchCalls).toBe(0)
        },
      })
    } finally {
      if (previousAuth) await Auth.set("hexin", previousAuth)
      else await Auth.remove("hexin").catch(() => undefined)
    }
  })

  test("provider refresh lets project config override the global auth key and exposes models to config/providers", async () => {
    const previousAuth = await Auth.get("hexin")
    await Auth.set("hexin", {
      type: "api",
      key: "global-hexin-key",
    })
    await using tmp = await tmpdir({
      config: {
        provider: {
          hexin: {
            name: "Hexin OpenAI Gateway",
            api: "https://aimemodeldev.myhexin.com/litellm/v1",
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
          data: [{ id: "claude-sonnet-4-6" }, { id: "qwen3-coder-plus" }],
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
              url: "https://aimemodeldev.myhexin.com/litellm/v1/models",
              authorization: "Bearer config-hexin-key",
            },
          ])

          const providers = await Provider.list()
          expect(Object.keys(providers.hexin.models).sort()).toEqual(["claude-sonnet-4-6", "qwen3-coder-plus"])
        },
      })
    } finally {
      if (previousAuth) await Auth.set("hexin", previousAuth)
      else await Auth.remove("hexin").catch(() => undefined)
    }
  })

  test("hexin OpenAI-compatible calls rewrite Kimi K2.6 temperature before HTTP send", async () => {
    await using tmp = await tmpdir({
      config: {
        provider: {
          hexin: {
            name: "Hexin OpenAI Gateway",
            api: "https://aimemodeldev.myhexin.com/litellm/v1",
            env: ["HEXIN_API_KEY"],
            options: {
              apiKey: "config-hexin-key",
            },
          },
        },
      } as any,
    })

    let chatBody: Record<string, unknown> | undefined
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/chat/completions")) {
        chatBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        const chunks = [
          `data: ${JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            created: 0,
            model: "kimi-k2.6",
            choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }],
          })}\n\n`,
          `data: ${JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            created: 0,
            model: "kimi-k2.6",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })}\n\n`,
          "data: [DONE]\n\n",
        ].join("")
        return new Response(chunks, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    }) as typeof fetch

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.remove("HEXIN_API_KEY")
      },
      fn: async () => {
        const model = await Provider.getModel("hexin", "kimi-k2.6")
        const language = await Provider.getLanguage(model)
        const result = streamText({
          model: language,
          temperature: 0,
          messages: [{ role: "user", content: "Reply OK." }],
        })
        for await (const _part of result.fullStream) {
          // Consume the stream so the request is sent.
        }
        expect(chatBody?.model).toBe("kimi-k2.6")
        expect(chatBody?.temperature).toBe(1)
      },
    })
  })
})
