// ── Direct-reply kind whitelist (overlay mirror) ──
//
// Mirrors DIRECT_REPLY_AGENT_KIND_VALUES from
// packages/opencorvus/src/orchestrator/direct-reply.ts. Kept in sync by
// the test in test/direct-reply-kinds.test.ts which imports both copies
// and asserts equality, so a backend route-capability change that is not
// mirrored here fails CI loudly.
//
// Why a mirror at all? Each card node already carries its `stage` /
// `phaseSessionKind` locally, and tests use this module to pin the
// frontend's understanding of the backend direct-reply route. The reply
// box itself intentionally renders for every non-root agent session; route
// refusals are surfaced as structured 4xx by AgentSessionReplyBox.
//
// rule 8 (single source) is preserved by the equality test, not by
// pretending the mirror does not exist.

export const DIRECT_REPLY_AGENT_KINDS: ReadonlySet<string> = new Set([
  "assistant",
  "intent-analysis",
  "requirements",
  "frontend-design",
  "goal",
  "architect",
  "integrity",
  "acceptance",
  "evaluator",
])

export function canReceiveDirectAgentReply(kind: string | undefined | null): boolean {
  return !!kind && DIRECT_REPLY_AGENT_KINDS.has(kind)
}
