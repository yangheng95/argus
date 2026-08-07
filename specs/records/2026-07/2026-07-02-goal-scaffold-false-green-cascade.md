# Goal Scaffold False-Green Cascade

Date: 2026-07-02
Status: Implemented

## Recall

- User request: Investigate the database-backed reason for repeated goal acceptance failures, explain why Build could not repair it, prove QA/audit evidence is really consumed, and fix the current cascade where goals now appear to fail immediately.
- Acceptance criteria: Restore a single root-cause chain from runtime database evidence; prevent a bootstrap scaffold goal from passing when it only writes a blocker document and does not materialize the production scaffold contract; prevent Architect from modeling blocker/audit documents as downstream-consumable `render_surface` contracts; preserve existing Visual Quality Assurance (QA) annotation consumption fields; add focused tests for the regression; do not create a new worktree or restart running OpenCorvus/overlay processes.
- Hard constraints: No fallback or compatibility path; no gate that hides root cause; no blind patch; no broad git reset; preserve unrelated dirty worktree changes; inspect landed specs before edits; code changes require tests; no new git worktree; do not restart, kill, refresh, or reload OpenCorvus/overlay processes.
- Sources read: `specs/README.md`; `specs/records/2026-07/README.md`; `specs/records/2026-07/2026-07-02-visual-qa-annotated-repair-consumption.md`; `specs/records/2026-07/2026-07-02-runtime-status-timing-root-repair.md`; `specs/current/architecture/10-worktree-lifecycle.md`; `specs/records/2026-07/2026-07-02-direct-build-current-worktree.md`; `specs/records/2026-07/2026-07-02-build-evidence-pack-role-separation.md`; attached task debug info from `C:\Users\chuan\.codex\attachments\d38fcac2-cc53-4fec-aa4f-9236ff2624d6\pasted-text.txt`; runtime database `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`; `packages/opencorvus/src/acceptance/contract-audit.ts`; `packages/opencorvus/src/architect/contract-graph.ts`; `packages/opencorvus/src/architect/output-tools.ts`; `packages/opencorvus/src/orchestrator/tools.ts`; `packages/opencorvus/src/prompt/core/architect-core.txt`; existing acceptance and architect tests.
- Whole-repository grep:
  - `rg -n "contract_audit|runContractAudit|contractAuditBlocksBuild|contractGraphIRIndex|validateArchitectContractGraph|render_surface|artifact_paths|blank-template|scaffold|blocker" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 -S`
  - `rg -n "consumed_visual_qa_annotation_refs|consumed_visual_qa_diagnostic_refs|annotated_screenshot|visual_qa" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 -S`
  - `rg -n "docs/blank-template-blocker|package.json|index.html|src/|public/" C:\Users\chuan\myhexin-local\demos\economy\world-economy -S`
  - `rg -n "validateArchitectContractGraph\(|contractAuditUnknownContractFindings|runGoalContractAuditCriteria|contract_audit_unknown_contract|render_surface_non_render_artifact_path" packages/opencorvus/src packages/opencorvus/test -S`
- Independent agent feedback: Not obtained in this turn. The available multi-agent tools were not invoked because the current user request is to repair the broken runtime behavior in the current worktree, and project rule 33.2 forbids creating a new worktree for audit isolation.

## Database Evidence

- Task: `tsk_f1e186a5b001Cl00bjZZDWHiMh`, title `clone: TradingView world economy`, project worktree `C:\Users\chuan\myhexin-local\demos\economy\world-economy`, runtime database `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`.
- Goal #1 `Blank-template project scaffold` passed with changed files limited to `.gitignore` and `docs/blank-template-blocker.md`.
- Goal #2 failed after about 64 seconds with `Missing dependency contract_scaffold_app_root`.
- Goal #3 failed after about 89 seconds with `Missing prerequisite production app scaffold`.
- Goal #15 failed after about 81 seconds with the same missing scaffold prerequisite.
- The Architect contract graph registered `contract_scaffold_app_root` as a `render_surface` with `artifact_paths` containing `package.json`, `index.html`, `src/**`, `public/**`, and `docs/blank-template-blocker.md`, then made #2/#3/#15 consumers of that contract.

## Root Cause

