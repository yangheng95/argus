# Screenshot Comparison Guidance Repair

Date: 2026-07-03

Supersession note:

- The side-by-side legend and visual inspection checklist in this record remain
  useful for comparison artifacts.
- Its original acceptance-authority assumption that `VisualEvidenceBundle`
  remains the formal rendered-vs-reference authority is superseded by
  `2026-07-03-rendered-reference-acceptance-redesign.md`. Current acceptance
  authority is task-scoped rendered visual feedback verification.

## Recall

User request:

- Screenshot comparison tool results must say which side is the reference image.
- The result must guide agents to inspect layout alignment, missing icons, color differences, spacing anomalies, hallucinated content, and additional likely visual parity defects.

Acceptance criteria:

- Side-by-side comparison outputs expose structured left/right roles in text/JSON, not only visual labels drawn into the PNG.
- The left side is unambiguously the source/reference image and the right side is the local rendered implementation across scroll-slice, region comparison, and module source-binding comparison outputs.
- Agent prompts tell Build and Visual QA to inspect comparison artifacts with a concrete defect checklist instead of relying on score/status flags.
- The checklist covers layout alignment, region order, icon/asset omissions, color, spacing, typography, density, content hallucination, missing content, wrong component family, chart/table/map scale, state styling, overflow/clipping, z-index/layering, responsive drift only when scoped, and fake/placeholder UI.
- Add focused regression tests for tool result payloads and prompt wording.
- No fallback, compatibility branch, fake visual pass, worktree creation, process restart, or broad git reset.

Hard constraints:

- Preserve existing dirty worktree changes.
- Superseded by `2026-07-03-rendered-reference-acceptance-redesign.md`:
  `VisualEvidenceBundle` is not current formal rendered-vs-reference authority.
  Scroll-slice and module comparison artifacts are Build/Visual QA feedback
  material; final acceptance comes from task-scoped rendered visual feedback
  verification.
- Do not expose hidden `browser_preview_compare_regions` to agents.
- Do not create tablet/mobile obligations for desktop-only replica scope.

Sources read:

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/artifacts/tv2ainvest.md`
- `specs/records/2026-07/2026-07-02-layout-geometry-build-consumption.md`
- `specs/records/2026-07/2026-07-02-visual-evidence-bundle-authority-repair.md`
- `packages/opencorvus/src/tool/browser-preview-compare-scroll-slices.ts`
- `packages/opencorvus/src/browser-preview/scroll-slice-comparison.ts`
- `packages/opencorvus/src/browser-preview/region-comparison.ts`
- `packages/opencorvus/src/tool/browser-preview-reference-regions.ts`
- `packages/opencorvus/src/browser-preview/local-module-source-binding.ts`
- `packages/opencorvus/src/prompt/core/visual-qa-core.txt`
- `packages/opencorvus/src/prompt/core/build-core.txt`
- `packages/opencorvus/src/skill/builtin/frontend-replica-expert-squad.md`
- `packages/opencorvus/test/browser-preview/scroll-slice-comparison.test.ts`
- `packages/opencorvus/test/browser-preview/region-comparison.test.ts`
- `packages/opencorvus/test/browser-preview/local-module-source-binding.test.ts`
- `packages/opencorvus/test/tool/browser-preview.test.ts`
- `packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts`
- `packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts`

Whole-repository search evidence:

- `rg -n "screenshot|截图|visual|视觉|compare|对比|reference|参考|alignment|layout|icon|spacing|hallucinat" specs packages script knip.config.js`
- `rg -n "reference-comparison|compareTaskTargetRegions|compare.*region|browser-preview/compare|implementation_screenshot_path|reference_artifact_id|visual_evidence_bundle|VisualEvidenceBundle" packages/opencorvus/src packages/opencorvus/test packages/overlay/src specs/records/2026-07`
- `rg -n "compare_scroll_slices|scroll_slices|visual_diff|side-by-side|browser_preview_compare|reference_regions" packages/opencorvus/src packages/opencorvus/test specs/records/2026-07 specs/current`
- `rg -n "module_comparison|Source crop|Local implementation crop|source/local|side-by-side" packages/opencorvus/src/browser-preview/local-module-source-binding.ts packages/opencorvus/test/browser-preview packages/opencorvus/test/tool packages/opencorvus/test/visual-qa`

Independent agent feedback:

- No independent subagent was launched. This is a narrow prompt/tool-result clarification bounded by existing VisualEvidenceBundle, scroll-slice, region-comparison, and module-binding records.

## Root Cause

The comparison PNGs already draw labels, but the structured tool results and manifests do not provide a reusable machine-readable legend or review checklist. Agents often consume the JSON/text portion first, so they can miss which side is authoritative or reduce the review to score/status fields. Existing Build and Visual QA prompts say to inspect images manually, but they do not enumerate the common visual parity failure classes the user listed.

## Repair Plan

1. Add one shared browser-preview comparison guidance source with:
   - `side_by_side_legend`: left reference/source of truth, right rendered implementation.
   - `inspection_checklist`: concrete visual parity defect categories.
2. Include that guidance in:
   - `browser_preview_compare_scroll_slices` result JSON and manifest.
   - `BrowserPreviewRegionComparisonResult` manifests.
   - `browser_preview_reference_regions` source-binding tool output.
3. Make side-by-side PNG labels explicit as `LEFT: Source reference` and `RIGHT: Local implementation`.
4. Update Build and Visual QA prompts to require using the legend and checklist when inspecting comparison artifacts.
5. Add tests asserting the legend/checklist exists in tool outputs/manifests and prompt text.

## Validation Plan

- `bun test packages/opencorvus/test/browser-preview/scroll-slice-comparison.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/browser-preview/region-comparison.test.ts packages/opencorvus/test/browser-preview/local-module-source-binding.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/tool/browser-preview.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 120000`
- `git diff --check`

## Validation Results

- PASS: `bun test packages/opencorvus/test/browser-preview/scroll-slice-comparison.test.ts --timeout 120000`
- PASS: `bun test packages/opencorvus/test/browser-preview/region-comparison.test.ts packages/opencorvus/test/browser-preview/local-module-source-binding.test.ts --timeout 120000`
- PASS: `bun test packages/opencorvus/test/tool/browser-preview.test.ts --timeout 120000`
- PASS: `bun test packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts packages/opencorvus/test/visual-qa/agent.test.ts packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts packages/opencorvus/test/agent/prompt-profile.test.ts --timeout 120000`
- PASS: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 120000`
- PASS: `bun run --cwd packages/opencorvus typecheck`
- PASS: `git diff --check`
- Unrelated existing failure observed and left unchanged: `bun test packages/opencorvus/test/tool/schema-snapshot.test.ts --timeout 120000` fails because the `contract_audit` scorer description in `packages/opencorvus/src/acceptance/types.ts` differs from the stored snapshot.
