import FRONTEND_RESEARCH_CORE from "@/prompt/core/frontend-research-core.txt"
import { ResearchAgent, runResearchSession } from "@/research/agent"

export namespace FrontendResearchAgent {
  export type RunInput = ResearchAgent.RunInput
  export type RunResult = ResearchAgent.RunResult

  export async function run(input: RunInput): Promise<RunResult> {
    return runResearchSession(input, {
      kind: "frontend-research",
      core: FRONTEND_RESEARCH_CORE,
      sessionTitlePrefix: "Frontend Research",
      prepareWebpageEvidence: "always-for-source-url",
      bundlePathKind: "frontend-research",
      delegation:
        "Orchestrator is asking frontend-research to gather source-backed webpage functional and visual evidence for downstream requirements and architecture. " +
        "Return page functions, layout, style, interactions, content inventory, fidelity acceptance, risks, document outline, and open questions only. " +
        "Do not create the frontend implementation template, do not build source, do not produce final REQ-N, acceptance specs, goal graph, implementation plan, or next-tool routing instructions.",
    })
  }
}
