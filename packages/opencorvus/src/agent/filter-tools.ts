/**
 * Filter a shared tool map through an agent's Agent.Info.tools include/exclude
 * list so users can restrict tool access per sub-agent via opencorvus.jsonc:
 *
 *   {
 *     "agent": {
 *       "architect": { "tools": { "exclude": ["web_search"] } }
 *     }
 *   }
 *
 * Only shared tools (e.g. everything returned by `createPlannerTools()`)
 * should pass through this filter. Structured-output tools created by the
 * sub-agent's own factory (register_contract, register_design_analysis, …)
 * bypass it — they are the agent's contract with the orchestrator and must
 * not be disabled by user config.
 */
import { Agent } from "./agent"

export async function filterAgentTools<T extends Record<string, unknown>>(
  tools: T,
  agentName: string,
): Promise<T> {
  const agent = await Agent.get(agentName).catch(() => undefined)
  const filter = agent?.tools
  if (!filter) return tools
  const include = filter.include
  const exclude = filter.exclude
  const entries = Object.entries(tools).filter(([name]) => {
    if (include && include.length > 0 && !include.includes(name)) return false
    if (exclude?.includes(name)) return false
    return true
  })
  return Object.fromEntries(entries) as T
}
