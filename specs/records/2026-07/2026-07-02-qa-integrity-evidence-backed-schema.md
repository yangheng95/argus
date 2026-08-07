# QA and Integrity Evidence-Backed Schema

Date: 2026-07-02

## Recall

User request:

- QA and Integrity schema fields must not be filled speculatively.
- A schema field may be populated only after the corresponding QA or Integrity work was actually performed.

Acceptance criteria:

- Visual QA rows that cite `evidence_refs` must cite refs registered through `register_visual_qa_evidence` in the same report collector.
- Visual QA reference comparison refs must also be registered evidence rows, so the final report cannot invent `browser_preview_evidence:*` strings.
- Integrity final reports must reject reviewer/finding/repair evidence that is detached from registered check items and reviewer evidence rows.
- Integrity check items that claim evidence must be represented by reviewer evidence, drilldown, or coverage rows before a pass verdict can be recorded.
- Prompts must state that schema rows are written only after tool-backed observation or command/runtime evidence, not from intent, plan text, or executor summaries.
- Tests must cover rejected detached Visual QA evidence refs and rejected Integrity evidence/check graph gaps.
- No fallback, compatibility path, host lifecycle gate, fake E2E claim, worktree creation, process restart, or broad git reset.

Hard constraints:

- Preserve existing dirty changes in project identity files and July README.
- Specs stay under `specs/records/2026-07/`; update the July index only.
- Every code change needs focused tests.
- Integrity and Visual QA remain report-only review agents; Orchestrator still owns lifecycle completion.

Sources read:

- `AGENTS.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-01-review-item-registration-tools.md`
- `specs/records/2026-07/2026-07-01-visual-qa-multi-viewport-alignment.md`
- `specs/records/2026-07/2026-07-02-layout-geometry-build-consumption.md`
- `packages/opencorvus/src/visual-qa/schema.ts`
- `packages/opencorvus/src/visual-qa/output-tools.ts`
- `packages/opencorvus/src/visual-qa/agent.ts`
- `packages/opencorvus/src/prompt/core/visual-qa-core.txt`
- `packages/opencorvus/src/integrity/team-schema.ts`
- `packages/opencorvus/src/integrity/team-agent.ts`
- `packages/opencorvus/src/prompt/core/integrity-team-core.txt`
- `packages/opencorvus/src/architect/output-tools.ts`
- `packages/opencorvus/src/research/output-tools.ts`
- `packages/opencorvus/test/visual-qa/output-tools.test.ts`
- `packages/opencorvus/test/integrity/team-agent.test.ts`
- `packages/opencorvus/test/architect/output-tools.test.ts`

Whole-repository search evidence:

- `rg -n "register_integrity|submit_integrity|Integrity.*Schema|evidence|drilldowns|coverage|checkIDs|reviewer|finding|tool|command|uninspected" packages/opencorvus/src/integrity packages/opencorvus/test/integrity packages/opencorvus/test/agent -S`
- `rg -n "evidence_refs|register_visual_qa|submit_visual_qa|visualQa.*Issues|GraphIssues|accepted" packages/opencorvus/src/visual-qa packages/opencorvus/test/visual-qa -S`
- `rg -n "evidence_refs|\\.evidence|reference_comparison_evidence_refs|checkIDs|check_ids|register_visual_qa_evidence|register_integrity_check_item|submit_integrity_consensus|submit_visual_qa_report" packages/opencorvus/src packages/opencorvus/test specs/current/architecture -S --glob '!**/node_modules/**'`
- `rg -n "reference_comparison_evidence_refs|browser_preview_evidence|artifacts/desktop.png|artifacts/mobile.png|artifacts/hero.png|submitReport\\(" packages/opencorvus/test/visual-qa/output-tools.test.ts -C 3`

Independent agent feedback:

- No subagent was launched for this narrow schema-contract repair. The prior 2026-07-01 record already documents the multi-agent review that required registration-first QA/Integrity output tools; this task tightens the evidence graph left open by that repair.

## Root Cause

The 2026-07-01 registration-first repair made Visual QA and Integrity emit row-level records before final submit. That fixed the old large-payload finalizer problem, but some schema fields still remain self-reported strings:

- Visual QA `check_items[].evidence_refs`, `coverage[].evidence_refs`, findings, blockers, unresolved code module problems, DOM regions, and `reference_parity.reference_comparison_evidence_refs` can cite arbitrary strings even when no matching `register_visual_qa_evidence` row exists.
- Integrity already validates that reviewer rows, findings, repairs, risks, and disagreements cite registered `checkIDs`, but the evidence text on those rows is not graph-bound. A report can still claim check evidence without a reviewer evidence/drilldown/coverage row proving that the check was actually inspected.

This is a data-contract gap, not a scheduling problem. The repair belongs in the report graph validators and prompts, not in a host-side gate.

## Repair Plan

1. Add Visual QA evidence-ref graph validation:
   - Build the known evidence ref set from registered `report.evidence[].ref`.
   - Reject final submit when any report field cites an `evidence_refs` or `reference_comparison_evidence_refs` value absent from the registered evidence set.
   - Preserve existing check-ID graph validation.
2. Add Integrity evidence-backed check graph validation:
   - Build per-check support from reviewer `evidence[]`, `drilldowns[]`, and `coverage[]`.
   - Reject pass verdicts when a passed check item has no reviewer support row.
   - Reject findings and required repairs when their evidence strings are not represented by the evidence pool of their cited check IDs.
3. Update Visual QA and Integrity prompt text to say schema rows are only written after actual tool-backed observation and registered evidence, not after plans or executor prose.
4. Add focused tests:
   - Visual QA rejects a check item that cites an unregistered screenshot ref.
   - Visual QA rejects reference parity refs that were not registered as evidence rows.
   - Integrity rejects pass verdicts when a check item lacks reviewer evidence support.
   - Integrity rejects finding/repair evidence detached from cited check evidence.

## Validation Plan

- `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/integrity/team-agent.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

## Validation Results

- `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts packages/opencorvus/test/visual-qa/agent.test.ts packages/opencorvus/test/integrity/team-agent.test.ts --timeout 120000` passed: 40 tests.
- `bun test packages/opencorvus/test/visual-qa packages/opencorvus/test/integrity --timeout 120000` passed: 132 tests.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 120000` passed: 65 tests.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `git diff --check` passed.

## Review Notes

- Visual QA now rejects final reports when any `evidence_refs` or `reference_comparison_evidence_refs` value is absent from registered `report.evidence[].ref`.
- Visual QA also checks that a registered evidence ref is tied to at least one of the row's cited `check_ids`.
- Integrity now rejects final reports when `checkItems[].evidence` is not backed by reviewer `evidence[]`, `coverage[]`, or `drilldowns[]` support rows.
- Integrity findings and required repairs must reuse evidence from the cited check items.
- This does not claim the tool layer can reconstruct every raw model tool call from arbitrary free text. The enforced single source is the registered report graph; browser preview refs still use the existing persisted-evidence readability checks where available.
