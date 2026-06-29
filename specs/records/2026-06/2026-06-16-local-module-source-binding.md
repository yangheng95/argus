# Local Module Source Binding

Date: 2026-06-16

## Problem

The visual repair loop was modeled around pre-cut source webpage regions. That is the wrong primary abstraction for build work. Build agents edit a concrete local module, not an abstract source-region list. The required operation is:

1. Capture the local module currently being edited.
2. Use its locator, component files, and visible anchors to find the corresponding source webpage module.
3. Produce a source/local binding puzzle image that the model receives as a tool attachment.
4. Feed the resulting binding into `region comparison tool`.

The source crop does not need pixel-perfect bbox alignment. It must fully contain the corresponding source module and avoid binding to the wrong neighboring module.

## Impact Review

`rg "region comparison tool|RegionComparisonTool|BrowserPreviewRegionBinding|reference.png|layout-map|sourceDomRegions" packages/opencorvus/src packages/opencorvus/test`

| Area                                   | Current behavior                                                                                                                              | Decision                                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `region comparison tool`      | Requires a preauthored source bbox.                                                                                                           | Keep it as the comparison consumer. Do not make build agents invent bboxes.                                                                         |
| `browser-preview/region-comparison.ts` | Crops source and local screenshots once binding exists.                                                                                       | Reuse the binding schema and source reference resolution.                                                                                           |
| `browser-preview/evidence-runner.ts`   | Captures local regions from browser preview targets.                                                                                          | Add a separate local-module capture path that extracts anchors and full-page local screenshot for binding.                                          |
| `web-clone-source` evidence            | Contains `reference.png`, `visual-surface-candidates.json`, `source-ir/layout-map.json`, and sometimes frontend-design `sourceDomRegions.ts`. | Use these as candidate evidence for source module matching.                                                                                         |
| Build prompt                           | Tells agents to prefer region comparison but leaves missing bindings underspecified.                                                          | Instruct build to call `local source-binding helper` when source bbox is missing or questionable, then pass `metadata.binding` to comparison. |

## Design

Add `local source-binding helper`.

Inputs:

- `targetID`: existing `browser_preview_target`.
- `viewportID`: local capture viewport.
- `regionID`: stable local module id.
- `route`: local route.
- `implementationLocator`: local module locator.
- `componentFiles`: source files implementing this module.
- `textAnchors`: optional extra visible labels from the module.
- `sourceReferenceArtifactID`: defaults to `web-clone-source/reference.png`.
- `sourcePadding` / `localPadding`: crop expansion to ensure visual containment.

Process:

1. Open the task-scoped preview target and route.
2. Locate the local module, scroll it into view, capture full-page local screenshot, local bbox, full text, and visible anchors.
3. Collect source candidates from:
   - `web-clone-source/visual-surface-candidates.json`
   - `web-clone-source/source-ir/layout-map.json`
   - `frontend-design-skeleton/src/data/sourceDomRegions.ts`
4. Score candidates using local anchors, region id, and component file words. Prefer source-dom regions and visual surfaces over tiny layout nodes when they match the same anchors.
5. Expand the selected source bbox and local bbox, crop both, create a source context crop with the selected bbox marked, and compose a `binding-puzzle.png`.
6. Return the puzzle as a tool image attachment and return `metadata.binding`, compatible with `region comparison tool`.

Outputs:

- `local-module-source-binding.json`
- `source-crop.png`
- `implementation-crop.png`
- `source-context.png`
- `binding-puzzle.png`
- persisted browser preview evidence
- tool image attachment containing the binding puzzle

## Non-Goals

- Do not use global source webpage segmentation as the primary workflow.
- Do not require exact bbox equality.
- Do not ask the model to browse files manually to find the puzzle; the tool result attaches the puzzle image directly.
- Do not replace `region comparison tool`; this tool creates its input binding.

## Test Plan

- Unit test candidate scoring chooses the source module matching local anchors over a page-wide candidate.
- Unit test artifact materialization writes source/local/context/puzzle PNGs.
- Tool registry test confirms `local source-binding helper` is available.
- Build prompt test confirms the build workflow calls binding before comparison when source bbox is missing/questionable.
