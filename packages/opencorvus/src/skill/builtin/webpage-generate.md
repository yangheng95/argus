---
name: webpage-generate
description: Produce a mirror-grounded PRD/SPEC for a live webpage reference. Design-analysis owns the webpage mirror evidence tools, then writes visual specs plus frontend/backend implementation contracts for downstream build agents. This skill no longer belongs to build; build implements from the persisted SPEC and integrity performs the final session-bound visual acceptance review.
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
- `mirror/visual-surface-candidates.json`
- `mirror/visual-surface-scaffold.json`
- `mirror/binding-manifest.json`
- `mirror/generated-view-source/*`
- no general scaffold JSON browsing; if one named unresolved gap remains, read one first excerpt only (`start_line=1`, `max_lines<=120`)

After that package exists, stop acquiring mirror evidence and move to PRD/SPEC synthesis. The session's main deliverable is the PRD/SPEC, not another extraction pass.

Use `mirror/prd-evidence-summary.md`, `mirror/shared-context.md`, `mirror/page-ir.xml`, the pixel reference, and the tool summaries as the PRD/SPEC working surface. Do not read `mirror/extracted-page.json` wholesale; it is the raw source artifact for deterministic tools and the downstream manifest, not prompt working context.

Use `mirror/visual-surface-scaffold.json`, `mirror/binding-manifest.json`, and `mirror/generated-view-source/*` as the visual-code handoff surface: they define semantic presentational View components and fillable slots. Business implementation specs must wrap these View components with project-owned containers/hooks/adapters instead of wiring API calls directly into extracted static DOM.

The PRD/SPEC must describe a framework-first implementation flow: first materialize the generated presentational View layer and slot manifest into the target app's conventions, then add project-owned container components, hooks, adapters, mock/API data, and interaction logic that fill those slots. The second phase consumes the first phase's View exports; it must not re-extract the webpage, fork the visual DOM, or attach APIs directly to static extracted markup.

## SPEC Requirements

- Visible text must come from extracted DOM / IR facts.
- Visual values must come from pixels, computed styles, or scaffold tokens.
- Component and interaction contracts must name the affected layout/component ids.
- `frontend_spec` must include a "visual framework handoff" section naming `visual-surface-scaffold.json`, `binding-manifest.json`, generated View components, slot ownership, and the required container/wrapper layer.
- `frontend_spec` must include a "functional fill" section naming the data models, hooks/adapters, interaction handlers, and loading/error/empty states that populate those slots.
- Backend/API requirements must be inferred from observable UI behavior and code artifacts only.
- Unknown backend details must be marked as unknown instead of invented.
- Visual consistency requirements must go directly into `visual_consistency_spec`: reusable tokens, layout, components, interactions, responsive rules, and dense repeated surfaces.
- Do not create one row per repeated table row, ticker, text instance, candle, or data point.
- Follow `assistant.auto_iteration`: one bounded PRD/SPEC review pass when disabled; at least two review passes when enabled (inventory coverage, then downstream frontend/backend implementability).
- Finalize with StructuredOutput fields: `product_spec`, `frontend_spec`, `visual_consistency_spec`, `backend_spec`, `prd_iteration_notes`, `completeness_review`, `reference_artifacts`, and `open_questions`.
- Put every source file/image URL and mirror artifact name you used into `reference_artifacts`; the orchestrator will publish them as `evidence_source_manifest` and materialize task-scoped runtime design-analysis PRD/SPEC plus evidence-source-manifest files for downstream agents.

## Downstream Contract

Build agents consume the persisted PRD/SPEC, especially `visual_consistency_spec`, the visual framework handoff, the functional fill section, plus optional `task.design_specs` anchors. They do not call mirror tools. Architect should order goals so the visual View framework lands before business containers fill slots. Build records its own runtime/visual evidence; Integrity owns the final workflow gate inside a review session.
