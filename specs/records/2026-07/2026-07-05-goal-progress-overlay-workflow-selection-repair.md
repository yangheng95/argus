# 2026-07-05 Goal Progress Overlay Workflow Selection Repair

## Recall

User request: `goal无法解析并在overlay显示进度状态了`

Current objective:

- Restore task goal progress parsing/rendering in the overlay.
- Keep `workflow.selected` as the single workflow-selection authority.
- Fix the real upstream regression instead of reintroducing a board-side default fallback.

Acceptance criteria:

- Direct-start workflow tasks emit durable `workflow.selected` evidence on their first Orchestrator wake even when `engine_task.time_started` was already stamped before the wake.
- `compileBoard()` restores `workflow` plus `goalWorkflows` for workflow tasks with goals after that first wake, so the overlay progress surface has data again.
- No board-side compatibility default or dual-source workflow authority is added back.
- Focused regression tests cover the direct-start wake path and verify the board projection recovers.

Hard constraints:

- No fallback or compatibility logic.
- No git reset/revert/worktree creation.
- Do not interfere with running OpenCorvus / overlay processes.
- Keep requirements, acceptance criteria, and root-cause evidence in this record so context compaction does not shrink scope.

Sources read before implementation:

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/07-panel.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-04-architecture-issue-subagent-investigation.md`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/engine/pipeline.ts`
- `packages/opencorvus/src/engine/workflow.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/workbench/board.ts`
- `packages/opencorvus/test/workbench/board.test.ts`
- `packages/opencorvus/test/orchestrator/session-reuse.test.ts`
- `packages/overlay/src/components/TaskProgressBar.tsx`
- `packages/overlay/src/utils/goal-state.ts`

Whole-repository search evidence:

- `rg -n "workflowForBoardTask|buildWorkflowFields|goalWorkflows|workflow\\.selected|TaskProgressBar|goalState\\(|taskRuntimeActivityKey|selectedTaskRuntimeKey" packages/opencorvus packages/overlay`
- `rg -n "workflow\\.selected|emit\\(.*workflow\\.selected|type: \"workflow\\.selected\"|workflowID" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
- `rg -n "defaultIDForTaskKind|builtInDefaultIDForTaskKind|default_workflow|workflow_state" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
- `rg -n "insert\\(EngineTaskTable\\)|createTask\\(|dispatchTaskLoop\\(|persistQueuedTask\\(" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`

Independent agent feedback:

- Read-only explorer `Poincare` independently confirmed the same causal chain:
  - `TaskProgressBar` is only a consumer of `board.goalWorkflows`.
  - `buildWorkflowFields()` returns empty `goalWorkflows` when `workflow.selected` is absent.
  - `WorkflowRegistry.builtInDefaultIDForTaskKind("workflow")` returns `undefined`, so workflow tasks depend on `workflow.selected`.
  - The only runtime emitter was gated by `!task.time_started`, while direct-start and claimed queued tasks already stamp `time_started` before the Orchestrator wake.
  - Adjacent blast radius includes the goals panel empty state and tree-writer goal-card GC, not just the top progress strip.

## Diagnosis

Confirmed root cause:

1. `persistQueuedTask()` stamps `engine_task.time_started` immediately for non-queued direct-start tasks in `packages/opencorvus/src/engine/pipeline.ts`.
2. `Orchestrator.processTask()` currently uses `!task.time_started` as the "first wake" signal in `packages/opencorvus/src/orchestrator/agent.ts`.
3. Because direct-start tasks already have `time_started`, the common direct-start workflow path never emits `workflow.selected`.
4. `compileBoard()` in `packages/opencorvus/src/workbench/board.ts` now treats `workflow.selected` as the workflow-selection authority for workflow tasks; without that event it returns no workflow template and an empty `goalWorkflows` array.
5. The overlay progress surfaces (`TaskProgressBar`, goals panel, debug-info) read `board.goalWorkflows`, so progress disappears even though goals still exist.

Why this is the real fix path:

- Reintroducing a board default would recreate the old hidden second authority.
- The missing evidence is caused by the Orchestrator's wrong wake predicate, not by overlay parsing.
- Fixing the upstream emission restores the single-source contract already documented in the current board architecture.

## Implementation Plan

1. Move latest `workflow.selected` lookup into shared workflow helpers so board and Orchestrator read the same parser.
2. Change Orchestrator first-selection logic from `!task.time_started` to "no prior `workflow.selected` for this task".
3. Add a regression test for a direct-start task with pre-stamped `time_started`, assert the first wake emits `workflow.selected`, and assert `compileBoard()` repopulates `goalWorkflows`.

## Validation

- `bun test packages/opencorvus/test/orchestrator/workflow-selection.test.ts packages/opencorvus/test/workbench/board.test.ts`
- `bun test packages/overlay/test/goal-state.test.ts packages/overlay/test/task-progress-collapse.test.ts packages/overlay/test/board-projection-sync.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`
