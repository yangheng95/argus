/**
 * Goal Workload Analyst — independent goal-sizing reviewer + execution-inventory
 * producer. Runs after Architect, before per-goal Build.
 *
 * Thin shell over `runAgentSession` (rule 24), same shape as architect/agent.ts:
 * the agent-specific code is the user-prompt constructor and the output tool kit;
 * the runner owns model resolution, session creation, system-prompt composition,
 * stream-error capture, and abort propagation.
 *
 * Read-only by construction: the tool surface is the read-only context tools
 * (filtered by the agent's tool pool assignment) plus the two structured-output tools.
 * No write / edit / bash — there is no implementation pressure, which is the
 * whole point (spec §0).
 */
import { runAgentSession } from "@/agent/runner"
import type { AgentSessionContinuation } from "@/engine/stage-continuation"
import { withFactCheckRegistration } from "@/prompt/fragments/fact-check-registration"
import { createAgentContextTools } from "@/agent/context-tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import { createGoalWorkloadOutputTools } from "./output-tools"
import { buildWorkloadUserPrompt, type WorkloadPromptInput } from "./prompt"
import type { WorkloadBrief } from "./types"

import GOAL_WORKLOAD_ANALYST_CORE from "@/prompt/core/goal-workload-analyst-core.txt"

const log = Log.create({ service: "goal-workload-analyst" })

export namespace GoalWorkloadAnalystAgent {
  export interface AnalyzeInput extends WorkloadPromptInput {
    /** Architect spec snapshot this analysis targets (staleness key on the artifact). */
    specSnapshotID: string
    taskID?: string
    parentSessionID?: string
    model?: { providerID: string; modelID: string }
    signal?: AbortSignal
    onStatus?: (summary: string) => void | Promise<void>
    onSessionCreated?: (sessionID: string) => void
    continuation?: AgentSessionContinuation
  }

  export interface AnalyzeResult {
    briefs: WorkloadBrief[]
    specSnapshotID: string
    summary: string
    sessionID: string
  }

  export async function analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    const knownGoalIDs = input.goals.map((g) => g.id)
    const knownContractIDs = (input.contractGraph?.contracts ?? []).map((c) => c.id)
    const outputToolKit = createGoalWorkloadOutputTools({ knownGoalIDs, knownContractIDs })
    const contextTools = await filterAgentTools(createAgentContextTools(), "goal-workload-analyst", {
      taskID: input.taskID,
      sessionID: input.parentSessionID,
    })

    log.info("goal-workload-analyst starting", {
      goals: input.goals.length,
      contracts: knownContractIDs.length,
      hastemplate: Boolean(input.prdFullText?.trim()),
    })

    const out = await runAgentSession({
      kind: "goal-workload-analyst",
      core: withFactCheckRegistration(GOAL_WORKLOAD_ANALYST_CORE),
      sessionTitle: `Workload: ${input.taskTitle}`,
      parentSessionID: input.parentSessionID,
      taskID: input.taskID,
      model: input.model,
      signal: input.signal,
      continuation: input.continuation,
      onStatus: input.onStatus ?? (() => {}),
      onSessionCreated: input.onSessionCreated
        ? (session) => {
            input.onSessionCreated!(session.id)
          }
        : undefined,
      toolKit: {
        tools: { ...contextTools, ...outputToolKit.tools },
        getCollector: () => outputToolKit.getCollector(),
        buildReport: () => outputToolKit.buildReport(),
      },
      buildUserPrompt: () => buildWorkloadUserPrompt(input),
      terminalTool: {
        toolName: "submit_workload_analysis",
        isSatisfied: (collector) => collector.finalized,
        // Must use the toolKit predicate so terminal scoping never disagrees with
        // submit's own validation (rule 8 — single source).
        shouldExposeOnlyTerminalTool: () => outputToolKit.isReadyToFinalize(),
      },
    })

    const collector = outputToolKit.getCollector()
    if (!collector.finalized) {
      throw new Error(
        "Goal Workload Analyst did not call submit_workload_analysis. It must register a workload brief per goal, then submit.",
      )
    }

    log.info("goal-workload-analyst finished", {
      sessionID: out.session.id,
      briefs: collector.briefs.length,
      flagged: collector.briefs.filter((b) => b.decomposition_concern?.trim()).length,
    })

    return {
      briefs: collector.briefs,
      specSnapshotID: input.specSnapshotID,
      summary: collector.summary,
      sessionID: out.session.id,
    }
  }
}
