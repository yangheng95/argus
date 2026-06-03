---
name: image-generate
description: Produce a webpage-evidence-grounded frontend template from screenshot-only visual references. frontend_design owns the image webpage evidence tools, then writes the frontend template, fillable modules, component inventory, material inventory, UI data contract, and visual-fidelity contract. Build implements from the persisted frontend template; integrity performs the final session-bound visual acceptance review.
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

# Image Reference Frontend Template Skill

You are not implementing the page. You are producing the authoritative frontend template that later agents will implement.

## Evidence Package

For screenshot-only references, create the webpage evidence package once if it does not already exist for the staged images. The package is complete when it contains:

- `webpage-evidence/reference.png`
- `webpage-evidence/page-ir.xml`
- `webpage-evidence/shared-context.md`
- `webpage-evidence/visual-surface-scaffold.json`
- `webpage-evidence/generated-view-source/*` only as legacy visual-surface evidence when present; do not treat it as project source or a Build template.
- no general scaffold JSON browsing; if one named unresolved gap remains, read one first excerpt only (`start_line=1`, `max_lines<=120`)

After that package exists, stop acquiring webpage evidence and move to frontend template synthesis. The session's main deliverable is the frontend template, not another extraction pass.

Use the screenshot pixels, `webpage-evidence/shared-context.md`, `webpage-evidence/page-ir.xml`, `webpage-evidence/visual-surface-scaffold.json`, and the tool summaries as the frontend template working surface. Do not read `webpage-evidence/image-analysis.json` wholesale; it is the raw source artifact for deterministic tools and the downstream manifest, not prompt working context.

## Frontend Template Requirements

- The screenshot is the final visual ground truth.
- Values inferred by image analysis are estimates; when analysis conflicts with visible pixels, say so and prefer the pixels for visual specs.
- UI data requirements must be inferred from visible UI behavior only.
- Unknown backend/API details must be marked as unknown instead of invented, and must not be elevated into backend scope unless the user explicitly asked for it.
- Visual consistency requirements must go directly into `visual_consistency_contract`: reusable tokens, layout, components, interactions, responsive rules, and dense repeated surfaces.
- Do not create one row per repeated table row, ticker, text instance, candle, or data point.
- Follow `assistant.auto_iteration`: one bounded frontend template review pass when disabled; at least two review passes when enabled (inventory coverage, then downstream frontend replica implementability).
- Finalize with StructuredOutput fields: `frontend_template`, `fillable_modules`, `component_inventory`, `material_inventory`, `visual_consistency_contract`, `ui_data_contract`, `template_iteration_notes`, `completeness_review`, `reference_artifacts`, and `open_questions`.
- Put every source file/image URL and webpage evidence artifact name you used into `reference_artifacts`; the orchestrator will publish them as `evidence_source_manifest` and materialize task-scoped runtime frontend-design template plus evidence-source-manifest files for downstream agents.

## Downstream Contract

Build agents consume the persisted frontend template, especially `fillable_modules`, `component_inventory`, `material_inventory`, `visual_consistency_contract`, and the UI data contract, plus optional `task.design_specs` anchors. They do not call webpage evidence tools. Build records its own runtime/visual evidence; Integrity owns the final workflow gate inside a review session.
