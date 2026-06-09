import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { streamText } from "ai"
import fs from "fs/promises"
import path from "path"
import { Auth } from "../../src/auth"
import { Env } from "../../src/env"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import {
  discoverHexinModels,
  discoverHexinModelsForStartup,
  refreshHexinCache,
} from "../../src/provider/hexin-discovery"
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

    const models = await refreshHexinCache("test-hexin-key")
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

    await expect(refreshHexinCache("test-hexin-key")).rejects.toThrow("hexin /models HTTP 401")
  })

  test("explicit refresh requires an explicit apiKey — never falls back to process.env", async () => {
    // Round-2 hardening: even with process.env.HEXIN_API_KEY set by
    // beforeEach, refreshHexinCache(undefined) must throw. The force path
    // refuses to consult process.env so that Provider.refreshHexin() — which
    // resolves the key via hexinApiKey(cfg) inside an Instance — cannot fall
    // through to raw env when Env.remove masked the per-instance shim.
    await fs.mkdir(path.dirname(cacheFile), { recursive: true })
    await fs.writeFile(cacheFile, JSON.stringify({ fetched: Date.now(), ids: ["stale-model"] }))
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
      new Response(JSON.stringify({ data: [{ id: "kimi-k2.6" }, { id: "openai/glm-5.1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch

    const models = await refreshHexinCache("test-hexin-key")

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

  test("Provider.getModel refreshes hexin catalog once on model miss", async () => {
    let modelFetches = 0
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (!url.endsWith("/models")) throw new Error(`unexpected fetch ${url}`)
      modelFetches++
      const ids = modelFetches === 1 ? ["stale-model"] : ["stale-model", "late-model"]
      return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        expect(Object.keys(providers.hexin.models)).toEqual(["stale-model"])

        const model = await Provider.getModel("hexin", "late-model")
        expect(model.id).toBe("late-model")
        expect(modelFetches).toBe(2)
      },
    })
  })

  test("Provider.list does not reject when hexin /v1/models returns budget_exceeded — /config/providers stays 200", async () => {
    // Regression: previously Provider.list() rejected when hexin /v1/models
    // returned 4xx (e.g. budget exceeded). That 500-ed /config/providers and
    // erased every other provider from the Settings UI, locking the operator
    // out of switching keys or disabling hexin. discoverHexinModelsForStartup
    // now soft-fails so state() resolves regardless of hexin's upstream
    // health. The Provider.database() catalog (used by /provider) still
    // exposes hexin for the refresh button; the connected list (used by
    // /config/providers) drops hexin only because models is empty, which is
    // the same pre-existing rule applied to any zero-model provider.
    const previousAuth = await Auth.get("hexin")
    await Auth.set("hexin", {
      type: "api",
      key: "auth-hexin-key",
    })
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Budget has been exceeded! Current cost: 1000.95, Max budget: 1000.0",
            type: "budget_exceeded",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      )) as typeof fetch

    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.remove("HEXIN_API_KEY")
        },
        fn: async () => {
          // Hard invariant: must not throw. /config/providers builds its
          // response from this same call; a reject here = a 500 there.
          const providers = await Provider.list()
          expect(providers).toBeDefined()
          // hexin is still registered in the underlying database so the
          // catalog route can render it; database() never filters zero-model.
          const database = await Provider.database()
          expect(database.hexin).toBeDefined()
          expect(Object.keys(database.hexin.models)).toEqual([])
        },
      })
    } finally {
      if (previousAuth) await Auth.set("hexin", previousAuth)
      else await Auth.remove("hexin").catch(() => undefined)
    }
  })

  test("startup discovery falls back to cached ids when live fetch fails", async () => {
    await fs.mkdir(path.dirname(cacheFile), { recursive: true })
    await fs.writeFile(cacheFile, JSON.stringify({ fetched: Date.now() - 60_000, ids: ["cached-hexin-model"] }))
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "budget exceeded" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })) as typeof fetch

    const outcome = await discoverHexinModelsForStartup({ apiKey: "test-hexin-key" })

    expect(outcome.source).toBe("cache")
    expect(Object.keys(outcome.models)).toEqual(["cached-hexin-model"])
    expect(outcome.error).toBeInstanceOf(Error)
    expect(outcome.error?.message).toContain("hexin /models HTTP 400")
  })

  test("startup discovery returns empty + error when live fails and no cache exists", async () => {
    // cacheFile was wiped in beforeEach
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "nope" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as typeof fetch

    const outcome = await discoverHexinModelsForStartup({ apiKey: "test-hexin-key" })

    expect(outcome.source).toBe("empty")
    expect(outcome.models).toEqual({})
    expect(outcome.error?.message).toContain("hexin /models HTTP 401")
  })

  test("startup discovery writes cache + reports live source on success", async () => {
    let called = 0
    globalThis.fetch = (async () => {
      called++
      return new Response(JSON.stringify({ data: [{ id: "kimi-k2.6" }, { id: "openai/glm-5.1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    const outcome = await discoverHexinModelsForStartup({ apiKey: "test-hexin-key" })
    const cached = JSON.parse(await Bun.file(cacheFile).text()) as { ids: string[] }

    expect(called).toBe(1)
    expect(outcome.source).toBe("live")
    expect(outcome.error).toBeUndefined()
    expect(Object.keys(outcome.models).sort()).toEqual(["kimi-k2.6", "openai/glm-5.1"])
    expect(cached.ids.sort()).toEqual(["kimi-k2.6", "openai/glm-5.1"])
  })

  test("startup discovery never touches network when no key + no cache, returns empty", async () => {
    delete process.env.HEXIN_API_KEY
    let called = false
    globalThis.fetch = (async () => {
      called = true
      throw new Error("network must not be touched without a key")
    }) as typeof fetch

    const outcome = await discoverHexinModelsForStartup({})

    expect(called).toBe(false)
    expect(outcome.source).toBe("empty")
    expect(outcome.models).toEqual({})
    expect(outcome.error).toBeUndefined()
  })

  test("startup discovery returns cached models when no key + cache present", async () => {
    delete process.env.HEXIN_API_KEY
    await fs.mkdir(path.dirname(cacheFile), { recursive: true })
    await fs.writeFile(cacheFile, JSON.stringify({ fetched: Date.now(), ids: ["legacy-model"] }))
    let called = false
    globalThis.fetch = (async () => {
      called = true
      throw new Error("must not fetch when no key supplied")
    }) as typeof fetch

    const outcome = await discoverHexinModelsForStartup({})

    expect(called).toBe(false)
    expect(outcome.source).toBe("cache")
    expect(Object.keys(outcome.models)).toEqual(["legacy-model"])
    expect(outcome.error).toBeUndefined()
  })

  test("startup helper does NOT bypass per-Instance Env isolation by reading process.env", async () => {
    // Regression for codex review #1 (rule 8 — single credential source).
    // process.env.HEXIN_API_KEY is set globally by beforeEach. Inside an
    // Instance scope the test calls Env.remove("HEXIN_API_KEY") which
    // clears the per-instance shallow copy but leaves process.env untouched.
    // hexinApiKey(config) → Env.get returns undefined; with no Auth and no
    // Config override, the canonical key is undefined and startup must
    // honor that — even though raw process.env still has a value.
    // If the helper ever falls back to process.env, this assertion fires.
    const previousAuth = await Auth.get("hexin")
    await Auth.remove("hexin").catch(() => undefined)
    let liveFetchCalls = 0
    globalThis.fetch = (async () => {
      liveFetchCalls++
      throw new Error("startup must not touch network when Env-scoped key is absent")
    }) as typeof fetch

    try {
      expect(process.env.HEXIN_API_KEY).toBe("test-hexin-key") // beforeEach set this
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.remove("HEXIN_API_KEY") // per-instance shallow copy only
        },
        fn: async () => {
          await Provider.list() // must not throw, must not fetch hexin
          expect(liveFetchCalls).toBe(0)
        },
      })
    } finally {
      if (previousAuth) await Auth.set("hexin", previousAuth)
    }
  })

  test("startup helper ignores process.env when called directly with no apiKey — unit-call shape", async () => {
    // Companion unit test: even outside an Instance, the startup helper
    // never reads process.env. Round-3 hardening extended this no-env policy
    // to the user-initiated discoverHexinModels force path as well (see the
    // "requires an explicit apiKey — never falls back to process.env" test
    // above) — process.env is no longer consulted anywhere in hexin-discovery.
    process.env.HEXIN_API_KEY = "leak-key-must-not-fetch"
    let called = false
    globalThis.fetch = (async () => {
      called = true
      throw new Error("startup helper must not read process.env")
    }) as typeof fetch

    const outcome = await discoverHexinModelsForStartup({})

    expect(called).toBe(false)
    expect(outcome.source).toBe("empty")
    expect(outcome.error).toBeUndefined()
  })

  test("refresh button (refreshHexinCache) still throws hard on live failure — user must see budget errors", async () => {
    // Regression guard: the startup softening must not bleed into the user-
    // initiated refresh path. UI refresh / Provider.refreshHexin must surface
    // the upstream HTTP error verbatim so the operator can act on it.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: { message: "Budget has been exceeded", type: "budget_exceeded" },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      )) as typeof fetch

    await expect(refreshHexinCache("test-hexin-key")).rejects.toThrow("hexin /models HTTP 400")
  })

  test("Provider.refreshHexin throws HEXIN_API_KEY unset when Env-scoped key is masked — does NOT fall through to process.env", async () => {
    // Regression for codex round-2 finding: Provider.refreshHexin resolves the
    // key via hexinApiKey(cfg). If that returns "" because Env.remove masked
    // the per-instance shim and no Auth/config key exists, the helper must
    // refuse to proceed instead of silently using the raw process.env key.
    const previousAuth = await Auth.get("hexin")
    await Auth.remove("hexin").catch(() => undefined)
    let liveFetchCalls = 0
    globalThis.fetch = (async () => {
      liveFetchCalls++
      throw new Error("Provider.refreshHexin must not touch network without an Env-scoped key")
    }) as typeof fetch

    try {
      expect(process.env.HEXIN_API_KEY).toBe("test-hexin-key") // beforeEach
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.remove("HEXIN_API_KEY") // mask per-instance shim only
        },
        fn: async () => {
          await expect(Provider.refreshHexin()).rejects.toThrow("HEXIN_API_KEY unset")
          expect(liveFetchCalls).toBe(0)
        },
      })
    } finally {
      if (previousAuth) await Auth.set("hexin", previousAuth)
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
