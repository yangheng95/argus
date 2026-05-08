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
6. For any task with real visual/reference inputs (URL, Figma link, image/PDF visual attachment, or visual_reference artifact), `design_analysis` is a hard prerequisite before requirements, architect, build, integrity, delivery, or publish.

## Product Contract for Design Analysis

Design-analysis output must include two layers:

1. `task.design_specs`: compact, delivery-checkable visual rows with stable `vis-*` ids.
2. Decision-log PRD/SPEC entries:
   - `product_spec`: page purpose, inventory, visible text, assets, tables/charts, forms, menus, dialogs, empty/error/loading states, and acceptance criteria.
   - `frontend_spec`: desktop/mobile dimensions, hierarchy, spacing, typography, color tokens, component tree, routes, client state, asset usage, chart/table behavior, responsive rules, and interaction flows.
   - `backend_spec`: required API routes, request/response shapes, mock data, latency/error cases, persistence expectations. This must be inferred from observed UI behavior and page code artifacts, not invented.
   - `prd_iteration_notes`: at least two review passes proving inventory coverage and downstream implementability were checked and corrected before handoff.
   - `completeness_review`: final audit stating the PRD/SPEC is complete enough for downstream implementation and what remains unknown.
   - `evidence_source_manifest`: the source manifest for all downstream agents, including PRD/SPEC decision-log location, `task.design_specs`, live URLs, Figma URLs, local material paths, user attachments, design-analysis materialized images/files, and mirror artifact names that can be read.
   - `reference_artifacts`: mirror paths, source URL, viewport, capture status, confidence, and source file/image names referenced by the manifest.
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
4a. Require at least two PRD/SPEC review passes before StructuredOutput and persist `prd_iteration_notes` plus `completeness_review`.
4b. Persist `evidence_source_manifest` from the orchestrator, not the LLM alone, so downstream agents know the exact PRD/SPEC source plus readable files/images/artifacts.
5. Update `orchestrator/tools.ts` design_analysis descriptions and success result to reflect PRD/SPEC output, not only visual checklist counts.
6. Remove mirror prompt sections from requirements, architect, and integrity. They should read design-analysis summaries and visual specs only.
7. Replace build-stage mirror skills with design-analysis-stage spec skills or disable their build auto-detection. Build must not declare `webpage_*` / `figma_*` as required tools.
8. Remove mirror/MCP alias teaching from external build executor prompts. External executors should implement the SPEC and rely on delivery gates, not call OpenCorvus mirror tools.
9. Update tests:
   - design-analyst includes mirror ids;
   - build/general/explore/orchestrator/requirements/architect/integrity/prosecutor do not receive mirror ids from `ToolRegistry.tools()`;
   - build webpage URL skill no longer injects mirror required tools;
   - design-analysis final schema requires PRD/SPEC fields;
   - visual/reference tasks block downstream orchestrator tools until design-analysis handoff exists;
   - build prompts surface design-analysis PRD/SPEC source and `evidence_source_manifest`;
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

## Iteration 2026-05-09: Handoff Compaction and Permission Closure

Benchmark evidence from `amd-design-analysis-first-20260509-025933` proved that `design_analysis` now runs first and materializes the PRD/SPEC, but downstream build payloads still grew past 700K characters because the full design-analysis decision-log section was copied into later prompts.

The architectural correction is:

1. The materialized PRD/SPEC and source manifest files are the canonical downstream source:
   - `.opencorvus/design-analysis/prd-spec.md`
   - `.opencorvus/design-analysis/evidence-source-manifest.md`
2. Requirements, architect, build, and delivery receive a compact handoff reference with those paths, the `design_analysis` phase name, and bounded decision-log excerpts only. They must read the files when they need detail.
3. Non-design native agents receive explicit mirror permission denies after user permission config is merged. This aligns permission logs with the registry boundary and prevents custom config from reopening mirror access outside design-analysis.

## Iteration 2026-05-09: AMD Benchmark Delivery Tooling Findings

The `amd-design-analysis-handoff-20260509-033126` benchmark confirmed the new handoff shape but exposed two delivery-infrastructure defects unrelated to PRD generation:

1. Delivery `run_command` inherited `SHELL=powershell` on Windows even though `Shell.fromEnv` already marks PowerShell as unacceptable. This made delivery-agent probes misread `bun run build` output and PowerShell stderr wrapping as failures while the same project-gate command and manual command passed.
2. Managed frontend preview started Vite with its default `localhost` binding. On this Windows host that could resolve through `::1` and fail with `EACCES`, even though an IPv4 loopback preview is the contract delivery needs.
3. Goal worktree cleanup used only 5 filesystem remove retries while goal cleanup uses 50. The benchmark produced `EBUSY` cleanup failures on Windows after build/test/server processes released handles slowly.

The correction is to make shell selection enforce the existing no-PowerShell rule, start Vite previews with `--host 127.0.0.1`, and use the same 50-retry filesystem cleanup budget for worktree removal.
