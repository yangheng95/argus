# Research Agent Webpage PRD Evidence Algorithm

Superseded on 2026-06-03 by
`specs/new-arch/2026-06-03-frontend-research-agent.md`: rendered webpage
functional/visual PRD evidence now belongs to `frontend-research` /
`frontend_research_brief`, not generic `research` / `research_brief`.

## Problem

When a research task asks for a PRD of a live webpage, the current research prompt says to start from source URLs with
`webfetch`. That is correct for documentation, pricing, API references, and article-style pages, but it is the wrong
primary evidence path for a visual product page or market dashboard. A modern webpage such as TradingView's World
Economy page contains large scripts, serialized data, runtime styles, lazy-rendered visual surfaces, charts, maps, and
responsive states. Feeding the fetched HTML or converted markdown into the research agent burns context on implementation
noise and still misses the visual facts that a PRD needs.

The correct algorithm is:

1. For webpage PRD work, host-prep a rendered webpage evidence package first.
2. Give the research agent compact artifact paths and excerpts from that package.
3. Make `document_outline` the primary PRD module surface returned by research.
4. Keep `webfetch` available only as secondary metadata/source confirmation, not the primary visual evidence source.

## Existing Sources And Call Points

| Surface | Current call points | Decision |
| --- | --- | --- |
| `ResearchAgent.run` | `src/orchestrator/tools.ts` only | Extend this entry point so all research delegations get the same webpage PRD preparation. |
| `createReadonlyRetrievalTools` | `src/research/agent.ts`, `src/fact-check/index.ts` | Keep retrieval surface unchanged except for already-added `webfetch`; do not add browser tools to research. |
| `ensureLiveWebpageEvidence` | `src/orchestrator/tools.ts`, tests in `test/orchestrator/webpage-evidence.test.ts` | Reuse as the single source of webpage evidence generation; do not copy extraction logic. |
| `primaryWebpageEvidenceArtifacts` | `src/orchestrator/tools.ts`, webpage evidence tests | Use artifact list for prompt references. |
| `primaryWebpageSourcePackageArtifacts` | `src/orchestrator/webpage-evidence.ts` | Use source package paths as implementation/source evidence anchors. |
| `ResearchBrief.document_outline` | schema-only today | Treat as the PRD major module list for downstream splitting. |

## Evidence Model

For source URLs and `targetDeliverable="prd"`, if a source URL is http(s), research should receive:

- `prd-evidence-summary.md` excerpt: page inventory, visual tokens, repeated patterns, review passes.
- `source-ir/component-tree.json`: semantic component/region boundaries.
- `source-ir/content-model.json`: visible tables, lists, cards, repeated groups, text signals.
- `source-ir/layout-map.json`: bounds and computed style anchors.
- `source-ir/style-tokens.json`: colors, fonts, spacing, radius, shadows.
- `source-ir/interaction-hints.json`: buttons, tabs, dropdowns, links, accordions, search, carousel controls.
- `web-clone-source/web-clone-context.md`: compact source package summary.
- `web-clone-source/reference.png`: visual truth anchor, referenced by path only.

The research agent should not receive raw `singlefile.html`, raw `capture.html`, full `extracted-page.json`, or full
fetched HTML in prompt context. Those files remain durable evidence but require targeted reads only when a compact source
artifact has a named gap.

## Research Prompt Behavior

When prepared webpage evidence exists:

- Read compact webpage evidence paths before calling `webfetch`.
- Do not call `webfetch` against the same URL just to obtain page layout, visual style, or visible content.
- Use `webfetch` only to confirm source metadata, canonical page title, or linked source pages when compact evidence names
  a missing fact.
- The submitted `document_outline` must be the downstream PRD module list, ordered by visible page flow and responsive
  importance.
- Each module must cite evidence ids that point to the prepared webpage evidence.
- The bundle `full_markdown` may contain detailed module notes, but the compact brief must remain readable.

## PRD Module Shape

For a dense market dashboard page, `document_outline` should include modules such as:

- Scope, source evidence, and target viewport matrix.
- Global header and account CTA.
- Breadcrumb and page hero.
- Sticky section navigation.
- Economic trends overview region.
- Inflation/world map chart card.
- GDP growth table/card.
- Small indicator chart cards.
- Country selector chip set.
- Ideas section with tabs and cards.
- Economic indicators heatmap.
- Main indicators chip catalog.
- Global industrial map.
- News section.
- Economic calendar carousel/card row.
- FAQ accordions.
- Footer and brand/social/link columns.
- Mobile responsive behavior.
- Visual style tokens and component rules.
- Data/content inventory for tables, cards, maps, charts, and repeated lists.
- Interaction states and unknowns.

This is not final PRD markdown. It is the research output's major-module surface so later agents can split work safely.

## Implementation Plan

1. Add a research-side webpage evidence preparation helper that reuses `ensureLiveWebpageEvidence`.
2. Call the helper from `ResearchAgent.run` only for PRD-like tasks with http(s) source URLs and a task id.
3. Render a compact prompt section listing artifact paths and bounded excerpts.
4. Update `research-core.txt` so prepared webpage evidence takes precedence over raw `webfetch` for visual webpage PRDs.
5. Add tests proving the prompt section tells research to use prepared evidence and document_outline as PRD modules.
6. Add tests proving the helper reuses the existing evidence pipeline and does not expose raw HTML as the primary prompt
   surface.

## Non-Goals

- Do not add Browser MCP tools to research.
- Do not make research a frontend-design agent.
- Do not generate the final PRD directly in research.
- Do not add host gates that block tool choice. The model is instructed with the correct evidence hierarchy; data
  integrity remains in schema and artifact existence checks.
- Do not modify generated PRD output by hand.
