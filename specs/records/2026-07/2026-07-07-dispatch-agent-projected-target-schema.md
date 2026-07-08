# Dispatch Agent Projected Target Schema

## Recall

### User Request

The user reported: `analyze_intent的schema有问题`.

Live task evidence supplied by the user:

- task id: `tsk_f3c9a5a3c001UUYlmD0yGuJc15`
- task title: OpenTest expert team should comprehensively test the cloned futures webpage, including functional, performance, and security tests, detailed cases, all components and interactions, and a test report.
- task directory and worktree: `C:\Users\chuan\myhexin-local\demos\economy\futures`
- server: `http://127.0.0.1:7878`
- runtime Database file: `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`
- root session: `ses_0c365a598ffeuk5GHjn5F7CHjD`

Read-only Database inspection showed the task selected active profile `opentest`, then a `dispatch_agent` call with `target: "analyze_intent"` failed with:

`Active expert squad "opentest" does not define capability_projection.agents.intent-analysis`.

The same live stream later retried `requirements` with `target_agent: "opentest-requirements-analyst"`, which strict schema correctly rejected. Virtual agent display identity is not a `dispatch_agent` input field.

### Acceptance Criteria

- Under active OpenTest, `dispatch_agent` schema must reject `target: "analyze_intent"` because the OpenTest package has no `capability_projection.agents.intent-analysis`.
- Under active OpenTest plus the `pipeline` workflow, `dispatch_agent` schema must accept only workflow targets that are also projected by `PromptProfileResolver`, including `requirements`, `architect`, `build`, `visual_qa`, and `integrity`.
- `target_agent` must remain rejected. OpenTest virtual agent ids stay package prompt/display metadata, not scheduler dispatch input.
- The existing workflow-only schema behavior must remain unchanged when no active capability projection is supplied, so generic tests and unprojected direct construction keep working.
- The fix must not add fallback, aliases, tolerated execution errors, hidden state, or an OpenTest `intent-analysis` role just to mask the schema mismatch.

### Hard Constraints

- No fallback or compatibility branch.
- No gate or state-machine workaround.
- `prompt_profile.active` and `PromptProfileResolver` remain the single runtime projection source.
- Do not restart, cancel, or delete the live OpenCorvus task or overlay process.
- Changes require focused tests.
- Specs stay under `specs/records/2026-07/` and this Recall must be reread before implementation.

### Sources Read

- `specs/artifacts/长程编排测试.md`
- `specs/records/2026-06/2026-06-23-intent-analysis-dynamic-followup.md`
- `specs/records/2026-07/2026-07-06-software-testing-expert-squad-integration.md`
- `specs/records/2026-07/2026-07-07-opentest-futures-e2e.md`
- `specs/records/2026-07/2026-07-07-opentest-lifecycle-virtual-agents.md`
- `specs/current/architecture/01-agents.md`
- `.opencorvus/expert-squads/wujiang/opentest/expert-squad.jsonc`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/intent-analysis/agent.ts`
- `packages/opencorvus/src/intent-analysis/output-tools.ts`
- `packages/opencorvus/src/engine/workflow.ts`
- `packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts`
- `packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts`
- `packages/opencorvus/test/orchestrator/analyze-intent-followup.test.ts`
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`

### Whole Repository Search Evidence

- `rg -n "analyze_intent|IntentAnalysisAgent|IntentAnalysisResult" packages/opencorvus/src packages/opencorvus/test -S`
- `rg -n "dispatchAgentInputSchemaForWorkflow|dispatchAgentTargetNamesForWorkflow|createOrchestratorTools|projectedWorkflowTools|resolveSchedulerCapability" packages/opencorvus/src packages/opencorvus/test -S`
- `rg -n "does not define capability_projection.agents" packages/opencorvus/src packages/opencorvus/test -S`
- `rg -n "opentest" packages/opencorvus/test/orchestrator packages/opencorvus/test/expert-squad .opencorvus/expert-squads/wujiang/opentest -S`
- `rg -n "default_workflow_id|pipeline|visual_qa|fact_check" packages/opencorvus/src/engine .opencorvus/expert-squads/wujiang/opentest -S`

### Independent Agent Feedback

No independent sub-agent was used for this focused schema repair. The directly inspected runtime evidence and existing projection tests are sufficient for a narrow implementation.

## Diagnosis

This is not an `IntentFinalSchema` or `AnalyzeIntentInputSchema` field-shape bug. `AnalyzeIntentInputSchema` is already strict and only permits optional `reason` plus `continuation_artifact_id`.

The failing schema surface is the unified scheduler dispatch tool. `createOrchestratorTools()` builds `dispatch_agent` variants from the selected `MiniWorkflow` steps only. The `pipeline` workflow contains `analyze_intent`, so the schema exposed it even after OpenTest became active.

However `PromptProfileResolver.resolveSchedulerCapability()` already computes `projectedWorkflowTools` from the active package's `capability_projection.agents`. OpenTest projects `requirements`, `architect`, `build`, `integrity`, and `visual_qa`; it does not project `intent-analysis`, `frontend-research`, `deep-research`, `goal-workload-analyst`, or `fact-check`. Execution therefore failed later when worker capability resolution enforced the active package projection.

The root mismatch is:

`dispatch_agent schema targets = workflow steps`

but runtime capability requires:

`dispatch_agent schema targets = workflow steps intersect active projected workflow tools`

## Implementation Plan

1. Add an optional `dispatchAgentTargets` input to `createOrchestratorTools`.
2. Pass `schedulerCapability.projectedWorkflowTools` from `Orchestrator.processTask` when constructing scheduler tools.
3. Make `dispatchAgentTargetNamesForWorkflow()` intersect workflow-declared targets with the supplied projected target set.
4. Keep default construction behavior unchanged when no projection is supplied.
5. Add a scheduler capability projection regression test for OpenTest:
   - `analyze_intent`, `frontend_research`, `deep_research`, `workload_analysis`, and `fact_check` are rejected.
   - `requirements`, `architect`, `build`, `visual_qa`, and `integrity` keep valid target-specific schemas.
   - `target_agent` is rejected.
6. Resolver validation surfaced a second projection-boundary failure: `PromptProfileResolver.catalog()` still parsed inactive package MCP JSONC through `ExpertSquadRegistry.loadCatalogPackage()`.
7. Repair the catalog/runtime boundary by keeping inactive catalog loading on package metadata, selector text, directory layout, skills, tools, and MCP server filenames only. Active package loading remains the only path that parses and validates MCP capabilities.
8. Run focused tests, docs link validation, typecheck, and diff checks.

## Validation Finding

`bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 30000` failed at:

`PromptProfileResolver > general catalog and selector projection do not parse inactive package MCP definitions`

The failing path was:

`PromptProfileResolver.catalog()` -> `projectCatalogPackages()` -> `ExpertSquadRegistry.loadCatalogPackage()` -> `collectPackageRefs()` -> `collectMcpRefs()` -> parse broken inactive package `mcp/broken.jsonc`.

That violates the same active projection boundary. Inactive catalog and selector projection may discover package metadata and selector skills, but must not parse inactive MCP capabilities. Active package selection still must fail on the same broken MCP definition.

## Validation Plan

- `bun test packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`
