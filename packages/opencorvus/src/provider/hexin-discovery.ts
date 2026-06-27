/**
 * Hexin OpenAI Gateway — explicit model discovery.
 *
 * There is one catalog source for Hexin models: the provider catalog loaded by
 * ModelsDev.get(), after ModelsDev.withLocalProviders() normalizes Hexin
 * capability metadata through hexin-profiles.ts.
 *
 * The only live path here is explicit refresh (UI button, route, or CLI
 * command). It fetches /v1/models, writes the models.dev cache through
 * ModelsDev.refreshHexinProvider(), and throws on any upstream failure so the
 * operator sees the real error. Provider startup and Provider.getModel() never
 * call this module to repair or replace the catalog.
 *
 * The /models endpoint only exposes {id, object, created, owned_by}.
 * Capability shape is assigned by hexin-profiles.ts during catalog
 * normalization from exact probes and /model/info metadata.
 */
import { Log } from "../util/log"
import type { Provider as ProviderNS } from "./provider"
import { ModelsDev } from "./models"
import { profileFor } from "./hexin-profiles"

const log = Log.create({ service: "hexin-discovery" })

export const HEXIN_GATEWAY_URL = ModelsDev.HEXIN_GATEWAY_URL

type Model = ProviderNS.Model

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
 * Normal reads use the provider catalog from ModelsDev. Forced reads are the
 * explicit refresh path: they hit /v1/models live, write the models.dev cache,
 * and throw on any failure so the refresh button / CLI surfaces the upstream
 * error verbatim.
 */
export async function discoverHexinModels(opts: DiscoveryOptions = {}): Promise<Record<string, Model>> {
  if (!opts.force) {
    const provider = (await ModelsDev.get()).hexin
    return toModelMap(Object.keys(provider?.models ?? {}))
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
  await ModelsDev.refreshHexinProvider(ids)
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
