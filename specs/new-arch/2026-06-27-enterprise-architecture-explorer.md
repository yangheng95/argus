# Enterprise architecture explorer plan

Date: 2026-06-27

## Task recall

User needs an enterprise-grade framework design diagram for the current OpenCorvus project. The deliverable must be a dynamic web page where readers can click through architecture layers and inspect framework/component concepts. The work must use a three-agent adversarial loop:

- Concept agent: read project facts and organize architecture concepts.
- Drawing agent: turn the concepts into an interactive information architecture.
- Review agent: reject stale, misleading, or unverifiable architecture claims.

This is a frontend/documentation deliverable, so it requires a real page, screenshot inspection, and iteration if the visual result is wrong.

## Current source recall

Current facts are taken from the checked-in repository, not from historical diagrams:

- `specs/new-arch/README.md` and `specs/new-arch/01-agents.md` through `16-unified-teardown.md`.
- `specs/new-arch/2026-06-25-visual-evidence-no-hard-gate-root-repair.md`.
- `specs/new-arch/2026-06-24-overlay-task-deep-link.md`.
- `specs/tv2ainvest.md` for frontend visual evidence discipline and desktop-only parity constraints.
- `packages/opencorvus/src/agent/agent.ts`.
- `packages/opencorvus/src/task-api/index.ts`.
- `packages/opencorvus/src/orchestrator/tools.ts`.
- `packages/opencorvus/src/engine/engine.sql.ts`.
- `packages/opencorvus/src/channel/ingress.ts`.
- `packages/opencorvus/src/control/message.ts`.
- `packages/opencorvus/src/server/routes/**`.
- `packages/overlay/src/services/task.ts`.
- `packages/overlay/src/store/card-tree.ts`.
- `packages/overlay/src/services/tree-writer.ts`.
- `packages/web/src/content/docs/concepts/architecture.mdx`.

## Architecture facts to represent

- Orchestrator is the task-level decision maker. It invokes explicit tools and worker sessions; it is not a fixed planner/deliver pipeline.
- The current workflow vocabulary is `frontend_research`, `frontend_design`, `requirements`, `architect`, `workload_analysis`, `build`, `visual_qa`, and `integrity`.
- `integrity` is the final acceptance surface. `visual_qa` is a post-build visual/product review surface, not final acceptance.
- `engine_artifact` is the durable process and evidence spine. The page must not describe retired `engine_evaluation`, retired acceptance-review tables, or old goal status tables as current runtime.
- A2A coordination is artifact-backed coordination (`agent_coordination_request`, `agent_coordination_response`, `agent_coordination_action`), not arbitrary peer chat.
- Browser Preview and visual evidence use task-scoped backend targets/evidence as the source.
- Overlay rendering flows from backend events to tree writer to `cardTreeStore` to Solid views.
- Web docs live in `packages/web/src/content/docs/**`; generated API reference is not manually edited.

## Callpoint and file inventory

| Surface | Action |
| --- | --- |
| `packages/web/astro.config.mjs` | Add the new Concepts sidebar page. |
| `packages/web/src/components/EnterpriseArchitectureExplorer.astro` | Add the interactive explorer component. |
| `packages/web/src/content/docs/concepts/enterprise-architecture.mdx` | Add English docs page using the component. |
| `packages/web/src/content/docs/zh-cn/concepts/enterprise-architecture.mdx` | Add Chinese docs page using the component. |
| `packages/web/src/content/docs/concepts/architecture.mdx` | Correct adjacent stale durable-artifact wording and link the explorer. |
| `packages/web/src/content/docs/zh-cn/concepts/architecture.mdx` | Correct adjacent stale durable-artifact wording and link the explorer. |
| `packages/web/src/content/docs/concepts/goal-run-task.mdx` | Correct Concepts data-model wording for current artifact-backed goal attempts and verification evidence. |
| `packages/web/src/content/docs/zh-cn/concepts/goal-run-task.mdx` | Correct Chinese Concepts data-model wording for current artifact-backed goal attempts and verification evidence. |
| `packages/web/src/content/docs/index.mdx` | Correct stale durable-state wording and link the explorer. |
| `packages/web/src/content/docs/zh-cn/index.mdx` | Correct stale durable-state wording and link the explorer. |
| `packages/web/package.json` | Reuse existing `check`, `build`, and `dev` scripts. No dependency changes planned. |

No existing architecture page is removed in this task because it is a broader conceptual overview. Stale neighboring durable-state wording is updated so the new explorer does not coexist with contradictory current-architecture claims.

## Interactive design

- A workbench page with toolbar, search, view mode controls, architecture map, side inspector, and evidence drawer.
- View modes: Overview, Runtime chain, Data lineage, Agent collaboration, Overlay.
- Click a domain node to expand its child components.
- Click a component node to inspect responsibility, source paths, constraints, related edges, and current evidence.
- Search filters and highlights matching domains, components, responsibilities, and source paths.
- The page must remain readable in the Starlight content column without nested cards or marketing hero treatment.

## Acceptance

- `bun run --cwd packages/web check` passes.
- `bun run --cwd packages/web build` passes.
- The docs page is opened through a real local dev server.
- A desktop screenshot is captured and inspected.
- If the screenshot shows unreadable text, broken layout, or non-working controls, fix and repeat.
- Stage only the files listed in this plan, commit without bypassing hooks, and push the current branch. If a hook or push fails due unrelated workspace state, record the exact blocker and do not hide it.

## Goal supervision contract

Active goal objective:

> Deliver a clickable, layer-expandable enterprise architecture web page for the current OpenCorvus architecture, supervised by three independent agent perspectives: concept organization, interaction drawing, and adversarial review. Acceptance requires disk-plan recall, source-traceable facts, real-page screenshot self-check, web check/build, scoped staging, commit, and push.

Iteration rules:

- Concept loop: every architecture claim must trace to `specs/new-arch/**` or current `packages/**` source.
- Drawing loop: every displayed layer must have a real click state, inspector state, or evidence drawer state.
- Review loop: remove or rewrite any claim that describes retired planner/deliver/evaluation/acceptance-review structures as current runtime.
- Visual loop: inspect the actual rendered page screenshot before finalizing.
- Git loop: stage only the files named in this plan; never stage unrelated dirty workspace files.
