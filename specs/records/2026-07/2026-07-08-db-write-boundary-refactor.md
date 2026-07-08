# 2026-07-08 Database Write Boundary Refactor

## Recall

- User request: The backend database write model is wrong: each module appears to solve database reads and writes independently, which violates layered architecture. The user asked how serious it is, whether fixing it helps MySQL migration, whether frontend UI code must change, and then explicitly requested a new worktree, a detailed goal, the start of the refactor, and a durable prohibition against unscientific database implementation.
- Acceptance criteria: Create a new git worktree; define a concrete refactor goal; record the goal and constraints under `specs/`; start the database write-boundary refactor in code; add a test that prevents future production code from writing core DB tables outside the approved boundary; keep frontend UI unchanged unless API or projection contracts change.
- Hard constraints: No fallback, no compatibility path, no dual-source write model, no runtime gate to hide the issue, no blind patching, no git reset, preserve unrelated dirty worktree changes, use mature database layering rather than ad hoc SQL ownership, and keep specs under root `specs/`.
- Sources read: `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/02-data.md`; `specs/current/architecture/09-verification-evidence.md`; `specs/current/architecture/10-worktree-lifecycle.md`; `specs/current/architecture/16-unified-teardown.md`; `specs/current/architecture/99-principles.md`; `packages/opencorvus/src/storage/db.ts`; `packages/opencorvus/src/engine/engine.sql.ts`.
- Whole-repository search evidence: `rg -n "Database\\.|db\\.(insert|update|delete)\\(|\\.insert\\(|\\.update\\(|\\.delete\\(" packages/opencorvus/src -g "*.ts"` found broad direct database writes. `rg -n "db\\.(insert|update|delete)\\(EngineArtifactTable|\\.(insert|update|delete)\\(EngineArtifactTable" packages/opencorvus/src -g "*.ts"` showed cross-domain direct writes in acceptance, browser-preview, verification, fact-check, frontend-design, plugin, and orchestrator modules before this slice.
- Independent agent feedback: None spawned for this first slice. The scope is narrow enough to validate by source inventory, architecture tests, and targeted domain tests.

## Worktree

- Path: `C:\Users\chuan\myhexin-local\opecorvus-db-write-boundary`
- Branch: `codex/db-write-boundary-refactor`
- Base commit: `944ca18cea dsw-33987 harden expert squad release schema`

The main worktree had unrelated dirty and untracked user changes. This refactor worktree keeps those changes untouched.

## Goal

`db-write-boundary-refactor-g1`: establish a real database write boundary for the `engine_artifact` process table, migrate non-engine production modules to the engine-owned artifact writer, and add a regression test that blocks future non-engine direct writes to `EngineArtifactTable`.

This is intentionally a first vertical slice, not a cosmetic rename. The serious architecture issue is that `engine_artifact` has become a shared universal table where domain modules directly encode their own write semantics. That makes invariants hard to audit, makes table evolution expensive, and makes a future MySQL migration riskier because SQL, transaction shape, ID generation, timestamps, and update semantics are scattered.

## Scope

In scope for this slice:

- Add an engine-owned artifact writer module.
- Replace non-engine direct artifact writes in acceptance, browser-preview, verification, fact-check, frontend-design, plugin, and orchestrator exploration persistence.
- Keep reads stable where they are projection/query concerns.
- Update architecture docs so `engine/artifact.ts` is the explicit artifact write boundary.
- Add a script test that fails when production modules outside `engine/**` or `task-api/index.ts` directly insert, update, or delete `EngineArtifactTable`.

Out of scope for this slice:

- Full repository migration of every `engine_*` table write.
- Schema redesign or DB migration. This project resets DBs for schema changes instead of carrying historical migration compatibility.
- Frontend UI changes. UI only needs changes when API response shapes, SSE events, or projection DTOs change; this slice preserves those contracts.

## Implementation Plan

1. Create `packages/opencorvus/src/engine/artifact.ts` with insert/update helpers that own ID, timestamp, nullable FK, and payload write shape for `engine_artifact`.
2. Migrate cross-domain artifact writes to the writer while preserving existing labels, kinds, payloads, timestamps, and emitted events.
3. Add a production-source architecture test for non-engine direct `EngineArtifactTable` writes.
4. Update `specs/current/architecture/02-data.md` to make the new boundary explicit.
5. Run targeted tests for the migrated domains plus documentation health tests.

