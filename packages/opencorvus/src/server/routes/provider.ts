import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { streamText } from "../../llm/api"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { ProviderLLM } from "../../provider/llm"
import { Agent } from "../../agent/agent"
import { ModelsDev } from "../../provider/models"
import { ProviderAuth } from "../../provider/auth"
import { Auth } from "../../auth"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const HexinBudget = z
  .object({
    maxBudget: z.number(),
    spend: z.number(),
    remaining: z.number(),
    overBudget: z.boolean(),
  })
  .meta({ ref: "HexinBudget" })

const HexinBudgetResponse = z
  .discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      budget: HexinBudget,
    }),
    z.object({
      ok: z.literal(false),
      error: z.string(),
    }),
  ])
  .meta({ ref: "HexinBudgetResponse" })

const HexinBudgetUpstream = z.object({
  max_budget: z.number(),
  spend: z.number(),
  remaining: z.number(),
  over_budget: z.boolean(),
})

function hexinBudgetURL(): string {
  const url = new URL(ModelsDev.HEXIN_GATEWAY_URL)
  const parts = url.pathname.split("/").filter(Boolean)
  if (parts[parts.length - 1] !== "v1") {
    throw new Error("ModelsDev.HEXIN_GATEWAY_URL must end with /v1 to derive the Hexin budget endpoint")
  }
  parts[parts.length - 1] = "key"
  parts.push("budget")
  url.pathname = `/${parts.join("/")}`
  return url.toString()
}

function normalizeApiBaseURL(raw: string): string | undefined {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    url.hash = ""
    url.search = ""
    url.pathname = url.pathname.replace(/\/+$/, "") || "/"
    return url.toString()
  } catch {
    return undefined
  }
}

function providerAllowsSavedKey(provider: Provider.Info | undefined, requestedApi: string): boolean {
  if (!provider) return false
  const allowed = new Set<string>()
  for (const model of Object.values(provider.models)) {
    const normalized = normalizeApiBaseURL(model.api.url)
    if (normalized) allowed.add(normalized)
  }
  return allowed.has(requestedApi)
}