The direct trigger was not the Visual QA annotation evidence repair. The cascade started because the bootstrap scaffold goal produced a blocker document but was still accepted as a passed producer of the downstream production scaffold contract.

The deeper mechanism is twofold:

1. `contract_audit` only audited typed Contract Intermediate Representation (IR) fields through `contractGraphIRIndex`. Non-IR graph contracts such as `render_surface` with concrete `artifact_paths` returned `skipped`.
2. `contractAuditBlocksBuild("skipped")` is intentionally non-blocking, so the scaffold goal could pass even though the production app root paths were absent.
3. Architect allowed a blocker document path to be mixed into a downstream-consumable `render_surface` contract. That turned "the requested scaffold is unavailable" into a contract that downstream goals tried to consume.

## Repair Plan

1. Extend `runContractAudit` with graph-backed materialization checks for non-IR contracts that declare `artifact_paths`.
2. Pass the full Architect contract graph from the orchestrator contract-audit runner so goal builds audit materialized graph artifacts, not only typed IR fields.
3. Make `render_surface` contract validation reject documentation/audit/blocker artifact paths. Those paths can remain docs deliverables, but they cannot be a downstream rendered surface contract.
4. Update the Architect core prompt to state that missing external scaffolds must block/fail the bootstrap goal rather than emit a consumable render-surface contract backed by a document.
5. Add regression tests for the false-green scaffold cascade and the render-surface contract modeling error.

## Validation Plan

- `bun test packages/opencorvus/test/acceptance/contract-audit.test.ts packages/opencorvus/test/architect/output-tools.test.ts -t "materializes non-IR graph contract artifact paths|rejects render_surface contracts that mix documentation artifacts"`
- `bun test packages/opencorvus/test/acceptance/contract-audit.test.ts packages/opencorvus/test/architect/output-tools.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun run --cwd packages/opencorvus typecheck`

## Implemented Fix

1. `runContractAudit` now accepts the full Architect contract graph and audits materialized `artifact_paths` for referenced graph contracts before returning `passed` for non-IR contracts.
2. The Orchestrator goal contract-audit runner passes the full graph to `runContractAudit`, so goal builds no longer audit only typed IR entries.
3. `validateArchitectContractGraph` now blocks `render_surface` contracts that include documentation, Markdown, text audit, or blocker-report artifact paths.
4. The Orchestrator build dispatcher now rejects any persisted Architect contract graph blocker before starting Build. This covers old database artifacts that were persisted before the newer Architect submit validation existed.
5. The Architect core prompt and contract-audit scorer description now state that graph `artifact_paths` are materialized by `contract_audit`, and that a missing scaffold must fail/block the bootstrap goal rather than satisfy a downstream render-surface contract with a document.
6. Regression tests cover the exact blocker-only scaffold false-green pattern, the invalid `render_surface` + `docs/blank-template-blocker.md` contract graph, and persisted graph blockers refusing to start BuildAgent.

## Validation Results

- `bun test packages/opencorvus/test/acceptance/contract-audit.test.ts packages/opencorvus/test/architect/output-tools.test.ts packages/opencorvus/test/agent/core-prompt-hygiene.test.ts -t "materializes non-IR graph contract artifact paths|passes non-IR graph contract artifact path audit|rejects render_surface contracts that mix documentation artifacts|architect prompt binds contract_audit ids" --timeout 120000`: 4 pass.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "goal build rejects persisted contract graph blockers before build starts|goal build rejects persisted contract_audit graph id mismatch before build starts" --timeout 120000`: 2 pass.
- `bun test packages/opencorvus/test/acceptance/contract-audit.test.ts packages/opencorvus/test/architect/output-tools.test.ts packages/opencorvus/test/agent/core-prompt-hygiene.test.ts --timeout 120000`: 118 pass.
- `bun run --cwd packages/opencorvus typecheck`: pass.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`: 19 pass.
- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 120000`: 50 pass.
- `bun test packages/opencorvus/test/build-agent/visual-reference-prompt.test.ts packages/opencorvus/test/build-agent/prompt-context.test.ts packages/opencorvus/test/build-agent/contract-error.test.ts --timeout 120000`: 63 pass, including rejection of passed Build reports that omit consumed Visual QA annotated screenshot or diagnostic manifest refs.
