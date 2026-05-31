import { Config } from "./config"
import { Agent } from "@/agent/agent"
import { AgentRoleContract, type AgentRoleID } from "@/agent/role-contract"

import PROMPT_SYSTEM from "@/session/prompt/system.txt"
import PROMPT_GENERATE from "@/agent/generate.txt"

/** Native agents whose prompt is NOT consumed from prompt catalog config
 *  at runtime. Surfacing them in the catalog is a UX trap: users edit the
 *  card, hit Save, and nothing changes.
 *  - orchestrator → dynamic prompt built per-trigger in `buildSystemParts`;
 *    the small Agent.Info prompt only prevents inheritance of the generic
 *    assistant core header, while workflow state is reconstructed from DB every
 *    invocation, so a user-editable static override has no place to land.
 *  - summary → `PROMPT_SUMMARY` is attached to the agent registry but has
 *    no consumer; `task-api/index.ts::generateFollowup` only picks a model
 *    via `resolveAgentModel("summary")` and constructs its own prompt. */
const UNEDITABLE_AGENTS = new Set<string>(
  Object.values(AgentRoleContract.all)
    .filter((contract) => !contract.promptEditable)
    .map((contract) => contract.id),
)

export namespace PromptCatalog {
  export interface Entry {
    scope: "system" | "agent"
    key: string
    label: string
    group: string
    mode?: string
    prompt: string
    effective_prompt: string
    configured_prompt: string | null
    default_prompt: string
    inherits_core: boolean
    prompt_mode: "override" | "append"
    description?: string
  }

  /** Static metadata for system-scope prompt slots.
   *  Only two truly system-wide slots remain — they apply to every LLM call
   *  regardless of which agent is running. Per-agent override prompts live on
   *  `config.agent.{name}.prompt`; code-owned stage prompts accept only
   *  `config.agent.{name}.prompt_append`. Both surface as agent-scope entries
   *  with distinct defaults from `Agent.nativeDefaultPrompt`. */
  const SYSTEM_PROMPT_META: Array<{
    key: string
    label: string
    group: string
    description?: string
  }> = [
    {
      key: "core_header",
      label: "System Prompt",
      group: "core",
      description: "Unified system prompt applied to all models",
    },
    {
      key: "agent_generate",
      label: "Agent Generator",
      group: "generator",
      description: "Prompt used when generating new agent configurations",
    },
  ]

  /** Resolve the built-in default prompt for a system-scope slot. */
  function defaultPromptForKey(key: string): string {
    switch (key) {
      case "core_header":
        return PROMPT_SYSTEM
      case "agent_generate":
        return PROMPT_GENERATE
      default:
        return ""
    }
  }

  function agentGroup(agent: Agent.Info): string {
    if (agent.hidden) return "hidden_agent"
    if (!agent.native) return "custom_agent"
    if (agent.mode === "subagent") return "subagent"
    // Assistant-level agents
    return "primary_agent"
  }

  export async function list(): Promise<Entry[]> {
    const cfg = await Config.get()
    const configPrompts = cfg.prompt ?? {}
    const agents = await Agent.list()

    const entries: Entry[] = []

    // System-scope prompts
    for (const slot of SYSTEM_PROMPT_META) {
      const configured = configPrompts[slot.key] ?? null
      const defaultPrompt = defaultPromptForKey(slot.key)
      entries.push({
        scope: "system",
        key: slot.key,
        label: slot.label,
        group: slot.group,
        prompt: configured ?? defaultPrompt,
        effective_prompt: configured ?? defaultPrompt,
        configured_prompt: configured,
        default_prompt: defaultPrompt,
        inherits_core: false,
        prompt_mode: "override",
        description: slot.description,
      })
    }

    // Agent-scope prompts — every native agent surfaces with its own default.
    //
    // The previous implementation used a SYSTEM_COVERS_AGENT mask to hide
    // agents whose system-scope slot existed (spec/goal/plan/evaluator).
    // That mask was removed together with those legacy slots, so every native
    // agent now renders as one distinct card. `Agent.nativeDefaultPrompt` is
    // the single source of truth for the default prompt; dynamically-loaded
    // dynamically-loaded agents use `agent.prompt` populated in state().
    // `prompt_mode` makes the write semantics explicit:
    // - override entries replace the runtime prompt with `config.agent.X.prompt`.
    // - append entries keep the code-owned core and append
    //   `config.agent.X.prompt_append`.
    for (const agent of agents) {
      if (UNEDITABLE_AGENTS.has(agent.name)) continue
      const agentCfg = (cfg.agent ?? {})[agent.name]
      const contract = AgentRoleContract.all[agent.name as AgentRoleID]
      if (!contract?.promptEditable) continue
      const promptMode = AgentRoleContract.promptMode(agent.name as AgentRoleID)
      if (promptMode === "none") continue
      const configuredPrompt = promptMode === "append"
        ? (agentCfg?.prompt_append ?? null)
        : (agentCfg?.prompt ?? null)
      const nativeDefault = agent.native ? Agent.nativeDefaultPrompt(agent.name) : undefined
      const defaultPrompt = nativeDefault ?? agent.prompt ?? ""
      const prompt = configuredPrompt ?? (promptMode === "append" ? "" : defaultPrompt)
      const effectivePrompt =
        promptMode === "append"
          ? [defaultPrompt, configuredPrompt].filter((item) => item && item.trim().length > 0).join("\n\n")
          : prompt
      const inheritsCore = promptMode === "override" && !configuredPrompt && (!defaultPrompt || defaultPrompt === PROMPT_SYSTEM)
      entries.push({
        scope: "agent",
        key: agent.name,
        label: agent.name,
        group: agentGroup(agent),
        mode: agent.mode,
        prompt,
        effective_prompt: effectivePrompt,
        configured_prompt: configuredPrompt,
        default_prompt: defaultPrompt,
        inherits_core: inheritsCore,
        prompt_mode: promptMode,
        description: agent.description,
      })
    }

    return entries
  }

  /**
   * Resolve the effective prompt for a system-scope slot.
   * Returns the config override if present, otherwise the built-in default.
   */
  export async function resolve(key: string): Promise<string | undefined> {
    const cfg = await Config.get()
    const override = cfg.prompt?.[key]
    if (override) return override
    const meta = SYSTEM_PROMPT_META.find((s) => s.key === key)
    if (!meta) return undefined
    return defaultPromptForKey(key)
  }
}
