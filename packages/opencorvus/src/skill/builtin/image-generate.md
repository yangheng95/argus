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
4. Read `mirror/reference.png`, `mirror/image-analysis.json`, `mirror/page-ir.xml`, `mirror/scaffold.json`, and `mirror/shared-context.md`.
5. Register visual specs for tokens, layout, components, interactions, and responsive rules.
6. Perform at least two PRD/SPEC review passes: inventory coverage, then downstream frontend/backend implementability.
7. Finalize with StructuredOutput fields: `product_spec`, `frontend_spec`, `backend_spec`, `prd_iteration_notes`, `completeness_review`, `reference_artifacts`, and `open_questions`. Put every source file/image URL and mirror artifact name you used into `reference_artifacts`; the orchestrator will publish them as `evidence_source_manifest` for downstream agents.

## SPEC Requirements

- The screenshot is the final visual ground truth.
- Values inferred by image analysis are estimates; when analysis conflicts with visible pixels, say so and prefer the pixels for visual specs.
- Backend/API requirements must be inferred from visible UI behavior only.
- Unknown backend details must be marked as unknown instead of invented.

## Downstream Contract

Build agents consume the persisted SPEC and `task.design_specs`. They do not call mirror tools. Delivery owns rendered browser evidence and visual hard gates.
