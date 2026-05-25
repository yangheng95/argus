/**
 * Fact-Check Agent module.
 *
 * Stub closure: this module exists so that `agent/agent.ts` and the
 * orchestrator can reference the role without import errors. The real
 * runtime is filled in by implementation step 5; calling `run()` before
 * that step throws.
 *
 * See specs/fact-check-agent-2026-05-25.md §8 step 1 for the staged-build
 * rationale (every commit must remain build-clean).
 */

export namespace FactCheckAgent {
  export interface RunInput {
    targetSessionID: string
    targetAgent: string
    targetMessageID: string
    targetMessageContentHash: string
    reason: string
    orchestratorSessionID: string
    signal?: AbortSignal
    onSessionCreated?: (sessionID: string) => void
  }

  export interface RunOutput {
    sessionID: string
    report: unknown // Replaced with FactCheckReport in step 5
    outcome: "completed" | "aborted" | "tool_error"
  }

  export async function run(_input: RunInput): Promise<RunOutput> {
    throw new Error(
      "FactCheckAgent.run is not yet implemented (impl step 1 stub; real runtime arrives in step 5).",
    )
  }
}
