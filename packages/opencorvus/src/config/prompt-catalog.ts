import { Config } from "./config"
import { Agent } from "@/agent/agent"

import PROMPT_CODEX from "@/session/prompt/codex_header.txt"
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

  const SYSTEM_PROMPTS: Array<{
    key: string
    label: string
    group: string
    defaultPrompt: string
    description?: string
  }> = [
    {
      key: "core_header",
      label: "Core Header",
      group: "core",
      defaultPrompt: PROMPT_CODEX,
      description: "Shared system prompt prepended to all LLM sessions",
    },
    {
      key: "agent_generate",
      label: "Agent Generator",
      group: "generator",
      defaultPrompt: PROMPT_GENERATE,
      description: "Prompt used when generating new agent configurations",
    },
  ]

  function agentGroup(agent: Agent.Info): string {
    if (agent.hidden) return "hidden_agent"
    if (!agent.native) return "custom_agent"
    if (agent.mode === "subagent") return "subagent"
    // Orchestrator-level agents
    if (["spec", "plan"].includes(agent.name)) return "orchestrator"
    return "primary_agent"
  }

  export async function list(): Promise<Entry[]> {
    const cfg = await Config.get()
    const configPrompts = cfg.prompt ?? {}
    const agents = await Agent.list()

    const entries: Entry[] = []

    // System-scope prompts
    for (const slot of SYSTEM_PROMPTS) {
      const configured = configPrompts[slot.key] ?? null
      entries.push({
        scope: "system",
        key: slot.key,
        label: slot.label,
        group: slot.group,
        prompt: configured ?? slot.defaultPrompt,
        configured_prompt: configured,
        default_prompt: slot.defaultPrompt,
        inherits_core: false,
        description: slot.description,
      })
    }

    // Agent-scope prompts
    for (const agent of agents) {
      const agentCfg = (cfg.agent ?? {})[agent.name]
      const configuredPrompt = agentCfg?.prompt ?? null
      // Use native default (before config override) for built-in agents
      const nativeDefault = agent.native ? Agent.nativeDefaultPrompt(agent.name) : undefined
      const defaultPrompt = nativeDefault ?? ""
      const hasOwnPrompt = !!defaultPrompt
      entries.push({
        scope: "agent",
        key: agent.name,
        label: agent.name,
        group: agentGroup(agent),
        mode: agent.mode,
        prompt: configuredPrompt ?? defaultPrompt,
        configured_prompt: configuredPrompt,
        default_prompt: defaultPrompt,
        inherits_core: !hasOwnPrompt && !configuredPrompt,
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
    const slot = SYSTEM_PROMPTS.find((s) => s.key === key)
    return slot?.defaultPrompt
  }
}
