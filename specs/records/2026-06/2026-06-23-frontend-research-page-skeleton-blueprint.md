# Frontend Research Page Skeleton Blueprint

Date: 2026-06-23

## Task

Move webpage page-skeleton ownership out of `frontend_design`'s freeform
materialization prompt and into `frontend_research`'s source-backed investigation
brief.

The target boundary:

- `frontend_research` owns the screenshot/source-evidence description of the
  page skeleton: visible region order, section count, major module boundaries,
  concrete `functional_surfaces.component_kind_hypothesis` values, data/content
  anchors, interaction states, and fidelity risks.
- `frontend_design` owns material preparation and materialization: source package
  preparation, source-editable `visual-html-skeleton/` files, assets, token/style
  extraction, screenshots, and the frontend handoff. It must consume the
  `frontend_research` page skeleton blueprint as page information architecture
  input and must not invent, reorder, or demote major content sections from
  `sourceDomReplacementPlan` queue order.
- `frontend_research` remains a structured investigation publisher. It does not
  write HTML/CSS, edit code, create the visual skeleton files, or become Build.

## Current Failure

TradingView world-economy failures show that evidence can exist while the
materialized skeleton is still wrong:

- A complete reference atlas already existed with source dimensions
  `1440x6572` and eight band images.
- The frontend-design prompt still allowed page skeleton establishment inside
  design from current screenshot/source evidence plus replacement rows.
- `frontend_research` currently says "Visual HTML Skeleton Coverage" but does
  not explicitly own a Page Skeleton Blueprint that downstream design must obey.

That leaves frontend-design with too much authority over information
architecture and lets component queue order become page skeleton order.

## Repair Plan

1. Add a frontend-research-to-design prompt section renderer:
   `renderFrontendResearchDesignPromptSection`.
2. Render `webpage_contract.visual_layout`, `functional_surfaces`,
   `data_content_inventory`, `interaction_states`, and `fidelity_risks` as a
   compact "Page Skeleton Blueprint" for frontend-design.
3. Append that section to the frontend-design user prompt when a non-stale
   frontend-research brief exists.
4. Update frontend-research prompt language so "Visual HTML Skeleton Coverage"
   explicitly includes the Page Skeleton Blueprint: visible flow order, region
   count, major content sections, component kinds, source evidence ids, and
   risks.
5. Update frontend-design prompt language so it consumes the blueprint as the
   page IA source. Source IR/reference pixels can repair evidence gaps, but
   `sourceDomIterationState` and `sourceDomReplacementPlan` remain per-region
   restoration evidence only.
6. Add tests that prove:
   - frontend-research prompt requires Page Skeleton Blueprint output.
   - the new design prompt section renders compact blueprint data.
   - frontend-design user prompt includes the research blueprint section.
   - frontend-design prompt forbids using replacement queue order as page IA.

## Adversarial Review Amendments

Independent review found four extra risks and the implementation must cover
them in the same repair:

- Do not create a second persisted Blueprint artifact. Keep `webpage_contract`
  as the single stored source and add role-specific prompt projections.
- `component-kind hypotheses` must be a schema-backed field, not a renderer
  guess from surface titles. Add `functional_surfaces.component_kind_hypothesis`
  and project it into requirements/architect/design/build/visual QA views as
  appropriate.
- Frontend-design continuation snapshots must include the design-side
  blueprint projection so a newly produced or changed frontend-research brief
  invalidates stale frontend-design recovery.
- Workflow hints and host-prepared source summaries must not tell
  frontend-design to start page architecture from
  `sourceDomIterationState.ts`/`sourceDomReplacementPlan.ts`; those files are
  only per-region selection and repair metadata.

## Follow-up: Design-First Evidence Escape

Task `tsk_ef31c37850015M9wXdvRwPU1u5` reproduced a remaining ordering bug:
the orchestrator session quoted the prompt sentence that raw webpage
evidence/source package materialization may require `frontend_design` first,
then dispatched `frontend_design` at `2026-06-23 06:17:11Z`. The task had an
`explore` child and a `frontend-design` child, but no `frontend-research`
session, and the decision log wrote `frontend_design/webpage_evidence` at
`2026-06-23 06:18:07Z`.

That means the page-skeleton ownership repair is incomplete while the
design-first evidence exception remains. For live webpage clones with no
non-stale Page Skeleton Blueprint, the frontend-research tool path must be the
first rendered-evidence consumer because the host prepares evidence from
`source_urls` before the frontend-research session. Frontend-design may still
materialize the visual template and source package, but it must not be invoked
merely to discover page information architecture or raw webpage evidence before
frontend-research publishes the blueprint.

## Follow-up: Same-URL Focus Rerun

Task `tsk_ef3d14bc0001Q7vgzoeDtiC7Of` reproduced the inverse ordering bug after
frontend-research and frontend-design had both succeeded. The orchestrator
created three fresh `frontend_research` children for the same URL at
`2026-06-23T10:14:23Z` after reading the first brief's fidelity risks:

- mobile/tablet viewport evidence
- hover/focus/active state evidence
- world-map SVG/path/tooltip evidence

The orchestrator reasoning quoted the correct rule that existing
frontend_research briefs should only be followed by frontend_research for
additional source page URLs, then misclassified "same URL with a different
focus" as a possible additional page scope. That is wrong: source-page scope is
bounded by the source URL, not by focus text. A different viewport, interaction
state, region, component, data question, fidelity risk, or missing-detail note
for the same URL must be routed through requirements, architect, build,
visual_qa, or integrity using the persisted frontend_research/frontend_design
artifacts. It must not open another frontend_research session for the same
source page.

## Acceptance

- A non-stale frontend-research brief with webpage contract becomes visible to
  frontend-design as Page Skeleton Blueprint input.
- Frontend-design is still allowed to create/edit `visual-html-skeleton`, but
  only as materialization of the blueprint plus source/reference evidence.
- Live webpage clone orchestration does not use `frontend_design` first merely
  to prepare raw webpage evidence when the Page Skeleton Blueprint is missing.
- No new broad source-reading or code-writing authority is granted to
  frontend-research.
- Component kind is explicit in the `webpage_contract` schema and remains
  visible in the design/build/visual QA projections.
- Frontend-design continuation rejects a stale recovery artifact when the
  frontend-research Page Skeleton Blueprint changes.
- Same source URL with a new focus, viewport, interaction state, region,
  component, data question, fidelity risk, or missing-detail note is not treated
  as an additional frontend_research page scope after a non-stale brief exists.
