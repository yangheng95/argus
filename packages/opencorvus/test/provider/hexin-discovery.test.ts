import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { streamText } from "ai"
import fs from "fs/promises"
import path from "path"
import { Auth } from "../../src/auth"
import { Env } from "../../src/env"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { discoverHexinModels, refreshHexinCache } from "../../src/provider/hexin-discovery"
import { GLM_EVALUATION_TEMPERATURE, THINKING_MODEL_TOP_P } from "../../src/provider/sampling"
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

  test("explicit refresh surfaces live fetch failure instead of using stale cache", async () => {
    await fs.mkdir(path.dirname(cacheFile), { recursive: true })
    await fs.writeFile(cacheFile, JSON.stringify({ fetched: Date.now(), ids: ["stale-model"] }))
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "bad key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as typeof fetch

    await expect(refreshHexinCache()).rejects.toThrow("hexin /models HTTP 401")
  })

  test("explicit refresh requires a live key even when stale cache exists", async () => {
    await fs.mkdir(path.dirname(cacheFile), { recursive: true })
    await fs.writeFile(cacheFile, JSON.stringify({ fetched: Date.now(), ids: ["stale-model"] }))
    delete process.env.HEXIN_API_KEY

    await expect(refreshHexinCache()).rejects.toThrow("HEXIN_API_KEY unset")
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

  test("provider list hydrates missing hexin cache from global auth", async () => {
    const previousAuth = await Auth.get("hexin")
    await Auth.set("hexin", {
      type: "api",
      key: "auth-hexin-key",
    })
    const requests: Array<{ authorization: string | null }> = []
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        authorization: new Headers(init?.headers).get("authorization"),
      })
      return new Response(JSON.stringify({ data: [{ id: "glm-5.1" }, { id: "kimi-k2.6" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
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
          expect(Object.keys(providers.hexin.models).sort()).toEqual(["glm-5.1", "kimi-k2.6"])
          expect(requests).toEqual([{ authorization: "Bearer auth-hexin-key" }])
        },
      })
    } finally {
      if (previousAuth) await Auth.set("hexin", previousAuth)
      else await Auth.remove("hexin").catch(() => undefined)
    }
  })

  test("provider list surfaces hexin live discovery failure when a key is configured", async () => {
    const previousAuth = await Auth.get("hexin")
    await Auth.set("hexin", {
      type: "api",
      key: "auth-hexin-key",
    })
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "bad key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as typeof fetch

    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.remove("HEXIN_API_KEY")
        },
        fn: async () => {
          await expect(Provider.list()).rejects.toThrow("hexin /models HTTP 401")
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
              url: "https://arsenal-openai.10jqka.com.cn:8443/ai-gateway/v1/models",
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
            api: "https://arsenal-openai.10jqka.com.cn:8443/ai-gateway/v1",
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
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "kimi-k2.6" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
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
