/**
 * Per-agent model resolution.
 *
 * Single source of truth for "which model does agent X use?". Resolution order:
 *   1. Agent.Info.model (merged from user config `agent.<name>.model`)
 *   2. Project default (Provider.defaultModel())
 *
 * Agents listed in STRONG_AGENTS never receive an injected haiku default —
 * they always fall through to Provider.defaultModel() unless the user has
 * explicitly overridden them in config. This preserves the "expensive path"
 * for the agents that actually write code or orchestrate end-to-end work.
 *
 * All other registered agents are automatically assigned the hexin haiku
 * default (at Agent.state() construction time) so cheap inference is the
 * default for spec/plan/explore/requirements/etc.
 */
import { Agent } from "./agent"
import { Provider } from "../provider/provider"

/**
 * Agents whose default model must remain the project-wide powerful model
 * (Provider.defaultModel()). These actually execute code or own the whole
 * task lifecycle, so they should not be silently downgraded to a cheap
 * haiku-class model.
 */
export const STRONG_AGENTS: ReadonlySet<string> = new Set([
  "task",
  "build",
  "delivery",
  "general",
])

/**
 * Resolve the Provider.Model for a given agent by name.
 *
 * - If Agent.Info.model is set → honor it (user config wins).
 *   A resolution failure here is NOT silently swallowed: the user explicitly
 *   chose this model, so a missing provider/model surfaces as an error rather
 *   than being papered over with the default (which would hide the root cause).
 * - Otherwise → Provider.defaultModel().
 */
export async function resolveAgentModel(name: string): Promise<Provider.Model> {
  const agent = await Agent.get(name)
  if (agent?.model) {
    return Provider.getModel(agent.model.providerID, agent.model.modelID)
  }
  const def = await Provider.defaultModel()
  return Provider.getModel(def.providerID, def.modelID)
}
