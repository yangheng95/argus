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
---

# Webpage Reference Frontend Template Skill

You are not implementing the page. You are producing the authoritative frontend template that later agents will implement. Do not implement application source.

## Evidence Package

For a live webpage reference, create the mirror evidence package once if it does not already exist for the requested URL. The package is complete when it contains:

- `mirror/reference.png`
- `mirror/capture.html`
- `mirror/page.ir.json`
- `mirror/assets/manifest.json`
- `mirror/segments.json`
- `mirror/codegen-context.json`
- `mirror/source-skeleton/`
- `mirror/source-skeleton/README.md`
- `mirror/source-skeleton/index.html`
- `mirror/source-skeleton/styles.css`
- `mirror/source-skeleton/critical.css`
- `mirror/source-skeleton/full-source.css`
- `mirror/source-skeleton/used-selectors.json`
- `mirror/source-skeleton/skeleton-manifest.json`
- `mirror/source-skeleton/source-skeleton-audit.json`
- `mirror/source-ir/component-tree.json`
- `mirror/source-ir/content-model.json`
- `mirror/source-ir/layout-map.json`
- `mirror/source-ir/style-tokens.json`
- `mirror/source-ir/interaction-hints.json`
- `mirror/source-ir/source-quality-audit.json`
- `mirror/shared-context.md`
- `mirror/prd-evidence-summary.md`
- `mirror/visual-surface-candidates.json`
- `mirror/visual-surface-scaffold.json`
- no general scaffold JSON browsing; if one named unresolved gap remains, read one first excerpt only (`start_line=1`, `max_lines<=120`)

After that package exists, stop acquiring mirror evidence and move to frontend template synthesis. The session's main deliverable is the frontend template, not another extraction pass.

Use `mirror/prd-evidence-summary.md`, `mirror/page.ir.json`, `mirror/assets/manifest.json`, `mirror/segments.json`, `mirror/codegen-context.json`, `mirror/shared-context.md`, the pixel reference, and the tool summaries as the frontend template working surface. Do not read `mirror/extracted-page.json` or `mirror/capture.html` wholesale; they are raw source artifacts for deterministic tools and the downstream manifest, not prompt working context.

Use `mirror/page.ir.json` as the canonical structure source and `mirror/assets/manifest.json` as the canonical dense-resource source. CSS, SVG path data, base64/data URIs, canvas captures, images, and other long values live in sidecar assets; reference them by id/path instead of copying them into the frontend template.

frontend_design/host must materialize the development-facing source handoff as project-root `web-clone-source/` before downstream Build runs. Use `web-clone-source/README.md`, `web-clone-source/implementation-blueprint.md`, `web-clone-source/web-clone-context.md`, `web-clone-source/web-clone-implementation-contract.json`, `web-clone-source/source-ir/component-tree.json`, `web-clone-source/source-ir/content-model.json`, `web-clone-source/source-ir/layout-map.json`, `web-clone-source/source-ir/style-tokens.json`, `web-clone-source/source-ir/interaction-hints.json`, `web-clone-source/visual-surface-candidates.json` when present, and `web-clone-source/source-skeleton/critical.css` as the development-facing source handoff. The raw `web-clone-source/source-skeleton/index.html` is source-only evidence for exact hierarchy/source ids and missing text; it is not a template to mechanically convert into one giant React/Vue/etc. component. Downstream Build must read these artifacts and generate normal project-owned components, data models, render loops, CSS, and adapters from them. `web-clone-source/reference.png` remains the visual truth for final screenshot regression. `web-clone-source/source-skeleton/full-source.css`, `web-clone-source/source-skeleton/index.html`, `web-clone-source/page.ir.json`, `web-clone-source/assets/manifest.json`, `web-clone-source/segments.json`, and `web-clone-source/codegen-context.json` remain canonical evidence and diagnostics for targeted gaps, but they are not a substitute for `implementation-blueprint.md`, source IR, and maintainable app source.

The frontend template must describe a blueprint-first implementation flow: first read the visible `web-clone-source/` package; if that package is missing, report a host materialization blocker instead of asking Build to repair it from `mirror/`; then use `implementation-blueprint.md`, source IR, visual-surface candidates, and `critical.css` as primary implementation inputs; use `source-skeleton/index.html` and `full-source.css` only for exact hierarchy or targeted missing style detail; then generate idiomatic target-framework components, data models, adapters, and interaction logic in the target project. Do not create a separate generated source project as the deliverable path. Repeated tables/lists/cards must become data arrays and component loops. The implementation must not re-extract the webpage, fork the visual DOM from guesses, mechanically convert raw skeleton HTML, runtime-load third-party CSS bundles, or edit an unmaintainable generated runtime. If the user asks for maintainable/real/component-reuse replacement, set `final_delivery_mode=maintainable_replacement_required` and include `quality_project_contract` plus `baseline_replacement_plan` entries that say which generated baseline regions Build must replace/delete/defer, which `component_reuse_plan` family owns them, and which existing project component or mature library should be reused before any custom fallback. The raw frontend-design baseline project is visual evidence only; the frontend_design handoff must define the GPT-class maintainable project Build is expected to produce.

