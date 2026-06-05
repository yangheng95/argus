import type { SessionKind } from "./session.sql"

const AGENT_OWNED_SESSION_KINDS = new Set<SessionKind>([
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
])

export namespace SessionAgentIdentity {
  export function ownedAgentForSessionKind(kind: SessionKind): string | undefined {
    return AGENT_OWNED_SESSION_KINDS.has(kind) ? kind : undefined
  }

  export function applyToPrompt<T extends { agent?: string }>(kind: SessionKind, prompt: T): T {
    const ownedAgent = ownedAgentForSessionKind(kind)
    if (!ownedAgent) return prompt
    return {
      ...prompt,
      agent: ownedAgent,
    }
  }

  export function resolveForWake(input: { sessionKind: SessionKind; requestedAgent?: string }): string | undefined {
    return ownedAgentForSessionKind(input.sessionKind) ?? input.requestedAgent
  }
}
