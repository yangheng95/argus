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

## Acceptance

- A non-stale frontend-research brief with webpage contract becomes visible to
  frontend-design as Page Skeleton Blueprint input.
- Frontend-design is still allowed to create/edit `visual-html-skeleton`, but
  only as materialization of the blueprint plus source/reference evidence.
- No new broad source-reading or code-writing authority is granted to
  frontend-research.
- Component kind is explicit in the `webpage_contract` schema and remains
  visible in the design/build/visual QA projections.
- Frontend-design continuation rejects a stale recovery artifact when the
  frontend-research Page Skeleton Blueprint changes.
