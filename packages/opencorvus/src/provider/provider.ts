import z from "zod"
import fuzzysort from "fuzzysort"
import { Config } from "../config/config"
import { mapValues, mergeDeep, omit, pickBy, sortBy } from "remeda"
import { APICallError, NoSuchModelError, type LanguageModel } from "ai"
import { Log } from "../util/log"
import { ModelsDev } from "./models"
import { NamedError } from "@opencorvus-ai/util/error"
import { Auth } from "../auth"
import { Env } from "../env"
import { Instance, lazyInstanceState } from "../project/instance"
import { Flag } from "../flag/flag"
import { iife } from "@/util/iife"
import { Global } from "../global"
import path from "path"
import { Filesystem } from "../util/filesystem"
import { entries } from "@/util/object"

import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createAzure } from "@ai-sdk/azure"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createVertex } from "@ai-sdk/google-vertex"
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { createXai } from "@ai-sdk/xai"
import { createMistral } from "@ai-sdk/mistral"
import { createGroq } from "@ai-sdk/groq"
import { createDeepInfra } from "@ai-sdk/deepinfra"
import { createCerebras } from "@ai-sdk/cerebras"
import { createCohere } from "@ai-sdk/cohere"
import { createGateway } from "@ai-sdk/gateway"
import { createTogetherAI } from "@ai-sdk/togetherai"
import { createPerplexity } from "@ai-sdk/perplexity"
import { createVercel } from "@ai-sdk/vercel"
import { createGitLab } from "@gitlab/gitlab-ai-provider"
import { ProviderTransform } from "./transform"
import { applyProviderPolicy } from "./policy"
import { CUSTOM_LOADERS, smallModelPriority, type CustomModelLoader } from "./vendor"
import { installProvider, loadProviderModule } from "./install"
import { discoverHexinModelsForStartup } from "./hexin-discovery"
import { InvalidModelReferenceError as ProviderInvalidModelReferenceError, parseModelReference } from "./model-ref"
import { BUILTIN_TEST_PROVIDERS } from "./builtin-test-providers"

export namespace Provider {
  const log = Log.create({ service: "provider" })

  type LanguageModelProvider = {
    languageModel(modelId: string): LanguageModel
  }

  const DEFAULT_INACTIVITY_TIMEOUT_MS = 300_000
  const PROVIDER_INACTIVITY_TIMEOUT_MS: Record<string, number> = {
    "alibaba-coding-plan-cn": 60_000,
  }

  export function resolveFetchInactivityMs(providerID: string, configuredTimeout: unknown): number {
    const providerTimeout = PROVIDER_INACTIVITY_TIMEOUT_MS[providerID]
    const selectedTimeout =
      configuredTimeout !== undefined && configuredTimeout !== null
        ? configuredTimeout
        : (providerTimeout ?? DEFAULT_INACTIVITY_TIMEOUT_MS)

    if (selectedTimeout === false || typeof selectedTimeout !== "number" || selectedTimeout <= 0) return 0
    if (providerTimeout !== undefined) return Math.min(selectedTimeout, providerTimeout)
    return Math.max(selectedTimeout, DEFAULT_INACTIVITY_TIMEOUT_MS)
  }