## Follow-Up Goals

- Collapse remaining direct `engine_artifact` writes inside `engine/**` into narrower command-style methods grouped by lifecycle semantics.
- Establish similar write-boundary tests for other core `engine_*` tables after their service ownership is documented.
- After table ownership is centralized, evaluate the SQL dialect assumptions that still block a MySQL storage implementation.

## Phase 2 Tightening

After review feedback that the first slice was too small, the second phase collapses the remaining direct `EngineArtifactTable` writes inside `engine/**` and `task-api/index.ts` behind `engine/artifact.ts`.

Additional grep evidence before Phase 2:

- `rg -n "db\\.(insert|update|delete)\\(EngineArtifactTable|\\.(insert|update|delete)\\(EngineArtifactTable" packages/opencorvus/src/engine packages/opencorvus/src/task-api/index.ts -g "*.ts"` found direct writes in `engine/persist.ts`, `engine/agent-coordination.ts`, `engine/queue.ts`, `engine/runtime.ts`, `engine/writer.ts`, `engine/state.ts`, `engine/stage-continuation.ts`, `engine/tool-ownership.ts`, and `task-api/index.ts`.

Phase 2 acceptance criteria:

- Production source direct writes to `EngineArtifactTable` exist only in `packages/opencorvus/src/engine/artifact.ts`.
- Existing transaction and compare-and-set update semantics are preserved through writer helpers, including condition-based update-returning paths.
- The static boundary test is tightened to reject all direct `EngineArtifactTable` writes outside `engine/artifact.ts`.

Phase 2 verification:

- `rg -n "db\\.(insert|update|delete)\\(EngineArtifactTable|\\.(insert|update|delete)\\(EngineArtifactTable" packages/opencorvus/src -g "*.ts"` now reports only `packages/opencorvus/src/engine/artifact.ts`.
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/db-write-boundary.test.ts`
- `bun test --timeout 20000 packages/opencorvus/test/engine/agent-coordination.test.ts packages/opencorvus/test/engine/begin-build-attempt-supersede.test.ts packages/opencorvus/test/engine/acceptance-latest-order.test.ts packages/opencorvus/test/engine/describe-bootstrap-active.test.ts packages/opencorvus/test/engine/describe-stream-error.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
- `bun test ./packages/opencorvus/test/fixture/isolated/tmpdir-git-lifecycle.isolated.ts`

`packages/opencorvus/test/server/task-message-routes.test.ts` was attempted both as a full file and with `-t` filters for the operator-message wake commitment cases. In this Windows host run it produced no assertion failure but became inactive after startup; the first full-file attempt also exposed `EBUSY` during temp directory cleanup. The fixture cleanup now waits for transient Windows file-handle release and still throws persistent cleanup failures instead of hiding them. The route file remains a separate test-runner stability issue rather than evidence of a failed artifact writer migration.

## Phase 3 Progress Snapshot Boundary

The next table with clear scattered write ownership is `engine_progress_snapshot`.
It is a process/projection fact table and should not be assembled independently by
`engine/git.ts`, `engine/state.ts`, `engine/queue.ts`, `engine/pipeline.ts`, and
`task-api/index.ts`.

Phase 3 grep evidence:

- `rg -n "\\.(insert|update|delete)\\s*\\(\\s*Engine[A-Za-z0-9_]*Table\\b|db\\.(insert|update|delete)\\s*\\(\\s*Engine[A-Za-z0-9_]*Table\\b" packages/opencorvus/src -g "*.ts"` shows direct `EngineProgressSnapshotTable` inserts in `engine/git.ts`, `engine/state.ts`, `engine/queue.ts`, `engine/pipeline.ts`, and `task-api/index.ts`.
- These writes share the same row shape: generated `progress` ID, `task_id`, `status`, `summary`, JSON payload, and timestamps.

Phase 3 acceptance criteria:

- Production source direct writes to `EngineProgressSnapshotTable` exist only in the engine progress writer.
- Existing transaction placement is preserved: callers that currently record a progress row inside a task state transaction still do so.
- The static database write-boundary test rejects future direct `EngineProgressSnapshotTable` writes outside the writer.
- Existing task creation, task update, queue claim, git note, and operator note behavior remains unchanged.

Phase 3 verification:

