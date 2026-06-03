import FRONTEND_RESEARCH_CORE from "@/prompt/core/frontend-research-core.txt"
import { ResearchAgent, runResearchSession, type ResearchSessionConfig } from "@/research/agent"

export namespace FrontendResearchAgent {
  export type RunInput = ResearchAgent.RunInput
  export type RunResult = ResearchAgent.RunResult

  export async function run(input: RunInput): Promise<RunResult> {
    return runResearchSession(input, frontendResearchSessionConfig())
  }
}

function frontendResearchSessionConfig(): ResearchSessionConfig {
  return {
    kind: "frontend-research",
    core: FRONTEND_RESEARCH_CORE,
    sessionTitlePrefix: "Frontend Research",
    prepareWebpageEvidence: "always-for-source-url",
    bundlePathKind: "frontend-research",
    delegation:
      "Orchestrator is asking frontend-research to perform read-only webpage research for downstream requirements and architecture. " +
      "Investigate the supplied page directly from prepared evidence and read-only source retrieval, then synthesize page functions, layout, style, interactions, content inventory, fidelity acceptance, risks, document outline, and open questions. " +
      "Do not create the frontend implementation template, do not build source, do not produce final REQ-N, acceptance specs, goal graph, implementation plan, or next-tool routing instructions.",
  }
}

export const FrontendResearchTestHooks = {
  frontendResearchSessionConfig,
}
