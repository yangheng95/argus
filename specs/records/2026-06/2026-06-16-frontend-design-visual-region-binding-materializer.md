# Frontend Design VisualRegionBinding Materializer

Date: 2026-06-16

## Problem

`frontend_design` can be asked to deliver a `VisualRegionBinding` package with per-region source references, bboxes, target routes, implementation locators, and component files. The current workflow exposes source extraction, skeleton creation, render/evaluate diagnostics, and `submit_frontend_template`, but it does not expose a first-class tool that materializes real per-region reference crops or a durable binding manifest.

The observed failure mode is structural:

- The failed frontend-design task produced no goals and no region binding package.
- A later replacement task wrote `docs/visual-region-binding.json`, but its region "crops" were handwritten SVG wrappers around a full-page screenshot.
- Build-side `region comparison tool` has real region crop/comparison behavior, but that is not available as a frontend-design handoff materializer.
- A direct experiment against `https://www.tradingview.com/markets/world-economy/` showed that DOM-driven section detection is not a reliable source of crop boundaries: TradingView parent containers can wrap multiple visible modules, producing duplicate huge crops such as a whole content column plus nested map crops.

Prompt wording alone cannot fix this because the agent needs direct visual coordinates in the model context, not prose instructions to infer bboxes from DOM structure.

## Call-Site Review

`rg "submit_frontend_template|record_frontend_region_selection|webpage_render|FRONTEND_DESIGN_SESSION_TOOL_IDS|region comparison tool|cropPng" packages/opencorvus/src packages/opencorvus/test`

| Area                                   | Current behavior                                                                          | Decision                                                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend-design/agent.ts`             | Builds the frontend-design tool surface and finalizes through `submit_frontend_template`. | Add `create_visual_region_coordinate_atlas` and `create_visual_region_binding_package` to the normal frontend-design tool surface.            |
| `frontend-design/static-tools.ts`      | Static tool ID lists omit any VisualRegionBinding materializer.                           | Add both tool IDs to static/session lists. They are session handoff materializers, not source-editing implementation tools.                   |
| `frontend-design-core.txt`             | Requires visual evidence but does not provide a concrete binding materialization step.    | Instruct agents to call the materializer when the task requires VisualRegionBinding/per-region binding evidence.                              |
| `browser-preview/region-comparison.ts` | Crops source and implementation images for build/integrity comparison.                    | Keep build comparison separate; frontend-design gets source crop + binding manifest materialization only.                                     |
| `frontend-design/tools/output-dir.ts`  | Constrains webpage evidence writes under `webpage-evidence/`.                             | Leave unchanged. Region binding artifacts should live under the frontend-design runtime package, not masquerade as webpage extraction output. |

## Design

Add `create_visual_region_coordinate_atlas` before `create_visual_region_binding_package`.

`create_visual_region_coordinate_atlas` inputs:

- `sourceImagePath`: existing full-page source PNG inside the current project, absolute or project-relative.
- `atlasName`: optional package directory name.
- `bandHeight`: optional vertical band height in source pixels; default `900`.
- `gridStep`: optional coordinate grid spacing; default `100`.

`create_visual_region_coordinate_atlas` outputs:

- A scaled full-page overview with band labels.
- Per-band PNG images with absolute screenshot x/y coordinate grid labels.
- Image attachments in the tool result, so the frontend-design LLM can read the coordinate atlas directly.
- An atlas manifest under `.opencorvus/r/t/<task>/fd/visual-region-atlases/<atlas-name>/manifest.json`.

The LLM must author region bboxes from visible screenshot boundaries in the returned atlas images. DOM/source structure may be used only to name locators and component ownership; it is not the source of crop boundaries.

Then add `create_visual_region_binding_package`.

Inputs:

- `sourceImagePath`: existing full-page source PNG inside the current project, absolute or project-relative.
- `manifestPath`: optional project-relative or project-contained absolute output JSON path; default `docs/visual-region-binding.json`.
- `regions[]`: each region provides `region_id`, `source_bbox`, `viewport`, `region_scope`, `target_route`, `implementation_locator`, and `component_files`.

Outputs:

- Real PNG crops under `.opencorvus/r/t/<task>/fd/visual-region-bindings/<manifest-stem>/`.
- A bbox overlay PNG drawn on top of the full source reference.
- A contact sheet PNG showing every crop with region id and bbox.
- The bbox overlay and contact sheet as image attachments in the tool result, so the frontend-design LLM can inspect whether cuts are too broad, duplicated, missing, or visually off-boundary before submitting.
- A JSON manifest containing the required VisualRegionBinding fields and each crop path as `source_reference_artifact`.
- A process-trace event so failed/successful materialization is visible in frontend-design diagnostics.

Crop filenames are derived from the source image dimensions and bbox, not from the requested viewport label:

- `01-global_header__src1440x6571__x0-y0-w1440-h64.png`

This avoids the misleading pattern `1440x900-region.png` when the crop is taken from a 1440px-wide full-page screenshot whose real height is much larger than the viewport.

Non-goals:

- Do not add a numeric quality gate.
- Do not make frontend-design run implementation comparison; build/integrity keeps `region comparison tool`.
- Do not accept SVG wrappers, prose-only references, missing source images, or out-of-bounds boxes.
- Do not let the agent finalize without inspecting the generated coordinate atlas first, then the overlay/contact sheet, and rerunning the materializer when region boundaries are wrong.
- Do not derive crop bboxes from DOM parent containers.

## Test Plan

- Unit test the materializer with a generated PNG and two regions; assert crops are PNGs with exact dimensions and the manifest has required fields.
- Unit test rejection for missing task ID and out-of-bounds bboxes.
- Unit test derived crop filenames, bbox overlay, contact sheet, duplicate binding rejection, external path rejection, and non-JSON manifest rejection.
- Unit test coordinate atlas overview/band generation, manifest shape, and source-coordinate filenames.
- Prompt/static-tool test that frontend-design exposes the tool and tells agents to materialize real PNG crops for VisualRegionBinding tasks.
