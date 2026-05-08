---
name: image-generate
description: Produce a mirror-grounded PRD/SPEC from screenshot-only visual references. Design-analysis owns `webpage_image_extract` -> `webpage_image_compile` -> `webpage_image_analyze`, then writes visual specs plus frontend/backend implementation contracts. Build implements from the persisted SPEC; delivery performs visual gates.
stage: design_analyst
auto_detect:
  task_signals:
    has_attachment_image: true
    request_contains_url: false
    request_contains_figma_url: false
priority: 60
required_tools:
  - webpage_image_extract
  - webpage_image_compile
  - webpage_image_analyze
---

# Image Reference SPEC Skill

You are not implementing the page. You are producing the authoritative PRD/SPEC that later agents will implement.

## Required Evidence Path

1. Run `webpage_image_extract` on the staged reference image paths.
2. Run `webpage_image_compile` after extraction finishes.
3. Run `webpage_image_analyze` after extraction finishes.
4. Read `mirror/reference.png`, `mirror/page-ir.xml`, `mirror/shared-context.md`, and mirror tool summaries. Use `mirror/scaffold.json` only for bounded targeted gaps. Do not read `mirror/image-analysis.json` wholesale; it is the raw source artifact for compile/analyze and the downstream manifest, not the PRD/SPEC working surface.
5. Write visual consistency requirements directly into `visual_consistency_spec`: reusable tokens, layout, components, interactions, responsive rules, and dense repeated surfaces. Do not create one row per repeated table row, ticker, text instance, candle, or data point.
6. Perform at least two PRD/SPEC review passes: inventory coverage, then downstream frontend/backend implementability.
7. Finalize with StructuredOutput fields: `product_spec`, `frontend_spec`, `visual_consistency_spec`, `backend_spec`, `prd_iteration_notes`, `completeness_review`, `reference_artifacts`, and `open_questions`. Put every source file/image URL and mirror artifact name you used into `reference_artifacts`; the orchestrator will publish them as `evidence_source_manifest` and materialize `.opencorvus/design-analysis/prd-spec.md` plus `.opencorvus/design-analysis/evidence-source-manifest.md` for downstream agents.

## SPEC Requirements

- The screenshot is the final visual ground truth.
- Values inferred by image analysis are estimates; when analysis conflicts with visible pixels, say so and prefer the pixels for visual specs.
- Backend/API requirements must be inferred from visible UI behavior only.
- Unknown backend details must be marked as unknown instead of invented.

## Downstream Contract

Build agents consume the persisted PRD/SPEC, especially `visual_consistency_spec`, plus optional `task.design_specs` anchors. They do not call mirror tools. Delivery owns rendered browser evidence and visual hard gates.
