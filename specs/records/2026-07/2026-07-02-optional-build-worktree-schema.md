# Optional Build Worktree Schema

Date: 2026-07-02
Status: Implemented

## Problem

The previous direct-build repair made task-level `directBuildIntent="modify_files"`
builds use the current project directory, but goal-scoped build dispatch still
forces a managed worktree. The user now wants every build dispatch that is
currently forced through a worktree to expose the worktree decision as optional
tool schema so the orchestrator model can choose the execution directory.

Two additional constraints make this more than a schema-only edit:

1. A goal build that chooses the current project directory must not persist that
   directory as a managed goal workspace, because completed goal cleanup deletes
   the latest completed `workspaceDir`.
2. A caller-owned current-project build still needs to commit and report
   normally. The BuildAgent result must surface the working directory and keep
   the reported commit reference instead of assuming all commit publication
   flows through `merge_back`.

## Recall

| Item | Details |
| --- | --- |
| User request | "把所有的现在强制worktree的agent改成可选的schema，让模型自己觉得是否使用workktree，然后确保即使不适用work tree也可以commit和report" |
| Acceptance criteria | The orchestrator `build` tool exposes an optional schema field that lets the model choose `managed_worktree` or `current_project`; goal-scoped builds can choose `current_project` without calling `Worktree.create`; task-level direct builds can still choose `managed_worktree` when the model wants isolation; current-project builds surface `worktreeDir`, preserve `commit_ref` in `report_build_result`, and do not expose/use `merge_back`; goal current-project builds do not persist the current project as a managed goal workspace and therefore do not trigger completed workspace cleanup against it. |
| Hard constraints | No fallback, no compatibility branch, no host-side route gate, no new git worktree for this repair, no broad git reset, preserve unrelated changes, code changes require tests, do not restart OpenCorvus / overlay, push to legacy remote after verification. |
| Sources read | `specs/records/2026-07/2026-07-02-direct-build-current-worktree.md`, `specs/current/architecture/01-agents.md`, `specs/current/architecture/04-extensions.md`, `packages/opencorvus/src/orchestrator/tools.ts`, `packages/opencorvus/src/build/agent.ts`, `packages/opencorvus/src/engine/writer.ts`, `packages/opencorvus/src/goal/runner.ts`, `packages/opencorvus/src/engine/store.ts`, `packages/opencorvus/src/engine/persist.ts`, `packages/opencorvus/src/prompt/core/build-core.txt`, `packages/opencorvus/test/orchestrator/tools.test.ts`, `packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts`, `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`. |
| Whole-repository grep | `rg -n "cleanupGoalWorkspaceForGoal|findGoalLatestWorkspace|beginBuildAttempt|finalizeBuildAttempt|workspaceDir|workspaceBranch|managedWorktree|Worktree\\.remove|removeWorktree|delete.*worktree" packages/opencorvus/src packages/opencorvus/test`; `rg -n "build-core|merge_back|worktree branch|Commit your work|report_build_result|commit_ref|managed_worktree|current_project|worktreeUsage|worktreeMode|useWorktree" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07`; `rg -n "goal-scoped managed|task-level direct|current project|managed worktree|BuildAgent.run|workDir|workspaceDir|cleanupGoalWorkspaceForGoal|merge_back" specs/current/architecture specs/records/2026-07 packages/opencorvus/test -g "*.md" -g "*.ts"`. |
| Independent agent feedback | Not obtained. The available multi-agent tool metadata forbids spawning sub-agents unless the user explicitly asks for sub-agents, delegation, or parallel agent work. |

## Current Call Graph

1. `orchestrator/tools.ts` owns the `build` tool schema and chooses between
   goal-scoped and task-level direct dispatch.
2. Goal-scoped dispatch currently creates or reuses a `managedWorktree` before
   calling `BuildAgent.run`.
3. Task-level direct dispatch currently passes `workDir=taskPrimaryProjectRoot`.
4. `BuildAgent.run` interprets:
   - `managedWorktree` as caller-provided managed state with `merge_back`.
   - missing `workDir` as build-managed worktree creation.
   - `workDir` as caller-owned current directory without `merge_back`.
