# Frontend Design Host-Prepared Exploration Fix

Date: 2026-06-02

## Problem

Overlay benchmark evidence for the TradingView world economy clone showed the frontend-design child session was created with only `submit_frontend_template` exposed. The host had already materialized `web-clone-source/` and `frontend-design-skeleton/`, then a terminal-only host-prepared submit wrapper generated most of the public report mechanically.

That contradicts the frontend-design prompt: the prompt asks the agent to review evidence, inspect project structure, choose component reuse/library strategy, and supervise maintainable rawproject refactoring, but the runtime tool surface made those actions impossible.

## Evidence

Repository grep covered all call points before the change:

| Surface | Current behavior | Required change |
| --- | --- | --- |
| `packages/opencorvus/src/frontend-design/agent.ts` | `shouldScopeFrontendTemplateSubmitTool({ hostPrepared: true })` returns true and removes read/search tools. | Host-prepared webpage turns must keep read/search/list/memory tools, while still avoiding redundant acquisition tools. |
| `packages/opencorvus/src/frontend-design/host-prepared-source-project.ts` | Host-prepared submit schema is a lightweight wrapper that fills a prebuilt report. | Host-prepared turns should use the normal full `submit_frontend_template` schema so the agent owns the maintainable contract. |
| `packages/opencorvus/src/prompt/core/frontend-design-core.txt` | Mentions terminal-only host-prepared turns and unavailable discovery tools. | Prompt must align with runtime: host-prepared turns should read bounded evidence and target project files before finalizing. |
| `packages/opencorvus/test/frontend-design/prompt.test.ts` | Tests assert terminal-only host-prepared behavior. | Tests must assert host-prepared turns are not scoped to terminal-only and prompt no longer forbids discovery tools. |
| `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts` | Hygiene test pins terminal-only prompt text. | Update expectations to the new exploration contract. |

## Design

Host-prepared source materialization remains host-owned: the host prepares `web-clone-source/` and `frontend-design-skeleton/` once. frontend-design then receives:

- read/search/list/memory context tools for bounded inspection;
- no redundant mirror acquisition tools when host evidence already exists;
- the full terminal `submit_frontend_template` schema.

Text-only frontend-design turns still pin to direct terminal submission because there is no visual/material evidence to explore.

## Verification

Run targeted tests:

- `bun test packages/opencorvus/test/frontend-design/prompt.test.ts`
- `bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`

Then rerun the TradingView overlay benchmark with visual reference images and inspect frontend-design session tool exposure before judging the result.

## 2026-06-02 Follow-up: Generic Semantic Region Replacement

The next root cause is inside `web-clone/source-project-generator.ts`: specialized recognizers already replace news lists, tables, maps, FAQ, header/footer, and several TradingView card surfaces, but generic repeated heading + card/list regions still fall back to `src/components/source-dom/*Region.tsx`. That preserves the rawproject as visual baseline but leaves raw DOM/CSS in the generated source project.

Required algorithm change:

- keep rawproject as evidence and visual baseline;
- detect generic repeated card/list regions after specialized recognizers decline a region;
- extract heading, wrapper, item title/body/link, classes, style, source node id, and bounds into data;
- render a semantic component with data arrays and `.map()`;
- record source map evidence in the semantic replacement progress metadata;
- leave source-dom fallback only for regions that genuinely lack enough structure for a semantic replacement.
