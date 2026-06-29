# Visual QA Self-Report Consistency Repair

Date: 2026-06-25

## Problem

The ETF clone task `tsk_efcc79380001HgNceHOrmCE1Kx` exposed an over-correction in the 2026-06-25 no-hard-gate repair.

The dedicated Visual QA report submitted:

- `accepted=true`
- `reference_parity.required=true`
- only one `reference_comparison_evidence_ref`
- non-empty `reference_parity.missing_regions`
- `production_blockers=[]`

Workflow projection then showed Visual QA as complete because it only checked `accepted && production_blockers.length === 0`. This is not the intended no-hard-gate behavior. The host should not reject a terminal report because it cannot verify every evidence artifact, but a report that internally says "accepted" while also saying "required reference regions are missing" is self-contradictory acceptance evidence.

The same task also had goal `gol_efcfb53180107N7UEwOLXst4jD` titled "Region-by-region visual acceptance" passed by a document-existence report with `files_changed=[]` and no tests, while `docs/etfs/final-delivery-report.md` explicitly said live browser screenshot comparison was `[未达成]`. That is a build/orchestrator routing failure, but the visual_qa projection bug made the final review fail to catch it.

## Recalled Constraints

- `2026-06-15-visual-qa-production-blockers.md`: accepted Visual QA is incompatible with production blockers and open critical/major findings; report presence is not acceptance.
- `2026-06-15-visual-qa-unrepairable-follow-up.md`: accepted Visual QA is incompatible with follow-up task requests.
- `2026-06-19-final-visual-qa-scoped-build-context.md`: Visual QA acceptance is blocker-based, not a numeric score or webpage judge.
- `2026-06-20-visual-qa-scroll-slice-comparison.md`: scroll-slice evidence cannot satisfy `reference_parity.reference_comparison_evidence_refs`.
- `2026-06-25-visual-evidence-no-hard-gate-root-repair.md`: host must not reject or rewrite terminal state solely because reference-comparison artifacts are missing, unreadable, incomplete, or not perfectly covered.

## Decision

Keep the no-hard-gate repair, but add a single self-report consistency semantic for Visual QA:

- The report remains recorded after schema validation.
- The submitted `accepted` boolean is preserved.
- A pure data helper computes `effectiveAccepted` from the report's own fields.
- Workflow projection uses `effectiveAccepted`, not the raw boolean.
- Orchestrator-visible summaries/headlines show both submitted and effective acceptance.
- The helper must not read browser-preview evidence, visual bundles, files, or database rows. It is not an evidence-shape gate.

An accepted report is effectively failed when its own fields say any of:

- no fresh evidence or no coverage;
- open critical/major findings;
- production blockers;
- follow-up task request;
- `reference_parity.required=true` with no required regions;
- `reference_parity.required=true` with no `reference_comparison` evidence refs;
- `reference_parity.required=true` with non-empty `missing_regions`.

Context-derived warnings such as "the task context expects reference parity but the report sets `reference_parity.required=false`" remain advisory unless the report itself declares reference parity. That keeps the 2026-06-25 no-hard-gate boundary intact.

## Call Point Inventory

| Surface                                                  | Current behavior                                                            | Repair                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/visual-qa/output-tools.ts`      | Records all schema-valid reports and emits advisories only.                 | Reuse the self-report helper, show `effective_accepted`, and keep recording the report.              |
| `packages/opencorvus/src/engine/workflow.ts`             | Projects completed from raw `accepted && production_blockers.length === 0`. | Project completed only when `effectiveAccepted=true`; project failed for self-contradictory reports. |
| `packages/opencorvus/src/orchestrator/tools.ts`          | Decision-log summary and tool headline expose only submitted `accepted`.    | Add effective acceptance and self-report issue count to decision-log summary and tool result fields. |
| `packages/opencorvus/src/visual-qa/agent.ts`             | Says passing report "should" include evidence and blockers absence.         | Restore "must" wording for self-report semantics.                                                    |
| `packages/opencorvus/src/prompt/core/visual-qa-core.txt` | Says passed/failed result "should".                                         | Restore "must" wording.                                                                              |
| Tests                                                    | Several tests intentionally assert weak advisory-only completion.           | Reverse those tests for self-report contradictions while preserving evidence-artifact advisories.    |

## Verification

Run focused tests:

```bash
bun test packages/opencorvus/test/visual-qa/output-tools.test.ts packages/opencorvus/test/visual-qa/negative-fixtures.test.ts packages/opencorvus/test/engine/workflow-integrity-step.test.ts packages/opencorvus/test/visual-qa/agent.test.ts packages/opencorvus/test/agent/core-prompt-hygiene.test.ts
```

Then run package typecheck if the focused suite passes.
