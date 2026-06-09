import type { SessionKind } from "./session.sql"

export namespace AutomaticCompaction {
  export const LIVE_RUNTIME_CONTINUATION_SESSION_KINDS = [
    "build",
    "frontend-design",
    "integrity",
  ] as const satisfies readonly SessionKind[]

  export const DISABLED_WORKFLOW_SESSION_KINDS = [
    "architect",
    "acceptance",
    "fact-check",
    "frontend-research",
    "goal-workload-analyst",
    "intent-analysis",
    "orchestrator",
    "deep-research",
    "requirements",
  ] as const satisfies readonly SessionKind[]

  export type Decision =
    | { enabled: true; reason: "allowed" | "runtime_continuation_ready" }
    | { enabled: false; reason: "runtime_contract_required" | "unsupported_workflow_kind" }

  const liveRuntimeContinuationSessionKinds = new Set<SessionKind>(LIVE_RUNTIME_CONTINUATION_SESSION_KINDS)
  const disabledWorkflowSessionKinds = new Set<SessionKind>(DISABLED_WORKFLOW_SESSION_KINDS)

  export function requiresLiveRuntimeContinuation(kind: SessionKind | string): boolean {
    return liveRuntimeContinuationSessionKinds.has(kind as SessionKind)
  }

  export function isDisabledForKind(kind: SessionKind | string): boolean {
    return disabledWorkflowSessionKinds.has(kind as SessionKind)
  }

  export function decision(input: { sessionKind: SessionKind | string; runtimeContinuationReady?: boolean }): Decision {
    if (disabledWorkflowSessionKinds.has(input.sessionKind as SessionKind)) {
      return { enabled: false, reason: "unsupported_workflow_kind" }
    }
    if (liveRuntimeContinuationSessionKinds.has(input.sessionKind as SessionKind)) {
      if (input.runtimeContinuationReady === true) {
        return { enabled: true, reason: "runtime_continuation_ready" }
      }
      return { enabled: false, reason: "runtime_contract_required" }
    }
    return { enabled: true, reason: "allowed" }
  }
}
