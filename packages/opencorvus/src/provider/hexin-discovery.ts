/**
 * Hexin OpenAI Gateway — explicit model discovery with cache.
 *
 * Two distinct entry points with *different* failure semantics and
 * *different* credential sources — do not collapse them, callers depend
 * on the split:
 *
 *   1. discoverHexinModels({ force?: boolean }) / refreshHexinCache
 *      — user-initiated (UI refresh button, CLI refresh command, explicit
 *      Provider.refreshHexin). force:true performs a live /v1/models call
 *      and writes the cache on success; any HTTP / network / parse failure
 *      throws so the operator sees the upstream error verbatim. force:true
 *      requires `opts.apiKey` to be supplied — throws `HEXIN_API_KEY unset`
 *      otherwise. We never consult process.env here because that would let
 *      Provider.refreshHexin (called inside an Instance) silently fall
 *      through to raw env when hexinApiKey(cfg) returned "" because
 *      Env.remove masked the per-instance shim. Direct unit/CLI callers
 *      that want env-derived behavior must pass
 *      `apiKey: process.env.HEXIN_API_KEY` themselves. force:false (the
 *      default) only reads the cache and returns {} when none exists.
 *
 *   2. discoverHexinModelsForStartup({ apiKey? })
 *      — invoked during Provider.state() lazy init. Tries a live fetch only
 *      when opts.apiKey is non-empty, falls back to the on-disk cache when
 *      the live call fails or no key was supplied, and finally falls back
 *      to an empty map. NEVER throws: hexin upstream errors (e.g. budget
 *      exceeded, 401, network) must not reject the global provider state,
 *      because that would 500 /config/providers and remove every other
 *      provider from the Settings UI, locking the operator out of switching
 *      keys or disabling hexin. Returns { models, source, error? } so the
 *      caller can log the failure (no UI contract is added in this PR —
 *      Provider.Info has no error field today; the catalog route is the
 *      operator's path back to hexin).
 *
 *      Note: this helper deliberately does NOT consult process.env directly.
 *      The canonical key is resolved at the Provider.state() boundary by
 *      hexinApiKey(config), which goes through the per-Instance Env shim
 *      (Env.get reads a per-instance shallow copy of process.env so tests
 *      and concurrent instances can mask vars independently). Reading
 *      process.env from inside this helper would re-introduce a parallel
 *      credential source and defeat that isolation (rule 8).
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

export const HEXIN_GATEWAY_URL = "https://aimemodeldev.myhexin.com/litellm/v1"
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
      temperature: profile.temperature ?? true,
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
      interleaved: profile.interleaved ?? false,
    },
    transform: profile.transform,
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
  apiKey?: string
}

/**
 * Returns { modelID → Model } for the hexin provider.
 *
 * User-initiated entry. Normal reads (force:false) only consult the cache.
 * Forced reads hit /v1/models live and throw on any failure so the refresh
 * button / CLI surfaces the upstream error verbatim. Callers that need a
 * non-throwing path (provider startup) must use
 * {@link discoverHexinModelsForStartup} instead.
 */
export async function discoverHexinModels(opts: DiscoveryOptions = {}): Promise<Record<string, Model>> {
  const cached = await readCache()
  const now = Date.now()

  if (!opts.force) {
    if (cached) {
      log.info("using cached hexin model list", { count: cached.ids.length, age_ms: now - cached.fetched })
      return toModelMap(cached.ids)
    }
    log.warn("hexin model cache missing — registering hexin with empty model list until explicit refresh")
    return {}
  }

  // Caller MUST supply the key explicitly. We do not consult process.env
  // here — that would let provider-layer refresh (Provider.refreshHexin)
  // silently fall through to raw env when hexinApiKey(cfg) returned "" due
  // to Env.remove masking the per-instance shim, defeating Env's isolation
  // (rule 8). Direct unit/CLI callers that want env-derived behavior must
  // pass `apiKey: process.env.HEXIN_API_KEY` themselves.
  const apiKey = opts.apiKey?.trim()
  if (!apiKey) {
    throw new Error("HEXIN_API_KEY unset")
  }

  const ids = await fetchModelIDs(apiKey)
  if (ids.length === 0) {
    throw new Error("hexin /models returned empty list")
  }
  await writeCache(ids)
  log.info("fetched hexin models", { count: ids.length })
  return toModelMap(ids)
}

