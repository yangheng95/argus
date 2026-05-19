# DECISION — contract_audit contract_id drift: referential-binding mechanism fix (2026-05-19)

Authoritative decision. Supersedes the candidate analysis in
`_codex-q-contract-audit-id-drift-2026-05-19.md`. Source: 3 independent reviewers
(consensus) + codex终局裁决 (session 019e3e5f, gpt-5.5, read-only).

## Empirical basis
- contract_audit gate: 0 pass across 7 tasks / 7 contract graphs. First & only real
  trigger (tsk_e3e0914d5001jPc5fQINpgBWsZ G3) failed on id drift POST-build (~14 min wasted).
- => mechanism problem, not model problem (user's framing, empirically confirmed).

## Root cause (consensus)
`contract_audit.spec.contract_ids` is an UNBOUND second string namespace beside
`contract_graph.contracts[].id`. Architect authors both in one session via two tools
(`register_goal` / `register_contract`) with two free-form schemas and zero referential
binding. = rule-8 double source. slice ① (1b19be2fa) added only the FORWARD concern;
no INVERSE referential check existed; mismatch detected only post-build.

## Verdict: Candidate X + strengthening. Candidate Y (finalize-blocker + prompt only) REJECTED
A single authored list is NOT required and host-derivation stays rule-13-forbidden.
What IS required: a FOREIGN-KEY invariant — graph contract id is authoritative identity;
audit `contract_ids` is a reference into it, validated at the AUTHORING boundary.
This is the same data-integrity class as the existing `register_dependency_contract`
unknown-id rejection (output-tools.ts ~769) — NOT a host state machine.

## Change set (rule 35)
CHANGE:
- `src/architect/output-tools.ts:450` register_goal.execute — reject any
  `contract_audit.spec.contract_ids` not in `collector.contract_graph.contracts`; leave
  collector.goals unchanged on reject.
- `src/architect/output-tools.ts:491` modify_goal.execute — same when
  `updates.acceptance_specs` supplied; prior goal unchanged on reject.
- `src/architect/output-tools.ts:717` register_contract result — expose current
  registered contract id set so the model copies authoritative ids from tool output.
- `src/architect/contract-graph.ts:322` validateArchitectContractGraph — add INVERSE
  blocker `contract_audit_unknown_contract` (every audit contract id resolves to a
  registered graph contract). Reuse existing `contractIDs` set / `essentialAcceptance
  ContractGraphIDsByGoal` traversal — no parallel impl (rule 9).
- `src/orchestrator/tools.ts:~5736` — pre-dispatch: after persisted
  architect_contract_graph load, run the same referential validation and THROW before
  opening/running build if any `contract_audit_unknown_contract` (covers legacy/corrupt
  persisted state). Fixes the timing defect (was post-build ~6053).
- `src/prompt/core/architect-core.txt:57` — one sentence: contract_audit.contract_ids
  must be copied from ids returned by register_contract; unknown ids are rejected.

STAY (defense-in-depth, not first detector):
- `src/acceptance/contract-audit.ts:56` — still runs the real static code audit.
- `src/orchestrator/tools.ts:~6052` runGoalContractAuditCriteria — still runs post-build,
  but unknown-id discovery no longer lives here as first detector.
- `src/acceptance/types.ts:86` ContractAuditScorerSchema — keep structural schema;
  dynamic collector validation must NOT move into static Zod (graph not in scope).
- No auto-attach / pre-dispatch re-link / delivery-gate derivation (rule-13, prior codex).

## Mandatory tests (rule 28/36)
1. validateArchitectContractGraph → blocker `contract_audit_unknown_contract` for an
   audit scorer id absent from graph.contracts.
2. submit_architect blocks that inverse mismatch; collector.finalized stays false.
3. register_goal rejects unknown contract_audit.contract_ids; collector.goals unchanged.
4. modify_goal rejects unknown contract_audit.contract_ids; prior goal unchanged.
5. register_goal/modify_goal accepts the same scorer AFTER the contract is registered.
6. Pre-dispatch orchestrator validation rejects a persisted graph/goal mismatch BEFORE
   build starts (timing-defect regression lock).
7. Existing register_dependency_contract unknown-id tests remain (same rule class proof).
8. core-prompt-hygiene: architect-core.txt contains the new binding sentence.

## Hazard note
contract-graph.ts / output-tools.ts may be touched by a concurrent refactor cron
(memory: concurrent-automation races git index). Verify HEAD ownership + use isolated
out-of-repo worktree before implementing; the decision stands regardless of line drift.
