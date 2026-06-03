# Research / Frontend Design Boundary — 2026-06-03

## Trigger

The TradingView World Economy request asked to research a webpage and produce a PRD covering functionality and visuals. The orchestrator routed into `frontend_design`, because the current `frontend_design` tool description says to call it when "the request mentions a URL to replicate or analyze".

## Evidence Scan

Call points checked:

- `src/orchestrator/tools.ts`
  - `frontend_design` tool description currently treats any URL analysis as frontend design input.
  - `research` tool description owns external facts and PRD/SPEC source material.
- `src/prompt/core/orchestrator-core.txt`
  - Research Tool Discipline already says source webpages for PRD/SPEC material belong to `research`.
  - Workflow Choice says visual-reference UI replication must call `frontend_design` first.
  - Tool Selection says `frontend_design` is for visual reference implementation.
- `src/research/agent.ts`
  - `targetDeliverable === "prd"` plus HTTP source URLs prepares rendered webpage PRD evidence.
- `src/research/webpage-prd-evidence.ts`
  - The prepared PRD evidence already includes rendered layout/content/style/interactions and `reference.png` paths for PRD module extraction.
- `src/prompt/core/research-core.txt`
  - Research is already instructed to use prepared webpage PRD evidence for visual layout, visible content, responsive behavior, style tokens, components, tables, cards, charts, maps, navigation, and footer/header inventory.
- `src/agent/role-contract.ts`
  - `frontend-design` is the frontend template / webpage-replica agent.
  - `research` is the PRD/SPEC evidence gatherer.

## Boundary Decision

`frontend_design` owns visual reference implementation and webpage/app replication. It produces an implementation-facing frontend template, source handoff, and visual contracts for downstream Requirements/Architect/Build.

`research` owns PRD/SPEC/research evidence. For PRD/SPEC/report tasks where a webpage URL is source material, the orchestrator should call `research` with `target_deliverable=prd|spec|research_report` and `source_urls=[...]`. If the deliverable still needs a file, Build writes that artifact from the research brief and task context.

The same webpage URL can be visual evidence in both domains, but the user's deliverable intent decides the owner:

- "clone/build/implement/replicate this page/app/UI" -> `frontend_design` first.
- "research/analyze/investigate this page and form a PRD/SPEC/report" -> `research` first.

## Implementation Plan

1. Narrow `frontend_design` tool description from "URL to replicate or analyze" to "URL is a visual reference for implementation/replication".
2. Add explicit skip language: PRD/SPEC/research/report/source-analysis URLs route to `research`, not `frontend_design`, unless the user asks to implement/clone UI.
3. Strengthen `research` description so PRD/SPEC webpage visual/content analysis is clearly in scope and should pass source URLs.
4. Update orchestrator core prompt Workflow Choice and Tool Selection with the same boundary.
5. Add tests asserting the descriptions contain this boundary.
