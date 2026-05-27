import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { validateConfigModelReferences } from "@/config/model-reference-validation"
import { EngineConfig } from "../../engine/config"
import { ChannelSupervisor } from "@/channel/supervisor"
import { Provider } from "../../provider/provider"
import { Agent } from "../../agent/agent"
import { PromptCatalog } from "../../config/prompt-catalog"
import { mapValues } from "remeda"
import { errors } from "../error"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "server" })

async function configResponse() {
  const [raw, orch] = await Promise.all([Config.get(), EngineConfig.get()])
  const userAsst = raw.assistant || {}
  const assistant = {
    ...userAsst,
    max_executor_groups: userAsst.max_executor_groups ?? orch.max_executor_groups,
  }
  return { ...raw, assistant }
}

export const ConfigRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get configuration",
        description: "Retrieve the current OpenCorvus configuration settings and preferences.",
        operationId: "config.get",
        responses: {
          200: {
            description: "Get config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await configResponse())
      },
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update configuration (JSON Merge Patch)",
        description:
          "Partially update OpenCorvus configuration per RFC 7396. Only include fields to change; set a field to null to delete it.",
        operationId: "config.update",
        responses: {
          200: {
            description: "Successfully updated config",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      // Accept arbitrary object shape — RFC 7396 merge patches legitimately
      // contain null sentinels at any depth to signal deletion, which the
      // strict Config.Info.partial() validator would reject. Semantic
      // correctness for sub-shapes that callers actually fail to format
      // (most often `provider[id]` from the overlay form) is enforced
      // explicitly below so users see the validation error on the PATCH
      // round-trip rather than silently shipping a broken config that
      // breaks the next parseConfig pass.
      validator("json", z.record(z.string(), z.unknown())),
      async (c) => {
        const partial = c.req.valid("json") as Record<string, unknown>
        // Provider sub-shape: each non-null entry must satisfy Config.Provider
        // schema. RFC 7396 still allows `null` to signal deletion.
        if (partial.provider != null) {
          if (typeof partial.provider !== "object" || Array.isArray(partial.provider)) {
            return c.json(
              { error: "config.provider must be a record of providerID -> ProviderConfig" },
              400,
            )
          }
          for (const [pid, value] of Object.entries(partial.provider as Record<string, unknown>)) {
            if (value === null) continue
            const parsed = Config.Provider.safeParse(value)
            if (!parsed.success) {
              const issues = parsed.error.issues
                .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
                .join("; ")
              return c.json({ error: `config.provider.${pid}: ${issues}` }, 400)
            }
          }
        }
        await validateConfigModelReferences(partial, "config")
        // Config.update() internally reads current config and deep-merges
        await Config.update(partial as Config.Info)
        const updated = await Config.get()
        Provider.reset()
        Agent.reset()
        await ChannelSupervisor.sync(updated).catch((error) => {
          log.warn("channel runtime sync failed", { error: String(error) })
        })
        return c.json(await configResponse())
      },
    )
    .get(
      "/prompt",
      describeRoute({
        summary: "List prompt catalog",
        description:
          "Returns all configurable prompt slots (system-scope and agent-scope) with their defaults and any user overrides from config.",
        operationId: "config.prompt",
        responses: {
          200: {
            description: "Prompt catalog entries",
            content: {
              "application/json": {
                schema: resolver(z.array(z.unknown())),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await PromptCatalog.list())
      },
    )
    .get(
      "/providers",
      describeRoute({
        summary: "List config providers",
        description: "Get a list of all configured AI providers and their default models.",
        operationId: "config.providers",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    providers: Provider.Info.array(),
                    default: z.record(z.string(), z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        using _ = log.time("providers")
        const providers = await Provider.list().then((x) => mapValues(x, (item) => item))
        return c.json({
          providers: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
        })
      },
    ),
)