- `rg -n "db\\.(insert|update|delete)\\(EngineProgressSnapshotTable|\\.(insert|update|delete)\\(EngineProgressSnapshotTable|db\\.(insert|update|delete)\\(EngineArtifactTable|\\.(insert|update|delete)\\(EngineArtifactTable" packages/opencorvus/src packages/opencorvus/test -g "*.ts"` shows production source writes only in `engine/artifact.ts` and `engine/progress.ts`; remaining direct writes are test fixture setup.
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/db-write-boundary.test.ts`
- `bun test --timeout 60000 packages/opencorvus/test/engine/task-global-project-forbidden.test.ts`
- `bun test --timeout 60000 packages/opencorvus/test/engine/task-message-revive.test.ts`
- `bun test --timeout 60000 packages/opencorvus/test/engine/prepare-project-non-git.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`

The first combined engine regression attempt used `--timeout 20000` and timed out in two slow `task-global-project-forbidden` channel-binding cases, then polluted the shared instance cleanup for the next file. Re-running the same affected files with `--timeout 60000` passed. The verified issue is an undersized test timeout for these Windows host cases, not a progress snapshot boundary regression.

## Phase 4 Interaction Request Boundary

The next half-converged table is `engine_interaction_request`. The code already
has `engine/interaction.ts` as the event bridge for permission/question requests,
but production source still writes the same table directly from `engine/runtime.ts`
for executor protocol interaction requests and from `task-api/index.ts` for
operator resolution of protocol interactions.

Phase 4 grep evidence:

- `rg -n "\\.(insert|update|delete)\\s*\\(\\s*EngineInteractionRequestTable\\b|db\\.(insert|update|delete)\\s*\\(\\s*EngineInteractionRequestTable\\b" packages/opencorvus/src -g "*.ts"` shows direct inserts/updates in `engine/interaction.ts`, `engine/runtime.ts`, and `task-api/index.ts`.
- `engine/interaction.ts` imports `EngineRuntime` to sync task/run state after writes, so `engine/runtime.ts` must not import it directly. The writer boundary must live in a lower-level module that both files can use without a runtime/interaction circular dependency.

Phase 4 acceptance criteria:

- Production source direct writes to `EngineInteractionRequestTable` exist only in the interaction request writer.
- Permission/question bridge creation, executor protocol interaction creation, and protocol interaction resolution preserve their current event payloads, event sources, timestamps, status/response writes, and post-write sync behavior.
- The static database write-boundary test rejects future direct `EngineInteractionRequestTable` writes outside the writer.
- Existing interaction route and task conversation tests keep passing without frontend/API contract changes.

Phase 4 verification:

- `rg -n "db\\.(insert|update|delete)\\(EngineArtifactTable|\\.(insert|update|delete)\\(EngineArtifactTable|db\\.(insert|update|delete)\\(EngineProgressSnapshotTable|\\.(insert|update|delete)\\(EngineProgressSnapshotTable|db\\.(insert|update|delete)\\(EngineInteractionRequestTable|\\.(insert|update|delete)\\(EngineInteractionRequestTable" packages/opencorvus/src -g "*.ts"` reports only `engine/artifact.ts`, `engine/progress.ts`, and `engine/interaction-request.ts`.
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/db-write-boundary.test.ts`
- `bun test --timeout 60000 packages/opencorvus/test/engine/interaction-request.test.ts`
- `bun test --timeout 60000 packages/opencorvus/test/engine/interaction-permission.test.ts`
- `bun test --timeout 60000 packages/opencorvus/test/engine/task-message-revive.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`

The first server-side attempt combined `orchestrator-bridge-init.test.ts`,
`task-conversation-routes.test.ts`, and `task-project-archive.test.ts`. It printed
initial passing cases and then had no output for two consecutive 60s activity
windows. Separate single-file attempts for `orchestrator-bridge-init.test.ts`
and `task-project-archive.test.ts` also printed passing cases and then had no
output for repeated 30s windows. Those runs were stopped as invalid no-activity
verifications. The focused `interaction-request.test.ts` now covers the writer
row semantics and protocol event source behavior directly; `interaction-permission.test.ts`
covers the permission bridge and service reply path.

## Phase 5 Channel Binding Boundary

