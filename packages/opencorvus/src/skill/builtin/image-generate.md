---
name: image-generate
description: Produce a mirror-grounded PRD/SPEC from screenshot-only visual references. Design-analysis owns the image mirror evidence tools, then writes visual specs plus frontend/backend implementation contracts. Build implements from the persisted SPEC; integrity performs the final session-bound visual acceptance review.
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

## Evidence Package

For screenshot-only references, create the mirror evidence package once if it does not already exist for the staged images. The package is complete when it contains:

- `mirror/reference.png`
- `mirror/page-ir.xml`
- `mirror/shared-context.md`
- `mirror/visual-surface-scaffold.json`
- `mirror/generated-view-source/*`
- no general scaffold JSON browsing; if one named unresolved gap remains, read one first excerpt only (`start_line=1`, `max_lines<=120`)

After that package exists, stop acquiring mirror evidence and move to PRD/SPEC synthesis. The session's main deliverable is the PRD/SPEC, not another extraction pass.

Use the screenshot pixels, `mirror/shared-context.md`, `mirror/page-ir.xml`, `mirror/visual-surface-scaffold.json`, and the tool summaries as the PRD/SPEC working surface. Do not read `mirror/image-analysis.json` wholesale; it is the raw source artifact for deterministic tools and the downstream manifest, not prompt working context.

## SPEC Requirements

- The screenshot is the final visual ground truth.
- Values inferred by image analysis are estimates; when analysis conflicts with visible pixels, say so and prefer the pixels for visual specs.
- Backend/API requirements must be inferred from visible UI behavior only.
- Unknown backend details must be marked as unknown instead of invented.
- Visual consistency requirements must go directly into `visual_consistency_spec`: reusable tokens, layout, components, interactions, responsive rules, and dense repeated surfaces.
- Do not create one row per repeated table row, ticker, text instance, candle, or data point.
- Follow `assistant.auto_iteration`: one bounded PRD/SPEC review pass when disabled; at least two review passes when enabled (inventory coverage, then downstream frontend/backend implementability).
- Finalize with StructuredOutput fields: `product_spec`, `frontend_spec`, `visual_consistency_spec`, `backend_spec`, `prd_iteration_notes`, `completeness_review`, `reference_artifacts`, and `open_questions`.
- Put every source file/image URL and mirror artifact name you used into `reference_artifacts`; the orchestrator will publish them as `evidence_source_manifest` and materialize task-scoped runtime design-analysis PRD/SPEC plus evidence-source-manifest files for downstream agents.

## Downstream Contract

Build agents consume the persisted PRD/SPEC, especially `visual_consistency_spec`, plus optional `task.design_specs` anchors. They do not call mirror tools. Build records its own runtime/visual evidence; Integrity owns the final workflow gate inside a review session.
