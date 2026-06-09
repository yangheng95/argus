import type { SessionKind } from "./session.sql"

export namespace AgentRuntimeMetadata {
  export const AGENT_OWNED_SESSION_KINDS = [
    "orchestrator",
    "mission",
    "intent-analysis",
    "requirements",
    "frontend-design",
    "goal-workload-analyst",
    "architect",
    "integrity",
    "fact-check",
    "acceptance",
    "build",
    "explore",
    "deep-research",
    "frontend-research",
    "visual-qa",
  ] as const satisfies readonly SessionKind[]

  export const RUNTIME_CONTRACT_REQUIRED_AGENT_KINDS = [
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
    "deep-research",
    "requirements",
    "visual-qa",
  ] as const satisfies readonly SessionKind[]

  export const EXACT_RUNTIME_CONTRACT_AGENT_KINDS = [
    "architect",
    "fact-check",
    "frontend-design",
    "frontend-research",
    "goal-workload-analyst",
    "intent-analysis",
    "requirements",
    "deep-research",
    "visual-qa",
  ] as const satisfies readonly SessionKind[]

  export const LIVE_RUNTIME_CONTINUATION_SESSION_KINDS = [
    "build",
    "frontend-design",
    "integrity",
    "visual-qa",
  ] as const satisfies readonly SessionKind[]

  export const DISABLED_AUTOMATIC_COMPACTION_SESSION_KINDS = [
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

  export const AGENT_OWNED_SESSION_KIND_SET = new Set<SessionKind>(AGENT_OWNED_SESSION_KINDS)
  export const RUNTIME_CONTRACT_REQUIRED_AGENT_KIND_SET = new Set<SessionKind>(
    RUNTIME_CONTRACT_REQUIRED_AGENT_KINDS,
  )
  export const EXACT_RUNTIME_CONTRACT_AGENT_KIND_SET = new Set<SessionKind>(EXACT_RUNTIME_CONTRACT_AGENT_KINDS)
  export const LIVE_RUNTIME_CONTINUATION_SESSION_KIND_SET = new Set<SessionKind>(
    LIVE_RUNTIME_CONTINUATION_SESSION_KINDS,
  )
  export const DISABLED_AUTOMATIC_COMPACTION_SESSION_KIND_SET = new Set<SessionKind>(
    DISABLED_AUTOMATIC_COMPACTION_SESSION_KINDS,
  )
}
