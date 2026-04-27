/**
 * Hexin OpenAI Gateway — dynamic model discovery with 24h cache.
 *
 * Flow:
 *   - Read cache at Global.Path.cache/hexin-models.json
 *   - If fresh (<24h) → use cache
 *   - Otherwise → GET /v1/models, write cache
 *   - On fetch failure with existing (stale) cache → use stale + warn
 *   - On fetch failure with no cache → throw (caller decides whether to skip hexin)
 *
 * Gateway only exposes {id, object, created, owned_by}. Capability shape
 * is assigned by hexin-profiles.ts.
 */
import path from "path"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import type { Provider as ProviderNS } from "./provider"
import { profileFor } from "./hexin-profiles"

const log = Log.create({ service: "hexin-discovery" })

export const HEXIN_GATEWAY_URL = "https://arsenal-openai.10jqka.com.cn:8443/ai-gateway/v1"
export const HEXIN_BUILTIN_KEY = "sk-eq7WQu0ylelH6uyedbf6PA"
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_FILE = "hexin-models.json"

type Model = ProviderNS.Model

interface CacheShape {
  fetched: number
  ids: string[]
}

function cachePath(): string {
  return path.join(Global.Path.cache, CACHE_FILE)
}

async function readCache(): Promise<CacheShape | undefined> {
  try {
    const raw = await Filesystem.readJson<CacheShape>(cachePath())
    if (!raw || typeof raw.fetched !== "number" || !Array.isArray(raw.ids)) return undefined
    return raw
  } catch {
    return undefined
  }
}

async function writeCache(ids: string[]): Promise<void> {
  await Filesystem.writeJson(cachePath(), { fetched: Date.now(), ids } satisfies CacheShape, 0o600)
}

async function fetchModelIDs(apiKey: string): Promise<string[]> {
  const url = `${HEXIN_GATEWAY_URL}/models`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 15_000)
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: ac.signal,
    })
    if (!response.ok) {
      throw new Error(`hexin /models HTTP ${response.status}: ${await response.text().catch(() => "")}`)
    }
    const body = (await response.json()) as { data?: Array<{ id: string }> }
    if (!body.data || !Array.isArray(body.data)) {
      throw new Error(`hexin /models response missing .data array`)
    }
    return body.data.map((m) => m.id).filter((x): x is string => typeof x === "string" && x.length > 0)
  } finally {
    clearTimeout(timer)
  }
}

function buildModel(id: string): Model {
  const profile = profileFor(id)
  return {
    id,
    providerID: "hexin",
    name: profile.name || id,
    family: profile.family,
    api: {
      id,
      url: HEXIN_GATEWAY_URL,
      npm: "@ai-sdk/openai-compatible",
    },
    status: "active",
    capabilities: {
      temperature: true,
      reasoning: profile.reasoning,
      attachment: profile.attachment,
      toolcall: profile.toolcall,
      input: {
        text: true,
        audio: false,
        image: profile.image_in,
        video: false,
        pdf: profile.pdf_in,
      },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: profile.context, input: profile.input, output: profile.output },
    options: {},
    headers: {},
    release_date: "",
    variants: {},
  }
}

export interface DiscoveryOptions {
  force?: boolean
}

/**
 * Returns { modelID → Model } for the hexin provider.
 *
 * Honors cache unless force:true. On network failure with a cache present,
 * returns the cached set with a warn log. Throws only if there is no cache
 * AND the gateway is unreachable.
 */
export async function discoverHexinModels(
  opts: DiscoveryOptions = {},
): Promise<Record<string, Model>> {
  const cached = await readCache()
  const now = Date.now()
  const fresh = cached && now - cached.fetched < CACHE_TTL_MS

  if (!opts.force && fresh) {
    log.info("using fresh hexin model cache", { count: cached!.ids.length, age_ms: now - cached!.fetched })
    return toModelMap(cached!.ids)
  }

  const apiKey = process.env.HEXIN_API_KEY?.trim() || HEXIN_BUILTIN_KEY

  try {
    const ids = await fetchModelIDs(apiKey)
    if (ids.length === 0) {
      throw new Error("hexin /models returned empty list")
    }
    await writeCache(ids)
    log.info("fetched hexin models", { count: ids.length })
    return toModelMap(ids)
  } catch (err) {
    if (cached) {
      log.warn("hexin /models fetch failed, using stale cache", {
        error: err instanceof Error ? err.message : String(err),
        cache_age_ms: now - cached.fetched,
        count: cached.ids.length,
      })
      return toModelMap(cached.ids)
    }
    throw err
  }
}

function toModelMap(ids: string[]): Record<string, Model> {
  const out: Record<string, Model> = {}
  for (const id of ids) out[id] = buildModel(id)
  return out
}

/** Exposed so UI can trigger a refresh without restarting the process. */
export async function refreshHexinCache(): Promise<Record<string, Model>> {
  return discoverHexinModels({ force: true })
}
