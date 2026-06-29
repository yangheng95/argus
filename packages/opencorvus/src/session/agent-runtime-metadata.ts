import { AgentRoleContract } from "@/agent/role-contract"
import { SESSION_KINDS, type SessionKind } from "./session.sql"

function contractForSessionKind(kind: SessionKind) {
  return AgentRoleContract.isRoleID(kind) ? AgentRoleContract.get(kind) : undefined
}

function filterSessionKinds(
  predicate: (kind: SessionKind, contract: ReturnType<typeof contractForSessionKind>) => boolean,
): readonly SessionKind[] {
  return SESSION_KINDS.filter((kind) => predicate(kind, contractForSessionKind(kind)))
}

export namespace AgentRuntimeMetadata {
  export const AGENT_OWNED_SESSION_KINDS = filterSessionKinds((kind, contract) => {
    if (kind === "acceptance") return true
    return contract?.agentOwnedSessionKind === true
  })

  export const RUNTIME_CONTRACT_REQUIRED_AGENT_KINDS = filterSessionKinds((kind, contract) => {
    if (kind === "acceptance") return true
    return contract?.runtimeContractRequired === true
  })

  export const EXACT_RUNTIME_CONTRACT_AGENT_KINDS = filterSessionKinds(
    (_kind, contract) => contract?.exactRuntimeContract === true,
  )

  export const LIVE_RUNTIME_CONTINUATION_SESSION_KINDS = filterSessionKinds(
    (_kind, contract) => contract?.liveRuntimeContinuation === true,
  )

  export const DISABLED_AUTOMATIC_COMPACTION_SESSION_KINDS = ["acceptance"] as const satisfies readonly SessionKind[]

  export const ORCHESTRATOR_WAKE_AUTOMATIC_COMPACTION_SESSION_KINDS = [
    "orchestrator",
  ] as const satisfies readonly SessionKind[]

  export const DIRECT_AUTOMATIC_COMPACTION_SESSION_KINDS = [
    "root",
    "assistant",
    "mission",
    "goal",
    "executor",
    "evaluator",
    "system",
  ] as const satisfies readonly SessionKind[]

  export const AGENT_OWNED_SESSION_KIND_SET = new Set<SessionKind>(AGENT_OWNED_SESSION_KINDS)
  export const RUNTIME_CONTRACT_REQUIRED_AGENT_KIND_SET = new Set<SessionKind>(RUNTIME_CONTRACT_REQUIRED_AGENT_KINDS)
  export const EXACT_RUNTIME_CONTRACT_AGENT_KIND_SET = new Set<SessionKind>(EXACT_RUNTIME_CONTRACT_AGENT_KINDS)
  export const LIVE_RUNTIME_CONTINUATION_SESSION_KIND_SET = new Set<SessionKind>(
    LIVE_RUNTIME_CONTINUATION_SESSION_KINDS,
  )
  export const DISABLED_AUTOMATIC_COMPACTION_SESSION_KIND_SET = new Set<SessionKind>(
    DISABLED_AUTOMATIC_COMPACTION_SESSION_KINDS,
  )
  export const ORCHESTRATOR_WAKE_AUTOMATIC_COMPACTION_SESSION_KIND_SET = new Set<SessionKind>(
    ORCHESTRATOR_WAKE_AUTOMATIC_COMPACTION_SESSION_KINDS,
  )
  export const DIRECT_AUTOMATIC_COMPACTION_SESSION_KIND_SET = new Set<SessionKind>(
    DIRECT_AUTOMATIC_COMPACTION_SESSION_KINDS,
  )
}
