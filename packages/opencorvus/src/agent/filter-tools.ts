/**
 * Filter a shared tool map through an agent's Agent.Info.tools pool assignment
 * so custom agents can restrict tool access via opencorvus.jsonc:
 *
 *   {
 *     "agent": {
 *       "my-reviewer": { "tools": { "global": ["read", "glob", "search_code"] } }
 *     }
 *   }
 *
 * Only shared tools (e.g. everything returned by `createAgentContextTools()`)
 * should pass through this filter. Structured-output tools created by the
 * sub-agent's own factory (register_contract, register_frontend_design, …)
 * bypass it — they are the agent's contract with the orchestrator and must
 * not be disabled by user config.
 */
import { Agent } from "./agent"
import { EffectiveConfig } from "@/config/effective"
import { AgentToolPool } from "./tool-pool-contract"

export async function filterAgentTools<T extends Record<string, unknown>>(
  tools: T,
  agentName: string,
  opts?: { taskID?: string; sessionID?: string },
): Promise<T> {
  // Agent.get returns undefined for unconfigured agents; any thrown error
  // (config parse, store failure) propagates so the filter doesn't silently
  // run with a permissive tool set.
  const agent = await Agent.get(agentName, { config: await EffectiveConfig.effective(opts) })
  const filter = agent?.tools
  if (!filter) return tools
  const visible = AgentToolPool.visibleToolIDs(filter)
  const entries = Object.entries(tools).filter(([name]) => {
    return visible.has(name)
  })
  return Object.fromEntries(entries) as T
}
