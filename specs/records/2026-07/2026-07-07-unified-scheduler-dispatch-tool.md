# Unified Scheduler Agent And Task Tools

Date: 2026-07-07
Status: Implementation plan
Owner: Codex

## Glossary

- A2A: Agent-to-Agent, the durable worker-to-orchestrator coordination path.
- API: Application Programming Interface, the TypeScript or route contract between modules.
- MCP: Model Context Protocol, the protocol for projected external or package-local tools.
- UI: User Interface.

## Recall

### User Request

The user first requested: "把调度器所有task的不同工具收束到一个工具，不同参数".

Follow-up correction on 2026-07-07: "语义不对，应该是改成dispatch_agent。而且opencorvus的task的创建，成功和失败，例如create task, fail task等等也要收束".

Interpretation for this codebase:

- The Orchestrator scheduler must stop exposing one visible tool per worker agent stage, such as `requirements`, `architect`, `frontend_design`, `build`, `visual_qa`, `integrity`, `fact_check`, and similar workflow tools. The agent-dispatch surface must be `dispatch_agent`, with the worker target selected by a structured parameter.
- Task and goal lifecycle tools such as `propose_task`, `complete_task`, `fail_task`, `cancel_task`, `retry_task`, `add_goal`, `modify_goal`, `complete_goal`, and `delete_goal` must also stop being many visible tools. They should be represented by one task-management tool with a structured action parameter.

### Acceptance Criteria

- The Orchestrator visible scheduler agent-dispatch surface has one built-in tool named `dispatch_agent`.
- The Orchestrator visible task/goal lifecycle surface has one built-in tool named `manage_task`.
- Former stage tool names remain only as internal workflow target IDs / persisted stage binding facts where needed for status projection and A2A recovery; they are not visible callable tools.
- Former task/goal lifecycle tool names remain only as internal action IDs / persisted audit facts where needed for existing decision-log and task-state semantics; they are not visible callable tools.
- Active expert-squad scheduler projection exposes `dispatch_agent` and `manage_task`, not many stage-specific workflow or lifecycle tools.
- Workflow declarations still own stage order, labels, scope, and role bindings through `WorkflowRegistry`.
- A2A redispatch continues to persist a concrete workflow binding so recovery remains exact and visible.
- No fallback, compatibility alias, hidden router, text keyword parser, broad catch-all task manipulation tool, second active expert-squad state, or second workflow engine is added.
- Focused tests prove old stage-specific and lifecycle-specific Orchestrator tools are absent, `dispatch_agent` reaches representative worker stages, and `manage_task` reaches representative lifecycle actions.

### Hard Constraints

- Preserve existing dirty worktree changes; do not git reset or revert unrelated files.
- Do not create a new worktree.
- Do not restart, close, refresh, or kill OpenCorvus / overlay processes.
- `PromptProfileResolver` remains the only expert-squad runtime projection surface.
- Manifest `id` remains the only expert-squad identity; namespace remains a source/install partition.
- The model chooses the dispatch target through typed parameters. Host code must not add gates that teach route order.
- Context handoff remains `AgentContextPacket` and existing stage-specific evidence writers, not a new context protocol.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/08-agent-tool-adapter.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `specs/current/architecture/15-agent-context-packet.md`
- `specs/records/2026-06/2026-06-29-subagent-infrastructure-homogeneity.md`
- `specs/records/2026-07/2026-07-03-expert-squad-capability-profile.md`
- `specs/records/2026-07/2026-07-04-direct-build-outcome-and-visual-qa-contract.md`
- `specs/records/2026-07/2026-07-06-agent-base-runtime-contract-projection.md`
- `specs/records/2026-07/2026-07-06-expert-squad-namespaced-source-layout.md`
- `specs/records/2026-07/2026-07-06-self-contained-expert-squad-runtime.md`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/engine/workflow.ts`
- `packages/opencorvus/src/agent/tool-pool-contract.ts`
- `packages/opencorvus/src/expert-squad/registry.ts`
- `packages/opencorvus/src/expert-squad/catalog-profile.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `.opencorvus/expert-squads/**/expert-squad.jsonc`
- Relevant existing tests under `packages/opencorvus/test/{orchestrator,expert-squad,agent}`.

