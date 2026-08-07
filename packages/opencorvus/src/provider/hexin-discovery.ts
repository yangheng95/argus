/**
 * Hexin OpenAI Gateway — explicit model discovery.
 *
 * There is one catalog source for Hexin models: the provider catalog loaded by
 * ModelsDev.get(), after ModelsDev.withLocalProviders() normalizes Hexin
 * capability metadata through hexin-profiles.ts.
 *
 * The only live path here is explicit refresh (UI button, route, or CLI
 * command). It fetches /v1/models and /v1/model/info, writes the models.dev cache through
 * ModelsDev.refreshHexinProvider(), and throws on malformed or failed upstream responses so the
 * operator sees the real error. Provider startup and Provider.getModel() never
 * call this module to repair or replace the catalog.
 *
 * The /models endpoint only exposes {id, object, created, owned_by}.
 * Behavioral capability shape is assigned by hexin-profiles.ts; context and
 * output limits use /model/info metadata when a matching row exists. A model
 * identity reported by /models without an enrichment row uses the canonical
 * defaults rather than invalidating the whole refresh.
 */
import { Log } from "../util/log"
import { ModelsDev } from "./models"
import { profileFor } from "./hexin-profiles"
import type { ProviderModel } from "./model-schema"
import { fetchHexinEndpoint } from "./hexin-endpoint"

const log = Log.create({ service: "hexin-discovery" })

export const HEXIN_GATEWAY_URL = ModelsDev.HEXIN_GATEWAY_URL

type Model = ProviderModel

async function fetchGatewayJSON(apiKey: string, path: "models" | "model/info"): Promise<unknown> {
  const url = `${HEXIN_GATEWAY_URL}/${path}`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 15_000)
  try {
    const response = await fetchHexinEndpoint(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: ac.signal,
    })
    if (!response.ok) {
      throw new Error(`hexin /${path} HTTP ${response.status}: ${await response.text().catch(() => "")}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchModelIDs(apiKey: string): Promise<string[]> {
  const body = (await fetchGatewayJSON(apiKey, "models")) as { data?: Array<{ id: string }> }
  if (!body.data || !Array.isArray(body.data)) throw new Error("hexin /models response missing .data array")
  return body.data.map((model) => model.id).filter((id): id is string => typeof id === "string" && id.length > 0)
}

interface HexinModelInfoRow {
  model_info?: {
    key?: unknown
    max_input_tokens?: unknown
    max_output_tokens?: unknown
  }
}

function positiveInteger(value: unknown, field: string, modelID: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`hexin /model/info ${field} for ${modelID} must be a positive integer`)
  }
  return value
}

/** Convert exact model_info.key rows into the only persisted Hexin limit map. */
export function parseHexinModelInfoLimits(
  modelIDs: readonly string[],
  body: unknown,
): Record<string, ModelsDev.HexinModelLimits> {
  const rows = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(rows)) throw new Error("hexin /model/info response missing .data array")

  const requested = new Set(modelIDs)
  const reported = new Map<string, { input?: number; output?: number }>()
  for (const candidate of rows) {
    if (!candidate || typeof candidate !== "object") continue
    const info = (candidate as HexinModelInfoRow).model_info
    const key = typeof info?.key === "string" ? info.key.trim() : ""
    if (!key || !requested.has(key)) continue
    const next = {
      input: positiveInteger(info?.max_input_tokens, "max_input_tokens", key),
      output: positiveInteger(info?.max_output_tokens, "max_output_tokens", key),
    }
    const current = reported.get(key)
    if (current) {
      if (current.input !== undefined && next.input !== undefined && current.input !== next.input) {
        throw new Error(`hexin /model/info has conflicting max_input_tokens for ${key}`)
      }
      if (current.output !== undefined && next.output !== undefined && current.output !== next.output) {
        throw new Error(`hexin /model/info has conflicting max_output_tokens for ${key}`)
      }
      reported.set(key, { input: current.input ?? next.input, output: current.output ?? next.output })
      continue
    }
    reported.set(key, next)
  }

  const limits: Record<string, ModelsDev.HexinModelLimits> = {}
  for (const id of modelIDs) {
    const metadata = reported.get(id)
    limits[id] = {
      context: metadata?.input ?? ModelsDev.HEXIN_DEFAULT_CONTEXT_LIMIT,
      ...(metadata?.input !== undefined ? { input: metadata.input } : {}),
      output: metadata?.output ?? 0,
    }
  }
  return limits
}

async function fetchModelLimits(
  apiKey: string,
  modelIDs: readonly string[],
): Promise<Record<string, ModelsDev.HexinModelLimits>> {
  return parseHexinModelInfoLimits(modelIDs, await fetchGatewayJSON(apiKey, "model/info"))
}

function buildModel(id: string, limit: ModelsDev.HexinModelLimits): Model {
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
    limit,
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
 * Normal reads use the provider catalog from ModelsDev. Forced reads are the
 * explicit refresh path: they hit /v1/models live, write the models.dev cache,
 * and throw on any failure so the refresh button / CLI surfaces the upstream
 * error verbatim.
 */
export async function discoverHexinModels(opts: DiscoveryOptions = {}): Promise<Record<string, Model>> {
  if (!opts.force) {
    const provider = (await ModelsDev.get()).hexin
    return toModelMap(provider?.models ?? {})
  }

  // Caller MUST supply the key explicitly. We do not consult process.env
  // here — that would let provider-layer refresh (Provider.refreshModels)
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
  const limits = await fetchModelLimits(apiKey, ids)
  const provider = await ModelsDev.refreshHexinProvider(limits)
  log.info("fetched hexin models", { count: ids.length })
  return toModelMap(provider.models)
}

function toModelMap(models: Record<string, ModelsDev.Model>): Record<string, Model> {
  const out: Record<string, Model> = {}
  for (const [id, model] of Object.entries(models)) out[id] = buildModel(id, model.limit)
  return out
}

/** Exposed so UI can trigger a refresh without restarting the process. */
export async function refreshHexinCache(apiKey?: string): Promise<Record<string, Model>> {
  return discoverHexinModels({ force: true, apiKey })
}
