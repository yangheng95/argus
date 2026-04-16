import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { SystemPrompt } from "../session/system"
import { Instance } from "../project/instance"
import { Truncate } from "../tool/truncation"
import { Auth } from "../auth"
import { ProviderTransform } from "../provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_BUILD from "./prompt/build.txt"
import SPEC_CORE from "@/prompt/core/spec-core.txt"
import PLAN_CORE from "@/prompt/core/plan-core.txt"
import ARCHITECT_CORE from "@/prompt/core/architect-core.txt"
import REQUIREMENTS_CORE from "@/prompt/core/requirements-core.txt"
import DESIGN_ANALYST_CORE from "@/prompt/core/design-analyst-core.txt"
import PLANNER_CORE from "@/prompt/core/planner-core.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_GENERAL from "./prompt/general.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import { PermissionNext } from "@/permission/next"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import path from "path"
import { Plugin } from "@/plugin"
import { Skill } from "../skill"
import { entries, values as objectValues } from "@/util/object"

export namespace Agent {
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      mode: z.enum(["subagent", "primary", "all"]),
      native: z.boolean().optional(),
      hidden: z.boolean().optional(),
      topP: z.number().optional(),
      temperature: z.number().optional(),
      color: z.string().optional(),
      // Permission ruleset — consumed only by SessionProcessor / SessionPrompt
      // flow (build / spec / plan / general / explore / compaction / title).
      // Stage agents dispatched through AgentRuntime (orchestrator / requirements /
      // architect / planner / design-analyst / delivery / summary) do NOT consult
      // permission; they may omit this field. Code that iterates Agent.Info
      // permission must therefore handle `undefined`.
      permission: PermissionNext.Ruleset.optional(),
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      variant: z.string().optional(),
      prompt: z.string().optional(),
      options: z.record(z.string(), z.any()),
      steps: z.number().int().positive().optional(),
      tools: z
        .object({
          include: z.array(z.string()).optional(),
          exclude: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  const state = Instance.state(async () => {
    const cfg = await Config.get()
    // Lazy-load the delivery agent system prompt to avoid pulling the large
    // delivery module at startup.
    const { DELIVERY_AGENT_SYSTEM } = await import("@/delivery/agent")

    const skillDirs = await Skill.dirs()
    const whitelistedDirs = [Truncate.GLOB, ...skillDirs.map((dir) => path.join(dir, "*"))]
    const defaults = PermissionNext.fromConfig({
      "*": "ask",
      invalid: "allow",
      doom_loop: "ask",
      list: "allow",
      glob: "allow",
      grep: "allow",
      bash: "allow",
      edit: "allow",
      task: "allow",
      webfetch: "allow",
      websearch: "deny",
      codesearch: "allow",
      lsp: "allow",
      memory: "allow",
      schedule: "allow",
      skill: "allow",
      panel: "allow",
      todoread: "allow",
      todowrite: "allow",
      screen: "allow",
      input: "ask",
      external_directory: {
        "*": "ask",
        ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
      },
      question: "deny",
      plan_enter: "deny",
      plan_exit: "deny",
      spec_enter: "deny",
      spec_exit: "deny",
      // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
      read: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
        "*.env.example": "allow",
      },
    })
    const user = PermissionNext.fromConfig(cfg.permission ?? {})

    const result: Record<string, Info> = {
      build: {
        name: "build",
        description: "The default agent. Executes tools based on configured permissions.",
        tools: { exclude: ["planner", "panel", "tui", "task_report", "analytics"] },
        options: {},
        prompt: PROMPT_BUILD,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            plan_enter: "allow",
            spec_enter: "allow",
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },
      spec: {
        name: "spec",
        description: "Read-only specification agent. Explores codebase, asks questions, and writes the specification file before planning.",
        tools: { include: ["read", "glob", "grep", "codesearch", "lsp", "question", "spec_exit", "task", "memory", "webfetch", "websearch"] },
        options: {},
        prompt: SPEC_CORE,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            spec_exit: "allow",
            bash: "deny",
            schedule: "deny",
            apply_patch: "deny",
            edit: {
              "*": "deny",
              ".opencorvus/specs/*.md": "allow",
            },
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },
      plan: {
        name: "plan",
        description: "Read-only planning agent. Explores, asks questions, and writes the implementation plan file.",
        tools: { include: ["read", "glob", "grep", "codesearch", "lsp", "question", "plan_exit", "task", "memory", "webfetch", "websearch"] },
        options: {},
        prompt: PLAN_CORE,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            plan_exit: "allow",
            bash: "deny",
            schedule: "deny",
            apply_patch: "deny",
            edit: {
              "*": "deny",
              ".opencorvus/plans/*.md": "allow",
            },
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },
      general: {
        name: "general",
        description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
        tools: { exclude: ["planner", "panel", "tui", "task_report", "analytics", "plan_enter", "plan_exit", "spec_enter", "spec_exit"] },
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            todoread: "deny",
            todowrite: "deny",
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      explore: {
        name: "explore",
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            webfetch: "allow",
            websearch: "deny",
            codesearch: "allow",
            read: "allow",
            memory: "allow",
            external_directory: {
              "*": "ask",
              ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
            },
          }),
          user,
        ),
        description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
        tools: { include: ["read", "glob", "grep", "bash", "codesearch", "lsp", "webfetch", "memory"] },
        prompt: PROMPT_EXPLORE,
        options: {},
        mode: "subagent",
        native: true,
      },
      compaction: {
        name: "compaction",
        tools: { include: [] as string[] },
        mode: "primary",
        native: true,
        hidden: true,
        prompt: PROMPT_COMPACTION,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        options: {},
      },
      title: {
        name: "title",
        tools: { include: [] as string[] },
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        temperature: 0.5,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_TITLE,
      },
      // ── Stage agents (dispatched through AgentRuntime, not SessionPrompt) ─
      // These do NOT consume `permission` — AgentRuntime never consults the
      // ruleset and tool execution inside stage agents bypasses the
      // SessionProcessor / tool-resolver permission gates. The field is
      // omitted to stop misleading users into thinking
      // `agent.<stage>.permission` in opencorvus.jsonc has any effect.
      // ───────────────────────────────────────────────────────────────────
      summary: {
        name: "summary",
        tools: { include: [] as string[] },
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        prompt: PROMPT_SUMMARY,
      },
      delivery: {
        name: "delivery",
        description: "Delivery verification agent. Verifies runtime behavior, fixes bugs, and makes final acceptance decisions.",
        tools: { exclude: ["task", "plan_enter", "plan_exit", "spec_enter", "spec_exit", "planner", "panel", "tui", "task_report", "analytics"] },
        options: {},
        prompt: DELIVERY_AGENT_SYSTEM,
        mode: "primary",
        native: true,
        hidden: true,
      },
      orchestrator: {
        name: "orchestrator",
        description: "Orchestrator (master) agent. Drives the end-to-end task lifecycle through one of the two built-in workflows (direct or pipeline).",
        // Prompt is constructed dynamically per-trigger in src/orchestrator/agent.ts
        // (see buildSystemParts + describeTrigger). No static core prompt — the
        // orchestrator's context depends on live task/goal/run state.
        options: {},
        mode: "primary",
        native: true,
        hidden: true,
      },
      requirements: {
        name: "requirements",
        description: "Requirements agent. Analyzes user input and decomposes it into typed GoalContracts with acceptance specs.",
        prompt: REQUIREMENTS_CORE,
        // Shared tools — structured-output tools from createRequirementsOutputTools()
        // bypass this filter (they are the agent's contract with the orchestrator).
        tools: { include: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get"] },
        options: {},
        mode: "primary",
        native: true,
        hidden: true,
      },
      architect: {
        name: "architect",
        description: "Architect agent. Resolves cross-goal interfaces, file layout, and shared types into binding Decision Log entries.",
        prompt: ARCHITECT_CORE,
        tools: { include: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get"] },
        options: {},
        mode: "primary",
        native: true,
        hidden: true,
      },
      planner: {
        name: "planner",
        description: "Planner agent. Produces per-goal implementation plans from GoalContracts + Architect decisions.",
        prompt: PLANNER_CORE,
        tools: { include: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get"] },
        options: {},
        mode: "primary",
        native: true,
        hidden: true,
      },
      "design-analyst": {
        name: "design-analyst",
        description: "Design analyst agent. Analyzes visual references (images, URLs) to produce structured design specifications.",
        prompt: DESIGN_ANALYST_CORE,
        // design-analyst also uses a dedicated webfetch tool in its factory; shared planner
        // tools listed here, webfetch + output tools bypass the filter.
        tools: { include: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get"] },
        options: {},
        mode: "primary",
        native: true,
        hidden: true,
      },
    }

    for (const [key, value] of entries((cfg.agent ?? {}) as NonNullable<Config.Info["agent"]>)) {
      if (value.disable) {
        delete result[key]
        continue
      }
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          mode: "all",
          permission: PermissionNext.merge(defaults, user),
          options: {},
          native: false,
        }
      if (value.model) item.model = Provider.parseModel(value.model)
      item.variant = value.variant ?? item.variant
      item.prompt = value.prompt ?? item.prompt
      item.description = value.description ?? item.description
      item.temperature = value.temperature ?? item.temperature
      item.topP = value.top_p ?? item.topP
      item.mode = value.mode ?? item.mode
      item.color = value.color ?? item.color
      item.hidden = value.hidden ?? item.hidden
      item.name = value.name ?? item.name
      item.steps = value.steps ?? item.steps
      item.tools = value.tools ?? item.tools
      item.options = mergeDeep(item.options, value.options ?? {})
      // Stage agents (no built-in permission) ignore user-supplied permission
      // overrides — the field has no consumer for them. Adding it would mislead
      // users into thinking the override does something.
      if (item.permission) {
        item.permission = PermissionNext.merge(item.permission, PermissionNext.fromConfig(value.permission ?? {}))
      }
    }

    // Ensure Truncate.GLOB is allowed unless explicitly configured.
    // Only applies to agents with a permission ruleset (i.e. SessionPrompt-
    // dispatched agents). Stage agents (delivery / requirements / architect /
    // planner / design-analyst / orchestrator / summary) omit permission and
    // bypass this loop — they don't go through the tool-resolver gate.
    for (const name in result) {
      const agent = result[name]
      if (!agent.permission) continue
      const explicit = agent.permission.some((r) => {
        if (r.permission !== "external_directory") return false
        if (r.action !== "deny") return false
        return r.pattern === Truncate.GLOB
      })
      if (explicit) continue

      result[name].permission = PermissionNext.merge(
        agent.permission,
        PermissionNext.fromConfig({ external_directory: { [Truncate.GLOB]: "allow" } }),
      )
    }

    return result
  })

  /** Map of native agent name → built-in default prompt (before config overrides). */
  const NATIVE_DEFAULTS: Record<string, string | undefined> = {
    build: PROMPT_BUILD,
    spec: SPEC_CORE,
    plan: PLAN_CORE,
    general: PROMPT_GENERAL,
    explore: PROMPT_EXPLORE,
    compaction: PROMPT_COMPACTION,
    title: PROMPT_TITLE,
    summary: PROMPT_SUMMARY,
  }

  /** Returns the built-in default prompt for a native agent (before config overrides).
   *  For dynamically loaded agents (evaluator, delivery), falls back to the agent's prompt field. */
  export function nativeDefaultPrompt(name: string): string | undefined {
    const static_ = NATIVE_DEFAULTS[name]
    if (static_ !== undefined) return static_
    // For agents loaded dynamically (evaluator, delivery), the prompt is populated in state()
    return undefined
  }

  /** Invalidate the memoized Agent.state(). Call after config changes so the
   *  next Agent.get()/list() call rebuilds with the fresh user overrides. */
  export function reset() {
    ;(state as any).reset()
  }

  export async function get(agent: string) {
    return state().then((x) => x[agent])
  }

  export async function list() {
    const cfg = await Config.get()
    return pipe(
      await state(),
      values(),
      sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "build"), "desc"]),
    )
  }

  export async function defaultAgent() {
    const cfg = await Config.get()
    const agents = await state()

    if (cfg.default_agent) {
      const agent = agents[cfg.default_agent]
      if (!agent) throw new Error(`default agent "${cfg.default_agent}" not found`)
      if (agent.mode === "subagent") throw new Error(`default agent "${cfg.default_agent}" is a subagent`)
      if (agent.hidden === true) throw new Error(`default agent "${cfg.default_agent}" is hidden`)
      return agent.name
    }

    const primaryVisible = objectValues(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
    if (!primaryVisible) throw new Error("no primary visible agent found")
    return primaryVisible.name
  }

  export async function generate(input: { description: string; model?: { providerID: string; modelID: string } }) {
    const cfg = await Config.get()
    const defaultModel = input.model ?? (await Provider.defaultModel())
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const language = await Provider.getLanguage(model)

    const system = [cfg.prompt?.["agent_generate"] ?? PROMPT_GENERATE]
    await Plugin.trigger("experimental.chat.system.transform", { model }, { system })
    const existing = await list()

    const params = {
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
        },
      },
      temperature: 0.3,
      messages: [
        ...system.map(
          (item): ModelMessage => ({
            role: "system",
            content: item,
          }),
        ),
        {
          role: "user",
          content: `Create an agent configuration based on this request: \"${input.description}\".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
        },
      ],
      model: language,
      schema: z.object({
        identifier: z.string(),
        whenToUse: z.string(),
        systemPrompt: z.string(),
      }),
    } satisfies Parameters<typeof generateObject>[0]

    if (defaultModel.providerID === "openai" && (await Auth.get(defaultModel.providerID))?.type === "oauth") {
      const result = streamObject({
        ...params,
        providerOptions: ProviderTransform.providerOptions(model, {
          store: false,
        }),
        onError: () => {},
      })
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error
      }
      return result.object
    }

    const result = await generateObject(params)
    return result.object
  }

  /** Resolve the agent generation prompt, respecting config.prompt.agent_generate override. */
  export async function generatePrompt(): Promise<string> {
    const cfg = await Config.get()
    return cfg.prompt?.["agent_generate"] ?? PROMPT_GENERATE
  }
}
