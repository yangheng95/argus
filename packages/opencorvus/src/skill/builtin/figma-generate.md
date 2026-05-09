---
name: figma-generate
description: Produce a mirror-grounded PRD/SPEC from Figma references. Design-analysis owns the Figma mirror evidence tools, then writes visual specs plus frontend/backend implementation contracts. Build implements from the persisted SPEC; delivery performs visual gates.
stage: design_analyst
auto_detect:
  task_signals:
    request_contains_figma_url: true
priority: 60
required_tools:
  - figma_extract
  - figma_compile
  - figma_analyze
---

# Figma Reference SPEC Skill

You are not implementing the page. You are producing the authoritative PRD/SPEC that later agents will implement.

## Evidence Package

For Figma references, create the mirror evidence package once if it does not already exist for the requested Figma source. The package is complete when it contains:

- `mirror/reference.png`
- `mirror/page-ir.xml`
- `mirror/shared-context.md`
- no general `mirror/scaffold.json` browsing; if one named unresolved gap remains, read one first excerpt only (`start_line=1`, `max_lines<=120`)

After that package exists, stop acquiring mirror evidence and move to PRD/SPEC synthesis. The session's main deliverable is the PRD/SPEC, not another extraction pass.

Use Figma nodes/tokens, `mirror/reference.png`, `mirror/shared-context.md`, `mirror/page-ir.xml`, and the tool summaries as the PRD/SPEC working surface. Do not read `mirror/figma-design.json` wholesale; it is the raw source artifact for deterministic tools and the downstream manifest, not prompt working context.

## SPEC Requirements

- Treat Figma nodes/tokens as authoritative for visual structure.
- Component names, variants, and reusable patterns should come from Figma artifacts when available.
- Backend/API requirements must be inferred from product behavior described by the task or visible UI states, not from imagined infrastructure.
- Unknown backend details must be marked as unknown instead of invented.
- Visual consistency requirements must go directly into `visual_consistency_spec`: reusable tokens, layout, components, interactions, responsive rules, and dense repeated surfaces.
- Do not create one row per repeated table row, ticker, text instance, candle, or data point.
- Perform at least two PRD/SPEC review passes: inventory coverage, then downstream frontend/backend implementability.
- Finalize with StructuredOutput fields: `product_spec`, `frontend_spec`, `visual_consistency_spec`, `backend_spec`, `prd_iteration_notes`, `completeness_review`, `reference_artifacts`, and `open_questions`.
- Put every source file/image URL and mirror artifact name you used into `reference_artifacts`; the orchestrator will publish them as `evidence_source_manifest` and materialize `.opencorvus/design-analysis/prd-spec.md` plus `.opencorvus/design-analysis/evidence-source-manifest.md` for downstream agents.

## Downstream Contract

Build agents consume the persisted PRD/SPEC, especially `visual_consistency_spec`, plus optional `task.design_specs` anchors. They do not call mirror tools. Delivery owns rendered browser evidence and visual hard gates.
