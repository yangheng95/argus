# Design Analysis Mirror PRD/SPEC Plan

## Current Evidence

1. `packages/opencorvus/src/design-analyst/agent.ts` and `packages/opencorvus/src/prompt/core/design-analyst-core.txt` currently frame design-analysis as a visual checklist producer. The prompt explicitly says not to use `webpage_extract`.
2. `packages/opencorvus/src/skill/builtin/webpage-generate.md` and `image-generate.md` currently make build agents run mirror extraction, compile, analyze, render, evaluate, text diff, and vision judge.
3. `packages/opencorvus/src/agent/agent.ts` currently exposes mirror tools broadly through the registry unless individual agent tool lists filter them.
4. Delivery already has an independent visual hard gate in `packages/opencorvus/src/delivery/service.ts`, `packages/opencorvus/src/delivery/checks/visual.ts`, and `packages/opencorvus/src/delivery/visual-metric.ts`; it does not need build-stage mirror tools to reject visual failures.
5. Requirements / architect / integrity currently receive mirror pipeline prompt sections even though they do not own mirror extraction.

## Objective Conclusion

The user's complaint is directionally correct: the current split asks build to discover page facts and implement at the same time, so the system can produce a visually plausible but under-specified page. However, the literal version "remove every mirror tool from every non-design agent" conflicts with the current build-stage skills because those skills declare mirror tools as hard required tools. Therefore the change must be architectural, not only a tool-list patch.

The correct target is:

1. `design_analysis` owns reference acquisition and fact extraction:
   - URL: `webpage_extract` -> `webpage_compile` -> `webpage_analyze`.
   - Screenshot: `webpage_image_extract` -> `webpage_image_compile` -> `webpage_image_analyze`.
   - Figma: `figma_extract` -> `figma_compile` -> `figma_analyze`.
2. `design_analysis` does not implement the app. It produces a complete PRD/SPEC from mirror facts, visual evidence, and observed page behavior.
3. Requirements, architect, and build consume the PRD/SPEC and `task.design_specs`; they do not re-run mirror extraction or treat the URL/screenshot as vague inspiration.
4. Build implements from the SPEC using normal code tools. It should not depend on mirror tools being present.
5. Delivery remains the quality gate owner for startup/runtime/visual evidence. This preserves quality gates without giving build a second source of mirror truth.

## Product Contract for Design Analysis

Design-analysis output must include two layers:

1. `task.design_specs`: compact, delivery-checkable visual rows with stable `vis-*` ids.
2. Decision-log PRD/SPEC entries:
   - `reference_artifacts`: mirror paths, source URL, viewport, capture status, confidence.
   - `page_inventory`: sections, visible text, assets, tables/charts, forms, menus, dialogs, empty/error/loading states.
   - `layout_spec`: desktop/mobile dimensions, hierarchy, spacing, typography, color tokens, responsive rules.
   - `component_spec`: each component's visual role, states, data needs, interactions, and owning UI region.
   - `frontend_spec`: routes, client state, component tree, asset usage, chart/table behavior, interaction flows.
   - `backend_spec`: required API routes, request/response shapes, mock data, latency/error cases, persistence expectations. This must be inferred from observed UI behavior and page code artifacts, not invented.
   - `open_questions`: only truly unobservable facts; do not use this as a fallback for facts mirror already exposes.

## Non-Goals

1. Do not make design-analysis write application source files.
2. Do not make requirements or architect run mirror tools "just to be safe".
3. Do not keep the current build-stage webpage-generate mirror workflow as a parallel path. That would preserve the same double-source failure.
4. Do not remove delivery's visual hard gate. The benchmark acceptance still needs rendered browser evidence and comparison against references.

## Implementation Plan

1. Add a single mirror tool id source (`MIRROR_TOOL_IDS`) and enforce registry-level exposure: only `design-analyst` can receive mirror tools from `ToolRegistry.tools()`. This prevents custom agent config from accidentally reopening mirror access elsewhere.
2. Update `design-analyst` registry metadata so its include list contains all mirror tool ids plus read/context tools.
3. Rewrite `design-analyst-core.txt`:
   - remove the prohibition on `webpage_extract`;
   - require mirror-first extraction for URL, screenshot, and Figma references;
   - require serial artifact reads before spec writing;
   - require multi-pass PRD/SPEC synthesis from both pixels and extracted DOM/code facts;
   - require backend/API contract inference from observable behavior only.
4. Extend `DesignFinalSchema` with PRD/SPEC fields. Keep visual rows in `task.design_specs`, and persist longer PRD/SPEC text into decision log entries so downstream agents receive it through existing context plumbing.
5. Update `orchestrator/tools.ts` design_analysis descriptions and success result to reflect PRD/SPEC output, not only visual checklist counts.
6. Remove mirror prompt sections from requirements, architect, and integrity. They should read design-analysis summaries and visual specs only.
7. Replace build-stage mirror skills with design-analysis-stage spec skills or disable their build auto-detection. Build must not declare `webpage_*` / `figma_*` as required tools.
8. Remove mirror/MCP alias teaching from external build executor prompts. External executors should implement the SPEC and rely on delivery gates, not call OpenCorvus mirror tools.
9. Update tests:
   - design-analyst includes mirror ids;
   - build/general/explore/orchestrator/requirements/architect/integrity/prosecutor do not receive mirror ids from `ToolRegistry.tools()`;
   - build webpage URL skill no longer injects mirror required tools;
   - design-analysis final schema requires PRD/SPEC fields;
   - prompt hygiene confirms design-analysis is the only mirror owner.
10. Run targeted tests, then run the AMD benchmark. If the benchmark fails, debug the failure against completion quality, not against the old build-stage mirror workflow.

## Risk Assessment

1. Biggest risk: build loses its self-iteration loop (`webpage_render` + `webpage_vision_judge`) before delivery. This is acceptable only because delivery has host visual gates. If delivery gates are not strong enough for AMD, strengthen delivery, not build mirror access.
2. Backend SPEC inference can hallucinate if prompt wording is loose. The design-analysis prompt must force "observed / inferred / unknown" confidence labels and forbid ungrounded API claims.
3. Mirror extraction may write generated React scaffold today. If design-analysis runs `webpage_analyze`, those generated files may appear in the project before build. The plan must either keep generated scaffold under `mirror/` only or explicitly treat generated source as analysis artifact, not deliverable source.
4. Existing tests encode the old architecture. Updating tests is part of the change, not evidence that the new design is wrong.

## Verification

1. `bun test packages/opencorvus/test/agent/agent.test.ts packages/opencorvus/test/agent/runner-tool-scope.test.ts packages/opencorvus/test/engine/skill-inject.test.ts packages/opencorvus/test/mirror/webpage-generate.test.ts`
2. `bun run --cwd packages/opencorvus typecheck`
3. AMD page replica benchmark through `packages/opencorvus/script/benchmark/overlay-web-benchmark.ts` using `specs/amd-replica.txt`.
