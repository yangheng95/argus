# Visual QA Tool Result Acceptance Contract

## Recall

- User request: investigate whether the Visual QA acceptance contract is reasonable, whether it breaks the current context protocol, who authorized `desktop1440 + 1280`, and remove the wrong pass semantics where tool execution or registration is treated as acceptance.
- Acceptance criteria: Visual QA can submit `accepted=true` only when registered evidence is backed by durable task-scoped tool results whose own result semantics satisfy the claimed check; `state.status=completed` or a registered `browser_preview_evidence:*` ref is not enough. Multi-viewport acceptance must require screenshot-bearing evidence for each scoped viewport, and layout-geometry can remain diagnostic only.
- Hard constraints: no fallback or compatibility branch, no new orchestration gate/state machine, no hidden context source, no Visual QA file repair ownership, no mobile/tablet scope expansion for desktop-only clone tasks, and no invented viewport dimensions.
- Disk records read before implementation: `AGENTS.md`, `specs/README.md`, `specs/current/architecture/04-extensions.md`, `specs/current/architecture/18-webpage-replica-agent-workflow.md`, `specs/records/2026-07/README.md`, `2026-07-06-visual-comparison-ssim-result-semantics.md`, `2026-07-03-rendered-reference-acceptance-redesign.md`, `2026-07-02-qa-integrity-evidence-backed-schema.md`, `2026-07-02-layout-geometry-build-consumption.md`, `2026-07-01-visual-qa-multi-viewport-alignment.md`, and `2026-07-01-frontend-replica-desktop-adaptive-viewports.md`.
- Full-repo grep performed before implementation:
  - `rg -n "compare_scroll|scroll-slice|scroll slices|compareBrowserPreviewScrollSlice|BrowserPreviewScrollSliceComparisonResult" packages/opencorvus/src packages/opencorvus/test`
  - `rg -n "browser_preview_compare_scroll_slices|compare-scroll|scroll-slice" packages/opencorvus/src/browser-preview packages/opencorvus/src/orchestrator packages/opencorvus/test`
  - `rg -n "VISUAL_QA_MULTI_VIEWPORT_ALIGNMENT_CATEGORY|multi-viewport|layout-geometry|desktop-1280|1440|1280" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07`
  - `rg -n "referenceComparisonEvidenceIDFromRef|browserPreviewEvidenceIDFromRef|reference_comparison_evidence_refs|findReadableBrowserPreviewEvidenceByID|operationKind|status" packages/opencorvus/src packages/opencorvus/test`
- Independent agent feedback: not spawned in this turn because the user asked for immediate current-tool contract repair and the relevant call graph is local and already covered by the above grep inventory.

## Findings

The contract is only partially reasonable. Its registration-first graph and report-only Visual QA role are aligned with the context protocol, because Visual QA consumes task-scoped context and emits a structured report while the Orchestrator owns the lifecycle decision. The broken part is evidence semantics: several report paths still validate that a ref exists in the report graph, but do not verify the underlying tool result's `operationKind`, durable artifact readability, or `status`.

The current formal reference-parity path already checks more strictly: `reference_comparison_evidence_refs` must resolve through the formal reference-comparison protocol, then `findReadableBrowserPreviewEvidenceByID()` must return `operationKind="reference-comparison"` with `status="passed"`. That repair does not cover ordinary `register_visual_qa_evidence` rows, multi-viewport alignment, or scroll-slice visual-diff evidence.

`desktop1440 + 1280` was not authorized by the operator as an acceptance viewport pair. `1440x900` is a desktop evidence default/source-reference width in the project. The `1280` dimension entered through Visual QA/layout-geometry desktop-adaptive diagnostic usage and report prose, not through a formal upstream requirement that those two viewports must define pass/fail. Current records allow desktop-class width checks only when the task or design contract names width scaling, overflow, wrapping, gutters, sticky controls, or layout stability. They do not allow Visual QA to invent viewport dimensions and then treat geometry-only output as screenshot acceptance.

The scroll-slice producer has a separate transport gap: `compareBrowserPreviewScrollSlice()` writes a job manifest and returns image attachments, but it does not persist a `browser_preview_evidence` row. As a result, Visual QA can cite side-by-side paths or job IDs as evidence without the consumer being able to resolve them through the same durable evidence contract as reference comparisons.

## Repair Plan

1. Extend Browser Preview persisted evidence with a `scroll-slice-comparison` operation kind and make `compareBrowserPreviewScrollSlice()` persist a durable `browser_preview_evidence:*` ref whose status is the SSIM-derived tool result status.
2. Return the new `evidenceID` from `browser_preview_compare_scroll_slices` so Visual QA can cite the durable evidence ref, not a bare path or job ID.
3. Add Visual QA tool-result acceptance validation for accepted reports:
   - Browser Preview evidence refs used as visual proof must resolve in the current task context.
   - `reference_comparison` rows require readable `reference-comparison` evidence with `status="passed"`.
   - `visual_diff` rows require readable `scroll-slice-comparison` or `reference-comparison` evidence with `status="passed"`.
   - `screenshot` rows require readable `preview-capture` evidence with `status="passed"` or a durable attachment URL.
   - `layout-geometry` and `source-binding` can support diagnostics/findings but cannot satisfy visual pass evidence.
4. Strengthen multi-viewport alignment so a report covering multiple viewports must provide screenshot-bearing, passed evidence for each viewport in the alignment check. Layout-geometry evidence cannot satisfy this requirement.
5. Update Visual QA prompt wording so tool-call completion and `state.status=completed` are explicitly not pass semantics; only tool output/result status plus inspected artifacts can support acceptance.
6. Add focused tests for failed tool-result evidence, layout-geometry-only multi-viewport claims, and scroll-slice evidence persistence. Update SDK contract expectations for the new operation kind.

## Non-Goals

- Do not add an Orchestrator gate or second lifecycle authority.
- Do not change default desktop-only clone scope into tablet/mobile responsive acceptance.
- Do not add aliases for invented viewport labels such as `desktop-1280`; future viewport expansion must come from task-scoped preview target evidence or explicit requirements.