  function googleVertexVars(options: Record<string, any>) {
    const project =
      options["project"] ?? Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
    const location =
      options["location"] ?? Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "us-central1"
    const endpoint = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`

    return {
      GOOGLE_VERTEX_PROJECT: project,
      GOOGLE_VERTEX_LOCATION: location,
      GOOGLE_VERTEX_ENDPOINT: endpoint,
    }
  }

  function loadBaseURL(model: Model, options: Record<string, any>) {
    const raw = options["baseURL"] ?? model.api.url
    if (typeof raw !== "string") return raw
    const vars = model.providerID === "google-vertex" ? googleVertexVars(options) : undefined
    return raw.replace(/\$\{([^}]+)\}/g, (match, key) => {
      const val = Env.get(String(key)) ?? vars?.[String(key) as keyof typeof vars]
      return val ?? match
    })
  }

  const dashscopeState = path.join(Global.Path.state, "dashscope-embedded.json")

  function dashscopeTtlMs() {
    const raw = Number(process.env.OPENCORVUS_EMBEDDED_DASHSCOPE_TTL_HOURS ?? "24")
    if (!Number.isFinite(raw) || raw <= 0) return 24 * 60 * 60 * 1000
    return raw * 60 * 60 * 1000
  }

  async function dashscopeKey(env: Record<string, string | undefined>) {
    const direct = env["DASHSCOPE_API_KEY"]?.trim()
    if (direct) return direct

    const key = process.env.OPENCORVUS_EMBEDDED_DASHSCOPE_KEY?.trim()
    if (!key) return

    const now = Date.now()
    const hash = Bun.hash.xxHash32(key)
    const saved = await Filesystem.readJson<{ hash?: number; first?: number }>(dashscopeState).catch(() => ({
      hash: undefined,
      first: undefined,
    }))
    const firstSaved = typeof saved.first === "number" && Number.isFinite(saved.first) ? saved.first : undefined
    const same = saved.hash === hash && firstSaved !== undefined
    const first = firstSaved ?? now

    if (!same) {
      await Filesystem.writeJson(
        dashscopeState,
        {
          hash,
          first,
        },
        0o600,
      )
    }

    if (now - first >= dashscopeTtlMs()) return
    return key
  }

  async function hexinApiKey(config: Config.Info) {
    const configKey = config.provider?.hexin?.options?.apiKey
    const auth = await Auth.get("hexin")
    return (
      Env.get("HEXIN_API_KEY")?.trim() ||
      (typeof configKey === "string" ? configKey.trim() : "") ||
      (auth?.type === "api" ? auth.key.trim() : "")
    )
  }

  const BUNDLED_PROVIDERS: Record<string, (options: any) => LanguageModelProvider> = {
    "@ai-sdk/amazon-bedrock": createAmazonBedrock,
    "@ai-sdk/anthropic": createAnthropic,
    "@ai-sdk/azure": createAzure,
    "@ai-sdk/google": createGoogleGenerativeAI,
    "@ai-sdk/google-vertex": createVertex,
    "@ai-sdk/google-vertex/anthropic": createVertexAnthropic,
    "@ai-sdk/openai": createOpenAI,
    "@ai-sdk/openai-compatible": createOpenAICompatible,
    "@openrouter/ai-sdk-provider": createOpenRouter,
    "@ai-sdk/xai": createXai,
    "@ai-sdk/mistral": createMistral,
    "@ai-sdk/groq": createGroq,
    "@ai-sdk/deepinfra": createDeepInfra,
    "@ai-sdk/cerebras": createCerebras,
    "@ai-sdk/cohere": createCohere,
    "@ai-sdk/gateway": createGateway,
    "@ai-sdk/togetherai": createTogetherAI,
    "@ai-sdk/perplexity": createPerplexity,
    "@ai-sdk/vercel": createVercel,
    "@gitlab/gitlab-ai-provider": createGitLab,
  }

  export const Model = z
    .object({
      id: z.string(),
      providerID: z.string(),
      api: z.object({
        id: z.string(),
        url: z.string(),
        npm: z.string(),
      }),
      name: z.string(),
      family: z.string().optional(),
      capabilities: z.object({
        temperature: z.boolean(),
        reasoning: z.boolean(),
        attachment: z.boolean(),
        toolcall: z.boolean(),
        input: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        output: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        interleaved: z.union([
          z.boolean(),
          z.object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          }),
        ]),
      }),
      transform: z
        .object({
          sampling: z
            .object({
              temperature: z.number().optional(),
              topP: z.number().optional(),
              topK: z.number().optional(),
            })
            .optional(),
          options: z.record(z.string(), z.any()).optional(),
        })
        .optional(),
      cost: z.object({
        input: z.number(),
        output: z.number(),
        cache: z.object({
          read: z.number(),
          write: z.number(),
        }),
        experimentalOver200K: z
          .object({
            input: z.number(),
            output: z.number(),
            cache: z.object({
              read: z.number(),
              write: z.number(),
            }),
          })
          .optional(),
      }),
      limit: z.object({
        context: z.number(),
        input: z.number().optional(),
        output: z.number(),
      }),
      status: z.enum(["alpha", "beta", "deprecated", "active"]),
      options: z.record(z.string(), z.any()),
      headers: z.record(z.string(), z.string()),
      release_date: z.string(),
      variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
    })
    .meta({
      ref: "Model",
    })
  export type Model = z.infer<typeof Model>

  export const Info = z
    .object({
      id: z.string(),
      name: z.string(),
      source: z.enum(["env", "config", "custom", "api"]),
      env: z.string().array(),
      key: z.string().optional(),
      options: z.record(z.string(), z.any()),
      models: z.record(z.string(), Model),
    })
    .meta({
      ref: "Provider",
    })
  export type Info = z.infer<typeof Info>

  function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
    const m: Model = {
      id: model.id,
      providerID: provider.id,
      name: model.name,
      family: model.family,
      api: {
        id: model.id,
        url: model.provider?.api ?? provider.api!,
        npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
      },
      status: model.status ?? "active",
      headers: model.headers ?? {},
      options: model.options ?? {},
      cost: {
        input: model.cost?.input ?? 0,
        output: model.cost?.output ?? 0,
        cache: {
          read: model.cost?.cache_read ?? 0,
          write: model.cost?.cache_write ?? 0,
        },
        experimentalOver200K: model.cost?.context_over_200k
          ? {
              cache: {
                read: model.cost.context_over_200k.cache_read ?? 0,
                write: model.cost.context_over_200k.cache_write ?? 0,
              },
              input: model.cost.context_over_200k.input,
              output: model.cost.context_over_200k.output,
            }
          : undefined,
      },
      limit: {
        context: model.limit.context,
        input: model.limit.input,
        output: model.limit.output,
      },
      capabilities: {
        temperature: model.temperature,
        reasoning: model.reasoning,
        attachment: model.attachment,
        toolcall: model.tool_call,
        input: {
          text: model.modalities?.input?.includes("text") ?? false,
          audio: model.modalities?.input?.includes("audio") ?? false,
          image: model.modalities?.input?.includes("image") ?? false,
          video: model.modalities?.input?.includes("video") ?? false,
          pdf: model.modalities?.input?.includes("pdf") ?? false,
        },
        output: {
          text: model.modalities?.output?.includes("text") ?? false,
          audio: model.modalities?.output?.includes("audio") ?? false,
          image: model.modalities?.output?.includes("image") ?? false,
          video: model.modalities?.output?.includes("video") ?? false,
          pdf: model.modalities?.output?.includes("pdf") ?? false,
        },
        interleaved: model.interleaved ?? false,
      },
      release_date: model.release_date,
      variants: {},
    }

    m.variants = mapValues(ProviderTransform.variants(m), (v) => v)

    return m
  }

  export function fromModelsDevProvider(provider: ModelsDev.Provider): Info {
    return {
      id: provider.id,
      source: "custom",
      name: provider.name,
      env: provider.env ?? [],
      options: {},
      models: mapValues(provider.models, (model) => fromModelsDevModel(provider, model)),
    }
  }

  const state = lazyInstanceState(async () => {
    using _ = log.time("state")
    const config = await Config.get()
    const modelsDev = await ModelsDev.get()
    const database = mapValues(modelsDev, fromModelsDevProvider)

    const disabled = new Set(config.disabled_providers ?? [])
    const enabled = config.enabled_providers ? new Set(config.enabled_providers) : null

    function isProviderAllowed(providerID: string): boolean {
      if (enabled && !enabled.has(providerID)) return false
      if (disabled.has(providerID)) return false
      return true
    }

    const providers: { [providerID: string]: Info } = {}
    const languages = new Map<string, LanguageModel>()
    const modelLoaders: {
      [providerID: string]: CustomModelLoader
    } = {}
    const sdk = new Map<number, LanguageModelProvider>()

    log.info("init")

    // Built-in test providers are固化在源码 (builtin-test-providers.ts) and拼到
    // config provider 之前，走与用户配置完全相同的解析路径。用户 opencorvus.jsonc
    // 里的同名 provider 条目在后，会整体覆盖内置默认值。
    const configProviders = entries({
      ...BUILTIN_TEST_PROVIDERS,
      ...((config.provider ?? {}) as NonNullable<Config.Info["provider"]>),
    } as NonNullable<Config.Info["provider"]>)

    // Built-in: Hexin OpenAI Gateway — models discovered dynamically from /v1/models.
    // discoverHexinModelsForStartup is fault-isolated by contract: a hexin
    // upstream outage (budget exceeded, 401, DNS) MUST NOT reject state(),
    // because that would 500 /config/providers and erase every other provider
    // from the Settings UI — leaving the operator no way to switch keys or
    // disable hexin. The helper falls back cache → empty and never throws.
    if (!database["hexin"] && !disabled.has("hexin")) {
      const key = await hexinApiKey(config)
      const outcome = await discoverHexinModelsForStartup({ apiKey: key })
      if (outcome.error) {
        log.warn("hexin discovery failed on startup; provider registered with fallback list", {
          source: outcome.source,
          modelCount: Object.keys(outcome.models).length,
          error: outcome.error.message,
        })
      }
      database["hexin"] = {
        id: "hexin",
        name: "Hexin OpenAI Gateway",
        env: ["HEXIN_API_KEY"],
        options: {},
        source: "custom",
        models: outcome.models,
      }
    }

    function mergeProvider(providerID: string, provider: Partial<Info>) {
      const existing = providers[providerID]
      if (existing) {
        // @ts-expect-error
        providers[providerID] = mergeDeep(existing, provider)
        return
      }
      const match = database[providerID]
      if (!match) return
      // @ts-expect-error
      providers[providerID] = mergeDeep(match, provider)
    }

    // extend database from config
    for (const [providerID, provider] of configProviders) {
      const existing = database[providerID]
      const parsed: Info = {
        id: providerID,
        name: provider.name ?? existing?.name ?? providerID,
        env: provider.env ?? existing?.env ?? [],
        options: mergeDeep(existing?.options ?? {}, provider.options ?? {}),
        // 内置测试 provider 标记为 custom（与 hexin 内置 provider 一致）；
        // 其余来自 opencorvus.jsonc 的标记为 config。
        source: providerID in BUILTIN_TEST_PROVIDERS ? "custom" : "config",
        models: existing?.models ?? {},
      }

      for (const [modelID, model] of entries((provider.models ?? {}) as NonNullable<Config.Provider["models"]>)) {
        const existingModel = parsed.models[model.id ?? modelID]
        const name = iife(() => {
          if (model.name) return model.name
          if (model.id && model.id !== modelID) return modelID
          return existingModel?.name ?? modelID
        })
        const parsedModel: Model = {
          id: modelID,
          api: {
            id: model.id ?? existingModel?.api.id ?? modelID,
            npm:
              model.provider?.npm ??
              provider.npm ??
              existingModel?.api.npm ??
              modelsDev[providerID]?.npm ??
              "@ai-sdk/openai-compatible",
            url: model.provider?.api ?? provider?.api ?? existingModel?.api.url ?? modelsDev[providerID]?.api,
          },
          status: model.status ?? existingModel?.status ?? "active",
          name,
          providerID,
          capabilities: {
            temperature: model.temperature ?? existingModel?.capabilities.temperature ?? false,
            reasoning: model.reasoning ?? existingModel?.capabilities.reasoning ?? false,
            attachment: model.attachment ?? existingModel?.capabilities.attachment ?? false,
            toolcall: model.tool_call ?? existingModel?.capabilities.toolcall ?? true,
            input: {
              text: model.modalities?.input?.includes("text") ?? existingModel?.capabilities.input.text ?? true,
              audio: model.modalities?.input?.includes("audio") ?? existingModel?.capabilities.input.audio ?? false,
              image: model.modalities?.input?.includes("image") ?? existingModel?.capabilities.input.image ?? false,
              video: model.modalities?.input?.includes("video") ?? existingModel?.capabilities.input.video ?? false,
              pdf: model.modalities?.input?.includes("pdf") ?? existingModel?.capabilities.input.pdf ?? false,
            },
            output: {
              text: model.modalities?.output?.includes("text") ?? existingModel?.capabilities.output.text ?? true,
              audio: model.modalities?.output?.includes("audio") ?? existingModel?.capabilities.output.audio ?? false,
              image: model.modalities?.output?.includes("image") ?? existingModel?.capabilities.output.image ?? false,
              video: model.modalities?.output?.includes("video") ?? existingModel?.capabilities.output.video ?? false,
              pdf: model.modalities?.output?.includes("pdf") ?? existingModel?.capabilities.output.pdf ?? false,
            },
            interleaved: model.interleaved ?? false,
          },
          cost: {
            input: model?.cost?.input ?? existingModel?.cost?.input ?? 0,
            output: model?.cost?.output ?? existingModel?.cost?.output ?? 0,
            cache: {
              read: model?.cost?.cache_read ?? existingModel?.cost?.cache.read ?? 0,
              write: model?.cost?.cache_write ?? existingModel?.cost?.cache.write ?? 0,
            },
          },
          options: mergeDeep(existingModel?.options ?? {}, model.options ?? {}),
          limit: {
            context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
            input: model.limit?.input ?? existingModel?.limit?.input,
            output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
          },
          headers: mergeDeep(existingModel?.headers ?? {}, model.headers ?? {}),
          family: model.family ?? existingModel?.family ?? "",
          release_date: model.release_date ?? existingModel?.release_date ?? "",
          variants: {},
        }
        const merged = mergeDeep(ProviderTransform.variants(parsedModel), model.variants ?? {}) as Record<
          string,
          Record<string, unknown> & { disabled?: boolean }
        >
        parsedModel.variants = mapValues(
          pickBy(merged, (v) => !v.disabled),
          (v) => omit(v, ["disabled"]),
        )
        parsed.models[modelID] = parsedModel
      }
      database[providerID] = parsed
    }

    // load env
    const env = Env.all()
    // DashScope providers share keys via fallback: try provider-specific env vars first,
    // then the shared DASHSCOPE_API_KEY.
    const dashscopeCommonKeys = ["DASHSCOPE_API_KEY"]
    for (const [providerID, provider] of entries(database)) {
      if (disabled.has(providerID)) continue
      // DashScope detection: any model in this provider uses a dashscope API URL.
      // Previously checked provider.api?.includes("dashscope") but Provider.Info
      // has no top-level .api field — api.url lives per-model.
      const isDashScope = Object.values(provider.models).some((m) => m.api?.url?.includes("dashscope"))
      // alibaba-cn has special embedded-key logic below
      if (providerID === "alibaba-cn" || providerID === "alibaba") continue
      const candidates = isDashScope ? [...provider.env, ...dashscopeCommonKeys] : provider.env
      const apiKey = candidates.map((item) => env[item]?.trim()).find(Boolean)
      if (!apiKey) continue
      // When the provider declares more than one env candidate (e.g. ["AZURE_KEY", "OPENAI_KEY"]),
      // we cannot guess which one carries the active credential. Leave key unset and let the SDK pick.
      if (!isDashScope && provider.env.length > 1) continue
      mergeProvider(providerID, {
        source: "env",
        key: apiKey,
      })
    }

    // hexin: HEXIN_API_KEY env var or saved auth key wires up an actual
    // credential via the env loop above / Auth.all() loop below. If
    // neither is present, still register the provider (no key) so the
    // UI can display it and let the operator paste a key at runtime.

    // alibaba-coding-plan-cn: no embedded key. Provider is still registered
    // via the env loop above (ALIBABA_CODING_PLAN_API_KEY / DASHSCOPE_API_KEY),
    // Auth.all(), config, or surfaced via database() for the UI to prompt input.

    // alibaba-cn: resolve key from DASHSCOPE_API_KEY or embedded key
    if (!disabled.has("alibaba-cn")) {
      const key = await dashscopeKey(env)
      if (key) {
        mergeProvider("alibaba-cn", {
          source: "env",
          key,
        })
      }
    }

    // load apikeys
    for (const [providerID, provider] of Object.entries(await Auth.all())) {
      if (disabled.has(providerID)) continue
      if (provider.type === "api") {
        mergeProvider(providerID, {
          source: "api",
          key: provider.key,
        })
      }
    }

    const { Plugin } = await import("../plugin")
    for (const plugin of await Plugin.list()) {
      if (!plugin.auth) continue
      const providerID = plugin.auth.provider
      if (disabled.has(providerID)) continue

      const auth = await Auth.get(providerID)
      if (!auth) continue
      if (!plugin.auth.loader) continue

      const options = await plugin.auth.loader(() => Auth.get(providerID) as any, database[plugin.auth.provider])
      const opts = options ?? {}
      const patch: Partial<Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
      mergeProvider(providerID, patch)
    }

    for (const [providerID, fn] of Object.entries(CUSTOM_LOADERS)) {
      if (disabled.has(providerID)) continue
      const data = database[providerID]
      if (!data) {
        log.error("Provider does not exist in model list " + providerID)
        continue
      }
      const result = await fn(data)
      if (result && (result.autoload || providers[providerID])) {
        if (result.getModel) modelLoaders[providerID] = result.getModel
        const opts = result.options ?? {}
        const patch: Partial<Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
        mergeProvider(providerID, patch)
      }
    }

    // load config
    for (const [providerID, provider] of configProviders) {
      // 内置测试 provider 标记为 custom（与 hexin 内置 provider 一致）；
      // 这里是最终落到 `providers` 的 source,需与上面 database 阶段保持一致。
      const partial: Partial<Info> = {
        source: providerID in BUILTIN_TEST_PROVIDERS ? "custom" : "config",
      }
      if (provider.env) partial.env = provider.env
      if (provider.name) partial.name = provider.name
      if (provider.options) partial.options = provider.options
      mergeProvider(providerID, partial)
    }

    for (const [providerID, provider] of entries(providers)) {
      if (!isProviderAllowed(providerID)) {
        delete providers[providerID]
        continue
      }

      const configProvider = config.provider?.[providerID]

      for (const [modelID, model] of Object.entries(provider.models)) {
        model.api.id = model.api.id ?? model.id ?? modelID
        if (modelID === "gpt-5-chat-latest" || (providerID === "openrouter" && modelID === "openai/gpt-5-chat"))
          delete provider.models[modelID]
        if (model.status === "alpha" && !Flag.OPENCORVUS_ENABLE_EXPERIMENTAL_MODELS) delete provider.models[modelID]
        if (model.status === "deprecated") delete provider.models[modelID]
        if (
          (configProvider?.blacklist && configProvider.blacklist.includes(modelID)) ||
          (configProvider?.whitelist && !configProvider.whitelist.includes(modelID))
        )
          delete provider.models[modelID]

        model.variants = mapValues(ProviderTransform.variants(model), (v) => v)

        // Filter out disabled variants from config
        const configVariants = configProvider?.models?.[modelID]?.variants
        if (configVariants && model.variants) {
          const merged = mergeDeep(model.variants, configVariants) as Record<
            string,
            Record<string, unknown> & { disabled?: boolean }
          >
          model.variants = mapValues(
            pickBy(merged, (v) => !v.disabled),
            (v) => omit(v, ["disabled"]),
          )
        }
      }

      if (Object.keys(provider.models).length === 0) {
        delete providers[providerID]
        continue
      }

      log.info("found", { providerID })
    }

    return {
      models: languages,
      providers,
      database,
      sdk,
      modelLoaders,
    }
  })

  export function reset() {
    ;(state as any).reset()
  }

  export function resetAll() {
    ;(state as any).resetAll()
  }

  /** Re-fetch the hexin /v1/models list bypassing cache, then reset provider state. */
  export async function refreshHexin(): Promise<string[]> {
    const { refreshHexinCache } = await import("./hexin-discovery")
    const cfg = await Config.get()
    const apiKey = await hexinApiKey(cfg)
    const models = await refreshHexinCache(apiKey)
    reset()
    return Object.keys(models)
  }

  export async function list() {
    return state().then((state) => state.providers)
  }

  /**
   * Returns the augmented provider database — modelsDev entries plus any
   * built-in providers we register (e.g. hexin). Use this when you need the
   * full discoverable provider catalog (e.g. UI selectors that show
   * "API key required" for unconfigured providers); use list() when you only
   * want providers with actual credentials.
   */
  export async function database() {
    return state().then((state) => state.database)
  }

  async function getSDK(model: Model) {
    try {
      using _ = log.time("getSDK", {
        providerID: model.providerID,
      })
      const s = await state()
      const provider = s.providers[model.providerID]
      const options = { ...provider.options }
      if (options["apiKey"] === undefined && provider.key) options["apiKey"] = provider.key
      applyProviderPolicy(model.providerID, options)

      if (model.providerID === "google-vertex" && !model.api.npm.includes("@ai-sdk/openai-compatible")) {
        delete options.fetch
      }

      if (model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
        options["includeUsage"] = true
      }

      const baseURL = loadBaseURL(model, options)
      if (baseURL !== undefined) options["baseURL"] = baseURL
      if (model.headers)
        options["headers"] = {
          ...options["headers"],
          ...model.headers,
        }

      const key = Bun.hash.xxHash32(JSON.stringify({ providerID: model.providerID, npm: model.api.npm, options }))
      const existing = s.sdk.get(key)
      if (existing) return existing

      const customFetch = options["fetch"]

      options["fetch"] = async (input: any, init?: BunFetchRequestInit) => {
        // Preserve custom fetch if it exists, wrap it with timeout logic
        const fetchFn = customFetch ?? fetch
        const opts = init ?? {}

        // Stable providers retain the 5min minimum for long model thinking.
        // alibaba-coding-plan-cn is documented to hang during peak hours, so
        // it is clamped fail-fast and never burns the orchestrator for 5min.
        const inactivityMs = resolveFetchInactivityMs(model.providerID, options["timeout"])

        // Inactivity-based abort: fires if no activity for the configured period.
        // The timer starts NOW (covers the initial connection phase) and resets
        // on every streaming chunk. This handles both:
        // - Server hangs before sending any response (initial connect timeout)
        // - Server stops sending data mid-stream (stream stall timeout)
        const inactivityController = inactivityMs > 0 ? new AbortController() : undefined
        let inactivityTimer: ReturnType<typeof setTimeout> | undefined
        const resetInactivityTimer = inactivityController
          ? () => {
              if (inactivityTimer) clearTimeout(inactivityTimer)
              inactivityTimer = setTimeout(() => {
                log.warn("fetch inactivity timeout — no data for configured period, aborting", {
                  providerID: model.providerID,
                  inactivityMs,
                })
                inactivityController!.abort()
              }, inactivityMs)
            }
          : undefined

        if (inactivityController) {
          const signals: AbortSignal[] = []
          if (opts.signal) signals.push(opts.signal)
          signals.push(inactivityController.signal)
          opts.signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0]
        }

        // Start the inactivity timer BEFORE fetch — covers initial connection hang
        resetInactivityTimer?.()

        // Strip openai itemId metadata following what codex does
        // Codex uses #[serde(skip_serializing)] on id fields for all item types:
        // Message, Reasoning, FunctionCall, LocalShellCall, CustomToolCall, WebSearchCall
        // IDs are only re-attached for Azure with store=true
        if (model.api.npm === "@ai-sdk/openai" && opts.body && opts.method === "POST") {
          const body = JSON.parse(opts.body as string)
          const isAzure = model.providerID.includes("azure")
          const keepIds = isAzure && body.store === true
          if (!keepIds && Array.isArray(body.input)) {
            for (const item of body.input) {
              if ("id" in item) {
                delete item.id
              }
            }
            opts.body = JSON.stringify(body)
          }
        }

        if (
          ProviderTransform.shouldNormalizeRequestBody(model.providerID, model.api.npm) &&
          opts.body &&
          opts.method === "POST"
        ) {
          const body = JSON.parse(opts.body as string)
          const normalized = ProviderTransform.requestBody(model.providerID, body)
          if (normalized !== body) opts.body = JSON.stringify(normalized)
        }

        const response = await fetchFn(input, {
          ...opts,
          // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
          timeout: false,
        })

        // Response received — reset timer (server is alive)
        resetInactivityTimer?.()

        // Some SDKs (e.g. @ai-sdk/openai-compatible) do not surface HTTP
        // errors from streaming responses — they silently consume the body
        // and later throw a generic "No output generated" error.  Extract
        // the upstream error here so callers get actionable messages.
        //
        // We throw an APICallError (not a plain Error) so:
        //   1. Message.fromError takes the APICallError branch and produces a
        //      Message.APIError with statusCode/isRetryable preserved
        //      (instead of falling through to NamedError.Unknown which loses
        //      the status and is treated as fatal).
        //   2. SessionRetry.retryable / llm/api.ts retryable() classify
        //      transient 408/429/5xx as retryable via the standard AI SDK
        //      contract, so the session loop backs off and retries instead
        //      of bubbling the failure up to the orchestrator stream-error
        //      path. Without this, an alibaba 429 rate-limit blew up the
        //      orchestrator into an "unknown session error" wake loop —
        //      see _session-20260428-130617.out incident.
        if (!response.ok) {
          if (inactivityTimer) clearTimeout(inactivityTimer)
          const text = await response.text().catch(() => "")
          let detail = ""
          try {
            const json = JSON.parse(text)
            detail = json?.error?.message ?? json?.message ?? text
          } catch {
            detail = text
          }
          const responseHeaders: Record<string, string> = {}
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value
          })
          let requestBodyValues: unknown = undefined
          if (typeof opts.body === "string") {
            try {
              requestBodyValues = JSON.parse(opts.body)
            } catch {
              requestBodyValues = opts.body
            }
          }
          // fetch accepts string | URL | Request; URL has .href, Request has .url
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input?.url ?? "")
          throw new APICallError({
            message: `Provider ${model.providerID} returned HTTP ${response.status}: ${detail || response.statusText}`,
            url,
            requestBodyValues,
            statusCode: response.status,
            responseHeaders,
            responseBody: text,
          })
        }

        // For streaming responses, wrap the body so each chunk resets the timer.
        if (inactivityController && response.body) {
          const original = response.body
          const wrapped = original.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                resetInactivityTimer!()
                controller.enqueue(chunk)
              },
              flush() {
                if (inactivityTimer) clearTimeout(inactivityTimer)
              },
            }),
          )

          // Return a new Response with the wrapped body, preserving headers/status
          return new Response(wrapped, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          })
        }

        // Non-streaming response — clear the inactivity timer
        if (inactivityTimer) clearTimeout(inactivityTimer)
        return response
      }

      const bundledFn = BUNDLED_PROVIDERS[model.api.npm]
      if (bundledFn) {
        log.info("using bundled provider", { providerID: model.providerID, pkg: model.api.npm })
        const loaded = bundledFn({
          name: model.providerID,
          ...options,
        })
        s.sdk.set(key, loaded)
        return loaded as LanguageModelProvider
      }

      let installedPath: string
      if (!model.api.npm.startsWith("file://")) {
        installedPath = await installProvider(model.api.npm, "latest")
      } else {
        installedPath = model.api.npm
      }

      const fn = await loadProviderModule(installedPath)
      const loaded = fn({
        name: model.providerID,
        ...options,
      })
      s.sdk.set(key, loaded)
      return loaded as LanguageModelProvider
    } catch (e) {
      throw new InitError({ providerID: model.providerID }, { cause: e })
    }
  }

  export async function getProvider(providerID: string) {
    return state().then((s) => s.providers[providerID])
  }

  export async function getModel(providerID: string, modelID: string) {
    let s = await state()
    const provider = s.providers[providerID]
    if (!provider) {
      const availableProviders = Object.keys(s.providers)
      const matches = fuzzysort.go(providerID, availableProviders, { limit: 3, threshold: -10000 })
      const suggestions = matches.map((m) => m.target)
      throw new ModelNotFoundError({ providerID, modelID, suggestions })
    }

    let info = provider.models[modelID]
    let refreshedModels: Record<string, Model> | undefined
    if (!info && providerID === "hexin") {
      try {
        const { refreshHexinCache } = await import("./hexin-discovery")
        const cfg = await Config.get()
        const apiKey = await hexinApiKey(cfg)
        refreshedModels = await refreshHexinCache(apiKey)
        reset()
        info = refreshedModels[modelID]
      } catch (error) {
        log.warn("hexin model miss refresh failed", {
          providerID,
          modelID,
          error,
        })
      }
    }

    if (!info) {
      const availableModels = Object.keys(refreshedModels ?? s.providers[providerID]?.models ?? provider.models)
      const matches = fuzzysort.go(modelID, availableModels, { limit: 3, threshold: -10000 })
      const suggestions = matches.map((m) => m.target)
      throw new ModelNotFoundError({ providerID, modelID, suggestions })
    }
    return info
  }

  export async function getLanguage(model: Model): Promise<LanguageModel> {
    const s = await state()
    const key = `${model.providerID}/${model.id}`
    if (s.models.has(key)) return s.models.get(key)!

    const provider = s.providers[model.providerID]
    const sdk = await getSDK(model)

    try {
      const language = s.modelLoaders[model.providerID]
        ? await s.modelLoaders[model.providerID](sdk, model.api.id, provider.options)
        : sdk.languageModel(model.api.id)
      s.models.set(key, language)
      return language
    } catch (e) {
      if (e instanceof NoSuchModelError)
        throw new ModelNotFoundError(
          {
            modelID: model.id,
            providerID: model.providerID,
          },
          { cause: e },
        )
      throw e
    }
  }

  export async function closest(providerID: string, query: string[]) {
    const s = await state()
    const provider = s.providers[providerID]
    if (!provider) return undefined
    for (const item of query) {
      for (const modelID of Object.keys(provider.models)) {
        if (modelID.includes(item))
          return {
            providerID,
            modelID,
          }
      }
    }
  }

  export async function getSmallModel(providerID: string) {
    const cfg = await Config.get()

    if (cfg.small_model) {
      const parsed = parseModel(cfg.small_model)
      return getModel(parsed.providerID, parsed.modelID)
    }

    const provider = await state().then((state) => state.providers[providerID])
    if (provider) {
      const priority = smallModelPriority(providerID)
      for (const item of priority) {
        if (providerID === "amazon-bedrock") {
          const crossRegionPrefixes = ["global.", "us.", "eu."]
          const candidates = Object.keys(provider.models).filter((m) => m.includes(item))

          // Model selection priority:
          // 1. global. prefix (works everywhere)
          // 2. User's region prefix (us., eu.)
          // 3. Unprefixed model
          const globalMatch = candidates.find((m) => m.startsWith("global."))
          if (globalMatch) return getModel(providerID, globalMatch)

          const region = provider.options?.region
          if (region) {
            const regionPrefix = region.split("-")[0]
            if (regionPrefix === "us" || regionPrefix === "eu") {
              const regionalMatch = candidates.find((m) => m.startsWith(`${regionPrefix}.`))
              if (regionalMatch) return getModel(providerID, regionalMatch)
            }
          }

          const unprefixed = candidates.find((m) => !crossRegionPrefixes.some((p) => m.startsWith(p)))
          if (unprefixed) return getModel(providerID, unprefixed)
        } else {
          for (const model of Object.keys(provider.models)) {
            if (model.includes(item)) return getModel(providerID, model)
          }
        }
      }
    }

    // Check if opencorvus provider is available before using it
    const opencorvusProvider = await state().then((state) => state.providers["opencorvus"])
    if (opencorvusProvider && opencorvusProvider.models["gpt-5-nano"]) {
      return getModel("opencorvus", "gpt-5-nano")
    }

    return undefined
  }

  const priority = ["gpt-5", "claude-sonnet-4", "gemini-3-pro"]
  export function sort(models: Model[]) {
    return sortBy(
      models,
      [
        (model) =>
          priority.findIndex(
            (filter) => model.id === filter || model.id.startsWith(filter + "-") || model.id.startsWith(filter + "."),
          ),
        "desc",
      ],
      [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
      [(model) => model.id, "desc"],
    )
  }

  // Provider.defaultModel() was removed (spec §13.2, rule 8). It duplicated
  // `cfg.model → parseModel → throw` already owned by
  // agent/model.ts:resolveConfiguredModelRef, which is now THE single
  // configured-model entrypoint (and also applies session overlay). All
  // former callers funnel through resolveConfiguredModelRef / resolveAgentModel.

  export function parseModel(model: string) {
    return parseModelReference(model)
  }

  export const InvalidModelReferenceError = ProviderInvalidModelReferenceError

  export const ModelNotFoundError = NamedError.create(
    "ProviderModelNotFoundError",
    z.object({
      providerID: z.string(),
      modelID: z.string(),
      suggestions: z.array(z.string()).optional(),
    }),
  )

  // Provider.MissingModelConfigError removed with defaultModel() (spec §13.2,
  // rule 8). The single MissingModelConfigError lives in agent/model.ts;
  // its NamedError name string is unchanged so name-based handling still works.

  export const InitError = NamedError.create(
    "ProviderInitError",
    z.object({
      providerID: z.string(),
    }),
  )
}
