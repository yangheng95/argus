import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { Output, type ModelMessage } from "ai"
import { streamText } from "@/llm/api"
import { SystemPrompt } from "../session/system"
import { Instance, lazyInstanceState } from "../project/instance"
import { Auth } from "../auth"
import { ProviderTransform } from "../provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import ARCHITECT_CORE from "@/prompt/core/architect-core.txt"
import REQUIREMENTS_CORE from "@/prompt/core/requirements-core.txt"
import DESIGN_ANALYST_CORE from "@/prompt/core/design-analyst-core.txt"
import INTENT_ANALYSIS_CORE from "@/prompt/core/intent-analysis-core.txt"
import PROMPT_BUILD from "./prompt/build.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_GENERAL from "./prompt/general.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import { PermissionNext } from "@/permission/next"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { Plugin } from "@/plugin"
import { entries, values as objectValues } from "@/util/object"
import { MIRROR_ANALYSIS_TOOL_IDS, MIRROR_TOOL_IDS } from "@/mirror/tools/ids"

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
      // Stage agents dispatched through SessionPrompt (orchestrator / requirements /
      // architect / design-analyst / delivery / summary) do NOT consult
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

    // Debug-default permission policy: tools are accepted unless an operator
    // supplies an explicit `deny` or `ask` rule in config. Tool availability is
    // still controlled separately by each agent's include/exclude list.
    const defaults = PermissionNext.fromConfig({
      "*": "allow",
      invalid: "allow",
      doom_loop: "allow",
      list: "allow",
      glob: "allow",
      search_code: "allow",
      bash: "allow",
      edit: "allow",
      task: "allow",
      webfetch: "allow",
      websearch: "allow",
      external_code_search: "allow",
      lsp: "allow",
      memory: "allow",
      schedule: "allow",
      skill: "allow",
      panel: "allow",
      todoread: "allow",
      todowrite: "allow",
      screen: "allow",
      input: "allow",
      external_directory: "allow",
      question: "allow",
      read: "allow",
    })
    const user = PermissionNext.fromConfig(cfg.permission ?? {})
    const mirrorDenied = PermissionNext.fromConfig(
      Object.fromEntries(MIRROR_TOOL_IDS.map((id) => [id, "deny"])),
    )
    const nonDesignPermissions = (...rulesets: PermissionNext.Ruleset[]) =>
      PermissionNext.merge(defaults, ...rulesets, user, mirrorDenied)

    const result: Record<string, Info> = {
      build: {
        name: "build",
        description: "The default agent. Executes tools based on configured permissions.",
        tools: { exclude: ["panel", "task_report", "analytics", ...MIRROR_TOOL_IDS] },
        options: {},
        prompt: PROMPT_BUILD,
        permission: nonDesignPermissions(
          PermissionNext.fromConfig({
            question: "allow",
            webfetch: "allow",
          }),
        ),
        mode: "primary",
        native: true,
      },
      general: {
        name: "general",
        description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
        tools: { exclude: ["planner", "panel", "task_report", "analytics", "task", "todoread", "todowrite", ...MIRROR_TOOL_IDS] },
        permission: nonDesignPermissions(),
        options: {},
        mode: "subagent",
        native: true,
      },
      explore: {
        name: "explore",
        permission: nonDesignPermissions(),
        description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
        tools: { include: ["read", "glob", "search_code", "bash", "external_code_search", "lsp", "webfetch", "memory"] },
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
        permission: nonDesignPermissions(),
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
        permission: nonDesignPermissions(),
        prompt: PROMPT_TITLE,
      },
      // ── Stage agents (dispatched through SessionPrompt) ─
      // These do NOT consume `permission` — the stage-agent path never consults the
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
        description: "Delivery verification agent. Verifies runtime behavior and makes final acceptance decisions without editing deliverables.",
        // Hard step budget. Mirrors EngineConfig.delivery.max_steps (default
        // 160); SessionLoop reads this value directly. Operators that tune
        // EngineConfig.delivery.max_steps should also update this — an
        // EngineConfig-linked dynamic read here would couple the Agent
        // registry to runtime state (CLAUDE.md rule 26), so we keep both
        // in sync by convention.
        steps: 1000,
        // Delivery is review-only. Registry tools include mutation-capable
        // surfaces (`edit`, `write`, `apply_patch`, `bash`, `task`) that bypass
        // the delivery-specific read-only contract, so this stage exposes no
        // registry tools. Its review and output tools are injected by
        // DeliveryAgent.verify via SessionLoop extra tools.
        tools: { include: [] as string[] },
        // Permission remains merged for consistency with the shared Agent.Info
        // shape, but registry tool exposure above is the delivery authority.
        permission: nonDesignPermissions(),
        options: {},
        prompt: DELIVERY_AGENT_SYSTEM,
        mode: "primary",
        native: true,
        hidden: true,
      },
      orchestrator: {
        name: "orchestrator",
        description: "Orchestrator (master) agent. Drives the end-to-end task lifecycle through one of the two built-in workflows (direct or pipeline).",
        // Prompt is constructed dynamically per-wake in src/orchestrator/agent.ts
        // (buildSystemParts). No static core prompt — the orchestrator's
        // context depends on live task/goal/run state.
        // Step cap raised to 1000 (effectively unlimited). Per user 2026-04-25
        // the per-agent step budget should not constrain normal flow. A tight
        // per-session cap was the dominant failure mode (3-goal pipeline
        // burned the original 20-step cap on dispatch alone, never reaching
        // deliver). The stream-idle watchdog and signal abort still bound a
        // genuinely wedged LLM.
        steps: 1000,
        // Whitelist: orchestrator is a SCHEDULER, not an executor. The benchmark
        // caught it bypassing the build agent entirely (calling webpage_extract
        // / webpage_render / webpage_evaluate / bash /
        // edit / read directly across 20 steps) because the default toolset
        // exposed every executor surface. Rule 22 — one role per tool list.
        // Allowed:
        //   - dispatch tools (the orchestrator's actual job)
        //   - observation tools (read_context, query_failed_goals, *_report)
        //   - user interaction (question)
        //   - bookkeeping (todoread, todowrite, memory, schedule, skill, panel)
        // Excluded:
        //   - filesystem / shell (bash, read, edit, write, glob, search_code,
        //     external_code_search, lsp, codesearch, list)
        //   - mirror toolchain (webpage_extract / compile / compile_html /
        //     analyze / render / evaluate / text_diff) — these belong to build
        //   - network (webfetch, websearch) — same reason
        //   - sub-agent dispatch via the generic `task` tool — orchestrator uses
        //     the explicit `build` / `requirements` / etc. tools instead
        tools: {
          include: [
            // dispatch
            "build",
            "requirements",
            "design_analysis",
            "architect",
            "integrity",
            "deliver",
            "prosecute",
            "publish_delivery",
            "analyze_intent",
            "modify_goal",
            "refine",
            "restart_from_stage",
            "fail_task",
            "cancel_task",
            "retry_task",
            "inject_operator_message",
            // observation (read-only views of task state)
            "query_failed_goals",
            "read_context",
            "task_report",
            "goal_report",
            "analytics",
            // user interaction
            "question",
            // own bookkeeping
            "todowrite",
            "todoread",
            "memory",
            "schedule",
            "skill",
            "panel",
          ],
        },
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
        // todoread/todowrite expose the per-session private scratchpad so the
        // LLM can plan + check off steps; rule 23 says we don't infer plans
        // from internal state, the agent maintains its own.
        tools: { include: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "todoread", "todowrite"] },
        options: {},
        mode: "primary",
        native: true,
        hidden: true,
      },
      architect: {
        name: "architect",
        description: "Architect agent. Resolves cross-goal interfaces, file layout, and shared types into binding Decision Log entries.",
        prompt: ARCHITECT_CORE,
        tools: { include: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "todoread", "todowrite"] },
        steps: 1000,
        options: {},
        mode: "primary",
        native: true,
        hidden: true,
      },
      "design-analyst": {
        name: "design-analyst",
        description: "Design analyst agent. Uses visual evidence and mirror artifacts to produce a complete PRD/SPEC for faithful frontend and backend restoration.",
        prompt: DESIGN_ANALYST_CORE,
        // design-analyst is the only stage that owns mirror extraction.
        // Requirements / architect / build consume the persisted SPEC and
        // visual specs rather than calling mirror tools themselves.
        // Render/evaluate/diff/judge mirror tools are delivery quality-gate
        // surfaces, not PRD/SPEC extraction surfaces, so they stay out of
        // design-analysis to prevent implementation-style score loops.
        tools: {
          include: [
            "read_file",
            "find_files",
            "search_code",
            "list_directory",
            "memory_search",
            "memory_get",
            "url_screenshot",
            "todoread",
            "todowrite",
            ...MIRROR_ANALYSIS_TOOL_IDS,
          ],
        },
        options: {},
        mode: "primary",
        native: true,
        hidden: true,
      },
      "intent-analysis": {
        name: "intent-analysis",
        description: "Intent-analysis agent. Front-of-pipeline intent disambiguation — turns a short user request into a structured IntentAnalysisResult (class, complexity, slots, missing info, clarifications).",
        prompt: INTENT_ANALYSIS_CORE,
        tools: { include: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "todoread", "todowrite"] },
        options: {},
        mode: "primary",
        native: true,
        hidden: true,
      },
      integrity: {
        name: "integrity",
        description: "Integrity review stage. Multi-dimension review of architect output: goal_fidelity / technical_feasibility / hallucination / solution_quality. System prompt is built per-call in integrity/agent.ts from the dimension registry.",
        steps: 1000,
        // Verdict tools are injected per run; registry tools only bloat the schema.
        tools: { include: [] as string[] },
        options: {},
        mode: "primary",
        native: true,
        hidden: true,
      },
      prosecutor: {
        name: "prosecutor",
        description: "Prosecutor stage. Adversarial half of the delivery Dynamic Adversarial Metrics loop; files counterexamples against the defender (delivery) verdict.",
        steps: 1000,
        // Prosecutor's tool surface (query_metric_trajectory, query_diff,
        // mark_counterexample, propose_challenge_metric,
        // resolve_counterexample) is injected per run via toolKit in
        // prosecutor/agent.ts. Registry tools (read/edit/bash/mirror/...)
        // have no role here; without this empty include the prosecutor would
        // pull in the full registry and bloat its system prompt with ~30
        // unused tool schemas. Mirrors integrity / delivery contract.
        tools: { include: [] as string[] },
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
          permission: nonDesignPermissions(),
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

    const helperMessages: ModelMessage[] = [
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
    ]
    const helperSchema = z.object({
      identifier: z.string(),
      whenToUse: z.string(),
      systemPrompt: z.string(),
    })

    const result = streamText({
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
        },
      },
      temperature: 0.3,
      messages: helperMessages,
      model: language,
      output: Output.object({ schema: helperSchema }),
      ...(isOpenAIOAuth
        ? {
            providerOptions: ProviderTransform.providerOptions(model, { store: false }),
            onError: () => {},
          }
        : {}),
    })

    let helperError: string | undefined
    try {
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error
      }
      const finalObj = await result.output
      const { AgentTrace } = await import("@/trace")
      if (AgentTrace.isEnabled()) {
        AgentTrace.recordHelperLLMCall({
          agentName: "agent-generate",
          model: { providerID: defaultModel.providerID, modelID: defaultModel.modelID },
          messages: helperMessages,
          schema: { identifier: "string", whenToUse: "string", systemPrompt: "string" },
          output: finalObj,
        })
      }
      return finalObj
    } catch (err) {
      helperError = err instanceof Error ? err.message : String(err)
      const { AgentTrace } = await import("@/trace")
      if (AgentTrace.isEnabled()) {
        AgentTrace.recordHelperLLMCall({
          agentName: "agent-generate",
          model: { providerID: defaultModel.providerID, modelID: defaultModel.modelID },
          messages: helperMessages,
          error: helperError,
        })
      }
      throw err
    }
  }

  /** Resolve the agent generation prompt, respecting config.prompt.agent_generate override. */
  export async function generatePrompt(): Promise<string> {
    const cfg = await Config.get()
    return cfg.prompt?.["agent_generate"] ?? PROMPT_GENERATE
  }
}
