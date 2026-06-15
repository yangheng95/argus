import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import z from "zod"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "../util/filesystem"
import { profileFor } from "./hexin-profiles"

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  const filepath = path.join(Global.Path.cache, "models.json")
  export const HEXIN_GATEWAY_URL = "https://aimemodeldev.myhexin.com/litellm/v1"
  const LOCAL_HEXIN_MODEL_IDS = [
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "kimi-k2.5",
    "kimi-k2.6",
    "kimi-k2.7-code",
    "glm-5",
    "glm-5.1",
    "openai/glm-5.1",
    "qwen3.7-max",
    "claude-sonnet-4-6-v2",
    "cy-claude-sonnet-4-6",
  ] as const

  const OPENCORVUS_API_URL = "https://api.opencorvus.ai/v1"
  const KILO_API_URL = "https://api.kilo.ai/api/gateway"

  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    release_date: z.string(),
    attachment: z.boolean(),
    reasoning: z.boolean(),
    temperature: z.boolean(),
    tool_call: z.boolean(),
    interleaved: z
      .union([
        z.literal(true),
        z
          .object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          })
          .strict(),
      ])
      .optional(),
    cost: z
      .object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
        context_over_200k: z
          .object({
            input: z.number(),
            output: z.number(),
            cache_read: z.number().optional(),
            cache_write: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    limit: z.object({
      context: z.number(),
      input: z.number().optional(),
      output: z.number(),
    }),
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      })
      .optional(),
    experimental: z.boolean().optional(),
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
    options: z.record(z.string(), z.any()),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.object({ npm: z.string().optional(), api: z.string().optional() }).optional(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })
  export type Model = z.infer<typeof Model>

  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()),
    id: z.string(),
    npm: z.string().optional(),
    models: z.record(z.string(), Model),
  })

  export type Provider = z.infer<typeof Provider>

  function hexinModel(id: string): Model {
    const profile = profileFor(id)
    const input: Array<"text" | "audio" | "image" | "video" | "pdf"> = ["text"]
    if (profile.image_in) input.push("image")
    if (profile.pdf_in) input.push("pdf")

    return {
      id,
      name: profile.name || id,
      family: profile.family,
      attachment: profile.attachment,
      reasoning: profile.reasoning,
      tool_call: profile.toolcall,
      temperature: profile.temperature ?? true,
      interleaved: profile.interleaved || undefined,
      release_date: "",
      modalities: {
        input,
        output: ["text"],
      },
      limit: {
        context: profile.context,
        input: profile.input,
        output: profile.output,
      },
      cost: {
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
      },
      options: {},
    }
  }

  function hexinProvider(input?: Provider): Provider {
    const ids = Object.keys(input?.models ?? {})
    const modelIDs = ids.length > 0 ? ids : Array.from(LOCAL_HEXIN_MODEL_IDS)
    const models = Object.fromEntries(modelIDs.map((id) => [id, hexinModel(id)]))
    return {
      id: "hexin",
      env: input?.env ?? ["HEXIN_API_KEY"],
      npm: "@ai-sdk/openai-compatible",
      api: HEXIN_GATEWAY_URL,
      name: input?.name ?? "Hexin OpenAI Gateway",
      models,
    }
  }

  function opencorvusModel(id: string): Model {
    return {
      id,
      name: id === "gpt-5-nano" ? "GPT-5 Nano" : id,
      family: "gpt-nano",
      attachment: true,
      reasoning: true,
      tool_call: true,
      temperature: false,
      release_date: "",
      modalities: {
        input: ["text", "image", "pdf"],
        output: ["text"],
      },
      limit: {
        context: 400_000,
        input: 272_000,
        output: 128_000,
      },
      cost: {
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
      },
      options: {},
    }
  }

  function opencorvusProvider(input?: Provider): Provider {
    const ids = Object.keys(input?.models ?? {})
    const modelIDs = ids.length > 0 ? ids : ["gpt-5-nano"]
    return {
      id: "opencorvus",
      env: input?.env ?? ["OPENCORVUS_API_KEY"],
      npm: "@ai-sdk/openai-compatible",
      api: input?.api ?? OPENCORVUS_API_URL,
      name: input?.name ?? "OpenCorvus",
      models: Object.fromEntries(modelIDs.map((id) => [id, input?.models?.[id] ?? opencorvusModel(id)])),
    }
  }

  function kiloModel(id: string): Model {
    return {
      id,
      name: id === "inclusionai/ling-2.6-1t" ? "inclusionAI: Ling-2.6-1T" : id,
      family: "ling",
      attachment: false,
      reasoning: false,
      tool_call: true,
      temperature: true,
      release_date: "2026-04-23",
      modalities: {
        input: ["text"],
        output: ["text"],
      },
      limit: {
        context: 262_144,
        output: 32_768,
      },
      cost: {
        input: 0.3,
        output: 2.5,
        cache_read: 0.06,
      },
      options: {},
    }
  }

  function kiloProvider(input?: Provider): Provider {
    const ids = Object.keys(input?.models ?? {})
    const modelIDs = ids.length > 0 ? ids : ["inclusionai/ling-2.6-1t"]
    return {
      id: "kilo",
      env: input?.env ?? ["KILO_API_KEY"],
      npm: "@ai-sdk/openai-compatible",
      api: input?.api ?? KILO_API_URL,
      name: input?.name ?? "Kilo Gateway",
      models: Object.fromEntries(modelIDs.map((id) => [id, input?.models?.[id] ?? kiloModel(id)])),
    }
  }

  export function withLocalProviders(input: Record<string, Provider>): Record<string, Provider> {
    return {
      ...input,
      hexin: hexinProvider(input.hexin),
      opencorvus: opencorvusProvider(input.opencorvus),
      kilo: kiloProvider(input.kilo),
    }
  }

  function url() {
    return Flag.OPENCORVUS_MODELS_URL || "https://models.dev"
  }

  // Catalog resolution is strictly offline-first:
  //   1. the per-instance cache (./models.json) populated by the most recent
  //      explicit refresh,
  //   2. user-supplied JSON at OPENCORVUS_MODELS_PATH,
  //   3. the snapshot embedded at build time (script/build.ts pulls from
  //      models.dev once during the matrix build and writes
  //      provider/models-snapshot.ts),
  //   4. empty record — never silently network-fetch.
  // This resolver previously performed an implicit `fetch(models.dev/api.json)`
  // plus a top-level auto-refresh + hourly setInterval; both removed so
  // every outbound network call to the registry is the result of an
  // explicit `refresh()` invocation (UI button, CLI `models --refresh`,
  // POST /provider/refresh). This avoids surprise traffic on `serve`
  // startup, makes air-gapped deployments correct by default, and keeps
  // the catalog deterministic for the duration of a process.
  export const Data = lazy(async () => {
    const cached = await Filesystem.readJson(filepath).catch(() => {})
    if (cached) return withLocalProviders(cached as Record<string, Provider>)
    const result = Flag.OPENCORVUS_MODELS_PATH
      ? await Filesystem.readJson(Flag.OPENCORVUS_MODELS_PATH).catch(() => {})
      : undefined
    if (result) return withLocalProviders(result as Record<string, Provider>)
    // Try to import bundled snapshot (generated at build time). It is
    // gitignored in dev worktrees, so the empty tier keeps development
    // worktrees deterministic when no snapshot is present.
    // @ts-ignore models-snapshot.ts is generated by build.ts.
    const snapshot = await import("./models-snapshot")
      .then((m) => m.snapshot as Record<string, unknown>)
      .catch(() => undefined)
    if (snapshot) return withLocalProviders(snapshot as Record<string, Provider>)
    return withLocalProviders({})
  })

  export async function get() {
    const result = await Data()
    return result as Record<string, Provider>
  }

  /**
   * Pull a fresh registry snapshot from the configured URL and persist it
   * to the per-instance cache. Returns `{ ok: true, fetchedAt }` on a
   * successful update, otherwise `{ ok: false, error }`. Callers are the
   * UI button in ProvidersPanel, `opencorvus models --refresh`, and
   * `POST /provider/refresh` — there is no implicit invocation.
   */
  export async function refresh(): Promise<{ ok: true; fetchedAt: number } | { ok: false; error: string }> {
    try {
      const result = await fetch(`${url()}/api.json`, {
        headers: { "User-Agent": Installation.USER_AGENT },
        signal: AbortSignal.timeout(10 * 1000),
      })
      if (!result.ok) {
        const error = `${result.status} ${result.statusText}`
        log.error("registry refresh non-2xx", { error })
        return { ok: false, error }
      }
      await Filesystem.write(filepath, await result.text())
      ModelsDev.Data.reset()
      const fetchedAt = Date.now()
      log.info("registry refreshed", { fetchedAt })
      return { ok: true, fetchedAt }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      log.error("registry refresh failed", { error })
      return { ok: false, error }
    }
  }

  export async function refreshHexinProvider(ids: string[]): Promise<Provider> {
    const provider = hexinProvider({
      id: "hexin",
      env: ["HEXIN_API_KEY"],
      npm: "@ai-sdk/openai-compatible",
      api: HEXIN_GATEWAY_URL,
      name: "Hexin OpenAI Gateway",
      models: Object.fromEntries(ids.map((id) => [id, hexinModel(id)])),
    })
    const current = await get()
    await Filesystem.writeJson(filepath, withLocalProviders({ ...current, hexin: provider }), 0o600)
    ModelsDev.Data.reset()
    return provider
  }
}
