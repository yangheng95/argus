---
name: webpage-generate
description: Produce a web-clone-source-grounded frontend template for a live webpage reference. frontend_design owns webpage evidence acquisition and visible source-package materialization, then writes the frontend template, fillable modules, component inventory, material inventory, UI data contract, visual-fidelity contract, and source handoff for downstream build agents. This skill no longer belongs to build; build implements from the persisted frontend template and visible source package, and integrity performs the final session-bound visual acceptance review.
auto_detect:
  task_signals:
    request_contains_url: true
priority: 60
required_tools:
  - webpage_extract
  - webpage_compile
  - webpage_analyze
  - webpage_runtime_state
---

# Webpage Reference Frontend Template Skill

You are not implementing the page. You are producing the authoritative frontend template that later agents will implement. Do not implement application source.

## Evidence Package

For a live webpage reference, create the webpage evidence package once if it does not already exist for the requested URL. The package is complete when it contains:

- `webpage-evidence/reference.png`
- `webpage-evidence/capture.html`
- `webpage-evidence/page.ir.json`
- `webpage-evidence/assets/manifest.json`
- `webpage-evidence/segments.json`
- `webpage-evidence/codegen-context.json`
- `webpage-evidence/source-skeleton/`
- `webpage-evidence/source-skeleton/README.md`
- `webpage-evidence/source-skeleton/index.html`
- `webpage-evidence/source-skeleton/styles.css`
- `webpage-evidence/source-skeleton/critical.css`
- `webpage-evidence/source-skeleton/full-source.css`
- `webpage-evidence/source-skeleton/used-selectors.json`
- `webpage-evidence/source-skeleton/skeleton-manifest.json`
- `webpage-evidence/source-skeleton/source-skeleton-audit.json`
- `webpage-evidence/source-ir/component-tree.json`
- `webpage-evidence/source-ir/content-model.json`
- `webpage-evidence/source-ir/layout-map.json`
- `webpage-evidence/source-ir/style-tokens.json`
- `webpage-evidence/source-ir/interaction-hints.json`
- `webpage-evidence/source-ir/interaction-state-snapshots.json`
- `webpage-evidence/source-ir/source-quality-audit.json`
- `webpage-evidence/shared-context.md`
- `webpage-evidence/prd-evidence-summary.md`
- `webpage-evidence/visual-surface-candidates.json`
- `webpage-evidence/visual-surface-scaffold.json`
- no general scaffold JSON browsing; if one named unresolved gap remains, read one first excerpt only (`start_line=1`, `max_lines<=120`)

After that package exists, stop acquiring webpage evidence and move to frontend template synthesis. The session's main deliverable is the frontend template, not another extraction pass.

Use `webpage-evidence/prd-evidence-summary.md`, `webpage-evidence/page.ir.json`, `webpage-evidence/assets/manifest.json`, `webpage-evidence/segments.json`, `webpage-evidence/codegen-context.json`, `webpage-evidence/shared-context.md`, `webpage-evidence/source-ir/interaction-state-snapshots.json`, the pixel reference, and the tool summaries as the frontend template working surface. Do not read `webpage-evidence/extracted-page.json` or `webpage-evidence/capture.html` wholesale; they are raw source artifacts for deterministic tools and the downstream manifest, not prompt working context.

Use `webpage-evidence/page.ir.json` as the canonical structure source and `webpage-evidence/assets/manifest.json` as the canonical dense-resource source. CSS, SVG path data, base64/data URIs, canvas captures, images, and other long values live in sidecar assets; reference them by id/path instead of copying them into the frontend template.

