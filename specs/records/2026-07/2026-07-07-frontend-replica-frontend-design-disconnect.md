# Frontend Replica Frontend Design Disconnect

## Recall

User request:

- `把frontend-desgin从前端复刻workflow里面拆除，因为我发现对效果没有影响。只是断接，不是删除`

Acceptance criteria:

- Disconnect `frontend_design` from the frontend replica workflow path.
- Do not delete the frontend-design agent, tools, prompts, source modules, or historical handoff readers.
- Ensure the built-in `pipeline` workflow no longer lists `frontend_design` as a stage, dependency, progress row, or normal `dispatch_agent` target.
- Ensure existing `frontend_design` artifacts can still be consumed if they already exist or if a custom workflow explicitly uses the stage.
- Add regression tests proving the disconnect and the non-deletion boundary.

Hard constraints:

- No fallback, compatibility alias, hidden gate, second active profile field, or parallel workflow engine.
- Keep workflow authority in `WorkflowRegistry`; expert squads can project capabilities and prompts but must not define their own workflow.
- Keep spec records under `specs/records/2026-07/` and update the monthly README.
- Do not touch unrelated dirty worktree changes. Current `git status --short --branch` shows many pre-existing modifications across expert-squad, benchmark, core, overlay, SDK, and spec files.
- Do not create a new git worktree or restart OpenCorvus / overlay.

Sources read:

- `AGENTS.md`
- `C:\Users\chuan\.codex\skills\opencorvus-expert-squad-creator\SKILL.md`
- `C:\Users\chuan\.codex\skills\opencorvus-expert-squad-creator\references\open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/18-webpage-replica-agent-workflow.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-05-frontend-replica-goal-bound-reference-crops.md`
- `specs/records/2026-07/2026-07-05-frontend-replica-worker-terminal-tool-projection.md`
- `specs/records/2026-07/2026-07-06-frontend-design-tool-surface-sync.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/expert-squad.jsonc`
- `.opencorvus/expert-squads/builtin/frontend-replica/README.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/selector.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/agents/architect/system.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/agents/build/system.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/agents/orchestrator/system.md`
- `packages/opencorvus/src/engine/workflow.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/test/engine/workflow-integrity-step.test.ts`
- `packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts`
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
- `packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts`

Whole-repository search evidence:

- `rg -n "frontend[-_ ]?desgin|frontend[-_ ]?design|frontend_design|frontend-replica|front.*replica|workflow" specs/current specs/records specs/artifacts packages/opencorvus/src packages/opencorvus/test -S` showed the repository uses the correctly spelled `frontend_design` / `frontend-design`; no distinct `frontend-desgin` implementation exists.
- `rg -l "frontend_design|frontend-design|Frontend Design" packages/opencorvus/src packages/opencorvus/test .opencorvus/expert-squads specs/current specs/records/2026-07 -g "!packages/opencorvus/src/expert-squad/payload.ts" -S` found broad historical and source-handoff usage. The relevant disconnect surfaces are `engine/workflow.ts`, `orchestrator/tools.ts`, `prompt-profile-resolver.ts`, frontend-replica package prompts, and focused tests.
- `rg -n "DispatchAgentInputSchema|SchedulerDispatchTargetInputSchemas|dispatch_agent target|ORCHESTRATOR_WORKFLOW_TOOL_NAMES|projectOrchestratorTools\(|activeProjectedSchedulerToolIDs|workflowToolRoleMap" packages/opencorvus/src packages/opencorvus/test -g "*.ts" -S` showed `dispatch_agent` currently uses global workflow tool names, so removing the pipeline step alone would still leave `frontend_design` selectable as a target.
- `rg -n "frontend_design|frontend-design|Frontend Design" packages/opencorvus/src/engine/workflow.ts packages/opencorvus/src/orchestrator/tools.ts packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts packages/opencorvus/test/engine/workflow-integrity-step.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts .opencorvus/expert-squads/builtin/frontend-replica -S` identified tests and prompts that still require `frontend_design` as a normal frontend-replica stage.
- `rg -n "reference_regions|reference_coverage|reference_region_key|source_reference_artifact" packages/opencorvus/src/architect packages/opencorvus/src/pipeline packages/opencorvus/test/architect -S` showed `reference_coverage.reference_regions` is optional and can remain as a consumer of existing region manifests without making Frontend Design a mandatory stage.

Independent agent feedback:

- None spawned. The available sub-agent tool explicitly says not to spawn agents unless the user asks for sub-agents or delegation; this focused disconnect is handled from local evidence.

## Current Diagnosis

`frontend_design` is connected in two places:

1. `packages/opencorvus/src/engine/workflow.ts` declares it as the first built-in `pipeline` step and as an advisory dependency of `analyze_intent` and `requirements`.
2. The in-progress unified scheduler change in `packages/opencorvus/src/orchestrator/tools.ts` exposes `dispatch_agent.target` from the global `ORCHESTRATOR_WORKFLOW_TOOL_NAMES` enum, so `frontend_design` remains callable even if a specific workflow no longer contains that step.

The frontend-design implementation itself has many downstream readers: Build, Architect, Visual QA, Integrity, and context-packet code read historical `frontend_design` decision-log entries and artifacts. Deleting those readers would violate the request. The correct change is to disconnect the normal workflow dispatch path while preserving artifact consumption.

## Plan

1. Remove the `frontend_design` step from the built-in `pipeline` workflow and update pipeline descriptions/dependencies so the normal replica path starts from host webpage evidence / `frontend_research` / external research as needed.
2. Keep `frontend_design` in `OrchestratorWorkflowToolName`, `ORCHESTRATOR_WORKFLOW_TOOL_NAMES`, `SchedulerDispatchTargetInputSchemas`, and the private orchestrator tool object so custom workflows or explicit legacy continuation paths are not deleted.
3. Make `dispatch_agent` build its target enum from the active workflow steps. With the built-in pipeline selected, `frontend_design` will not parse as a target; with a custom workflow that explicitly declares `frontend_design`, it can still be used.
4. Update frontend-replica selector and role overlays so they do not instruct Orchestrator / Architect / Build to require Frontend Design crop rows. They should consume task-scoped source evidence and any existing visual-region manifest when present.
5. Update tests:
   - workflow topology no longer contains `frontend_design`;
   - historical/custom `frontend_design` projection still works;
   - `dispatch_agent` rejects `frontend_design` under built-in pipeline but still keeps the private internal tool hidden;
   - frontend-replica runtime projection no longer expects `frontend_design` as a projected dispatch target;
   - frontend-replica prompts no longer require the disconnected stage.

## Validation Targets

- `bun test packages/opencorvus/test/engine/workflow-integrity-step.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 180000`
- `bun test packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`
- `git diff --check`
