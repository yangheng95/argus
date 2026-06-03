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
    prepareWebpageEvidence: "read-existing-for-source-url",
    bundlePathKind: "frontend-research",
    retrievalTools: "none",
    delegation:
      "Orchestrator is asking frontend-research to publish webpage investigation work packets for downstream requirements, architecture, and implementation. " +
      "Use only supplied prompt context and prepared evidence summaries already injected by the host; do not perform source-page, artifact, repository, or web investigation yourself. " +
      "Do not create the frontend implementation template, do not build source, do not produce final REQ-N, acceptance specs, goal graph, implementation plan, or next-tool routing instructions.",
  }
}

export const FrontendResearchTestHooks = {
  frontendResearchSessionConfig,
}
