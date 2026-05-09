---
name: webpage-generate
description: Produce a mirror-grounded PRD/SPEC for a live webpage reference. Design-analysis owns the webpage mirror evidence tools, then writes visual specs plus frontend/backend implementation contracts for downstream build agents. This skill no longer belongs to build; build implements from the persisted SPEC and delivery performs visual gates.
stage: design_analyst
auto_detect:
  task_signals:
    request_contains_url: true
priority: 60
required_tools:
  - webpage_extract
  - webpage_compile
  - webpage_analyze
---

# Webpage Reference SPEC Skill

You are not implementing the page. You are producing the authoritative PRD/SPEC that later agents will implement. Do not implement application source.

## Evidence Package

For a live webpage reference, create the mirror evidence package once if it does not already exist for the requested URL. The package is complete when it contains:

- `mirror/reference.png`
- `mirror/page-ir.xml`
- `mirror/shared-context.md`
- `mirror/prd-evidence-summary.md`
- bounded access to `mirror/scaffold.json` for named unresolved gaps only

After that package exists, stop acquiring mirror evidence and move to PRD/SPEC synthesis. The session's main deliverable is the PRD/SPEC, not another extraction pass.

Use `mirror/prd-evidence-summary.md`, `mirror/shared-context.md`, `mirror/page-ir.xml`, the pixel reference, and the tool summaries as the PRD/SPEC working surface. Do not read `mirror/extracted-page.json` wholesale; it is the raw source artifact for deterministic tools and the downstream manifest, not prompt working context.

## SPEC Requirements

- Visible text must come from extracted DOM / IR facts.
- Visual values must come from pixels, computed styles, or scaffold tokens.
- Component and interaction contracts must name the affected layout/component ids.
- Backend/API requirements must be inferred from observable UI behavior and code artifacts only.
- Unknown backend details must be marked as unknown instead of invented.
- Visual consistency requirements must go directly into `visual_consistency_spec`: reusable tokens, layout, components, interactions, responsive rules, and dense repeated surfaces.
- Do not create one row per repeated table row, ticker, text instance, candle, or data point.
- Perform at least two PRD/SPEC review passes: inventory coverage, then downstream frontend/backend implementability.
- Finalize with StructuredOutput fields: `product_spec`, `frontend_spec`, `visual_consistency_spec`, `backend_spec`, `prd_iteration_notes`, `completeness_review`, `reference_artifacts`, and `open_questions`.
- Put every source file/image URL and mirror artifact name you used into `reference_artifacts`; the orchestrator will publish them as `evidence_source_manifest` and materialize `.opencorvus/design-analysis/prd-spec.md` plus `.opencorvus/design-analysis/evidence-source-manifest.md` for downstream agents.

## Downstream Contract

Build agents consume the persisted PRD/SPEC, especially `visual_consistency_spec`, plus optional `task.design_specs` anchors. They do not call mirror tools. Delivery owns rendered browser evidence and visual hard gates.
