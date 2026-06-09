import type { SessionKind } from "./session.sql"
import { AgentRuntimeMetadata } from "./agent-runtime-metadata"

export namespace SessionAgentIdentity {
  export function ownedAgentForSessionKind(kind: SessionKind): string | undefined {
    return AgentRuntimeMetadata.AGENT_OWNED_SESSION_KIND_SET.has(kind) ? kind : undefined
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