### Repository Search Evidence

- `rg -n "workflow_tool_name|schedulerWorkflowTools|OrchestratorWorkflowToolName|WorkflowRegistry|workflow tools|scheduler-projected workflow tools|build\\(\\{|visual_qa\\(|integrity\\(|requirements\\(|architect\\(|frontend_design\\(|frontend_research\\(" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 specs/records/2026-06 -g "*.ts" -g "*.md"`
  - Finding: workflow tool names are authored by `engine/workflow.ts`, filtered by `PromptProfileResolver.projectOrchestratorTools`, used in A2A redispatch recovery, tested in prompt/profile/runtime contract tests, and referenced in current docs/prompts.
- `rg -n "^\\s+(requirements|architect|frontend_design|frontend_research|deep_research|visual_qa|integrity|fact_check|workload_analysis|analyze_intent|explore|build): tool\\(" packages/opencorvus/src/orchestrator/tools.ts`
  - Finding: twelve separate scheduler stage tools are visible today.
- `rg -n "ORCHESTRATOR_PRIVATE_TOOL_IDS|createOrchestratorTools|projectOrchestratorTools|schedulerBuiltInToolIDsFromProjection|capability_projection.scheduler|built_in_tool_ids" packages/opencorvus/src packages/opencorvus/test .opencorvus/expert-squads -g "*.ts" -g "*.jsonc"`
  - Finding: Orchestrator private pool and expert-squad scheduler projection both list stage-specific tools, so both must change.
- `rg -n "tools\\.(requirements|architect|frontend_design|frontend_research|deep_research|visual_qa|integrity|fact_check|workload_analysis|analyze_intent|explore|build)\\.execute|execute.*StageRedispatch|schedulerRedispatchStrategies" packages/opencorvus/src/orchestrator/tools.ts packages/opencorvus/test -g "*.ts"`
  - Finding: A2A redispatch helpers currently invoke stage tools through the public tool map. They must call internal dispatch handlers instead of requiring old tools to remain visible.
