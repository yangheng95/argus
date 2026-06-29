# Side By Side Agent Tool Surface

Date: 2026-06-29

## Supersession Note

This record is superseded for the agent-facing tool surface by
`2026-06-29-browser-preview-reference-regions-tool.md`. The current surface is:
build and visual QA both receive `browser_preview_reference_regions` for the
combined source-binding plus reference-region comparison flow, and both also
receive `browser_preview_compare_scroll_slices` for scroll-slice evidence. The
SSIM precheck addendum below remains current for the scroll-slice helper.

## Task

Keep the side-by-side browser preview comparison tool as the single
agent-facing visual comparison helper. Make it available to build as well as
visual QA. Remove the local module source-binding wrapper from agent tool
surfaces. Preserve backend region/reference comparison evidence APIs and stored
evidence semantics.

## Recalled Plans

- `2026-06-16-local-module-source-binding.md` introduced a binding puzzle
  wrapper before the region comparison flow.
- `2026-06-20-visual-qa-scroll-slice-comparison.md` introduced
  `browser_preview_compare_scroll_slices` as a side-by-side scroll slice tool.
- `2026-06-29-remove-region-diff-agent-tool.md` removed the old red diff
  wrapper while preserving backend region/reference comparison evidence.

The current operator instruction narrows the agent-facing surface further:
only the side-by-side scroll-slice helper remains exposed.

## Call Point Inventory

Command used:

```powershell
rg -n "local source-binding helper|browser_preview_compare_scroll_slices|BrowserPreviewCompareScrollSlices|source-binding|visual_diff" packages/opencorvus/src packages/opencorvus/test specs/current/architecture specs/records/2026-06 -S --glob '!**/target*'
```

| Surface | Current role | Change |
| --- | --- | --- |
| Build private tools | Exposes the binding wrapper. | Expose `browser_preview_compare_scroll_slices` instead. |
| Visual QA tools | Exposes the binding wrapper and scroll-slice helper. | Keep only `browser_preview_compare_scroll_slices`. |
| Integrity preview tools | Loads browser preview plus binding wrapper. | Load browser preview plus side-by-side helper. |
| Build and visual QA prompts | Mention binding/source-binding puzzle evidence. | Direct agents to side-by-side scroll-slice evidence. |
| Binding wrapper file | Agent-callable local module binding tool. | Delete the wrapper. |
| Backend evidence code | Owns stored source-binding and reference-comparison semantics. | Preserve unless separately retired. |

## Acceptance

- No agent role exposes `local source-binding helper`.
- Build and visual QA both expose `browser_preview_compare_scroll_slices`.
- Prompts instruct side-by-side evidence use without naming the binding wrapper.
- Backend region/reference comparison APIs and `reference_comparison_evidence_refs`
  stay intact.
- Focused tests and typecheck pass.

## SSIM Precheck Addendum

SSIM means Structural Similarity Index Measure, a perceptual image-similarity
metric. The side-by-side scroll-slice comparison computes SSIM before composing
the side-by-side PNG. When SSIM is very low, the result still returns supporting
`visual_diff` evidence, but diagnostics and the side-by-side header must warn
that the screenshots may not match, the page's overall layout may be misaligned,
and the page should be calibrated as a whole before local component tuning.

This is not a new gate, fallback, or acceptance shortcut. It is a diagnostic
surface so agents stop polishing a local component when the underlying slice
pair is probably the wrong region or the full-page layout has drifted.
