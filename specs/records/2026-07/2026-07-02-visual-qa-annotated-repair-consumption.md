# Visual QA Annotated Repair Consumption

## Recall

### User Request

Investigate the repeated acceptance failures from the database, stop attributing the task to unrelated causes, fix the real build/Visual QA/Integrity chain issues, annotate Document Object Model (DOM) diagnostics directly onto screenshots, pass those images to later agents, and require later agents to consume them.

### Acceptance Criteria

- Latest failed Visual QA DOM diagnostics are materialized as screenshot/image artifacts with the faulty DOM region, locator, bounding box, blocker IDs, and search hints rendered directly on the image.
- Build receives those annotated screenshots as first-class evidence under a diagnostic role, not as target reference or previous output.
- Build terminal reports cannot claim `status="passed"` when any `tests[].passed` value is false.
- Build terminal reports dispatched with Visual QA annotation evidence must list the consumed annotation refs before `status="passed"` is accepted.
- Stale failed Visual QA reports must remain visible as repair feedback, but a later build/Integrity pass must not treat the old report as fresh visual proof without consuming the post-report annotated evidence or producing fresh visual evidence.
- No fallback, compatibility path, gate workaround, fake E2E, or prompt-only repair can be counted as complete.

### Hard Constraints

- Do not create a new worktree.
- Do not use git reset or destructive cleanup.
- Do not restart or kill active OpenCorvus/overlay processes.
- Every code change needs targeted tests.
- VisualEvidenceBundle remains the formal rendered-vs-reference acceptance authority; annotated Visual QA screenshots are repair diagnostics and must stay role-separated.

### Sources Read

- `AGENTS.md` instructions supplied in the current prompt.
- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`.
- `specs/records/2026-07/2026-07-02-build-evidence-pack-role-separation.md`.
- `specs/records/2026-07/2026-07-02-visual-evidence-bundle-authority-repair.md`.
- `specs/current/architecture/09-verification-evidence.md`.
- `specs/records/2026-07/2026-07-01-visual-evidence-bundle-producer.md`.
- `specs/records/2026-07/2026-07-01-visual-qa-feedback-consumption-chain.md`.
- `specs/README.md`.
- `specs/records/2026-07/README.md`.
- `packages/opencorvus/src/visual-qa/schema.ts`.
- `packages/opencorvus/src/visual-qa/output-tools.ts`.
- `packages/opencorvus/src/visual-qa/agent.ts`.
- `packages/opencorvus/src/build/types.ts`.
- `packages/opencorvus/src/build/evidence-pack.ts`.
- `packages/opencorvus/src/build/agent.ts`.
- `packages/opencorvus/src/build/prompt-context.ts`.
- `packages/opencorvus/src/orchestrator/tools.ts`.
- `packages/opencorvus/src/browser-preview/persist.ts`.
- `packages/opencorvus/src/storage/attachment-store.ts`.
- Relevant tests under `packages/opencorvus/test/{build-agent,orchestrator,visual-qa}/`.

### Database Evidence

- Task `tsk_f1e7c67a0001kxLHBCeHB3RpwE` failed at task-level post-build integrity, while goal-level results looked passed.
- Visual QA report `report_1782950289375` was not ignored. Four Integrity attempts read it through `inspect_integrity_evidence(section="visual_qa_report")` and cited its blocker IDs.
- The persistent blockers were `blocker-map-summary-product-ui` and `blocker-main-flow-reference-drift`.
- Problem DOM regions recorded selectors, bounding boxes, computed styles, evidence refs, and code search terms, but Build only received them as text.
- Later repair builds produced reports marked passed even when one recorded visual test was `passed=false` for `browser_preview_reference_regions map-surfaces-world-trends`.
- The real chain defect is therefore: stale Visual QA report is consumed as blocking evidence after repairs, while repair builds can self-report passed without consuming annotated Visual QA screenshot evidence and without host rejection of failed tests.

### Whole-Repository Search Evidence

- `rg "submit_visual_qa_report|register_visual_qa_problem_dom_region|problem_dom_regions|production_blockers|renderVisualQaProblemDomFeedback|composeLatestVisualQaFeedbackForBuild"` showed Visual QA DOM feedback is collected in `visual-qa/output-tools.ts` and rendered to Build as text in `orchestrator/tools.ts`.
- `rg "browser_preview_compare_scroll_slices|browser_preview_reference_regions|reference_comparison_evidence_refs|VisualEvidenceBundle|materializeVisualEvidenceBundle|inspect_visual_evidence"` confirmed VisualEvidenceBundle is the formal authority and browser preview artifacts are the image source to reuse.
- `rg "report_build_result|BuildResult|tests.*passed|passed.*tests|status.*passed|failed test|tests:\\s*\\["` found `BuildResultSchema` rejects failed repair verification commands but not failed top-level `tests[]`.
- `rg "BuildEvidenceFile|BuildEvidenceRole|evidencePack|visualQaFeedback|consumed"` found Build evidence roles are limited to `target_reference`, `previous_output`, and `comparison_artifact`, and Visual QA feedback is not image-backed.
- `rg "sharp|pngjs|jimp|canvas"` found `sharp` is already a root dependency and AttachmentStore already uses it, so annotation can reuse the existing image toolchain.

### Independent Agent Feedback

No independent subagent was launched in this turn. The current request asks this agent to fix the chain and pass annotated images to later agents; the evidence above comes from the remote database export and local code search.

## Root Cause Chain

1. Visual QA correctly produced blockers and DOM-localized diagnostics.
2. Integrity correctly consumed that Visual QA report, so the issue is not missing QA consumption.
3. Build received the Visual QA DOM diagnostics only as prompt text. No annotated screenshot artifact was passed as binary evidence.
4. Build could still submit `status="passed"` with a failed visual test in `tests[]`; the schema did not reject that contradiction.
5. Later Integrity attempts kept citing the old Visual QA report because no later repair artifact proved annotated Visual QA evidence was consumed, and the old report remained the only concrete visual blocker record.

## Repair Plan

1. Extend Visual QA problem DOM regions with host-generated `annotated_evidence_refs`.
2. Add a Visual QA annotation helper that resolves task-scoped screenshot evidence, renders bbox/locator/blocker/search-term callouts onto PNGs with `sharp`, stores them through `AttachmentStore`, and writes the refs back into the Visual QA report.
3. Extend BuildEvidencePack with a `visual_qa_annotation` diagnostic role and route latest failed Visual QA annotation refs into Build evidence.
4. Extend Build terminal result schema with `consumed_visual_qa_annotation_refs`.
5. Reject passed Build reports when any top-level test failed.
6. Reject passed Build report submissions when Visual QA annotation refs were dispatched but not listed as consumed.
7. Render the annotation refs in Visual QA feedback and the Build terminal report contract so later agents know exactly what to cite.
8. Add tests for schema rejection, annotation materialization, Build feedback context, Build evidence role separation, and required consumption.

## Validation

- `bun test packages/opencorvus/test/build-agent/types.test.ts`
- `bun test packages/opencorvus/test/build-agent/contract-error.test.ts`
- `bun test packages/opencorvus/test/build-agent/visual-reference-prompt.test.ts`
- `bun test packages/opencorvus/test/build-agent/prompt-context.test.ts`
- `bun test packages/opencorvus/test/orchestrator/build-feedback-context.test.ts`
- `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
- `bun run typecheck`
- `git diff --check`
