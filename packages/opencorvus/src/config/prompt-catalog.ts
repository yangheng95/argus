import { Config } from "./config"
import { Agent } from "@/agent/agent"

import PROMPT_SYSTEM from "@/session/prompt/system.txt"
import PROMPT_GENERATE from "@/agent/generate.txt"

export namespace PromptCatalog {
  export interface Entry {
    scope: "system" | "agent"
    key: string
    label: string
    group: string
    mode?: string
    prompt: string
    configured_prompt: string | null
    default_prompt: string
    inherits_core: boolean
    description?: string
  }

  /** Static metadata for system-scope prompt slots. */
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
    {
      key: "spec_system",
      label: "Spec Agent",
      group: "assistant",
      description: "System prompt used by the spec agent when it extracts requirements and constraints",
    },
    {
      key: "goal_system",
      label: "Goal Agent",
      group: "assistant",
      description: "System prompt used by the goal agent when it decomposes spec requirements into executable implementation goals",
    },
    {
      key: "planner_system",
      label: "Planner Agent",
      group: "assistant",
      description: "System prompt used by the planner when it builds execution plans",
    },
    {
      key: "evaluator_system",
      label: "Evaluator Agent",
      group: "assistant",
      description: "System prompt used by the evaluator when it decides acceptance or replanning",
    },
    {
      key: "delivery_system",
      label: "Delivery Agent",
      group: "assistant",
      description: "System prompt used by the delivery agent when it verifies startup, fixes bugs, and makes the final acceptance decision",
    },
  ]

  /**
   * Resolve the built-in default prompt for a system-scope slot.
   * Uses dynamic imports for orchestrator prompts to avoid circular dependency
   * (agent modules import Config, and prompt-catalog lives next to Config).
   */
  async function defaultPromptForKey(key: string): Promise<string> {
    switch (key) {
      case "core_header":
        return PROMPT_SYSTEM
      case "agent_generate":
        return PROMPT_GENERATE
      case "spec_system":
      case "goal_system":
      case "requirements_system": {
        const { REQUIREMENTS_SYSTEM } = await import("@/requirements")
        return REQUIREMENTS_SYSTEM
      }
      case "planner_system": {
        const PLAN_CORE = (await import("@/prompt/core/plan-core.txt")).default
        return PLAN_CORE
      }
      case "evaluator_system": {
        const { EVALUATOR_DEFAULT_SYSTEM } = await import("@/evaluator/types")
        return EVALUATOR_DEFAULT_SYSTEM
      }
      case "delivery_system": {
        const { DELIVERY_AGENT_SYSTEM } = await import("@/delivery/agent")
        return DELIVERY_AGENT_SYSTEM
      }
      default:
        return ""
    }
  }

  /**
   * Map from system-scope key to the agent name it covers.
   * Agents with a system-scope entry are excluded from the agent-scope list
   * so the catalog shows exactly one entry per logical agent.
   */
  const SYSTEM_COVERS_AGENT: Record<string, string> = {
    spec_system: "spec",
    goal_system: "goal",
    planner_system: "plan",
    evaluator_system: "evaluator",
    delivery_system: "delivery",
  }

  function agentGroup(agent: Agent.Info): string {
    if (agent.hidden) return "hidden_agent"
    if (!agent.native) return "custom_agent"
    if (agent.mode === "subagent") return "subagent"
    // Assistant-level agents
    if (["spec", "plan"].includes(agent.name)) return "assistant"
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
      const defaultPrompt = await defaultPromptForKey(slot.key)
      entries.push({
        scope: "system",
        key: slot.key,
        label: slot.label,
        group: slot.group,
        prompt: configured ?? defaultPrompt,
        configured_prompt: configured,
        default_prompt: defaultPrompt,
        inherits_core: false,
        description: slot.description,
      })
    }

    // Agent names already covered by a system-scope entry — skip to avoid duplicates
    const coveredAgents = new Set(Object.values(SYSTEM_COVERS_AGENT))

    // Agent-scope prompts (skip agents with a system-scope counterpart)
    for (const agent of agents) {
      if (coveredAgents.has(agent.name)) continue
      const agentCfg = (cfg.agent ?? {})[agent.name]
      const configuredPrompt = agentCfg?.prompt ?? null
      // Use native default (before config override) for built-in agents
      const nativeDefault = agent.native ? Agent.nativeDefaultPrompt(agent.name) : undefined
      const defaultPrompt = nativeDefault ?? ""
      // An agent inherits core if it has no own prompt, or if its default IS the core prompt
      const inheritsCore = !configuredPrompt && (!defaultPrompt || defaultPrompt === PROMPT_SYSTEM)
      entries.push({
        scope: "agent",
        key: agent.name,
        label: agent.name,
        group: agentGroup(agent),
        mode: agent.mode,
        prompt: configuredPrompt ?? defaultPrompt,
        configured_prompt: configuredPrompt,
        default_prompt: defaultPrompt,
        inherits_core: inheritsCore,
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
