# Frontend Tool Portability Boundary

Date: 2026-07-07
Status: Agent-reviewed implementation plan
Owner: Codex

## Glossary

- API: Application Programming Interface, the typed contract between modules.
- CLI: Command Line Interface, an executable command surface.
- MCP: Model Context Protocol, the protocol for external model tools.
- UI: User Interface.

## Recall

### User Request

The user asked whether the large projected tool pool is truly necessary, then clarified that the point of making tools CLI-like is to make expert squads portable. The latest requirement is stricter:

- Existing logic has already been heavily refactored.
- Analyze real tool necessity, especially the `webpage_*` tool family.
- Base agents may only hold generic tools.
- Produce an agent-reviewed plan, do not simply agree with the surface request.

### Acceptance Criteria

- The plan separates generic base-agent tools from expert-squad/domain tools.
- The plan classifies `webpage_*`, `web_clone_*`, frontend visual-region tools, and Browser Preview comparison tools by necessity and ownership.
- Portable expert-squad capabilities move through package-owned typed tools or CLI-backed package tools, not a global opaque `frontend_tool_cli`.
- `PromptProfileResolver` remains the only runtime projection surface.
- Overlay and Skill/MCP surfaces do not hide old tools with UI filters; old IDs disappear at the resolver/catalog/tool-pool source.
- No fallback, compatibility alias, inactive package scan, second active expert-squad source, or dual core/package implementation is introduced.
- The plan is reviewed by independent read-only agents and records their findings.

### Hard Constraints

- Preserve the dirty worktree and unrelated user changes.
- Do not create a new worktree.
- Do not restart, refresh, kill, or otherwise affect OpenCorvus / overlay runtime processes.
- Do not implement code changes before the plan is accepted.
- If implemented later, code changes require focused tests and payload regeneration where package sources change.
- `general` remains the only built-in runtime package; non-general expert squads remain project packages released under `.opencorvus/expert-squads/<namespace>/<id>/`.

### Sources Read

- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/08-agent-tool-adapter.md`
- `specs/current/architecture/01-agents.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-06-agent-base-runtime-contract-projection.md`
- `specs/records/2026-07/2026-07-06-self-contained-expert-squad-runtime.md`
- `specs/records/2026-07/2026-07-07-unified-scheduler-dispatch-tool.md`
- Current source files and tests listed in the repository search evidence below.

### Repository Search Evidence

- `rg -n "AgentToolPool|roleAssignments|GLOBAL_TOOL_IDS|privateRegistryToolLoaders|FRONTEND_DESIGN_STATIC_TOOL_IDS|VISUAL_QA_STATIC_TOOL_IDS|CODING_PRIVATE_TOOL_IDS|BUILD_PRIVATE_TOOL_IDS|webpage_|web_clone_|browser_preview_reference_regions|browser_preview_compare_scroll_slices|browser_preview_layout_geometry|create_visual_region|record_frontend_region|create_frontend_skeleton_project" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 .opencorvus -g "*.ts" -g "*.md" -g "*.txt" -g "*.jsonc"`
  - Finding: `web_clone_*` is in `CODING_PRIVATE_TOOL_IDS`; frontend-design static tools include `webpage_*`, visual-region, and process-trace tools; Visual QA static tools include Browser Preview reference/scroll/layout evidence tools; current tests lock several of these into base-role visibility.
- `rg -n "package_tool_refs|default_tool_refs|package_mcp|PromptProfileResolver|projectWorkerTools|projectOrchestratorTools|workerBuiltInToolIDsFromProjection|schedulerBuiltInToolIDsFromProjection|role_base|active_skill_projection|projected_tool_ids" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test .opencorvus specs/current specs/records/2026-07 -g "*.ts" -g "*.tsx" -g "*.md" -g "*.jsonc"`
  - Finding: `role_base` expands built-in tool IDs from `AgentToolPool`; package tools are already projected by manifest refs through `PromptProfileResolver`; Overlay displays projected IDs from backend catalog rather than filtering them.
- `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test | Sort-Object`
  - Finding: OpenTest already has package-local tools under `.opencorvus/expert-squads/wujiang/opentest/tools/`; frontend-replica and frontend-innovate currently have prompt overlays but no package-local tools.
- `rg -n "webpage_extract|webpage_compile|webpage_analyze|webpage_runtime_state|web_clone_prepare_context|web_clone_generate_source_project|browser_preview_reference_regions|browser_preview_compare_scroll_slices|browser_preview_layout_geometry|create_visual_region_coordinate_atlas|create_visual_region_binding_package" packages/opencorvus/test packages/overlay/test specs/current specs/records/2026-07 .opencorvus -g "*.ts" -g "*.tsx" -g "*.md" -g "*.txt" -g "*.jsonc"`
  - Finding: tests and docs currently assert several old role-base exposures; they must be rewritten to assert active package projection and old-ID non-regression.

### Independent Agent Feedback

Four read-only agents reviewed independent surfaces. None modified files, committed, ran tests, or delegated further.

- Base tool boundary review: confirmed a real boundary violation. `AgentToolPool.canonicalToolIDs()` currently includes role-specific private tools, and `role_base` expands those into expert-squad built-in tools. It recommended migrating `web_clone_*`, `webpage_*`, frontend visual-region tools, and Browser Preview comparison tools out of base pools and adding tests that package-only tools never appear in base/canonical tool IDs.
- Frontend/webpage review: confirmed `webpage_*` is necessary as capability but not as agent-facing tools, because `ensureLiveWebpageEvidence()` already runs extraction/compile/analyze/runtime-state before frontend-design sessions. It recommended keeping visual-region materializers agent-facing only for specialized frontend package contexts because bbox decisions require model image inspection.
- Expert-squad projection review: recommended the OpenTest pattern: package-owned `@opencorvus-ai/plugin` tools projected by `package_tool_refs`, explicit typed CLI execution when needed, `role_base` only for generic base tools, no ToolRegistry package scan, no built-in profile regression, and payload regeneration from source packages.
- UI/MCP/Skill review: confirmed Overlay projected tool pools are direct backend catalog output, so old IDs must be removed from resolver/catalog/tool-pool source rather than hidden in UI. It also found that `SkillMount.required_tools` currently checks `AgentToolPool.hasTool`, so package tool/provider migration must update skill requirements or mount semantics to avoid disabling package skills.

## Diagnosis

The current system conflates four different categories:

1. Generic base-agent tools, such as read/search/write/shell/patch/skill and generic `browser_preview`.
2. Host deterministic pipelines, such as live webpage evidence preparation.
3. Expert-squad domain tools, such as webpage clone source generation and visual-region binding.
4. Stage-owned output protocol tools, such as frontend-design update/submit tools.

The projected 51-tool pool is therefore not just a UI size issue. It exposes a deeper ownership problem: `role_base: true` imports complete role assignments from `AgentToolPool`, and those role assignments currently contain frontend replica and visual evidence specialist tools. That makes non-general expert squads less portable and makes base agents carry domain assumptions.

The correct repair is not one global `frontend_tool_cli`. That would hide schemas and recreate a broad opaque tool. The repair is to keep base roles generic, move domain capabilities into active expert-squad package tools or host pipelines, and keep projection single-sourced through `PromptProfileResolver`.

## Ownership Classification

| Tool family | Capability necessary | Agent-facing necessary | Correct owner |
| --- | --- | --- | --- |
| `webpage_extract`, `webpage_compile`, `webpage_analyze`, `webpage_runtime_state` | Yes | No, except test harnesses | Host pipeline `ensureLiveWebpageEvidence`; remove from frontend-design/base visible tools |
| `web_clone_prepare_context` | Yes | No | Host source-package materializer inside live webpage evidence pipeline |
| `web_clone_generate_source_project` | Conditional | Only when active frontend package explicitly needs it | Frontend expert-squad package tool, optionally CLI-backed |
| `create_visual_region_coordinate_atlas`, `create_visual_region_binding_package` | Yes | Yes, but only specialized frontend contexts | Frontend expert-squad package tool or frontend-design package-projected tool |
| `record_frontend_region_selection`, `record_frontend_replacement_result` | Yes for process trace | Yes, but only frontend-design package context | Package-owned process trace tools or generalized stage output protocol |
| `create_frontend_skeleton_project` | Yes for frontend-design handoff | Only specialized frontend contexts | Frontend expert-squad package tool |
| `browser_preview` | Yes | Yes | Generic host tool |
| `browser_preview_reference_regions`, `browser_preview_compare_scroll_slices` | Yes for replica/reference parity | Only specialized frontend/visual parity contexts | Frontend-replica / frontend-innovate package tools or package-projected Browser Preview wrappers |
| `browser_preview_layout_geometry` | Yes for UI diagnostics | Only if re-contracted as generic layout evidence | Until re-contracted, treat as package/specialist Visual QA tool |
| `update_frontend_*`, `submit_frontend_template` | Yes | Yes in stage runtime | Stage-owned output protocol; do not collapse into generic CLI in this phase |

## Design

### 1. Define Base Tool Purity

Base role assignments may contain only generic tools:

- Code and filesystem: `read`, `glob`, `search_code`, `list`, `edit`, `write`, `apply_patch`, `bash`, `lsp`.
- General research and memory where appropriate: `websearch`, `webfetch`, `external_code_search`, `memory`, todo/planner helpers.
- Coordination: `skill`, `request_orchestrator_decision`, `question`, `wait` where the role contract already allows them.
- Generic preview: `browser_preview`.

Base role assignments must not contain expert-squad domain tools, including `webpage_*`, `web_clone_*`, visual-region materializers, frontend process-trace tools, or Browser Preview reference-parity wrappers.

### 2. Retire Old Host Tool IDs From Base Projection

Introduce a single source for retired / package-only host IDs. The set should include at least:

```text
webpage_extract
webpage_compile
webpage_analyze
webpage_runtime_state
web_clone_prepare_context
web_clone_generate_source_project
create_frontend_skeleton_project
create_visual_region_coordinate_atlas
create_visual_region_binding_package
record_frontend_region_selection
record_frontend_replacement_result
browser_preview_reference_regions
browser_preview_compare_scroll_slices
browser_preview_layout_geometry
```

This set is not a runtime fallback gate. It is a data-integrity assertion and test source for preventing old host IDs from returning to base pools, MCP executor surfaces, SkillTool required-tool checks, and catalog projection.

### 3. Move Webpage Evidence To Host Pipeline

Keep `ensureLiveWebpageEvidence()` as the source for live URL evidence. It already:

- materializes task runtime paths;
- runs extract, compile, analyze, and runtime-state capture;
- prepares source package artifacts;
- fails before frontend-design session creation when evidence cannot be produced.

The agent should consume durable evidence artifacts and source packages, not call `webpage_*` directly.

### 4. Move Frontend Domain Tools Into Expert-Squad Packages

For frontend-replica and frontend-innovate:

- Add package-local tools under `.opencorvus/expert-squads/builtin/<id>/tools/` or role-owned `agents/<role>/tools/`.
- Use `@opencorvus-ai/plugin` typed tool definitions, following the OpenTest runner pattern.
- If a tool shells out to CLI, require explicit typed parameters and `shell:false`; no command inference and no package-script fallback.
- Project tools through `package_tool_refs` in `expert-squad.jsonc`.
- Avoid reusing old host IDs as provider names. Use package names such as `frontend-replica/shared/webpage-evidence`, `frontend-replica/frontend-design/visual-region-binding`, or `frontend-innovate/frontend-design/html-ground-truth`.

The model-visible surface should be typed action tools, for example:

```text
frontend_webpage_evidence({ action: "inspect_status" | "materialize_source_package", ... })
frontend_clone_source({ action: "generate_source_project", ... })
frontend_visual_region_binding({ action: "coordinate_atlas" | "binding_package", ... })
frontend_region_iteration({ action: "select" | "record_result", ... })
```

This is intentionally not a free-form `frontend_tool_cli`.

### 5. Keep Stage Output Protocol Separate

Do not collapse `update_frontend_*` and `submit_frontend_template` into the first CLI migration. Those tools are stage-owned output collection and terminal finalization contracts, injected through `runAgentSession` with `stageOwnedToolIDs`.

A later phase can create a generic package-owned stage output protocol only if it replaces these tools atomically and updates Orchestrator/Architect/Build consumers. Until then, they remain stage-owned runtime tools, not base tools and not CLI wrappers.

### 6. Update Skill Required-Tool Semantics

Package skills must not keep `required_tools: webpage_extract` or similar old IDs. Two accepted options:

- Use package tool refs in package skills and make SkillMount understand projected package providers.
- Or remove `required_tools` entries for package-local tools and rely on manifest projection plus package skill ownership tests.

Do not add aliases from old host tool IDs to package provider names.

### 7. Update Overlay By Source Projection Only

Overlay should continue displaying backend projection, but the backend projection must change:

- `capability_projection.*.built_in_tool_ids` no longer contains package-only old IDs.
- `package_tool_refs` and package provider names represent portable tools.
- Projected Tool Pool count may shrink or shift from built-in IDs to package refs.

No UI-only filtering is allowed.

## Implementation Plan

1. Add the package-only / retired tool ID source and tests that fail if those IDs appear in base role assignments, canonical built-in IDs, ToolRegistry static pools, MCP executor tools, or active skill projection for `general`.
2. Remove `web_clone_*` from `CODING_PRIVATE_TOOL_IDS`; delete their private loader path unless still used exclusively by a package-tool wrapper through direct module import.
3. Remove `webpage_*` from `FRONTEND_DESIGN_STATIC_TOOL_IDS` and runtime frontend-design toolKit; keep the underlying pure functions available to `ensureLiveWebpageEvidence`.
4. Move or wrap `web_clone_generate_source_project`, visual-region binding, skeleton-project creation, and frontend region process-trace tools as package-local tools for frontend-replica / frontend-innovate.
5. Remove `browser_preview_reference_regions`, `browser_preview_compare_scroll_slices`, and `browser_preview_layout_geometry` from generic base role pools. Reproject them only through frontend/visual specialist package refs, unless `layout_geometry` is separately re-contracted as a generic UI diagnostics host tool.
6. Update frontend-replica / frontend-innovate manifests to project package tools explicitly. Keep `role_base: true` only where the underlying role assignment is generic; otherwise use `role_base: false` plus explicit generic built-ins and package refs.
7. Regenerate `packages/opencorvus/src/expert-squad/payload.ts` from `.opencorvus/expert-squads/**` sources.
8. Update prompts, package README/selector files, and skills so they reference package tool refs or host-prepared evidence artifacts instead of old host tool IDs.
9. Update Overlay tests to prove the displayed Projected Tool Pool comes from backend projection and contains package refs/provider names, not old host IDs.
10. Run focused validation and then self-review the diff for old-ID leakage.

## Non-Goals

- Do not remove the live webpage evidence capability.
- Do not remove Browser Preview as a generic host preview launcher.
- Do not replace Orchestrator `dispatch_agent` / `manage_task`.
- Do not add a second workflow engine or package-owned dispatch mechanism.
- Do not introduce a catch-all shell-like CLI.
- Do not silently overwrite existing project expert-squad packages during payload release.

## Required Tests

- `packages/opencorvus/test/agent/agent.test.ts`
  - Base roles do not expose package-only tool IDs.
  - `frontend-design` no longer exposes `webpage_*` as base tools.
  - `coding`, `coding-assistant`, and `general` no longer expose `web_clone_*`.
- `packages/opencorvus/test/tool/web-clone-prepare-context.test.ts`
  - Update visibility assertions away from coding private tools.
- `packages/opencorvus/test/tool/web-clone-generate-source-project.test.ts`
  - Update visibility assertions toward active package projection.
- `packages/opencorvus/test/orchestrator/webpage-evidence.test.ts`
  - Keep and extend host pipeline coverage for generated, reused, and failed evidence.
- `packages/opencorvus/test/orchestrator/tools.test.ts`
  - Live URL frontend-design dispatch prepares evidence before child session creation; failed evidence prevents child session creation.
- `packages/opencorvus/test/expert-squad/registry.test.ts`
  - Frontend package manifests validate `package_tool_refs`; old built-in IDs are rejected when declared as built-ins.
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
  - Active frontend package projects package tools; inactive/general does not; provider names do not collide with old IDs.
- `packages/opencorvus/test/server/expert-squad-routes.test.ts`
  - Catalog and active skill projection expose package refs/provider names and exclude old built-in IDs.
- `packages/opencorvus/test/mcp/serve.test.ts`
  - Executor MCP does not expose retired host IDs, and new package provider naming is not accidentally suffix-blocked.
- `packages/opencorvus/test/script/historical-docs-links.test.ts`
  - Required after this spec record addition.
- Overlay tests under `packages/overlay/test/**expert-squad**` and `packages/overlay/test/browser/skill-mount-matrix-browser.test.ts`
  - Projected Tool Pool and skill mount matrix render package refs/providers, not old hidden host IDs.
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

## Approval Result

The plan is agent-reviewed and accepted with one explicit caveat:

- Accepted: `webpage_*` and `web_clone_*` should not remain base or ordinary frontend-design visible tools.
- Accepted: frontend portability should use package-owned typed tools or CLI-backed package tools projected by `PromptProfileResolver`.
- Accepted: Overlay must not hide old tools; resolver/catalog/tool-pool must stop projecting them.
- Caveat: visual-region and Browser Preview comparison tools still have legitimate model-facing use in frontend replica workflows. They should not become host-only; they should become package-projected specialist tools. `browser_preview_layout_geometry` may be promoted back to generic base only after a separate contract strips replica-specific semantics and tests prove broad UI diagnostic ownership.

This plan is ready for implementation after user approval.

## Implementation Result

Status: Implemented and validated.

The implementation keeps one source of truth for the existing host implementations instead of copying them into package-local wrappers. Frontend-replica and frontend-innovate now declare specialist capabilities through package `default_tool_refs`; `PromptProfileResolver` maps those refs to package-scoped provider names and resolves execution back to the existing host tool implementation. This is intentionally not a global `frontend_tool_cli`, and it avoids a second implementation of webpage clone, visual-region, and Browser Preview comparison behavior.

Implemented changes:

- Removed `web_clone_*`, `webpage_*`, visual-region, frontend process-trace, and Browser Preview comparison tools from base/private role tool pools.
- Added `NON_BASE_FRONTEND_TOOL_IDS` and `EXECUTOR_MCP_DENIED_TOOL_IDS` as a single assertion source for package-only / non-base frontend tools.
- Kept `webpage_*` in the host-prepared `ensureLiveWebpageEvidence()` pipeline and out of ordinary frontend-design model-facing tools.
- Split frontend-design and Visual QA static/base tool IDs from specialist runtime/session IDs.
- Projected frontend-replica and frontend-innovate specialist capabilities through active package `default_tool_refs`.
- Changed catalog/resolver projection so package-declared default tools appear as scoped provider names rather than raw old host IDs.
- Kept Overlay displaying backend projection directly; tests assert package provider projection rather than UI-side hiding.
- Regenerated `packages/opencorvus/src/expert-squad/payload.ts`.

Validation completed:

- `bun test packages/opencorvus/test/agent/agent.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/visual-qa/agent.test.ts`
- `bun test packages/opencorvus/test/tool/browser-preview.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/tool/web-clone-prepare-context.test.ts packages/opencorvus/test/tool/web-clone-generate-source-project.test.ts --timeout 15000`
- `bun test packages/opencorvus/test/orchestrator/webpage-evidence.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "frontend_design no longer materializes live URLs through one-shot URL screenshots" --timeout 30000`
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/expert-squad/registry.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/mcp/serve.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/server/expert-squad-routes.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/agent/prompt-profile.test.ts packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts packages/opencorvus/test/build-agent/external-system.test.ts packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts --timeout 30000`
- `bun test packages/overlay/test/expert-squad-scope.test.ts`
- `cd packages/overlay; node test/browser-runner.mjs test/browser/expert-squad-panel.test.ts test/browser/skill-mount-matrix-browser.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

Residual boundary:

- The current implementation is package-scoped host capability projection, not a fully self-contained package-local CLI wrapper for each frontend specialist tool. Promoting these to true package-local CLI-backed tools remains a separate atomic migration because doing it now by copying host logic would create a dual implementation.
