# Browser Preview Reference Regions Tool

Date: 2026-06-29

## Recall

- User request: restore the two earlier browser preview abilities
  `browser_preview_bind_local_module` and `browser_preview_compare_regions`, but bind
  them into one agent-facing tool. Also assign the combined tool and
  `browser_preview_compare_scroll_slices` to build and visual-qa.
- Acceptance:
  - Do not restore two separate agent-callable tool IDs for binding and region
    comparison.
  - Expose one combined agent tool that can produce source-binding evidence and
    formal `reference-comparison` evidence through the existing backend
    implementations.
  - Build and visual-qa must both receive the combined tool.
  - Build and visual-qa must both keep `browser_preview_compare_scroll_slices`.
  - Scroll-slice evidence remains supporting `visual_diff` evidence, not formal
    `reference-comparison` proof.
- Hard constraints recalled:
  - No fallback or compatibility path.
  - No gate mechanism; fix the real tool surface.
  - Preserve backend evidence semantics and persisted `reference-comparison`
    rows.
  - Specs and records belong under root `specs/`.
  - Every code change needs targeted tests.
  - `SSIM` means Structural Similarity Index Measure.
- Read from disk before edits:
  - `specs/records/2026-06/2026-06-29-remove-region-diff-agent-tool.md`
  - `specs/records/2026-06/2026-06-29-side-by-side-agent-tool-surface.md`
  - `specs/records/2026-06/README.md`
  - `specs/README.md`
  - `packages/opencorvus/src/agent/tool-pool-contract.ts`
  - `packages/opencorvus/src/visual-qa/static-tools.ts`
  - `packages/opencorvus/src/visual-qa/agent.ts`
  - `packages/opencorvus/src/prompt/core/build-core.txt`
  - `packages/opencorvus/src/prompt/core/visual-qa-core.txt`
  - `packages/opencorvus/src/tool/browser-preview-tool-ids.ts`
  - `packages/opencorvus/src/tool/browser-preview-compare-scroll-slices.ts`
  - Historical deleted wrappers from `024afb82b4^` and `3eb13e9a13^`.
- Missing open IDE file: the deleted root-level tv2ainvest spec record is not
  present in the current repository checkout, so it cannot be used as an
  implementation source.
- Full-repo grep/inventory:
  - `rg -n "browser_preview_(bind_local_module|compare_regions|compare_scroll_slices|layout_geometry|bind_and_compare|compare_bound)|BrowserPreview(BindLocalModule|CompareRegions|CompareScrollSlices|LayoutGeometry)|BROWSER_PREVIEW_REPAIR_TOOL_IDS|reference-comparison|source-binding|local source-binding helper|region diff tool|side-by-side" packages/opencorvus/src packages/opencorvus/test specs/current/architecture specs/records/2026-06 -S --glob '!**/target*'`
  - `rg -n "BrowserPreviewCompareRegionsTool|BrowserPreviewBindLocalModuleTool|browser-preview-compare-regions|browser-preview-bind-local-module|browser_preview_compare_regions|browser_preview_bind_local_module" packages/opencorvus/src packages/opencorvus/test -S`
  - `rg -n "browser_preview_compare_scroll_slices|browser_preview_layout_geometry|VISUAL_QA_IMPLEMENTATION_TOOL_IDS|BUILD_PRIVATE_TOOL_IDS|privateRegistryToolLoaders|loadIntegrityPreviewToolInfos|createVisualQaImplementationTools" packages/opencorvus/src packages/opencorvus/test -S`
- Independent agent feedback:
  - Agent 1: add a single wrapper such as `browser_preview_reference_regions`;
    do not re-add old tool IDs; wire through private registry, build, visual-qa,
    prompt and tests. `browser_preview_compare_scroll_slices` is already exposed
    to build and visual-qa.
  - Agent 2: update build/visual-qa prompts and tests to distinguish formal
    bound-region proof from scroll-slice visual sweeps; this supersedes the
    earlier "scroll-slice only" records.

## Task

Add `browser_preview_reference_regions` as the single agent-facing wrapper for
reference-region binding and comparison. The wrapper preserves the existing
backend owners:

- `browser-preview/local-module-source-binding.ts` owns source-binding
  materialization.
- `browser-preview/region-comparison.ts` owns true-size
  `reference-comparison` evidence.

The wrapper only coordinates those implementations and returns a single tool
result with the relevant image attachments.

## Superseded Records

This record supersedes the agent-facing tool-surface conclusions in:

- `2026-06-29-remove-region-diff-agent-tool.md`
- `2026-06-29-side-by-side-agent-tool-surface.md`

It does not supersede their backend evidence preservation requirements.

## Call Point Inventory

| Surface | Current role | Change |
| --- | --- | --- |
| `browser-preview/local-module-source-binding.ts` | Backend source-binding implementation. | Reuse directly; no new binding algorithm. |
| `browser-preview/region-comparison.ts` | Backend true-size reference comparison implementation. | Reuse directly; no new comparison algorithm. |
| `tool/browser-preview-tool-ids.ts` | Shared browser preview tool IDs. | Add only `browser_preview_reference_regions`. Do not add old IDs. |
| `tool/browser-preview-reference-regions.ts` | Missing. | New combined wrapper with `bind_and_compare_local_module` and `compare_bound_regions` operations. |
| `agent/tool-pool-contract.ts` | Build gets scroll-slice and layout geometry. | Add combined wrapper to build private tools and private loader. |
| `visual-qa/static-tools.ts` | Visual QA gets scroll-slice and layout geometry. | Add combined wrapper. |
| `visual-qa/agent.ts` | Runtime visual-qa tool map and prompt text. | Add combined wrapper and formal proof language. |
| `agent/agent.ts` | Visual QA permission allow-list. | Allow combined wrapper. |
| `prompt/core/build-core.txt` | Build prompt names scroll-slice. | Add combined wrapper for formal bound-region proof. |
| `prompt/core/visual-qa-core.txt` | Visual QA prompt names scroll-slice. | Add combined wrapper for formal bound-region proof. |
| Tests | Assert current scroll-slice-only surface. | Update surface tests and add a real bind+compare wrapper test. |

## Acceptance

- `browser_preview_reference_regions` is not a global tool.
- Build and visual-qa both expose `browser_preview_reference_regions`.
- Build and visual-qa both expose `browser_preview_compare_scroll_slices`.
- Old agent-callable tool IDs `browser_preview_bind_local_module` and
  `browser_preview_compare_regions` remain absent.
- A focused tool test proves one call can produce `source-binding` evidence and
  passed `reference-comparison` evidence.
- Prompt tests prove agents are directed to the combined wrapper for formal
  region proof and to scroll-slice for supporting screen-by-screen
  `visual_diff` evidence.
- Focused tests and typecheck pass.
