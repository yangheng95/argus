import { AgentRoleContract } from "@/agent/role-contract"

export const NON_EXECUTOR_SOURCE_BOUNDARY_PROMPT = `## Non-Executor Source Boundary

Build, Integrity, and Visual QA are the only roles expected to perform broad project-source implementation, final acceptance repair, or visual validation sweeps. Every other agent must keep source inspection narrow: read only files, evidence artifacts, and role-owned outputs directly needed for the assigned deliverable; do not read or write broad project source areas; do not load task-irrelevant skills. If broad implementation changes, final acceptance repair, or visual validation are required, report the concrete need and hand it to Build, Integrity, or Visual QA instead of crossing roles.`

export function shouldAppendNonExecutorSourceBoundary(agentID: string): boolean {
  return !AgentRoleContract.isNonExecutorSourceBoundaryExempt(agentID)
}

export function appendNonExecutorSourceBoundary(input: { agentID: string; prompt: string }): string {
  if (!shouldAppendNonExecutorSourceBoundary(input.agentID)) return input.prompt
  if (input.prompt.includes("## Non-Executor Source Boundary")) return input.prompt
  return [input.prompt.trimEnd(), NON_EXECUTOR_SOURCE_BOUNDARY_PROMPT].join("\n\n")
}
