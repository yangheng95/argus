import type { ToolSet } from "ai"
import type { AgentRoleID } from "./role-contract"
import { createAiSdkToolFromInfo } from "@/tool/ai-sdk-adapter"
import { RequestOrchestratorDecisionTool } from "@/tool/request-orchestrator-decision"

/**
 * A2A (Agent-to-Agent) worker coordination runtime tools.
 * Exact runtime contracts skip the global registry, so task workers must merge
 * this helper into their concrete runAgentSession toolKit.
 */
export async function createAgentCoordinationRuntimeTools(input: {
  agent: AgentRoleID
  taskID?: string
  signal?: AbortSignal
}): Promise<ToolSet> {
  return {
    request_orchestrator_decision: await createAiSdkToolFromInfo({
      info: RequestOrchestratorDecisionTool,
      agent: input.agent,
      taskID: input.taskID,
      signal: input.signal,
    }),
  }
}
