import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { ChannelSupervisor } from "@/channel/supervisor"
import { Provider } from "../../provider/provider"
import { mapValues } from "remeda"
import { errors } from "../error"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import {
  Agent,
  DEFAULT_COMPACTION_PROMPT,
  DEFAULT_EXPLORE_PROMPT,
  DEFAULT_GENERATE_PROMPT,
  DEFAULT_SUMMARY_PROMPT,
  DEFAULT_TITLE_PROMPT,
} from "@/agent/agent"
import { DEFAULT_CORE_HEADER } from "@/session/system"
import { PLANNER_SYSTEM } from "@/planner/agent"
import { SPEC_SYSTEM } from "@/spec/agent"
import { GOAL_JUDGE_SYSTEM } from "@/evaluator/agent"

const log = Log.create({ service: "server" })

const PromptEntry = z.object({
  key: z.string(),
  scope: z.enum(["system", "agent"]),
  group: z.string(),
  label: z.string(),
  description: z.string().optional(),
  prompt: z.string(),
  configured_prompt: z.string().nullable(),
  default_prompt: z.string().nullable().optional(),
  mode: z.enum(["subagent", "primary", "all"]).optional(),
  native: z.boolean().optional(),
  hidden: z.boolean().optional(),
  inherits_core: z.boolean().optional(),
})

function promptValue(value: unknown) {
  return typeof value === "string" ? value : null
}

function agentDefaultPrompt(name: string) {
  if (name === "explore") return DEFAULT_EXPLORE_PROMPT
  if (name === "compaction") return DEFAULT_COMPACTION_PROMPT
  if (name === "title") return DEFAULT_TITLE_PROMPT
  if (name === "summary") return DEFAULT_SUMMARY_PROMPT
  return null
}

function agentPromptGroup(input: { native?: boolean; mode?: "subagent" | "primary" | "all"; hidden?: boolean }) {
  if (input.native !== true) return "custom_agent"
  if (input.hidden === true) return "hidden_agent"
  if (input.mode === "subagent") return "subagent"
  return "primary_agent"
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
        return c.json(await Config.get())
      },
    )
    .get(
      "/prompt",
      describeRoute({
        summary: "List configurable prompts",
        description: "Retrieve the effective prompt catalog used by agents and orchestrator stages.",
        operationId: "config.prompts",
        responses: {
          200: {
            description: "Prompt catalog",
            content: {
              "application/json": {
                schema: resolver(PromptEntry.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const [config, agents] = await Promise.all([Config.get(), Agent.list()])
        const system = [
          {
            key: "core_header",
            scope: "system" as const,
            group: "core",
            label: "Core Conversation Header",
            description: "Base system header used for normal coding sessions.",
            prompt: promptValue(config.prompt?.core_header) ?? DEFAULT_CORE_HEADER,
            configured_prompt: promptValue(config.prompt?.core_header),
            default_prompt: DEFAULT_CORE_HEADER,
          },
          {
            key: "agent_generate",
            scope: "system" as const,
            group: "generator",
            label: "Agent Generator",
            description: "Prompt used when generating a new agent configuration.",
            prompt: promptValue(config.prompt?.agent_generate) ?? DEFAULT_GENERATE_PROMPT,
            configured_prompt: promptValue(config.prompt?.agent_generate),
            default_prompt: DEFAULT_GENERATE_PROMPT,
          },
          {
            key: "planner_system",
            scope: "system" as const,
            group: "orchestrator",
            label: "Planner Agent",
            description: "System prompt for the orchestrator planning stage.",
            prompt: promptValue(config.prompt?.planner_system) ?? PLANNER_SYSTEM,
            configured_prompt: promptValue(config.prompt?.planner_system),
            default_prompt: PLANNER_SYSTEM,
          },
          {
            key: "spec_system",
            scope: "system" as const,
            group: "orchestrator",
            label: "Spec Agent",
            description: "System prompt for the orchestrator specification stage.",
            prompt: promptValue(config.prompt?.spec_system) ?? SPEC_SYSTEM,
            configured_prompt: promptValue(config.prompt?.spec_system),
            default_prompt: SPEC_SYSTEM,
          },
          {
            key: "evaluator_system",
            scope: "system" as const,
            group: "orchestrator",
            label: "Evaluator Agent",
            description: "System prompt for the orchestrator evaluation stage.",
            prompt: promptValue(config.prompt?.evaluator_system) ?? GOAL_JUDGE_SYSTEM,
            configured_prompt: promptValue(config.prompt?.evaluator_system),
            default_prompt: GOAL_JUDGE_SYSTEM,
          },
        ]
        const agentItems = agents.map((item) => {
          const configured = promptValue(config.agent?.[item.name]?.prompt)
          const prompt = configured ?? item.prompt ?? ""
          return {
            key: item.name,
            scope: "agent" as const,
            group: agentPromptGroup(item),
            label: item.name,
            description: item.description,
            prompt,
            configured_prompt: configured,
            default_prompt: agentDefaultPrompt(item.name),
            mode: item.mode,
            native: item.native,
            hidden: item.hidden,
            inherits_core: !prompt,
          }
        })
        return c.json([...system, ...agentItems])
      },
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update configuration",
        description: "Update OpenCorvus configuration settings and preferences.",
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
      validator("json", Config.Info),
      async (c) => {
        const config = c.req.valid("json")
        await Config.update(config)
        await ChannelSupervisor.sync(config).catch((error) => {
          log.warn("channel runtime sync failed", { error: String(error) })
        })
        return c.json(config)
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
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0]?.id),
        })
      },
    ),
)
