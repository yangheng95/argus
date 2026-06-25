import type { SessionKind } from "./session.sql"
import { AgentRuntimeMetadata } from "./agent-runtime-metadata"

export namespace AutomaticCompaction {
  export const LIVE_RUNTIME_CONTINUATION_SESSION_KINDS = AgentRuntimeMetadata.LIVE_RUNTIME_CONTINUATION_SESSION_KINDS

  export const DISABLED_WORKFLOW_SESSION_KINDS = AgentRuntimeMetadata.DISABLED_AUTOMATIC_COMPACTION_SESSION_KINDS

  export const ORCHESTRATOR_WAKE_SESSION_KINDS =
    AgentRuntimeMetadata.ORCHESTRATOR_WAKE_AUTOMATIC_COMPACTION_SESSION_KINDS

  export const DIRECT_AUTOMATIC_COMPACTION_SESSION_KINDS =
    AgentRuntimeMetadata.DIRECT_AUTOMATIC_COMPACTION_SESSION_KINDS

  export type Decision =
    | { enabled: true; reason: "allowed" | "runtime_continuation_ready" | "orchestrator_wake_ready" }
    | {
        enabled: false
        reason: "runtime_contract_required" | "unsupported_workflow_kind" | "uncategorized_session_kind"
      }

  export function requiresLiveRuntimeContinuation(kind: SessionKind | string): boolean {
    return AgentRuntimeMetadata.LIVE_RUNTIME_CONTINUATION_SESSION_KIND_SET.has(kind as SessionKind)
  }

  export function isDisabledForKind(kind: SessionKind | string): boolean {
    return AgentRuntimeMetadata.DISABLED_AUTOMATIC_COMPACTION_SESSION_KIND_SET.has(kind as SessionKind)
  }

  export function requiresOrchestratorWakeContinuation(kind: SessionKind | string): boolean {
    return AgentRuntimeMetadata.ORCHESTRATOR_WAKE_AUTOMATIC_COMPACTION_SESSION_KIND_SET.has(kind as SessionKind)
  }

  export function isDirectlyAllowedForKind(kind: SessionKind | string): boolean {
    return AgentRuntimeMetadata.DIRECT_AUTOMATIC_COMPACTION_SESSION_KIND_SET.has(kind as SessionKind)
  }

  export function decision(input: { sessionKind: SessionKind | string; runtimeContinuationReady?: boolean }): Decision {
    if (AgentRuntimeMetadata.DISABLED_AUTOMATIC_COMPACTION_SESSION_KIND_SET.has(input.sessionKind as SessionKind)) {
      return { enabled: false, reason: "unsupported_workflow_kind" }
    }
    if (AgentRuntimeMetadata.LIVE_RUNTIME_CONTINUATION_SESSION_KIND_SET.has(input.sessionKind as SessionKind)) {
      if (input.runtimeContinuationReady === true) {
        return { enabled: true, reason: "runtime_continuation_ready" }
      }
      return { enabled: false, reason: "runtime_contract_required" }
    }
    if (
      AgentRuntimeMetadata.ORCHESTRATOR_WAKE_AUTOMATIC_COMPACTION_SESSION_KIND_SET.has(
        input.sessionKind as SessionKind,
      )
    ) {
      if (input.runtimeContinuationReady === true) {
        return { enabled: true, reason: "orchestrator_wake_ready" }
      }
      return { enabled: false, reason: "runtime_contract_required" }
    }
    if (AgentRuntimeMetadata.DIRECT_AUTOMATIC_COMPACTION_SESSION_KIND_SET.has(input.sessionKind as SessionKind)) {
      return { enabled: true, reason: "allowed" }
    }
    return { enabled: false, reason: "uncategorized_session_kind" }
  }
}