function toModelMap(ids: string[]): Record<string, Model> {
  const out: Record<string, Model> = {}
  for (const id of ids) out[id] = buildModel(id)
  return out
}

/** Exposed so UI can trigger a refresh without restarting the process. */
export async function refreshHexinCache(apiKey?: string): Promise<Record<string, Model>> {
  return discoverHexinModels({ force: true, apiKey })
}

/**
 * Outcome of {@link discoverHexinModelsForStartup}. `source` records which
 * tier produced the model list — log metadata only, not driver state.
 *
 *   - `live`   — fetched fresh from /v1/models, cache rewritten.
 *   - `cache`  — live fetch failed (or no key supplied) and the on-disk
 *                cache provided a fallback list.
 *   - `empty`  — no key + no cache, or live fetch failed with no cache.
 *                Provider is still registered but with zero models.
 *
 * `error` is set when the live fetch was attempted and threw, regardless of
 * whether cache fallback succeeded. Callers should log it. The error is NOT
 * propagated to Provider.Info today: /config/providers has no contract for
 * per-provider error state. Operators recover via the catalog route
 * (/provider, sourced from Provider.database()) and the hexin refresh button.
 */
export interface StartupDiscoveryOutcome {
  models: Record<string, Model>
  source: "live" | "cache" | "empty"
  error?: Error
}

export interface StartupDiscoveryOptions {
  /**
   * Hexin API key resolved at the Provider.state() boundary via hexinApiKey().
   * The startup helper trusts this value as the only credential source — it
   * does NOT consult process.env. See module header for the rationale.
   */
  apiKey?: string
}

/**
 * Non-throwing discovery for Provider.state() lazy init.
 *
 * Resolution order:
 *   1. If opts.apiKey is non-empty, attempt /v1/models. On success write the
 *      cache and return source:"live".
 *   2. On live failure (or no key supplied), fall back to the on-disk cache
 *      when present and return source:"cache" (with `error` set if a live
 *      attempt was made and threw).
 *   3. Otherwise return source:"empty" — hexin is still registered in the
 *      database, but with zero models. The operator can recover by pasting
 *      a key from the /provider catalog UI and hitting the refresh button.
 *
 * This function MUST NOT throw. A single provider's upstream outage (budget
 * exceeded, 401, DNS) must not cascade into a global Provider.list reject —
 * that would 500 /config/providers and hide every other provider from the
 * Settings UI, leaving the operator no way to switch keys or disable hexin.
 */
export async function discoverHexinModelsForStartup(
  opts: StartupDiscoveryOptions = {},
): Promise<StartupDiscoveryOutcome> {
  // Trust opts.apiKey as the single credential source. The state() boundary
  // is responsible for going through Env (per-instance shim) + Auth + Config
  // before calling us; reading process.env here would defeat that isolation.
  const apiKey = opts.apiKey?.trim()
  const cached = await readCache()

  if (apiKey) {
    try {
      const ids = await fetchModelIDs(apiKey)
      if (ids.length === 0) {
        throw new Error("hexin /models returned empty list")
      }
      await writeCache(ids)
      log.info("fetched hexin models on startup", { count: ids.length })
      return { models: toModelMap(ids), source: "live" }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      if (cached) {
        log.warn("hexin live discovery failed on startup — falling back to cached model list", {
          error: error.message,
          cached: cached.ids.length,
          age_ms: Date.now() - cached.fetched,
        })
        return { models: toModelMap(cached.ids), source: "cache", error }
      }
      log.warn("hexin live discovery failed on startup and no cache exists — registering empty model list", {
        error: error.message,
      })
      return { models: {}, source: "empty", error }
    }
  }

  if (cached) {
    log.info("hexin startup: no key configured, using cached model list", {
      count: cached.ids.length,
      age_ms: Date.now() - cached.fetched,
    })
    return { models: toModelMap(cached.ids), source: "cache" }
  }

  log.info("hexin startup: no key + no cache, registering empty model list")
  return { models: {}, source: "empty" }
}
