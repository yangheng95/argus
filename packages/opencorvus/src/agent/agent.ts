import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { streamObject, type ModelMessage } from "ai"
import { SystemPrompt } from "../session/system"
import { Instance, lazyInstanceState } from "../project/instance"
import { Truncate } from "../tool/truncation"
import { Auth } from "../auth"
import { ProviderTransform } from "../provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import ARCHITECT_CORE from "@/prompt/core/architect-core.txt"
import REQUIREMENTS_CORE from "@/prompt/core/requirements-core.txt"
import DESIGN_ANALYST_CORE from "@/prompt/core/design-analyst-core.txt"
import PLANNER_CORE from "@/prompt/core/planner-core.txt"
import INTENT_ANALYSIS_CORE from "@/prompt/core/intent-analysis-core.txt"
import PROMPT_BUILD from "./prompt/build.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_GENERAL from "./prompt/general.txt"
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

  const state = lazyInstanceState(async () => {
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
      // webfetch is restricted to the `build` agent (the one actually turning a
      // URL reference into code). design-analyst / planner / architect / explore
      // read cached mirror artifacts instead of hitting the live network — the
      // mirror pipeline (`webpage_extract` → compile / analyze / render /
      // evaluate) is the canonical path for URL work. Keep default at `deny`
      // so no stage agent reaches over the build-agent fence.
      webfetch: "deny",
      websearch: "deny",
      // Mirror tools — the canonical pipeline for any URL work (extract →
      // compile | analyze → render → evaluate → text_diff). `allow` for ALL
      // six: unattended benchmark / pipeline runs (overlay-web-benchmark, CI,
      // scheduled agents) block on "ask" and can never reach them, which
      // defeats the whole webpage-generate pipeline. Leaving only 2 of 6 on
      // `allow` (the historical state) also caused inconsistent behaviour
      // where agents ran `webpage_extract` fine but then hit a permission
      // ask on `webpage_compile` / `webpage_analyze` / `webpage_evaluate` /
      // `webpage_text_diff` mid-pipeline. Restrictive installs can override
      // any of them via user config.
      webpage_extract: "allow",
      webpage_compile: "allow",
      webpage_analyze: "allow",
      webpage_render: "allow",
      webpage_evaluate: "allow",
      webpage_text_diff: "allow",
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
            // webfetch is allowed ONLY on the build agent. Default is `deny`
            // everywhere else so stage agents route URL work through the
            // mirror pipeline (`webpage_extract` → compile / analyze / render /
            // evaluate) instead of re-fetching text markup.
            webfetch: "allow",
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },
      general: {
        name: "general",
        description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
        tools: { exclude: ["planner", "panel", "tui", "task_report", "analytics"] },
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            todoread: "deny",
            todowrite: "deny",
            // `general` inherits `task: "allow"` from `defaults`. Without this
            // explicit deny a `general` subagent could spawn another `general`
            // (or `explore`) via the task tool, recursively. task.ts only
            // hard-denies task in the child session when the DISPATCHED agent
            // lacks the `task` permission — so we must remove it here.
            task: "deny",
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
      // `summary` is kept only as a model-routing key — `resolveAgentModel`
      // looks it up from `agent.summary.model` in config. It has no static
      // prompt: the only consumer (`task-api/index.ts::generateFollowup`)
      // constructs its own prompt inline.
      summary: {
        name: "summary",
        tools: { include: [] as string[] },
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
      },
      delivery: {
        name: "delivery",
        description: "Delivery verification agent. Verifies runtime behavior, fixes bugs, and makes final acceptance decisions.",
        // `task` is INTENTIONALLY not excluded: delivery dispatches per-goal
        // review subagents (Phase 2.5 in DELIVERY_AGENT_SYSTEM) to deepen its
        // otherwise thin per-goal verification. Adversarial review across 3+
        // goals in one delivery context dilutes attention; parallel general
        // / explore subagents get a goal each with clean context.
        tools: { exclude: ["planner", "panel", "tui", "task_report", "goal_report", "analytics"] },
        // Inherit the shared `defaults` ruleset (task: "allow" included) so
        // subagent dispatch does not trip the permission "ask" default and
        // hang the flow waiting for a non-existent operator. Without this
        // delivery was relying implicitly on `experimental.auto_permission`
        // to auto-approve its own tool calls — making auto-dispatch brittle.
        permission: PermissionNext.merge(defaults, user),
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
        // design-analyst uses dedicated url_screenshot + read_attachment/output
        // tools in its factory; shared planner tools listed here are the only
        // ones filtered by include/exclude.
        tools: { include: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "url_screenshot"] },
        options: {},
        mode: "primary",
        native: true,
        hidden: true,
      },
      "intent-analysis": {
        name: "intent-analysis",
        description: "Intent-analysis agent. Front-of-pipeline intent disambiguation — turns a short user request into a structured IntentAnalysisResult (class, complexity, slots, missing info, clarifications).",
        prompt: INTENT_ANALYSIS_CORE,
        tools: { include: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get"] },
        options: {},
        mode: "primary",
        native: true,
        hidden: true,
      },
      fidelity: {
        name: "fidelity",
        description: "Fidelity review stage. Verifies that the produced goal set covers the original user request; system prompt is built per-call in architect/fidelity.ts.",
        options: {},
        mode: "primary",
        native: true,
        hidden: true,
      },
      prosecutor: {
        name: "prosecutor",
        description: "Prosecutor stage. Adversarial half of the delivery Dynamic Adversarial Metrics loop; files counterexamples against the defender (delivery) verdict.",
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

  /** Map of native agent name → built-in default prompt (before config overrides).
   *  Every native agent that appears in state() must map to its own distinct
   *  core prompt here — otherwise the prompt-catalog panel renders it as an
   *  empty / "inherits core_header" placeholder and multiple agents collapse
   *  into visually identical cards. */
  const NATIVE_DEFAULTS: Record<string, string> = {
    build: PROMPT_BUILD,
    general: PROMPT_GENERAL,
    explore: PROMPT_EXPLORE,
    compaction: PROMPT_COMPACTION,
    title: PROMPT_TITLE,
    architect: ARCHITECT_CORE,
    planner: PLANNER_CORE,
    requirements: REQUIREMENTS_CORE,
    "design-analyst": DESIGN_ANALYST_CORE,
    "intent-analysis": INTENT_ANALYSIS_CORE,
  }

  /** Returns the built-in default prompt for a native agent (before config overrides).
   *  `delivery` is resolved lazily inside state() (async import) so its prompt
   *  is stamped directly on the Agent.Info row and read by the catalog via
   *  `agent.prompt` rather than this helper. */
  export function nativeDefaultPrompt(name: string): string | undefined {
    return NATIVE_DEFAULTS[name]
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

    const isOpenAIOAuth =
      defaultModel.providerID === "openai" && (await Auth.get(defaultModel.providerID))?.type === "oauth"

    const result = streamObject({
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
      ...(isOpenAIOAuth
        ? {
            providerOptions: ProviderTransform.providerOptions(model, { store: false }),
            onError: () => {},
          }
        : {}),
    })

    for await (const part of result.fullStream) {
      if (part.type === "error") throw part.error
    }
    return result.object
  }

  /** Resolve the agent generation prompt, respecting config.prompt.agent_generate override. */
  export async function generatePrompt(): Promise<string> {
    const cfg = await Config.get()
    return cfg.prompt?.["agent_generate"] ?? PROMPT_GENERATE
  }
}