5. `cleanupGoalWorkspaceForGoal` reads `findGoalLatestWorkspace(goalID)` and
   deletes the completed `workspaceDir`; therefore only true managed goal
   worktrees may be persisted in the goal workspace pointer.

## Repair Contract

1. Add an optional `worktreeUsage` schema field to `build` with exact values:
   `managed_worktree` and `current_project`.
2. Resolve the execution directory from the schema:
   - `managed_worktree`: create/reuse managed worktree and expose `merge_back`.
   - `current_project`: pass caller-owned current project `workDir` and do not
     expose `merge_back`.
3. Preserve existing defaults only as explicit schema-default semantics:
   goal-scoped omitted value means `managed_worktree`; task-level omitted value
   means `current_project`.
4. For goal-scoped `current_project`, keep the build session directory in the
   session/report facts but pass `workspaceDir=null`, `workspaceBranch=null`,
   and `workspaceBaseRef=null` into goal-run persistence.
5. Make `BuildAgent.RunOutput.worktreeDir` always report the directory used by
   the run, including caller-owned current-project runs.
6. Keep caller-owned `commit_ref` from `report_build_result` and use it as the
   goal contribution reference when there is no managed worktree contribution
   ref.
7. Update build prompt wording so agents commit in the session working
   directory and call `merge_back` only when the tool exists.

## Test Plan

- Orchestrator tool tests:
  - goal `worktreeUsage="current_project"` passes `workDir`, does not pass
    `managedWorktree`, does not call `Worktree.create`, and persists no managed
    goal workspace.
  - task-level direct `worktreeUsage="managed_worktree"` passes neither
    `workDir` nor `managedWorktree`, leaving `BuildAgent.run` to create a
    managed worktree.
  - existing omitted-field defaults remain covered by current goal/direct tests.
- BuildAgent runtime tests:
  - caller-owned `workDir` output includes `worktreeDir`.
  - caller-owned `report_build_result` preserves `commit_ref`.
- Prompt hygiene tests:
  - build-core no longer hard-codes "commit to the worktree branch" as the only
    commit path and still requires `merge_back` when available.

## Implemented Fix

1. `packages/opencorvus/src/orchestrator/tools.ts`
   - Added optional `worktreeUsage` to the `build` tool schema.
   - `managed_worktree` keeps the existing managed worktree create/reuse path.
   - `current_project` passes the active project directory as caller-owned
     `workDir`.
   - Goal current-project builds persist no managed `workspaceDir` /
     `workspaceBranch`, so completed goal cleanup has no current-project
     directory to reclaim.
   - Goal current-project finalization stores `report_build_result.commit_ref`
     as the contribution commit when no managed worktree contribution ref
     exists.
2. `packages/opencorvus/src/build/agent.ts`
   - `RunOutput.worktreeDir` now always reports the actual session working
     directory, including caller-owned `workDir`.
   - Caller-owned directories keep their reported `commit_ref` because they do
     not expose `merge_back`.
3. `packages/opencorvus/src/prompt/core/build-core.txt`
   - Build prompt now says to commit in the session working directory.
   - `merge_back` remains required only when the tool is available.
4. Tests and docs were updated for the new schema and no-worktree commit/report
   contract.

## Verification

Commands run:

```powershell
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "goal build can run in current project without persisting a managed workspace"
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "task-level direct build can explicitly request a managed worktree"
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "workflow task-level direct build receives active requirements and Visual QA feedback"
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "workflow task-level"
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "goal build retry reuses the prior build session by default"
bun test packages/opencorvus/test/orchestrator/build-goal-reference.test.ts
bun test packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts
bun test packages/opencorvus/test/build-agent/contract-error.test.ts
bun test packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts
bun test packages/opencorvus/test/build-dispatch-fidelity-order.test.ts
bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
bun run --cwd packages/opencorvus typecheck
```

Results:

- Goal current-project build: pass; no managed worktree is created or persisted,
  and the build-attempt outcome keeps the reported contribution commit.
- Task-level direct managed-worktree selection: pass; orchestrator passes
  neither `workDir` nor `managedWorktree`, leaving managed creation to
  `BuildAgent.run`.
- Existing direct current-project default and goal managed default/retry paths:
  pass.
- BuildAgent caller-owned output/report and managed commit-ref normalization:
  pass.
- Prompt hygiene, docs health, and package typecheck: pass.
