# CODEX ADJUDICATION REQUEST — contract_audit contract_id drift: mechanism vs model fix

You previously adjudicated the slice-① work (commit 1b19be2fa). This reopens an adjacent
question with new empirical evidence. Give a DEFINITIVE decision, not options.

## Empirical facts (verified, readonly DB)
- 7 tasks, 7 architect_contract_graph artifacts. `contract_audit` gate has NEVER passed once.
- Its only real trigger: task tsk_e3e0914d5001jPc5fQINpgBWsZ goal G3. The architect's
  `contract_audit` scorer referenced contract_ids `ct-data-keyvalueitem, ct-data-hookresult,
  ct-config-accessor`; the registered graph contained only
  `ct-types-viewmodel, ct-types-messageargs, ct-data-accessor, ct-sync-broadcast-fn, ct-mcp-export`.
- The mismatch surfaced ONLY post-build (orchestrator/tools.ts ~128-142, called ~6053) AFTER
  a ~14-min build that committed real code; then `modify_contract` supersede + retry.

## 3 independent reviewers — consensus
- Root cause: architect authors two co-dependent id sets in ONE session via TWO tools with
  TWO free-form schemas and zero referential binding: `register_contract` → graph
  `contracts[].id`; `register_goal` → `acceptance_specs[].scorers[contract_audit].spec.contract_ids`
  (`acceptance/types.ts:86-96`, `contract_ids: z.array(z.string()).min(1)` — free strings).
  `validateArchitectContractGraph` (contract-graph.ts:322-336, your slice ①) only checks the
  FORWARD direction (every graph contract covered by an essential audit) — no INVERSE check
  (every audit contract_id resolves to a registered graph contract). = rule-8 double source.
- Timing defect: the unknown-id check needs zero build output yet runs post-build → wasted build.
- Consensus fix: add an INVERSE blocker in `validateArchitectContractGraph` + one
  `architect-core.txt` sentence. ALL THREE concede this is still model-dependent: the LLM must
  still reconcile two free-form lists; a finalize blocker merely converts a wasted build into an
  architect retry loop.

## Your prior ruling (1b19be2fa commit body, authoritative)
"a data-integrity validation only — NOT auto-attach / pre-dispatch re-link / delivery-gate
(those were rule-13 host-state-machine and were rejected in codex review)."
Also commit 6ee0cf291: root cause that `z.unknown()` hid AcceptanceSpec shape from the model;
goal-contract schemas were made tool inputs (pure-schema decision).

## User's assertion (empirically backed)
contract_audit has never passed once ⇒ this is a MECHANISM problem, not a model problem.
A finalize blocker that still requires the LLM to hand-reconcile two free-form id lists is
not a mechanism fix — it relocates the model dependency earlier.

## The contested axis — DECIDE
Given you already rejected host-side derivation/auto-relink as rule-13, what is the
rule-8 + rule-13 + rule-6.1 compliant MECHANISM fix that removes the dual-authoring model
dependency for `contract_audit.contract_ids`?

Candidate X (proposed synthesis): make `contract_audit.contract_ids` NOT a free
`z.array(z.string())`. At the `register_goal` authoring tool call, validate each contract_id
against the collector's ALREADY-registered contract ids and REJECT in-call (same-session
immediate feedback), mirroring how `register_dependency_contract` already rejects unknown
`contract_ids` (output-tools.ts ~769-777). Plus expose the registered-id set to the model
(6ee0cf291 precedent). This is referential data-integrity at the authoring point — not
host derivation, not a state machine, not post-build, not finalize-only.

Candidate Y: the 3-reviewer finalize-blocker + prompt sentence (model-dependent, retry-loop risk).

Candidate Z: your alternative.

Adjudicate definitively:
1. Is the dual-authoring of `contract_id` (graph vs audit) itself the rule-8 defect to remove,
   or is referential validation at one chokepoint sufficient and "single authored list" not required?
2. Pick X, Y, or Z. If X: at which exact tool boundary must rejection happen (register_goal
   call-time vs submit_architect finalize vs both), and why that is NOT the rule-13 host-state-machine
   you previously rejected. If you maintain Y, explain why "never passed once" does not make Y
   inadequate.
3. The timing defect (post-build detection of a pre-build-decidable mismatch): mandatory to fix
   regardless? Where exactly.
4. rule-35: enumerate the authoritative call sites that MUST change vs stay.
5. The mandatory tests (rule 28/36) that lock the chosen mechanism.

Repo: packages/opencorvus. Key files: src/architect/contract-graph.ts,
src/architect/output-tools.ts, src/acceptance/types.ts, src/acceptance/contract-audit.ts,
src/orchestrator/tools.ts (~99-161, ~6053), src/prompt/core/architect-core.txt.
Read them before deciding. Read-only review; give the definitive verdict + exact change set.