- `rg -n "isWorkflowToolName|schedulerWorkflowToolForRole|schedulerAgentWorkflowBindingForRole|explicitSchedulerWorkflowTools|projectedWorkflowTools" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
  - Finding: workflow tool names also drive role binding diagnostics and manifest validation. These should be renamed or reinterpreted as scheduler stage targets where touched, not deleted without replacement.
- `rg -n "requirements|architect|frontend_design|frontend_research|deep_research|visual_qa|integrity|fact_check|workload_analysis|analyze_intent|explore|build" .opencorvus/expert-squads -g "expert-squad.jsonc" -g "*.md"`
  - Finding: repository packages project stage-specific scheduler tool IDs and package README/skill content teaches calling those old tools.
- `rg -n "complete_task|fail_task|cancel_task|retry_task|propose_task|add_goal|modify_goal|delete_goal|complete_goal|dispatch_task|dispatch_agent" specs/records/2026-07/2026-07-07-unified-scheduler-dispatch-tool.md packages/opencorvus/src packages/opencorvus/test .opencorvus -g "*.ts" -g "*.md" -g "*.jsonc"`
  - Finding: task lifecycle and goal graph operations are exposed as many separate scheduler tools today and are projected in `AgentToolPool`, expert-squad manifests, prompts, tests, and docs. They must be collapsed together with the worker-stage surface.

### Independent Agent Feedback

No sub-agent was used. Current multi-agent tool policy only permits spawning agents when the user explicitly asks for subagents, delegation, or parallel agent work. This plan therefore uses direct source review plus post-implementation self-review.

## Diagnosis

The current system conflates three concepts:

- stage identity: the durable workflow target such as `build` or `integrity`;
- task/goal lifecycle action identity: durable actions such as create follow-up task, complete task, fail task, cancel task, retry task, add goal, modify goal, complete goal, and delete goal;
- scheduler callable tool: the model-visible function name.

That conflation made every worker stage and every lifecycle action a separate Orchestrator tool. The result is a large scheduler surface and duplicated tool projection across `WorkflowRegistry`, `AgentToolPool`, expert-squad manifests, `PromptProfileResolver`, prompt text, and A2A redispatch helpers.

The root repair is to keep stage identity and lifecycle action identity as internal structured data while collapsing model-visible callables by semantic domain. Keeping old tools as aliases would violate the user's request and create dual source behavior.

## Design

Introduce two visible Orchestrator tools:

```text
dispatch_agent({ target, ...target-specific fields })
manage_task({ action, ...action-specific fields })
```

`dispatch_agent.target` is the internal worker stage target. The target enum is derived from the same workflow target set currently represented by `OrchestratorWorkflowToolName`.

`manage_task.action` is the internal task/goal lifecycle action target. The action enum covers:

- `propose_task`
- `complete_task`
- `fail_task`
- `cancel_task`
- `retry_task`
- `add_goal`
- `modify_goal`
- `complete_goal`
- `delete_goal`

Internal implementation may keep existing stage functions such as `dispatchRequirementsStage`, `dispatchArchitectStage`, and `runIntegrityReview`; these are implementation functions, not visible tools.

The `dispatch_agent` schema must include the union of currently required stage inputs:

- `target`: stage target such as `requirements`, `architect`, `build`, `visual_qa`, or `integrity`.
- common `reason`.
- build fields: `request`, `goalID`, `directBuildIntent`, `worktreeUsage`, `userConfirmedStaleIntegrityData`.
- frontend design fields: current `FrontendDesignInputSchema` fields.
- Visual QA, Integrity, Fact Check, research, workload, and explore fields currently accepted by their stage tools.
- continuation fields where the existing stage supports same-session continuation.

The `manage_task` schema must include the union of currently required lifecycle inputs:

- `action`: lifecycle action target.
- task terminal fields: `summary`, `error`, `reason`.
- task creation fields: `title`, `request`, `evidence_anchor`, `priority`, `queue`, `kind`.
- goal graph fields: `goal`, `goalID`, `updates`.

Validation must be exact. A target/action with missing required target-specific fields fails through schema/runtime execution, not through a hidden retry or fallback.

## Implementation Plan

1. Replace the in-progress `dispatch_task` draft with `dispatch_agent` in `orchestrator/tools.ts`.
2. Add `manage_task` for task/goal lifecycle actions in `orchestrator/tools.ts`.
3. Move each existing stage and lifecycle tool execute body behind internal target/action dispatchers. Remove the public old tool entries from the returned tool map.
4. Update A2A redispatch helper calls to invoke the internal target dispatcher instead of `tools.<stage>.execute`.
5. Update `AgentToolPool.ORCHESTRATOR_PRIVATE_TOOL_IDS` and `ORCHESTRATOR_SCHEDULER_ROLE_BASE_TOOL_IDS` so scheduler visibility is `dispatch_agent` and `manage_task` instead of stage/lifecycle-specific tools.
6. Update `WorkflowRegistry` terminology where necessary so workflow steps still carry target IDs while `renderWorkflowPrompt` instructs the model to call `dispatch_agent({ target: ... })`.
7. Update `PromptProfileResolver.projectOrchestratorTools` so active workflow stage projection authorizes `dispatch_agent` once when any projected stage target is active, and does not expose old stage tools.
8. Update expert-squad manifests under `.opencorvus/expert-squads/**/expert-squad.jsonc` so scheduler `built_in_tool_ids` names `dispatch_agent` and `manage_task` instead of stage/lifecycle-specific tools. Regenerate `packages/opencorvus/src/expert-squad/payload.ts`.
9. Update package README / skill prompt text that tells Orchestrator to call old stage/lifecycle tools.
10. Update focused tests:
   - `orchestrator/tools.test.ts`: old stage and lifecycle tools absent; `dispatch_agent` and `manage_task` can run representative targets/actions.
   - `prompt-profile-resolver.test.ts`: projection includes `dispatch_agent` and `manage_task`, and excludes old stage/lifecycle tools.
   - `registry.test.ts`: package scheduler projection validates `dispatch_agent` / `manage_task` plus agent capability projection.
   - `agent/base-runtime-contract.test.ts` and `subagent-infrastructure-homogeneity.test.ts`: stage binding remains derived from workflow, visible scheduler callable is unified.
11. Update docs/indexes and run focused validation.

## Non-Goals

- Do not remove workflow stage identities or workflow step cards.
- Do not change worker roles, terminal finalizer tools, package-local tools, MCP projection, or agent-owned output contracts.
- Do not fold operator question, wait, read-context, expert-squad selection, package skills, A2A response, bash, or browser-preview into the task lifecycle tool. They are not task/goal lifecycle actions.
- Do not migrate database rows.

## Validation Plan

- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --timeout 180000`
- `bun test packages/opencorvus/test/expert-squad/registry.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 180000`
- `bun test packages/opencorvus/test/agent/base-runtime-contract.test.ts packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

## Broad Compatibility Audit Recall

### User Request

Follow-up on 2026-07-07: "这个改动涉及面非常广，包括专家团全套兼容性，以及UI适配性，调度正确性等等，请你使用agent并行调查修复问题，直到不再有新的高置信度问题发现".

Interpretation:

- Reopen the completed unified `dispatch_agent` / `manage_task` implementation for a wider compatibility pass.
- Use independent parallel agents to audit expert-squad package compatibility, Overlay / UI / API adaptation, scheduler / A2A correctness, and prompt / docs / tests.
- Fix every high-confidence issue found by evidence-backed review and focused tests.
- Stop only after another review round yields no new high-confidence issue classes.

### Additional Acceptance Criteria

- Repository expert-squad packages, generated payloads, catalog / resolver / manager behavior, and active / inactive package isolation remain compatible with the unified visible scheduler tools.
- Overlay and API surfaces do not treat old stage or lifecycle tool names as visible scheduler tool calls; old names may remain as worker role, workflow target, message phase, task action enum, or persisted evidence identity where that is the actual data model.
- Orchestrator prompts and expert-squad README / selector content teach `dispatch_agent target=...` and `manage_task action=...` when referring to visible scheduler tool calls.
- A2A redispatch and recovery keep concrete target bindings without re-exposing old direct tools.
- Focused tests cover the repaired compatibility surfaces, not only prompt strings.

### Additional Hard Constraints

- Preserve the already-dirty worktree and existing staged files; do not commit unrelated changes.
- Do not create a worktree or restart / refresh OpenCorvus or overlay processes.
- Do not add fallback aliases, compatibility routes, hidden gates, string parsers, or a second projection source.
- Sub-agents are read-only audit agents in this pass and must not delegate further.

### Additional Sources Read

- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- This record's earlier Recall section.

### Additional Repository Search Evidence

- `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad\\.jsonc|prompt_profile\\.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records`
  - Finding: expert-squad compatibility touches resolver, registry, manager, catalog, config / server routes, Overlay expert-squad surfaces, and docs health checks.
- `rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\\(|loadPackage\\(|loadSourcePackage\\(|importDirectory\\(|importArchive\\(|exportArchive\\(|payload|seed|release" packages/opencorvus/src packages/opencorvus/test`
  - Finding: payload release and package manager tests are part of the proof surface; payload source freshness cannot be inferred from manifests alone.
- `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test | sort`
  - Finding: repository source packages include builtin namespace packages and `wujiang/opentest`; generated payload imports those source files by text imports.
- `rg -n "built_in_tool_ids|scheduler|dispatch_agent|manage_task|complete_task|fail_task|propose_task|add_goal|modify_goal|requirements|architect|build|visual_qa|integrity|frontend_design|frontend_research" .opencorvus/expert-squads -g "expert-squad.jsonc"`
  - Finding: package scheduler `built_in_tool_ids` currently name `dispatch_agent` and `manage_task`; stage names remain in agent / workflow projection identities.
- `rg -n "call (frontend_research|frontend_design|requirements|architect|visual_qa|integrity|analyze_intent|explore|workload_analysis|fact_check|build|complete_task|fail_task|cancel_task|retry_task|propose_task|add_goal|modify_goal|complete_goal|delete_goal)" packages/opencorvus/src .opencorvus/expert-squads -g "*.txt" -g "*.md" -g "*.ts" -g "*.jsonc"`
  - Finding: several Orchestrator-facing descriptions still use direct "call frontend_research" / "call requirements" wording that must be reviewed and repaired where it describes a visible scheduler action.

### Parallel Agent Feedback

Four read-only audit agents checked independent surfaces:

- Expert-squad / resolver audit: `dispatch_agent` was still missing from the general scheduler role base, the frontend-innovate selector still taught direct stage calls, and `PromptProfileResolver` still had an old workflow-tool projection path that could preserve the pre-unification mental model.
- Overlay / UI audit: tool summaries and trace labels did not expose the structured `target` / `action`, so users would see undifferentiated `dispatch_agent` / `manage_task` entries and old "visible redispatch action" wording remained guarded by tests.
- Scheduler / runtime audit: `dispatch_agent` target validation needed to be workflow-scoped, and both `dispatch_agent` and `manage_task` needed action/target-specific schemas instead of a broad shared object that allowed wrong-field calls.
- Prompt / docs / tests audit: architecture records, workflow prompt text, and focused tests still referenced direct visible scheduler calls such as `build({...})`, `fail_task`, or `modify_goal` in places that describe model-visible scheduler behavior.

### Broad Compatibility Fixes

- `ORCHESTRATOR_SCHEDULER_ROLE_BASE_TOOL_IDS` now includes both `dispatch_agent` and `manage_task`.
- `PromptProfileResolver` now projects workflow targets only through `dispatch_agent`; the old direct workflow-tool branch was removed instead of kept as a compatibility path.
- `dispatch_agent` now builds a discriminated `target` schema from the active workflow's steps. Targets outside the active workflow are rejected, while the internal target names remain durable workflow identities.
- `manage_task` now uses a discriminated `action` schema, so lifecycle actions keep exact action-specific validation under one visible scheduler tool.
- The Orchestrator tool map exposes only `dispatch_agent` and `manage_task` for worker dispatch and task/goal lifecycle operations; former stage/action tools remain internal implementation targets only.
- Overlay display helpers and trace-panel parsing now render `dispatch_agent(<target>)` and `manage_task(<action>)` from structured input.
- The frontend-innovate selector, current architecture docs, engine comments, and prompt-test expectations now describe visible scheduler calls as `dispatch_agent target=...` / `manage_task action=...`.
- Existing source-package manifests already used the unified visible tools; no generated payload rewrite was required for this pass.
- A document-health failure exposed a pre-existing untracked-record reference in `2026-07-06-gui-quality-bug-hunt-iteration.md`; the exact stale path was replaced with a neutral "untracked July planning draft" description so docs validation is not coupled to an untracked spec file.

### Verification

- Baseline expert-squad suite before this pass: `bun test packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/server/expert-squad-routes.test.ts --timeout 180000` passed with 171 pass / 4 skip.
- `bun test packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts --timeout 180000` passed with 11 pass.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 180000` passed with 76 pass / 4 skip.
- `bun test packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/engine/describe-bootstrap-active.test.ts packages/opencorvus/test/engine/workflow-integrity-step.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 180000` passed with 147 pass before the final docs wording fix.
- `bun test packages/overlay/test/tool-display.test.ts packages/overlay/test/primitives-panel-section.test.ts packages/overlay/test/i18n-discipline-round2.test.ts --timeout 180000` passed with 83 pass.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "config-reading orchestrator tools reject polluted task and agent session lineage before dispatch|propose_task rejects vague follow-up work without a concrete evidence anchor" --timeout 180000` passed with 2 pass.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts --timeout 180000` passed with 148 pass.
- `cd packages/overlay` then `node test/browser-runner.mjs test/browser/agent-reply-box-primitives.test.ts` passed with 1 browser test.
- `bun run typecheck` passed after re-running the transient generated overlay asset check.
- Static scan for old visible direct stage-call wording only returned false positives: locale discipline assertions and real `Bun.build` API calls.
- `git diff --check` passed with only CRLF normalization warnings for two already-edited test files.
- Final docs-focused rerun: `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/engine/workflow-integrity-step.test.ts packages/opencorvus/test/engine/describe-bootstrap-active.test.ts --timeout 180000` passed with 87 pass.

### Final Review Result

No new high-confidence issue class remained after the second implementation review, focused test reruns, static scan, typecheck, and diff whitespace check. Low-confidence residual risk is limited to broader repository dirty state outside this task; those files were not used as evidence of this change unless named above.
