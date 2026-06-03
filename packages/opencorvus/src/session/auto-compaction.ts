import type { SessionKind } from "./session.sql"

export namespace AutomaticCompaction {
  export const DISABLED_WORKFLOW_SESSION_KINDS = [
    "architect",
    "build",
    "acceptance",
    "fact-check",
    "frontend-design",
    "frontend-research",
    "goal-workload-analyst",
    "integrity",
    "intent-analysis",
    "orchestrator",
    "research",
    "requirements",
  ] as const satisfies readonly SessionKind[]

  const disabledWorkflowSessionKinds = new Set<SessionKind>(DISABLED_WORKFLOW_SESSION_KINDS)

  export function isDisabledForKind(kind: SessionKind | string): boolean {
    return disabledWorkflowSessionKinds.has(kind as SessionKind)
  }
}