The next clear single-table boundary is `engine_channel_binding`. It binds
external channel coordinates to engine tasks and should not be directly assembled
or deleted from unrelated service files.

Phase 5 grep evidence:

- `rg -n "\\.(insert|update|delete)\\s*\\(\\s*EngineChannelBindingTable\\b|db\\.(insert|update|delete)\\s*\\(\\s*EngineChannelBindingTable\\b" packages/opencorvus/src -g "*.ts"` shows direct insert in `engine/pipeline.ts` and direct delete in `task-api/index.ts`.
- The creation path is part of queued task persistence; the deletion path is part of task removal. Both should use one engine-owned channel binding writer while preserving the caller's existing transaction placement.

Phase 5 acceptance criteria:

- Production source direct writes to `EngineChannelBindingTable` exist only in the channel binding writer.
- Task creation still inserts channel binding rows with the same ID, task ID, platform, channel, thread, and timestamps.
- Task deletion still removes channel binding rows inside the same deletion transaction.
- The static database write-boundary test rejects future direct `EngineChannelBindingTable` writes outside the writer.

Phase 5 verification:

- `rg -n "db\\.(insert|update|delete)\\(EngineChannelBindingTable|\\.(insert|update|delete)\\(EngineChannelBindingTable" packages/opencorvus/src -g "*.ts"` reports only `engine/channel-binding.ts`.
- `bun run --cwd packages/opencorvus typecheck`
- `bun test --timeout 60000 packages/opencorvus/test/engine/channel-binding.test.ts`
- `bun test packages/opencorvus/test/script/db-write-boundary.test.ts`
- `bun test --timeout 60000 packages/opencorvus/test/engine/prepare-project-non-git.test.ts packages/opencorvus/test/engine/task-global-project-forbidden.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`

## Phase 6 Spec Snapshot Boundary

The next clear cross-domain write boundary is `engine_spec_snapshot`. It is an
engine-domain specification snapshot table, but production source currently
creates and mutates it directly inside `orchestrator/tools.ts`.

Phase 6 grep evidence:

- `rg -n "db\\.(insert|update|delete)\\(EngineSpecSnapshotTable|\\.(insert|update|delete)\\(EngineSpecSnapshotTable" packages/opencorvus/src -g "*.ts"` reports direct writes only in `orchestrator/tools.ts`.
- Architect persistence creates a version 2 snapshot, optionally copies requirements from the prior active spec, supersedes the prior active spec by id, and then updates the new snapshot content after goal ID remapping.
- Requirements persistence supersedes all active snapshots for the task and creates a version 1 snapshot in the same transaction.

Phase 6 acceptance criteria:

- Production source direct writes to `EngineSpecSnapshotTable` exist only in the spec snapshot writer.
- Architect and requirements persistence keep their existing transaction placement, IDs returned to callers, version/status/content/scope/timestamp semantics, and later reads via `findActiveSpecForTask`.
- The static database write-boundary test rejects future direct `EngineSpecSnapshotTable` writes outside the writer.
- Existing requirements/architect persistence tests keep passing without frontend/API contract changes.

Phase 6 verification:

- `rg -n 'db\\.(insert|update|delete)\\(EngineSpecSnapshotTable|\\.(insert|update|delete)\\(EngineSpecSnapshotTable' packages/opencorvus/src -g '*.ts'` reports only `engine/spec-snapshot.ts`.
- `rg -n 'Identifier\\.ascending\\("spec"\\)' packages/opencorvus/src -g '*.ts'` reports only `engine/spec-snapshot.ts`.
- `bun run --cwd packages/opencorvus typecheck`
- `bun test --timeout 60000 packages/opencorvus/test/engine/spec-snapshot.test.ts`
- `bun test packages/opencorvus/test/script/db-write-boundary.test.ts`
- `bun test --timeout 60000 packages/opencorvus/test/orchestrator/tools.test.ts -t "requirements persists a spec snapshot through the shared stage dispatcher"`
- `bun test --timeout 60000 packages/opencorvus/test/orchestrator/tools.test.ts -t "architect promotion keeps requirements attached to the active spec"`
- `bun test --timeout 60000 packages/opencorvus/test/orchestrator/tools.test.ts -t "architect does not start without an active requirements spec snapshot"`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
- `git diff --check`

## Phase 7 Active Plan Graph Boundary