The frontend template must require downstream implementation evidence from `web_clone_source_audit` / `web-clone-source-skeleton-consumption-audit.json`: reference text from `web-clone-source/source-ir/content-model.json` and `web-clone-source/source-skeleton/index.html` is present in project source, repeated structures are implemented as data arrays plus framework loops, semantic component files exist, default framework scaffold text/assets are absent, and project-owned source does not use large HTML strings, `innerHTML`/`dangerouslySetInnerHTML`, manual DOM mutation, dense inline SVG, or base64 data URIs. In `maintainable_replacement_required` mode the audit must also reject the frontend-design generated DOM/CSS baseline as the final deliverable.

Visual acceptance must be a viewport matrix, not a single screenshot. Name the required desktop, tablet, and narrow/mobile viewport sizes in `visual_consistency_contract`; each viewport must be rendered and evaluated with a strict 96/100 threshold, and source review must reject large HTML-string, inline base64, or dense CSS replay in project-owned source files.

## Frontend Template Requirements

- Visible text must come from extracted DOM / IR facts.
- Visual values must come from pixels, computed styles, or scaffold tokens.
- Component and interaction contracts must name the affected layout/component ids.
- `fillable_modules` must include a "source skeleton handoff" section naming `source-skeleton/README.md`, `source-ir/component-tree.json`, `source-ir/content-model.json`, `source-ir/style-tokens.json`, `source-ir/interaction-hints.json`, `source-skeleton/critical.css`, `source-skeleton/index.html`, `source-skeleton/full-source.css`, `source-skeleton/used-selectors.json`, `source-skeleton/skeleton-manifest.json`, `reference.png`, `page.ir.json`, `assets/manifest.json`, `segments.json`, asset ownership, and the required target-framework component/data/adapters.
- `fillable_modules` must include a "functional fill" section naming the data models, hooks/adapters, interaction handlers, and loading/error/empty states that populate those slots.
- UI data requirements must be inferred from observable UI behavior and code artifacts only. Do not turn a visual page into backend/API/database scope unless the user explicitly asks for backend/database/full-stack delivery or the evidence requires it. For explicit full-stack delivery, require a local database schema, seed/reset script, and read APIs derived from `source-ir/content-model.json` tables/lists/cards/metrics/navigation so the frontend renders repeated content through data contracts instead of JSX hardcoding.
- Unknown backend details must be marked as unknown instead of invented.
- Visual consistency requirements must go directly into `visual_consistency_contract`: reusable tokens, layout, components, interactions, responsive rules, dense repeated surfaces, and screenshot comparison against `reference.png`.
- `visual_consistency_contract` must include the viewport matrix and acceptance rule: every listed viewport must pass numeric visual evaluation at `passThreshold=96` plus source-quality review against static replay.
- `visual_consistency_contract` and `fillable_modules` must require a source-skeleton consumption check before visual pass: the build output must pass `web_clone_source_audit` against the visible `web-clone-source/` package and produce `web-clone-source-skeleton-consumption-audit.json` proving skeleton/IR coverage, maintainable components/data loops, and no scaffold/replay shortcuts. For maintainable replacement requests, require `finalDeliveryMode: "maintainable_replacement_required"` in that audit. Architect converts this requirement into per-goal acceptance specs later.
- Do not create one row per repeated table row, ticker, text instance, candle, or data point.
- Follow `assistant.auto_iteration`: one bounded frontend template review pass when disabled; at least two review passes when enabled (inventory coverage, then downstream frontend replica implementability).
- Finalize with StructuredOutput fields: `frontend_template`, `fillable_modules`, `component_inventory`, `material_inventory`, `visual_consistency_contract`, `ui_data_contract`, `template_iteration_notes`, `completeness_review`, `reference_artifacts`, and `open_questions`.
- Put every source file/image URL and mirror artifact name you used into `reference_artifacts`; the orchestrator will publish them as `evidence_source_manifest` and materialize task-scoped runtime frontend-design template plus evidence-source-manifest files for downstream agents.

## Downstream Contract

Build agents consume the persisted frontend template, especially `visual_consistency_contract`, the source IR/source skeleton handoff, the functional fill section, plus optional `task.design_specs` anchors. They do not call mirror tools. Architect should order goals so the source-IR/source-skeleton-derived component source lands before business adapters and interactions. Build records its own runtime/visual evidence against `reference.png`; Integrity owns the final workflow gate inside a review session.
