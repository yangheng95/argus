---
name: webpage-generate
description: Produce a mirror-grounded PRD/SPEC for a live webpage reference. Design-analysis owns `webpage_extract` -> `webpage_compile` -> `webpage_analyze`, then writes visual specs plus frontend/backend implementation contracts for downstream build agents. This skill no longer belongs to build; build implements from the persisted SPEC and delivery performs visual gates.
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

## Required Evidence Path

1. Run `webpage_extract` for the live URL.
2. Run `webpage_compile` after extraction finishes.
3. Run `webpage_analyze` after extraction finishes.
4. Read `mirror/reference.png`, `mirror/page-ir.xml`, `mirror/shared-context.md`, and mirror tool summaries. Use `mirror/scaffold.json` only for bounded targeted gaps. Do not read `mirror/extracted-page.json` wholesale; it is the raw source artifact for compile/analyze and the downstream manifest, not the PRD/SPEC working surface.
5. Write visual consistency requirements directly into `visual_consistency_spec`: reusable tokens, layout, components, interactions, responsive rules, and dense repeated surfaces. Do not create one row per repeated table row, ticker, text instance, candle, or data point.
6. Perform at least two PRD/SPEC review passes: inventory coverage, then downstream frontend/backend implementability.
7. Finalize with StructuredOutput fields: `product_spec`, `frontend_spec`, `visual_consistency_spec`, `backend_spec`, `prd_iteration_notes`, `completeness_review`, `reference_artifacts`, and `open_questions`. Put every source file/image URL and mirror artifact name you used into `reference_artifacts`; the orchestrator will publish them as `evidence_source_manifest` and materialize `.opencorvus/design-analysis/prd-spec.md` plus `.opencorvus/design-analysis/evidence-source-manifest.md` for downstream agents.

The extraction steps are strictly serial because compile/analyze read artifacts written by extract.

## SPEC Requirements

- Visible text must come from extracted DOM / IR facts.
- Visual values must come from pixels, computed styles, or scaffold tokens.
- Component and interaction contracts must name the affected layout/component ids.
- Backend/API requirements must be inferred from observable UI behavior and code artifacts only.
- Unknown backend details must be marked as unknown instead of invented.

## Downstream Contract

Build agents consume the persisted PRD/SPEC, especially `visual_consistency_spec`, plus optional `task.design_specs` anchors. They do not call mirror tools. Delivery owns rendered browser evidence and visual hard gates.
