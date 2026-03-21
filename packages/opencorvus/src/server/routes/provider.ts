import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { generateText } from "ai"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { ProviderAuth } from "../../provider/auth"
import { mapValues } from "remeda"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

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
                    all: ModelsDev.Provider.array(),
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

        const allProviders = await ModelsDev.get()
        const filteredProviders: Record<string, (typeof allProviders)[string]> = {}
        for (const [key, value] of Object.entries(allProviders)) {
          if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
            filteredProviders[key] = value
          }
        }

        const connected = await Provider.list()
        const providers = Object.assign(
          mapValues(filteredProviders, (x) => Provider.fromModelsDevProvider(x)),
          connected,
        )
        return c.json({
          all: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
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
          const language = await Provider.getLanguage(model)
          await generateText({
            model: language,
            maxOutputTokens: 1,
            abortSignal: AbortSignal.timeout(20_000),
            messages: [
              {
                role: "user",
                content: "Reply with OK.",
              },
            ],
          })

          return c.json({
            ok: true,
            status: "connected",
            providerID,
            modelID,
            message: "Provider is reachable.",
          })
        } catch (error) {
          return c.json({
            ok: false,
            status: "error",
            providerID,
            modelID,
            message: error instanceof Error ? error.message : String(error),
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
        return c.json(true)
      },
    ),
)
