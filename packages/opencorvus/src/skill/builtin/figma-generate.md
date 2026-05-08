---
name: figma-generate
description: Produce a mirror-grounded PRD/SPEC from Figma references. Design-analysis owns `figma_extract` -> `figma_compile` -> `figma_analyze`, then writes visual specs plus frontend/backend implementation contracts. Build implements from the persisted SPEC; delivery performs visual gates.
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

## Required Evidence Path

1. Run `figma_extract` for the Figma URL.
2. Run `figma_compile` after extraction finishes.
3. Run `figma_analyze` after extraction finishes.
4. Read the generated Figma mirror artifacts, compiled IR, scaffold, and shared context.
5. Register visual specs for tokens, layout, components, interactions, and responsive rules.
6. Perform at least two PRD/SPEC review passes: inventory coverage, then downstream frontend/backend implementability.
7. Finalize with StructuredOutput fields: `product_spec`, `frontend_spec`, `backend_spec`, `prd_iteration_notes`, `completeness_review`, `reference_artifacts`, and `open_questions`. Put every source file/image URL and mirror artifact name you used into `reference_artifacts`; the orchestrator will publish them as `evidence_source_manifest` for downstream agents.

## SPEC Requirements

- Treat Figma nodes/tokens as authoritative for visual structure.
- Component names, variants, and reusable patterns should come from Figma artifacts when available.
- Backend/API requirements must be inferred from product behavior described by the task or visible UI states, not from imagined infrastructure.
- Unknown backend details must be marked as unknown instead of invented.

## Downstream Contract

Build agents consume the persisted SPEC and `task.design_specs`. They do not call mirror tools. Delivery owns rendered browser evidence and visual hard gates.
