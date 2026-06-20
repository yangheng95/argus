# Frontend Research Context Digest

Date: 2026-06-21

## Acronyms

- API: Application Programming Interface, the typed interface or route contract consumed by agents.
- ID: Identifier, a stable task, artifact, evidence, or contract key.
- PRD: Product Requirements Document, a product-facing requirements artifact.
- QA: Quality Assurance, the review role that verifies product quality.

## Problem

`frontend_research` persists a task-scoped evidence bundle and a structured
brief. The persisted artifact is useful, but the downstream prompt renderer
currently emits a broad JSON block with many item categories. That block is
then injected into Requirements, Architect, and every Build goal context.

This is wasteful in Build:

- Build already receives Requirements, Architect contracts, `frontend_design`,
  and goal-local acceptance specs as the binding implementation contract.
- `frontend_research` is advisory coverage and investigation input, not a
  second implementation source of truth.
- Repeating the same broad webpage contract across multiple goal prompts
  spends tokens on surfaces the current goal may not own.

Visual QA already uses a compact pointer renderer, so the issue is not "all
agents receive raw research JSON." The issue is that Requirements/Architect/Build
share one broad renderer even though they need different detail levels.

## Decision

Split frontend research rendering by downstream role:

1. Requirements and Architect receive a compact `frontend_research_brief`
   digest containing:
   - summary;
   - evidence index without long excerpts;
   - requirement-forming problem statements, user needs, constraints, and open
     questions;
   - a webpage contract index with IDs, short labels, evidence IDs, and bundle
     paths for drilldown.
2. Build receives a smaller `frontend_research_build_pointers` digest containing:
   - source URL;
   - bundle paths;
   - coverage counts;
   - reference image evidence IDs;
   - blocking open questions;
   - a capped work-packet index for component/function/layout/data/fidelity
     coverage.
3. Visual QA keeps its existing pointer renderer.
4. The full research bundle remains persisted on disk and in the artifact
   payload. Downstream agents must drill down through bundle paths when they
   need details instead of receiving the full investigation payload by default.

## Non-Goals

- Do not delete `frontend_research` or its persisted bundle.
- Do not weaken `frontend_design` as the binding webpage implementation
  contract.
- Do not add keyword-matching fallback to guess which research items belong to
  a goal. The first change is role-scoped compaction; goal-scoped slicing needs
  explicit contract IDs or another reliable source if added later.
- Do not hide missing evidence. Missing bundle paths or stale briefs still mean
  no frontend research context is injected.

## Call Point Inventory

| Surface | Current behavior | Required change |
| --- | --- | --- |
| `packages/opencorvus/src/research/prompt-section.ts` | One frontend research renderer emits broad JSON. | Add role-specific compact renderers and keep evidence IDs plus bundle paths. |
| `packages/opencorvus/src/requirements/agent.ts` | Injects frontend research through the broad renderer. | Continue injecting frontend research, now as compact Requirements/Architect digest. |
| `packages/opencorvus/src/architect/agent.ts` | Injects frontend research through the broad renderer. | Continue injecting frontend research, now as compact Requirements/Architect digest. |
| `packages/opencorvus/src/orchestrator/tools.ts` | Build context uses the broad renderer for each goal/direct build. | Use the Build pointer renderer instead. |
| `packages/opencorvus/src/build/prompt-context.ts` | Wraps whatever frontendResearch string it receives. | Reword wrapper to treat the section as compact pointers, not an inlined work-packet body. |
| `packages/opencorvus/src/visual-qa/context.ts` | Already renders compact frontend research pointers. | Leave unchanged. |
| Tests | Cover persistence, build prompt overlay presence, and Visual QA compactness. | Assert compact digest omits long excerpts/full JSON categories, Build receives pointer digest, and Visual QA still omits full JSON. |

## Acceptance

- `renderFrontendResearchBriefPromptSection` no longer emits the old broad
  `webpage_contract` body or evidence excerpts.
- Build prompt context uses a dedicated compact Build pointer digest and does
  not include broad problem/user/constraint/fact sections from frontend research.
- Requirements and Architect still receive evidence IDs and bundle paths needed
  to cite or drill down into research evidence.
- Visual QA context remains compact and unchanged in behavior.
- Focused tests and typecheck pass.