frontend_design/host must materialize the development-facing source handoff under `.opencorvus/runtime/tasks/<taskID>/frontend-design/`, not in the project root, before downstream Build runs. Use the task-runtime `web-clone-source/README.md`, `web-clone-source/implementation-blueprint.md`, `web-clone-source/web-clone-context.md`, `web-clone-source/web-clone-implementation-contract.json`, `web-clone-source/source-ir/component-tree.json`, `web-clone-source/source-ir/content-model.json`, `web-clone-source/source-ir/layout-map.json`, `web-clone-source/source-ir/style-tokens.json`, `web-clone-source/source-ir/interaction-hints.json`, `web-clone-source/source-ir/interaction-state-snapshots.json`, `web-clone-source/visual-surface-candidates.json` when present, and `web-clone-source/source-skeleton/critical.css` as the development-facing source handoff. The raw `web-clone-source/source-skeleton/index.html` is source-only evidence for exact hierarchy/source ids and missing text; it is not a template to mechanically convert into one giant React/Vue/etc. component. Downstream Build must read the runtime artifact paths published in the frontend_design public report and generate normal project-owned components, data models, render loops, CSS, and adapters from them. `web-clone-source/reference.png` remains the visual truth for final screenshot regression. `web-clone-source/source-skeleton/full-source.css`, `web-clone-source/source-skeleton/index.html`, `web-clone-source/page.ir.json`, `web-clone-source/assets/manifest.json`, `web-clone-source/segments.json`, and `web-clone-source/codegen-context.json` remain canonical evidence and diagnostics for targeted gaps, but they are not a substitute for `implementation-blueprint.md`, source IR, and maintainable app source.

The frontend template must describe a blueprint-first implementation flow: first read the task-runtime `web-clone-source/` package from the public report; if that package is missing, report a host materialization blocker instead of asking Build to repair it from `webpage-evidence/`; then use the generated runtime `frontend-design-skeleton/` source project, `implementation-blueprint.md`, source IR, visual-surface candidates, and `critical.css` as primary implementation inputs; use `source-skeleton/index.html` and `full-source.css` only for exact hierarchy or targeted missing style detail. Repeated tables/lists/cards should become data arrays and component loops as specific regions are refined. The implementation must not re-extract the webpage, fork the visual DOM from guesses, runtime-load third-party CSS bundles, or edit an unmaintainable raw DOM-injection runtime. If the user asks for maintainable/real/component-reuse replacement, set `final_acceptance_mode=maintainable_replacement_required` and include `quality_project_contract`; include `baseline_replacement_plan` only for specific raw/generated regions that need replace/delete/defer handling. The frontend-design source skeleton is the implementation seed, not a sidecar reference to discard.

The frontend template should request downstream implementation evidence from `web_clone_source_audit` / `web-clone-source-skeleton-consumption-audit.json` when source quality is in scope: reference text from `web-clone-source/source-ir/content-model.json` and `web-clone-source/source-skeleton/index.html` is present in project source, repeated structures are implemented as data arrays plus framework loops where componentized, semantic component files exist, default framework scaffold text/assets are absent, and project-owned source does not use screenshot replay, hidden semantic coverage, dense inline SVG, or base64 data URIs. Treat the audit as diagnostics; reject concrete replay/scaffold/source defects, not the mere absence of an audit file.

Visual acceptance must be a viewport matrix, not a single screenshot. Name the required desktop, tablet, and narrow/mobile viewport sizes in `visual_consistency_contract`; each viewport must be rendered and evaluated with measured visual comparison evidence, and source review must reject screenshot replay, hidden coverage, inline base64, or unrelated freehand rebuilds.

For maintainable rawproject/refinement requests, frontend_design must encode a baseline-first, region-by-region replacement algorithm rather than handing off a freehand rewrite. Use the normal frontend_design tool flow; do not create project-internal state machines, self-dispatch loops, or extra runtime blocking mechanisms:

