import FRONTEND_RESEARCH_CORE from "@/prompt/core/frontend-research-core.txt"
import { DeepResearchAgent, runResearchSession, type ResearchSessionConfig } from "@/research/agent"

export namespace FrontendResearchAgent {
  export type RunInput = DeepResearchAgent.RunInput
  export type RunResult = DeepResearchAgent.RunResult

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
    retrievalTools: "none",
    delegation:
      "Orchestrator is asking frontend-research to publish webpage investigation work packets for downstream requirements, architecture, and implementation. " +
      "Use the host-prepared rendered webpage evidence summaries injected into the prompt; the host prepares source URL evidence before your session when a URL is supplied. " +
      "Do not create the frontend implementation template, do not build source, do not produce final REQ-N, acceptance specs, goal graph, implementation plan, or next-tool routing instructions.",
  }
}

export const FrontendResearchTestHooks = {
  frontendResearchSessionConfig,
}