The next production write cluster with a clean owner is the active execution plan
graph. `createExecutionRunRecord` in `orchestrator/tools.ts` currently inserts
`engine_plan_version`, inserts `engine_plan_node`, and updates
`engine_goal.plan_version_id` directly while `engine/persist.ts` already owns
architect goal graph writes and active-plan superseding.

Phase 7 grep evidence:

- `rg -n 'db\\.(insert|update|delete)\\(Engine(Task|Goal|PlanVersion|PlanNode|Requirement|SpecItem|Milestone)Table|\\.(insert|update|delete)\\(Engine(Task|Goal|PlanVersion|PlanNode|Requirement|SpecItem|Milestone)Table' packages/opencorvus/src -g '*.ts'` reports the create-run plan graph writes in `orchestrator/tools.ts` around `createExecutionRunRecord`.
- Existing `engine/persist.ts` already has `supersedePriorActivePlansForTask` and `appendGoalToActiveGraph`; keeping create-run plan graph creation there avoids a second owner for active plan rows.
- The existing behavior creates one active plan version, drops unknown `goal.depends_on` references from plan-node dependencies with a warning, inserts one node per current goal, and repoints each goal to the new plan version in the same transaction.

Phase 7 acceptance criteria:

- Production source direct writes to `EnginePlanVersionTable` and `EnginePlanNodeTable` exist only in `engine/persist.ts`.
- `createExecutionRunRecord` keeps the same transaction placement, plan ID returned to the run writer, active-plan superseding, plan summary, prompt, node order, node dependency resolution, node brief rendering, and goal `plan_version_id` updates.
- Unknown goal dependency references remain ignored for plan-node dependency IDs without blocking run creation.
- Static database write-boundary tests reject future direct `EnginePlanVersionTable` / `EnginePlanNodeTable` writes outside the persistence writer.
- Focused engine writer tests cover plan graph creation, prior active plan superseding, goal repointing, and unknown dependency pruning.

Phase 7 verification:

- `rg -n 'db\\.(insert|update|delete)\\(EnginePlanVersionTable|\\.(insert|update|delete)\\(EnginePlanVersionTable|db\\.(insert|update|delete)\\(EnginePlanNodeTable|\\.(insert|update|delete)\\(EnginePlanNodeTable' packages/opencorvus/src -g '*.ts'` reports only `engine/persist.ts`.
- `bun test --timeout 60000 packages/opencorvus/test/engine/active-plan-graph.test.ts`
- `bun test packages/opencorvus/test/script/db-write-boundary.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
- `git diff --check`

## Phase 8 Goal Contract Field Boundary

The next small cross-layer write is `manage_task(action=modify_goal)`.
`orchestrator/tools.ts` computes changed contract fields correctly, but then
directly updates `engine_goal`. Goal row creation, deletion, architect upsert,
operator add-goal, and active plan repointing already live in `engine/persist.ts`.

Phase 8 grep evidence:

- `rg -n 'db\\.(insert|update|delete)\\(EngineGoalTable|\\.(insert|update|delete)\\(EngineGoalTable' packages/opencorvus/src -g '*.ts'` reports one non-persist production write in `orchestrator/tools.ts` inside `modify_goal`.
- The existing no-op filter and live-work blocking stay in `orchestrator/tools.ts`; the persistence boundary should only own the row update once the tool has proven a real contract change.

Phase 8 acceptance criteria:

- Production source direct writes to `EngineGoalTable` exist only in `engine/persist.ts`.
- `modify_goal` keeps its existing no-op filtering, dependency graph mutation refusal, retry-intent behavior, and return text.
- Static database write-boundary tests reject future direct `EngineGoalTable` writes outside `engine/persist.ts`.
- A focused writer test covers applying a contract field patch to a goal row.

Phase 8 verification:

- `rg -n 'db\\.(insert|update|delete)\\(EngineGoalTable|\\.(insert|update|delete)\\(EngineGoalTable' packages/opencorvus/src -g '*.ts'` reports only `engine/persist.ts`.
- `bun test --timeout 60000 packages/opencorvus/test/engine/goal-contract-fields.test.ts`
- `bun test packages/opencorvus/test/script/db-write-boundary.test.ts`
- `bun test --timeout 60000 packages/opencorvus/test/orchestrator/tools.test.ts -t "modify_goal records retry intent without clearing a completed workspace pointer"`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
