// ── Direct-reply kind whitelist (overlay mirror) ──
//
// Mirrors DIRECT_REPLY_AGENT_KIND_VALUES from
// packages/opencorvus/src/orchestrator/direct-reply.ts. Kept in sync by
// the test in test/direct-reply-kinds.test.ts which imports both copies
// and asserts equality, so a backend addition that is not mirrored here
// fails CI loudly instead of silently letting the overlay show a reply
// box on a kind the route will refuse with 400.
//
// Why a mirror at all? Each card node already carries its `stage` /
// `phaseSessionKind` locally, so deciding "should the reply box be
// shown for THIS card" only needs the kind set, not a per-session
// server roundtrip. Adding a `canDirectReply` field to the conversation
// event would be redundant for the kind branch (the other branches —
// runtime contract presence, envelope readiness — are surfaced as
// structured 4xx by the reply route itself, see AgentSessionReplyBox).
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
  "delivery",
  "evaluator",
]);

export function canReceiveDirectAgentReply(kind: string | undefined | null): boolean {
  return !!kind && DIRECT_REPLY_AGENT_KINDS.has(kind);
}
