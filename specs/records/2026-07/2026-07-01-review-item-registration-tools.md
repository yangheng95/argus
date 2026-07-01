# Review Item Registration Tools

Date: 2026-07-01

## Recall

User request:

- Change Integrity and Visual QA to work like Architect: each reviewed item must be registered one by one.
- Do not let either agent hide the review in one large final payload.
- Preserve the report-only completion boundary: Integrity and Visual QA produce accept/reject reports, while Orchestrator decides task completion.

Acceptance criteria:

- Visual QA exposes item-level `register_*` tools for coverage, evidence, findings, production blockers, DOM problem regions, unresolved code module problems, repairs, commands, changed files, open questions, fact checks, and reference parity.
- `submit_visual_qa_report` no longer accepts a full `VisualQaReport` payload; it finalizes from the collector and validates the accumulated items.
- Integrity exposes item-level `register_*` tools for reviewer reports, coverage-audit rows, uninspected risks, findings, review rounds, required repairs, unresolved disagreements, and fact checks.
- `submit_integrity_consensus` no longer accepts a full `IntegrityTeamReport` payload; it finalizes from the collector and validates the accumulated items.
- Downstream persisted report shapes remain `VisualQaReport` and `IntegrityTeamReport` so existing Orchestrator, Build feedback, workflow projection, and event consumers keep a single report data source.
- Tests prove the old large-payload finalizers are replaced by item registration and that missing registered coverage/evidence is still rejected.
- No fallback, no dual source, no host lifecycle gate, no new worktree, no process restart.

Hard constraints:

- The worktree is already dirty; preserve all unrelated changes.
- All changes must be in the current worktree.
- Every code change needs targeted tests.
- Specs remain under `specs/records/2026-07/` and this file must be indexed from the July README.

Sources read:

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-01-integrity-report-only-completion-boundary.md`
- `specs/records/2026-07/2026-07-01-visual-qa-feedback-consumption-chain.md`
- `packages/opencorvus/src/architect/output-tools.ts`
- `packages/opencorvus/src/architect/agent.ts`
- `packages/opencorvus/src/visual-qa/schema.ts`
- `packages/opencorvus/src/visual-qa/output-tools.ts`
- `packages/opencorvus/src/visual-qa/agent.ts`
- `packages/opencorvus/src/visual-qa/static-tools.ts`
- `packages/opencorvus/src/integrity/team-schema.ts`
- `packages/opencorvus/src/integrity/team-agent.ts`
- `packages/opencorvus/src/integrity/static-tools.ts`
- `packages/opencorvus/test/visual-qa/output-tools.test.ts`
- `packages/opencorvus/test/visual-qa/negative-fixtures.test.ts`
- `packages/opencorvus/test/visual-qa/agent.test.ts`
- `packages/opencorvus/test/integrity/team-agent.test.ts`
- `packages/opencorvus/test/integrity/browser-preview-tool.test.ts`

Whole-repository search evidence:

- `rg -n "architect|register|check item|check_item|review item|review_item|finding|submit_.*report|production_blockers|integrity" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07`
- `rg --files packages/opencorvus/src | rg "architect|integrity|visual-qa|review|check"`
- `rg --files specs | rg "integrity|visual|architect|review|qa|feedback|completion|verification"`
- `rg -n "createVisualQaOutputTools|submit_visual_qa_report|submit_integrity_consensus|createSingleSessionIntegrityToolKit|VISUAL_QA_SESSION_TOOL_IDS|INTEGRITY_DECLARED_TOOL_IDS|IntegrityTeamReportSchema|VisualQaReportSchema" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
- `rg -n "submit_visual_qa_report|VisualQaReportSchema|createVisualQaOutputTools|problem_dom_regions|effectiveAccepted|VISUAL_QA_SESSION_TOOL_IDS" packages/opencorvus/test packages/opencorvus/src -g "*.ts"`
- `rg -n "submit_integrity_consensus|IntegrityTeamReportSchema|reviewIntegrity|coverageAudit|requiredRepairs|Integrity" packages/opencorvus/test/integrity packages/opencorvus/test/agent packages/opencorvus/test/orchestrator packages/opencorvus/test -g "*.ts"`

Independent agent feedback:

- None. The request is a direct implementation change in the current chain; no sub-agent was required.

## Existing Pattern

Architect collects durable rows through many small tools (`register_goal`,
`register_traceability`, `register_source_coverage`, `register_reference_coverage`,
`register_assembly_owner`, `register_contract`, `register_dependency_contract`)
and `submit_architect` only records summary/decomposition text and validates
the collector. The terminal tool readiness is tied to the same validation source.

Visual QA and Integrity currently diverge:

- Visual QA has one `submit_visual_qa_report` tool whose input schema is the full
  `VisualQaReportSchema`.
- Integrity has one `submit_integrity_consensus` tool whose input schema is the full
  `IntegrityTeamReportSchema`.

That lets an agent produce a large report-shaped payload without proving that each
review item was deliberately inspected and registered.

## Decision

Keep the downstream report schemas as the durable data model, but make the tool
surface registration-first:

- Add small Visual QA registration tools that mutate a single collector.
- Add small Integrity registration tools that mutate a single collector.
- Finalizers accept only verdict/summary/narrative fields and optional reference
  parity metadata; list-shaped review facts must already be in the collector.
- Validation runs on the assembled report, so Build/Orchestrator consumers still
  read exactly one report shape.
- Static tool lists and prompts must name the registration sequence explicitly.

This is not a fallback or gate. It is a single-source output contract: registered
review items are the only source of final report arrays.

## Implementation Plan

1. Refactor Visual QA output tools:
   - Replace `VisualQaCollector.final?: VisualQaReport` with item arrays plus `final`.
   - Add `register_visual_qa_coverage`, `register_visual_qa_evidence`,
     `register_visual_qa_finding`, `register_visual_qa_production_blocker`,
     `register_visual_qa_problem_dom_region`,
     `register_visual_qa_unresolved_code_module_problem`,
     `register_visual_qa_repair`, `register_visual_qa_command`,
     `register_visual_qa_changed_file`, `register_visual_qa_open_question`,
     `register_visual_qa_fact_check_item`, and `set_visual_qa_reference_parity`.
   - Make `submit_visual_qa_report` accept `accepted` and `summary` only.
2. Refactor Integrity consensus tools:
   - Replace `ConsensusCollector.report?: IntegrityTeamReport` with registered arrays plus final report.
   - Add `register_integrity_reviewer_report`,
     `register_integrity_coverage_audit`, `register_integrity_uninspected_risk`,
     `register_integrity_finding`, `register_integrity_round`,
     `register_integrity_required_repair`,
     `register_integrity_unresolved_disagreement`, and
     `register_integrity_fact_check_item`.
   - Make `submit_integrity_consensus` accept `verdict`, `summary`, and `teamReportMarkdown` only.
3. Update static tool IDs and prompts to forbid final large payloads.
4. Update tests so helpers register reports item-by-item before final submit.
5. Run targeted Visual QA and Integrity tests plus docs link tests.

## Planned Validation

- `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts packages/opencorvus/test/visual-qa/negative-fixtures.test.ts packages/opencorvus/test/visual-qa/agent.test.ts packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/integrity/team-agent.test.ts packages/opencorvus/test/integrity/browser-preview-tool.test.ts packages/opencorvus/test/integrity/team-schema.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/agent/agent.test.ts packages/opencorvus/test/agent/role-contract.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 60000`
- `git diff --check`
