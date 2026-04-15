/**
 * Per-agent model resolution.
 *
 * Single source of truth for "which model does agent X use?". Resolution order:
 *   1. Agent.Info.model (from user config `agent.<name>.model`)
 *   2. Project default (Provider.defaultModel(), i.e. top-level `model` in config)
 */
import { Agent } from "./agent"
import { Provider } from "../provider/provider"

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