export const ProviderRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List providers",
        description: "Get a list of all available AI providers, including both available and connected ones.",
        operationId: "provider.list",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    all: Provider.Info.array(),
                    default: z.record(z.string(), z.string()),
                    connected: z.array(z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get()
        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

        // Sourced from the augmented provider database so built-ins
        // registered outside models.dev (hexin) are visible in the
        // catalog even when the operator has not configured a key.
        const allProviders = await Provider.database()
        const filteredProviders: Record<string, (typeof allProviders)[string]> = {}
        for (const [key, value] of Object.entries(allProviders)) {
          if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
            filteredProviders[key] = value
          }
        }

        const connected = await Provider.list()
        const providers = Object.assign(filteredProviders, connected)
        return c.json({
          all: Object.values(providers),
          default: Object.fromEntries(
            Object.entries(providers).flatMap(([k, item]) => {
              const first = Provider.sort(Object.values(item.models))[0]
              return first ? [[k, first.id]] : []
            }),
          ),
          connected: Object.keys(connected),
        })
      },
    )
    .get(
      "/auth",
      describeRoute({
        summary: "Get provider auth methods",
        description: "Retrieve available authentication methods for all AI providers.",
        operationId: "provider.auth",
        responses: {
          200: {
            description: "Provider auth methods",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.array(ProviderAuth.Method))),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await ProviderAuth.methods())
      },
    )
    .post(
      "/refresh",
      describeRoute({
        summary: "Refresh the models.dev registry snapshot",
        description:
          "Pulls api.json from the configured registry URL and persists it to the per-instance cache; subsequent provider/model lookups use the new data. The CLI runtime never refreshes implicitly — UI button, `opencorvus models --refresh`, and this route are the three explicit entry points.",
        operationId: "provider.refresh",
        responses: {
          200: {
            description: "Refresh outcome",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ok: z.boolean(),
                    fetchedAt: z.number().optional(),
                    error: z.string().optional(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const result = await ModelsDev.refresh()
        if (result.ok) {
          // Provider/Agent caches captured the old catalog; reset so the
          // refreshed list is visible to downstream callers immediately.
          Provider.reset()
          Agent.reset()
        }
        return c.json(result)
      },
    )
    .post(
      "/hexin/refresh",
      describeRoute({
        summary: "Refresh hexin gateway model list",
        description:
          "Force a re-fetch of the Hexin OpenAI Gateway /v1/models endpoint, bypassing the 24h cache, then reset provider state so downstream callers see the updated list.",
        operationId: "provider.hexin.refresh",
        responses: {
          200: {
            description: "Refresh result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ok: z.boolean(),
                    count: z.number(),
                    ids: z.array(z.string()),
                    error: z.string().optional(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        try {
          const ids = await Provider.refreshHexin()
          // Agent.state() captures the default haiku at construction — if the
          // hexin model list changed, reset so the injected default picks up
          // any renamed/removed haiku model on the next Agent.list() call.
          Agent.reset()
          return c.json({ ok: true, count: ids.length, ids })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return c.json({ ok: false, count: 0, ids: [], error: message })
        }
      },
    )
    .get(
      "/hexin/budget",
      describeRoute({
        summary: "Get hexin gateway key budget",
        description:
          "Fetch the Hexin LiteLLM key budget using the configured Hexin provider credential. This route never exposes the API key to the overlay.",
        operationId: "provider.hexin.budget",
        responses: {
          200: {
            description: "Hexin budget lookup result",
            content: {
              "application/json": {
                schema: resolver(HexinBudgetResponse),
              },
            },
          },
        },
      }),
      async (c) => {
        const apiKey = await Provider.resolveHexinApiKey(await Config.get())
        if (!apiKey) {
          return c.json({
            ok: false,
            error: "HEXIN_API_KEY unset",
          })
        }

        const url = hexinBudgetURL()
        try {
          const response = await fetch(url, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(15_000),
          })
          const text = await response.text()
          if (!response.ok) {
            return c.json({
              ok: false,
              error: `GET ${url} returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
            })
          }

          let parsed: unknown
          try {
            parsed = JSON.parse(text)
          } catch {
            return c.json({
              ok: false,
              error: `GET ${url} did not return JSON.`,
            })
          }

          const budget = HexinBudgetUpstream.safeParse(parsed)
          if (!budget.success) {
            return c.json({
              ok: false,
              error: `GET ${url} response must contain max_budget, spend, remaining, and over_budget.`,
            })
          }

          return c.json({
            ok: true,
            budget: {
              maxBudget: budget.data.max_budget,
              spend: budget.data.spend,
              remaining: budget.data.remaining,
              overBudget: budget.data.over_budget,
            },
          })
        } catch (error) {
          const message = (error instanceof Error ? error.message : String(error)).replaceAll(apiKey, "[redacted]")
          return c.json({
            ok: false,
            error: `GET ${url} failed: ${message}`,
          })
        }
      },
    )
    .post(
      "/discover-models",
      describeRoute({
        summary: "Discover OpenAI-compatible provider models",
        description:
          "Fetches the explicit OpenAI-compatible /models endpoint for a user-supplied base URL. This route only runs when requested by the operator; provider startup remains offline-first.",
        operationId: "provider.discover.models",
        responses: {
          200: {
            description: "Discovered model IDs",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ok: z.boolean(),
                    models: z.array(z.string()),
                    count: z.number(),
                    error: z.string().optional(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          api: z.string().min(1).meta({ description: "OpenAI-compatible base URL, usually ending in /v1" }),
          apiKey: z.string().optional().meta({ description: "Optional API key used as a Bearer token" }),
          providerID: z
            .string()
            .optional()
            .meta({ description: "Optional provider ID whose saved auth key may be used" }),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        let base: URL
        try {
          base = new URL(body.api.trim())
        } catch {
          return c.json(
            {
              ok: false,
              models: [],
              count: 0,
              error: "API URL must be an absolute http:// or https:// URL.",
            },
            400,
          )
        }
        if (base.protocol !== "http:" && base.protocol !== "https:") {
          return c.json(
            {
              ok: false,
              models: [],
              count: 0,
              error: "API URL must use http:// or https://.",
            },
            400,
          )
        }

        const explicitKey = body.apiKey?.trim()
        const savedAuth = body.providerID ? await Auth.get(body.providerID).catch(() => undefined) : undefined
        const savedKey = savedAuth?.type === "api" ? savedAuth.key.trim() : ""
        const requestedApi = normalizeApiBaseURL(body.api)
        if (!requestedApi) {
          return c.json(
            {
              ok: false,
              models: [],
              count: 0,
              error: "API URL must be an absolute http:// or https:// URL.",
            },
            400,
          )
        }
        if (!explicitKey && savedKey) {
          const provider = body.providerID ? await Provider.getProvider(body.providerID).catch(() => undefined) : undefined
          if (!providerAllowsSavedKey(provider, requestedApi)) {
            return c.json(
              {
                ok: false,
                models: [],
                count: 0,
                error: "Saved provider credentials can only be used with that provider's configured API URL.",
              },
              400,
            )
          }
        }
        const modelsURL = `${requestedApi.replace(/\/+$/, "")}/models`
        const apiKey = explicitKey || savedKey

        try {
          const response = await fetch(modelsURL, {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
            signal: AbortSignal.timeout(15_000),
          })
          const text = await response.text()
          if (!response.ok) {
            return c.json({
              ok: false,
              models: [],
              count: 0,
              error: `GET ${modelsURL} returned HTTP ${response.status}: ${text || response.statusText}`,
            })
          }
          let json: unknown
          try {
            json = JSON.parse(text)
          } catch {
            return c.json({
              ok: false,
              models: [],
              count: 0,
              error: `GET ${modelsURL} did not return JSON.`,
            })
          }
          const data = (json as { data?: unknown }).data
          if (!Array.isArray(data)) {
            return c.json({
              ok: false,
              models: [],
              count: 0,
              error: `GET ${modelsURL} response must contain a data array.`,
            })
          }
          const models = Array.from(
            new Set(
              data
                .map((item) => (item && typeof item === "object" ? (item as { id?: unknown }).id : undefined))
                .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
                .map((id) => id.trim()),
            ),
          ).sort((a, b) => a.localeCompare(b))
          if (models.length === 0) {
            return c.json({
              ok: false,
              models: [],
              count: 0,
              error: `GET ${modelsURL} returned no model ids.`,
            })
          }
          return c.json({ ok: true, models, count: models.length })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return c.json({
            ok: false,
            models: [],
            count: 0,
            error: `GET ${modelsURL} failed: ${message}`,
          })
        }
      },
    )
    .post(
      "/:providerID/test",
      describeRoute({
        summary: "Test provider connection",
        description: "Run a minimal live request against a provider using the selected or default model.",
        operationId: "provider.test",
        responses: {
          200: {
            description: "Provider test result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ok: z.boolean(),
                    status: z.enum(["connected", "error"]),
                    providerID: z.string(),
                    modelID: z.string(),
                    message: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z
          .object({
            modelID: z.string().optional(),
          })
          .optional(),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const body = c.req.valid("json") ?? {}
        const provider = await Provider.getProvider(providerID)
        if (!provider) {
          return c.json(
            {
              ok: false,
              status: "error",
              providerID,
              modelID: body.modelID ?? "",
              message: "Provider is not configured. Set API key or auth first.",
            },
            400,
          )
        }

        const modelID = body.modelID ?? Provider.sort(Object.values(provider.models))[0]?.id
        if (!modelID) {
          return c.json(
            {
              ok: false,
              status: "error",
              providerID,
              modelID: "",
              message: "Provider has no available models.",
            },
            400,
          )
        }

        try {
          const model = await Provider.getModel(providerID, modelID)
          const language = ProviderLLM.wrapModel(await Provider.getLanguage(model), model, {})
          const auth = await Auth.get(providerID)
          const isCodexOauth = providerID === "openai" && auth?.type === "oauth"
          const stream = streamText({
            model: language,
            // Keep this probe's own 30s deadline; disable the @/llm/api
            // wrapper's short default soft-timeout so it is not regressed.
            timeoutMs: false,
            ...(isCodexOauth ? {} : { maxOutputTokens: 64 }),
            abortSignal: AbortSignal.timeout(30_000),
            messages: [
              {
                role: "user",
                content: "Reply with OK.",
              },
            ],
            ...(isCodexOauth && {
              providerOptions: {
                openai: {
                  store: false,
                  instructions: "You are a coding assistant. Reply concisely.",
                },
              },
            }),
          })

          // Consume the full stream to detect error parts that streamText
          // may swallow (turning them into a generic "No output generated").
          let hasOutput = false
          const streamErrors: string[] = []
          for await (const part of stream.fullStream) {
            if (part.type === "text-delta" || part.type === "reasoning-delta") {
              hasOutput = true
            }
            if (part.type === "error") {
              const err = part.error
              streamErrors.push(err instanceof Error ? err.message : String(err))
            }
          }

          if (streamErrors.length > 0) {
            return c.json({
              ok: false,
              status: "error",
              providerID,
              modelID,
              message: streamErrors.join("; "),
            })
          }

          return c.json({
            ok: true,
            status: "connected",
            providerID,
            modelID,
            message: "Provider is reachable.",
          })
        } catch (error) {
          // Surface the original cause when the SDK wraps errors
          const cause = error instanceof Error && error.cause instanceof Error ? error.cause : undefined
          const message = cause?.message || (error instanceof Error ? error.message : String(error))
          return c.json({
            ok: false,
            status: "error",
            providerID,
            modelID,
            message,
          })
        }
      },
    )
    .post(
      "/:providerID/auth/prompts",
      describeRoute({
        summary: "Get auth prompts",
        description: "Return the prompts needed for a specific authentication method.",
        operationId: "provider.auth.prompts",
        responses: {
          200: {
            description: "Auth prompts",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Prompt.array()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
          inputs: z.record(z.string(), z.string()).optional().meta({ description: "Already collected inputs" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method, inputs } = c.req.valid("json")
        const result = await ProviderAuth.prompts({ providerID, method, inputs })
        return c.json(result)
      },
    )
    .post(
      "/:providerID/auth/execute",
      describeRoute({
        summary: "Execute auth method",
        description: "Execute an authentication method with collected inputs.",
        operationId: "provider.auth.execute",
        responses: {
          200: {
            description: "Auth executed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
          inputs: z.record(z.string(), z.string()).optional().meta({ description: "Collected inputs" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method, inputs } = c.req.valid("json")
        await ProviderAuth.execute({ providerID, method, inputs })
        Provider.resetAll()
        Agent.resetAll()
        return c.json(true)
      },
    )
    .post(
      "/:providerID/oauth/authorize",
      describeRoute({
        summary: "OAuth authorize",
        description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
        operationId: "provider.oauth.authorize",
        responses: {
          200: {
            description: "Authorization URL and method",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Authorization.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
          inputs: z.record(z.string(), z.string()).optional().meta({ description: "Collected inputs" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method, inputs } = c.req.valid("json")
        const result = await ProviderAuth.authorize({
          providerID,
          method,
          inputs,
        })
        return c.json(result)
      },
    )
    .post(
      "/:providerID/oauth/callback",
      describeRoute({
        summary: "OAuth callback",
        description: "Handle the OAuth callback from a provider after user authorization.",
        operationId: "provider.oauth.callback",
        responses: {
          200: {
            description: "OAuth callback processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
          code: z.string().optional().meta({ description: "OAuth authorization code" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method, code } = c.req.valid("json")
        await ProviderAuth.callback({
          providerID,
          method,
          code,
        })
        Provider.resetAll()
        Agent.resetAll()
        return c.json(true)
      },
    ),
)
