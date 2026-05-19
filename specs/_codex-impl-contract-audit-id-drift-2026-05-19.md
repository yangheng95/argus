# CODEX IMPLEMENTATION TASK — contract_audit contract_id referential binding

AUTHORITATIVE PLAN (read first, implement EXACTLY, do not redesign):
C:\Users\chuan\myhexin-local\opecorvus\specs\_codex-contract-audit-id-drift-decision-2026-05-19.md

This decision is already adjudicated (3 reviewers + codex终局裁决). Your job is
implementation only. Do NOT re-litigate the approach. Do NOT add auto-attach /
pre-dispatch re-link / delivery-gate derivation (rule-13 forbidden).

REPO: C:\Users\chuan\myhexin-local\opecorvus  PACKAGE: packages/opencorvus

## Implement EXACTLY these 6 change sites
1. `src/architect/output-tools.ts` register_goal.execute (~:450): reject any
   `acceptance_specs[].scorers[type==contract_audit].spec.contract_ids` entry not present
   in the collector's already-registered graph contracts. On reject: return an actionable
   error (list the unknown ids + that they must be ids from register_contract), and leave
   `collector.goals` UNCHANGED. MIRROR the existing `register_dependency_contract` unknown
   contract_ids rejection (~:769) — same error shape/class, do NOT invent a parallel
   mechanism (rule 9/35).
2. `src/architect/output-tools.ts` modify_goal.execute (~:491): same rejection when
   `updates.acceptance_specs` is supplied; leave the prior goal UNCHANGED on reject.
3. `src/architect/output-tools.ts` register_contract result (~:717): include the current
   set of registered contract ids in the tool's returned text/payload so the model copies
   authoritative ids from tool output (not memory/prose).
4. `src/architect/contract-graph.ts` validateArchitectContractGraph (~:322, fn def ~:128):
   add an INVERSE finding code `contract_audit_unknown_contract` at severity **blocker**:
   for every goal's `contract_audit` scorer, every contract id must resolve to a registered
   graph contract id. REUSE the existing `contractIDs` set already built in that function
   and the existing `essentialAcceptanceContractGraphIDsByGoal` traversal shape — do not
   parallel-implement the traversal. Keep the existing forward `contract_without_audit_
   coverage` concern intact (do not double-fire on the same goal/contract pair).
5. `src/orchestrator/tools.ts` pre-dispatch (~:5736, after the persisted
   architect_contract_graph is loaded, BEFORE build agent open/run): run the same
   graph/goal referential validation; if any `contract_audit_unknown_contract` exists,
   THROW before opening or running the build (covers legacy/corrupt persisted state).
   Do NOT remove the post-build `runGoalContractAuditCriteria` path (~:6052) — it stays
   as defense-in-depth, just no longer the first unknown-id detector.
6. `src/prompt/core/architect-core.txt` (~:57): add ONE sentence:
   `contract_audit.contract_ids must be copied from already-registered contract ids
   returned by register_contract; unknown ids are rejected.`

Do NOT change `src/acceptance/types.ts` ContractAuditScorerSchema structurally (keep it;
dynamic collector validation must NOT move into static Zod). Do NOT change
`src/acceptance/contract-audit.ts` audit logic.

## Mandatory tests (rule 28/36) — add and make green
- `test/architect/output-tools.test.ts`:
  (1) validateArchitectContractGraph → blocker `contract_audit_unknown_contract` for an
      audit scorer id absent from graph.contracts; (2) all ids present → no such blocker
      and no double-fire with contract_without_audit_coverage; (3) submit_architect blocks
      that mismatch, collector.finalized stays false; (4) register_goal rejects unknown
      audit contract_ids, collector.goals unchanged; (5) modify_goal rejects unknown,
      prior goal unchanged; (6) register_goal/modify_goal accepts the SAME scorer after
      the contract is registered; (7) incident regression: graph ids exactly
      [ct-types-viewmodel,ct-types-messageargs,ct-data-accessor,ct-sync-broadcast-fn,
      ct-mcp-export], audit ids [ct-data-keyvalueitem,ct-data-hookresult,ct-config-
      accessor,ct-sync-broadcast-fn,ct-types-viewmodel] → exactly the 3 drifted ids
      flagged as blockers, the 2 valid not.
- orchestrator test (`test/orchestrator/tools.test.ts` or the right existing file):
  pre-dispatch validation rejects a persisted graph/goal mismatch BEFORE build starts.
- `test/agent/core-prompt-hygiene.test.ts`: assert architect-core.txt contains the new
  binding sentence.
- Keep existing register_dependency_contract unknown-id tests passing (same rule class).

## Verification before you finish
- Run the affected test files via bun test and iterate until GREEN:
  `bun test packages/opencorvus/test/architect/output-tools.test.ts`
  plus the orchestrator + core-prompt-hygiene test files you touched.
- Run typecheck if available (`bun run --cwd packages/opencorvus typecheck` or the repo's
  typecheck script). If `tsc` is not installed (`command not found: tsc`), report that
  fact but do NOT block — the parent handles push-toolchain separately.

## HARD CONSTRAINTS
- DO NOT run `git add`, `git commit`, `git stash`, `git checkout --`, or `git push`.
  The working tree contains ~30 UNRELATED uncommitted WIP files (overlay + inspect_only
  build) including unrelated edits in `orchestrator/tools.ts` and
  `test/agent/core-prompt-hygiene.test.ts`. The parent will do precise hunk-scoped
  staging. You must ONLY edit source/test files and leave them uncommitted.
- Touch ONLY the files listed above. Do not reformat or edit unrelated regions of
  tools.ts / core-prompt-hygiene.test.ts — keep your edits surgical and far from the
  existing uncommitted hunks (your tools.ts edit is ~5736, the WIP is ~5457-5530).
- Match surrounding code style/idiom. No state machine. No fallback/compat. No
  hardcoded ids — drive off the collector's registered contract set.
- When done, output a concise summary: files changed, the exact functions/lines,
  test results (pass/fail counts), and any typecheck status.
