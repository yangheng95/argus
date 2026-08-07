# Visual QA Diagnostic Image Annotation Repair

## Recall

- User request: fix the Visual QA failure where `register_visual_qa_problem_dom_region` repeatedly reports `problem_dom_region dom-duplicate-quotes has no resolvable screenshot evidence to annotate` for `browser_preview_evidence:*` refs.
- Acceptance criteria: DOM annotation must resolve image-bearing Browser Preview diagnostic evidence when it can draw an accurate box, especially `source-binding` local full-page screenshots and `scroll-slice-comparison` implementation slices with scroll offsets; `layout-geometry` remains manifest-only diagnostic evidence and must not be treated as screenshot evidence; Visual QA accepted/pass semantics must remain strict and unchanged.
- Hard constraints: no fallback/compatibility path, no new gate, no lifecycle authority change, no process restart, no active overlay interference, no weakening of `accepted=true` validation, no unrelated dirty worktree rollback, code change must include focused tests.
- Sources read: `AGENTS.md`; `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`; `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`; `specs/README.md`; `specs/current/architecture/04-extensions.md`; `specs/current/architecture/09-verification-evidence.md`; `specs/records/2026-07/README.md`; `specs/records/2026-07/2026-07-02-visual-qa-annotated-repair-consumption.md`; `specs/records/2026-07/2026-07-06-visual-qa-tool-result-acceptance-contract.md`; `specs/records/2026-07/2026-07-06-visual-comparison-ssim-result-semantics.md`; runtime DB rows for `art_f365819080014xzU482cshices`, `art_f3658a9f30014xpheWJyRYFUCd`, and `art_f3659c49a001B2KlAW0QBjJ63Z`; `packages/opencorvus/src/visual-qa/annotated-screenshot.ts`; `packages/opencorvus/src/visual-qa/output-tools.ts`; `packages/opencorvus/src/browser-preview/persist.ts`; `packages/opencorvus/test/visual-qa/output-tools.test.ts`.
- Whole-repository grep evidence:
  - `rg -n "problem_dom_region|register_visual_qa_problem_dom_region|resolvable screenshot|browser_preview_evidence|Visual QA evidence ref is not a resolvable screenshot|annotate" packages/opencorvus/src packages/opencorvus/test specs`
  - `rg -n "function findReadableBrowserPreviewEvidenceCapturePath|function findReadableBrowserPreviewEvidenceArtifactPath|artifactName|operation_kind|operationKind|artifact_paths|capture" packages/opencorvus/src/browser-preview/persist.ts packages/opencorvus/test/browser-preview`
  - `rg -n "annotateVisualQaProblemDomRegion|resolveImageEvidenceRef|resolveBrowserPreviewEvidenceImage|findReadableBrowserPreviewEvidenceCapturePath|findReadableBrowserPreviewEvidenceArtifactPath|browser_preview_evidence|source-binding|scroll-slice-comparison|layout-geometry|problem_dom_region" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 -g '!node_modules'`
- Runtime evidence:
  - `art_f365819080014xzU482cshices` is `operation_kind="source-binding"`, `status="passed"`, and contains readable `localCapture.screenshotPath` plus source/implementation/module comparison PNGs.
  - `art_f3658a9f30014xpheWJyRYFUCd` is `operation_kind="scroll-slice-comparison"`, `status="failed"`, and contains readable `implementation-slice.png` plus `manifest.json` with `scrollY=900`.
  - `art_f3659c49a001B2KlAW0QBjJ63Z` is `operation_kind="layout-geometry"`, `status="passed"`, and contains only `layout-geometry.json`.
  - The failing DOM bbox was page-coordinate `{ x: 507, y: 1045, width: 426, height: 535 }`, matching the source-binding local full-page screenshot and the scroll slice after subtracting `scrollY=900`.
- Independent agent feedback: not spawned because the bug is localized to the Visual QA annotation helper and Browser Preview evidence resolver, with direct runtime rows and callpoints already inspected.

## Root Cause

The acceptance contract correctly distinguishes Browser Preview evidence operation kinds. A `browser_preview_evidence:*` row is not automatically pass proof.

The annotation path incorrectly reused a narrower image resolver:

- `findReadableBrowserPreviewEvidenceCapturePath()` only returns images for `operationKind="preview-capture"`.
- `findReadableBrowserPreviewEvidenceArtifactPath()` only returns images for `operationKind="reference-comparison"`.
- `annotateVisualQaProblemDomRegion()` calls only those two helpers, so `source-binding` and `scroll-slice-comparison` rows are rejected even when they contain readable PNGs.

That mixes two different semantics: formal visual acceptance evidence versus diagnostic image material suitable for drawing a DOM bbox. The former must stay strict; the latter should resolve image-bearing diagnostics only when coordinates are trustworthy.

## Repair Plan

1. Keep Visual QA report acceptance and reference parity validation unchanged.
2. Teach `annotated-screenshot.ts` to resolve Browser Preview diagnostic images through `findReadableBrowserPreviewEvidenceByID()`.
3. For `source-binding`, prefer a local full-page screenshot discovered from capture metadata so DOM page-coordinate bbox values remain accurate.
4. For `scroll-slice-comparison`, use `implementation_crop` only with manifest `scrollY`, transforming page-coordinate bbox into slice-coordinate bbox.
5. Keep `layout-geometry` as non-image diagnostic evidence and return a precise diagnostic when used for annotation.
6. Add focused tests proving `source-binding` and failed `scroll-slice-comparison` can materialize annotated screenshots while `layout-geometry` still cannot.

## Verification Plan

- `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

## Verification Results

- `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts --timeout 120000`: passed, 33 tests and 162 expectations.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`: passed, 19 tests and 66 expectations.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- `git diff --check`: passed.
- `bun test packages/opencorvus/test/script/document-health.test.ts --timeout 120000`: failed in a pre-existing repository health check because `examples/tradingview-world-economy/test/visual-check.mjs` is missing. This failure is outside the Visual QA evidence annotation path changed here.
