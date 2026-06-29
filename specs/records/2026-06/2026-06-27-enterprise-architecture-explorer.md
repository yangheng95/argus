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

- `specs/current/architecture/README.md` and `specs/current/architecture/01-agents.md` through `16-unified-teardown.md`.
- `specs/records/2026-06/2026-06-25-visual-evidence-no-hard-gate-root-repair.md`.
- `specs/records/2026-06/2026-06-24-overlay-task-deep-link.md`.
- `specs/artifacts/tv2ainvest.md` for frontend visual evidence discipline and desktop-only parity constraints.
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

| Surface                                                                    | Action                                                                                                                                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/web/astro.config.mjs`                                            | Add the new Concepts sidebar page.                                                                                                                       |
| `packages/web/src/components/EnterpriseArchitectureExplorer.astro`         | Add the interactive explorer component.                                                                                                                  |
| `packages/web/src/pages/architecture-explorer.astro`                       | Add the English full-screen architecture workbench route.                                                                                                |
| `packages/web/src/pages/zh-cn/architecture-explorer.astro`                 | Add the Chinese full-screen architecture workbench route.                                                                                                |
| `packages/web/src/content/docs/concepts/enterprise-architecture.mdx`       | Add English docs page using the component.                                                                                                               |
| `packages/web/src/content/docs/zh-cn/concepts/enterprise-architecture.mdx` | Add Chinese docs page using the component.                                                                                                               |
| `packages/web/src/content/docs/concepts/architecture.mdx`                  | Correct adjacent stale durable-artifact wording and link the explorer.                                                                                   |
| `packages/web/src/content/docs/zh-cn/concepts/architecture.mdx`            | Correct adjacent stale durable-artifact wording and link the explorer.                                                                                   |
| `packages/web/src/content/docs/concepts/goal-run-task.mdx`                 | Correct Concepts data-model wording for current artifact-backed goal attempts and verification evidence.                                                 |
| `packages/web/src/content/docs/zh-cn/concepts/goal-run-task.mdx`           | Correct Chinese Concepts data-model wording for current artifact-backed goal attempts and verification evidence.                                         |
| `packages/web/src/content/docs/index.mdx`                                  | Correct stale durable-state wording and link the explorer.                                                                                               |
| `packages/web/src/content/docs/zh-cn/index.mdx`                            | Correct stale durable-state wording and link the explorer.                                                                                               |
| `packages/web/src/content/docs/reference/evaluator.mdx`                    | Rename the current reference surface to Integrity Review and remove current-runtime evaluation row wording.                                              |
| `packages/web/src/content/docs/zh-cn/reference/evaluator.mdx`              | Chinese Integrity Review reference with the same current completion contract.                                                                            |
| `packages/web/src/content/docs/concepts/agent-loop.mdx`                    | Update the reference link text away from evaluation wording.                                                                                             |
| `packages/web/src/content/docs/zh-cn/concepts/agent-loop.mdx`              | Chinese link text update.                                                                                                                                |
| `packages/web/src/content/docs/start/quickstart.mdx`                       | Update stale evaluator troubleshooting wording.                                                                                                          |
| `packages/web/src/content/docs/zh-cn/start/quickstart.mdx`                 | Chinese troubleshooting wording update.                                                                                                                  |
| `packages/web/src/content/docs/models.mdx`                                 | Update stale evaluator regression wording.                                                                                                               |
| `packages/web/src/content/docs/zh-cn/models.mdx`                           | Chinese model guidance wording update.                                                                                                                   |
| `packages/web/src/content/docs/custom-tools.mdx`                           | Update stale evaluator role wording while preserving hook names.                                                                                         |
| `packages/web/src/content/docs/zh-cn/custom-tools.mdx`                     | Chinese custom tool wording update.                                                                                                                      |
| `packages/opencorvus/src/engine/engine.sql.ts`                             | Add the current `agent_coordination_action` artifact kind to the source union and update the task kind comment to current explicit workflow terminology. |
| `packages/opencorvus/src/engine/model.ts`                                  | Comment-only update for the public task model kind description.                                                                                          |
| `packages/opencorvus/src/engine/persist.ts`                                | Comment-only update away from retired deliver-tool acceptance wording.                                                                                   |
| `packages/opencorvus/src/orchestrator/loop.ts`                             | Comment-only update for current lifecycle tool names.                                                                                                    |
| `packages/opencorvus/test/script/enterprise-architecture-explorer.test.ts` | Lock the repaired explorer against stale artifact counts, fake component evidence, no-op search, nested button regressions, and evaluator wording drift. |
| `packages/web/package.json`                                                | Reuse existing `check`, `build`, and `dev` scripts. No dependency changes planned.                                                                       |

No existing architecture page is removed in this task because it is a broader conceptual overview. Stale neighboring durable-state wording is updated so the new explorer does not coexist with contradictory current-architecture claims.

## Interactive design

- A workbench page with toolbar, search, view mode controls, architecture map, side inspector, and evidence drawer.
- View modes after repair: Runtime chain, Data spine, Agent ownership, Overlay projection, A2A coordination.
- Click a domain node to expand its child components.
- Click a component node to inspect responsibility, source paths, domain constraints, active-view related contracts, and current evidence.
- Search filters matching domains/components and indexes responsibilities, boundaries, artifact records, and source paths.
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

## Repair iteration after visual rejection

The first delivered explorer passed build and interaction checks, but the rendered page failed the actual product bar:

- The Starlight content column clipped the architecture map and made the workbench look like a cramped embedded widget instead of an enterprise architecture page.
- The node graph emphasized decorative connections over readable architecture contracts.
- The visible first screen did not communicate enough concrete current-runtime facts before interaction.
- The inspector/evidence model existed, but the presentation did not make source paths, durable records, and ownership boundaries immediately scannable.

The repair replaces the primary delivery surface with a full-screen architecture workbench route while keeping the same component as the single implementation source for both documentation entry points and the standalone page.

Additional acceptance for the repair:

- The primary screenshot must show the full architecture surface without being cut off by the docs sidebar.
- The first screen must communicate the current runtime chain, not just a title and generic cards.
- Every clickable domain or component must expose at least one exact source path and one concrete runtime/data responsibility.
- View modes must change the displayed architecture contracts, not merely highlight the same static map.
- The page must read as a professional architecture instrument: restrained density, stable columns, no decorative line clutter, no vague labels without evidence.

## Second repair iteration audit findings

The post-repair independent audits found additional blockers that must be fixed before delivery:

- Interaction drawing audit: domain cards cannot be nested `button` elements, flow connector lines must not imply cross-row sequence, and component selection needs component-scoped evidence.
- Concept audit: artifact statistics must not imply the highlighted 7 artifact streams are the full `EngineArtifactKind` surface; current workflow tools must include frontend research/design, intent analysis, workload analysis, build, visual QA, integrity, and fact check; board language must be board/progress projection rather than a durable board snapshot table.
- Adversarial audit: search must actually filter, not only dim non-matches; component inspector must expose responsibility/source/constraints/related contracts/evidence; nearby docs must not send readers back to current-runtime evaluator/evaluation-row narratives.

Repair decisions:

- Component objects carry `responsibility` as a required field; inspector/evidence drawer use that field directly.
- Search filters non-matching domains/components and indexes responsibilities, boundaries, records, and source paths.
- The artifact stat reports total current `EngineArtifactKind` entries and separately labels the 7 highlighted streams.
- The old `/reference/evaluator/` slug remains only as a URL-compatible Integrity Review page; page title/content and cross-link text use current integrity terminology.

Regression test added:

- `packages/opencorvus/test/script/enterprise-architecture-explorer.test.ts` compares the explorer artifact list with `EngineArtifactKind`, verifies the current workflow/tool vocabulary, asserts search filtering and preferred view selection, keeps component evidence source-scoped, prevents nested domain/component buttons, and ensures the evaluator URL content remains the current Integrity Review reference.
