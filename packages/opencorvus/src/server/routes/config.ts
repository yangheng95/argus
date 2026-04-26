import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
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
        const [raw, orch] = await Promise.all([Config.get(), EngineConfig.get()])
        // Merge effective scalar assistant values so the frontend can display correct defaults.
        // Spread userAsst first so that the explicitly-computed ?? fallbacks always win.
        const userAsst = raw.assistant || {}
        const assistant = {
          ...userAsst,
          max_runs: userAsst.max_runs ?? orch.max_runs,
          max_fix_runs: userAsst.max_fix_runs ?? orch.max_fix_runs,
          max_executor_groups: userAsst.max_executor_groups ?? orch.max_executor_groups,
        }
        return c.json({ ...raw, assistant })
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
      // correctness is enforced downstream when the merged file is re-parsed
      // by writeConfigFile → parseConfig.
      validator("json", z.record(z.string(), z.unknown())),
      async (c) => {
        const partial = c.req.valid("json") as Record<string, unknown>
        // Config.update() internally reads current config and deep-merges
        await Config.update(partial as Config.Info)
        const updated = await Config.get()
        Provider.reset()
        Agent.reset()
        await ChannelSupervisor.sync(updated).catch((error) => {
          log.warn("channel runtime sync failed", { error: String(error) })
        })
        return c.json(updated)
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
