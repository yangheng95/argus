import FRONTEND_RESEARCH_CORE from "@/prompt/core/frontend-research-core.txt"
import { ResearchAgent, runResearchSession } from "@/research/agent"
import { createFrontendResearchBuildDelegationTools } from "./build-delegation"

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
      includeRetrievalTools: false,
      createAdditionalTools: ({ runInput, webpagePrdEvidence, getSessionID }) =>
        createFrontendResearchBuildDelegationTools({
          ...runInput,
          webpagePrdEvidence,
          getParentSessionID: getSessionID,
        }),
      delegation:
        "Orchestrator is asking frontend-research to organize webpage research for downstream requirements and architecture. " +
        "Delegate deep source-backed investigation packets to build, then synthesize page functions, layout, style, interactions, content inventory, fidelity acceptance, risks, document outline, and open questions. " +
        "Do not create the frontend implementation template, do not build source, do not produce final REQ-N, acceptance specs, goal graph, implementation plan, or next-tool routing instructions.",
    })
  }
}