1. Adopt the traceable `frontend-design-skeleton/` source baseline into the acceptance root and compare it with `web-clone-source/reference.png`.
2. Read the static next-candidate metadata from `frontend-design-skeleton/src/data/sourceDomIterationState.ts` (`nextSourceDomReplacement`), then use the matching row in `frontend-design-skeleton/src/data/sourceDomReplacementPlan.ts`: its `sourceMap`, `dataSources`, `assetSources`, `generatedCleanupTargets`, `verticalSliceSteps`, and `parityGuard` are the per-region replacement algorithm.
3. Replace only that region through a vertical slice: source data extraction, semantic component boundary, scoped style ownership, generated fixed-layout cleanup, asset ownership, and interaction/state wiring.
4. Re-render the same viewport matrix, run visual comparison, and run `web_clone_source_audit` in `maintainable_replacement_required` mode.
5. If visual parity regresses or the source audit finds baseline-only/replay/freehand/default-scaffold defects, repair the changed region from source evidence before moving to another region.
6. If any region is deferred, call it unfinished source debt. Do not describe the project as a final maintainable version until the maintainable audit passes and the measured visual evidence satisfies the requested similarity target.

## Frontend Template Requirements

- Visible text must come from extracted DOM / IR facts.
- Visual values must come from pixels, computed styles, or scaffold tokens.
- Component and interaction contracts must name the affected layout/component ids.
- `fillable_modules` must include a "source skeleton handoff" section naming `source-skeleton/README.md`, `source-ir/component-tree.json`, `source-ir/content-model.json`, `source-ir/style-tokens.json`, `source-ir/interaction-hints.json`, `source-ir/interaction-state-snapshots.json`, `source-skeleton/critical.css`, `source-skeleton/index.html`, `source-skeleton/full-source.css`, `source-skeleton/used-selectors.json`, `source-skeleton/skeleton-manifest.json`, `reference.png`, `page.ir.json`, `assets/manifest.json`, `segments.json`, asset ownership, and the required target-framework component/data/adapters.
- `fillable_modules` must include a "functional fill" section naming the data models, hooks/adapters, interaction handlers, and loading/error/empty states that populate those slots.
- UI data requirements must be inferred from observable UI behavior and code artifacts only. Do not turn a visual page into backend/API/database scope unless the user explicitly asks for backend/database/full-stack acceptance or the evidence requires it. For explicit full-stack acceptance, require a local database schema, seed/reset script, and read APIs derived from `source-ir/content-model.json` tables/lists/cards/metrics/navigation so the frontend renders repeated content through data contracts instead of JSX hardcoding.
- Unknown backend details must be marked as unknown instead of invented.
- Visual consistency requirements must go directly into `visual_consistency_contract`: reusable tokens, layout, components, interactions, responsive rules, dense repeated surfaces, and screenshot comparison against `reference.png`.
- `visual_consistency_contract` must include the viewport matrix and measured visual comparison evidence plus source-quality review against static replay.
- `visual_consistency_contract` and `fillable_modules` should include a source-skeleton consumption diagnostic when source quality is in scope: run `web_clone_source_audit` against the task-runtime `web-clone-source/` package path from the public report and record `web-clone-source-skeleton-consumption-audit.json` findings where available. Architect converts concrete user-visible or source-quality defects into per-goal acceptance specs later.
- Do not create one row per repeated table row, ticker, text instance, candle, or data point.
- Follow `assistant.auto_iteration`: one bounded frontend template review pass when disabled; at least two review passes when enabled (inventory coverage, then downstream frontend replica implementability).
- Finalize with StructuredOutput fields: `frontend_template`, `fillable_modules`, `component_inventory`, `material_inventory`, `visual_consistency_contract`, `ui_data_contract`, `template_iteration_notes`, `completeness_review`, `reference_artifacts`, and `open_questions`.
- Put every source file/image URL and webpage evidence artifact name you used into `reference_artifacts`; the orchestrator will publish them as `evidence_source_manifest` and materialize task-scoped runtime frontend-design template plus evidence-source-manifest files for downstream agents.

## Downstream Contract

Build agents consume the persisted frontend template, especially `visual_consistency_contract`, the source IR/source skeleton handoff, the functional fill section, plus optional `task.design_specs` anchors. They do not call webpage evidence tools. Architect should order goals so the source-IR/source-skeleton-derived component source lands before business adapters and interactions. Build records its own runtime/visual evidence against `reference.png`; Integrity performs the final workflow review inside a review session.
