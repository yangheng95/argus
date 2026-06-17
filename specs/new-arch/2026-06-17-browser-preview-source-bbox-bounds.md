# Browser Preview Source Bbox Bounds

Date: 2026-06-17

## Problem

`browser_preview_compare_regions` records the authored `source_bbox` in the result, but `region-comparison.ts` crops PNGs by clamping the box to the image bounds. A bbox such as `x=80,y=80,w=30,h=30` on a `100x100` source image becomes a `20x20` artifact while the manifest still says `30x30`.

This creates false completed evidence: the comparison artifact no longer represents the declared source region.

## Recall

- `specs/new-arch/2026-06-15-region-comparison-evidence-runner.md` requires missing/bad bindings to fail loudly and not compare the wrong region.
- `specs/new-arch/2026-06-16-local-module-source-binding.md` says source crop need not be pixel-perfect, but it must fully contain the corresponding source module and avoid neighboring modules. Silent clipping violates that authority.
- `frontend-design/visual-region-binding-tool.ts` already rejects source bboxes that exceed the source image bounds.

## Callsite Inventory

`rg "cropPng\\(|clamp\\(|assertBoxInsideImage|source_bbox|materializeRegionComparison" packages/opencorvus/src packages/opencorvus/test specs/new-arch -S`

| Area | Finding | Decision |
| --- | --- | --- |
| `src/browser-preview/region-comparison.ts` | `materializeRegionComparison` calls `cropPng`, and `cropPng` clamps both coordinates and sizes. | Replace silent clamp with explicit bbox-inside-image validation before cropping. |
| `src/browser-preview/local-module-source-binding.ts` | Uses padding expansion and puzzle generation; separate workflow. | Leave unchanged in this iteration. |
| `src/frontend-design/visual-region-binding-tool.ts` | Has the same semantic validation for VisualRegionBinding bboxes. | Mirror the behavior locally; no new shared abstraction until both modules converge. |
| `test/browser-preview/region-comparison.test.ts` | Existing file has unrelated dirty edits. | Add a focused browser-preview test file instead of editing this dirty file. |
| `src/tool/task.ts` explore path | Current dirty worktree added an explore-specific path that passes `SessionPrompt.resolvePromptParts` into `ExploreAgent.run`; typecheck exposed that `ExploreAgent` and `runAgentSession` had a narrower text/file-only `buildUserParts` type than the real `SessionPrompt.PromptInput["parts"]`. | Align the runner/explore type contract with `SessionPrompt.PromptInput["parts"]`; do not filter or drop agent parts. |

## Acceptance

- Out-of-bounds source bbox returns a failed region with a clear reason.
- The failed region has no comparison artifacts.
- Failed reference-comparison evidence is persisted for the bad binding.
- In-bounds source crops keep the exact declared bbox dimensions.
- One bad source bbox does not abort other valid regions in the same comparison job.
- Package typecheck passes with `SessionPrompt.resolvePromptParts` output passed through the explore task path.
- In-bounds route-state and existing region comparison tests remain green.
