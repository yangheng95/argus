# Scheduler Closure Repair Plan (2026-05-05)

## Problem Statement

Current task execution still relies on orchestrator judgment for two decisions that must be deterministic:

1. whether architect output has completed the full pre-build review loop
2. where the task must rewind after delivery exposes a structural integration failure

As a result, the system can:

- dispatch per-goal build before `integrity` has reviewed the active architect snapshot
- keep retrying local goal work after delivery has already proven the decomposition is wrong
- leave task-scope delivery failures as advisory text instead of routing the task back to the right upstream stage

This is not a prompt-quality problem. It is a scheduler closure problem.

## Root Cause

The orchestrator currently treats `integrity` as an optional sibling tool instead of a required pipeline stage, and `deliver` only reopens goal attempts when rejection details are goal-scoped.

Missing closure properties:

1. `architect -> integrity -> build` is not enforced by the dispatcher
2. `deliver -> plan restart` is not enforced for structural / repeated / budget-exhausted failures
3. workflow projection does not represent integrity as a first-class task stage

That leaves the system optimizing local tool correctness without a closed-loop execution graph.

## Target State

The scheduler must own the closure, not the LLM prompt.

Required properties:

1. Pipeline workflow explicitly includes `integrity` between `architect` and `build`.
2. Per-goal build dispatch for workflow tasks auto-runs integrity when the active spec snapshot has not yet been reviewed.
3. Delivery rejections that prove a local retry is insufficient automatically rewind the task to `plan`.
4. Workflow projection shows integrity completion from persisted artifacts, so reloads and downstream decisions see the same truth.

## Implementation

### Phase 1: Workflow Completeness

- Add `integrity` as a task-scope step in `pipeline`.
- Project `integrity` step status from the latest `integrity_attempt` artifact for the active spec snapshot.

Files:

- `packages/opencorvus/src/engine/workflow.ts`
- `packages/opencorvus/src/engine/store.ts`

### Phase 2: Forward Closure Before Build

- Extract integrity execution into a helper callable from both the `integrity` tool and the `build` tool.
- In goal-scoped `build`, require an active spec snapshot and an integrity attempt for that snapshot.
- If none exists, run integrity automatically before any worktree side effect.
- If integrity rewrites the goal graph, abort the current build dispatch and force the orchestrator to re-read the corrected goal set.

Files:

- `packages/opencorvus/src/orchestrator/tools.ts`

### Phase 3: Backward Closure After Deliver

- Extract `restart_from_stage` state mutation into a shared helper.
- When delivery shows repeated failure signatures, fix-run budget exhaustion, or task-scope rejection with no attributable goals, automatically restart from `plan`.
- Keep per-goal rejection behavior unchanged: attributed goals reopen with `delivery_rework`.

Files:

- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/orchestrator/scheduler.ts`

### Phase 4: Regression Coverage

Add tests for:

1. workflow pipeline includes integrity and projects it from persisted artifacts
2. build auto-runs integrity before goal dispatch for an unreviewed spec
3. task-scope / repeated / budget-exhausted delivery rejection rewinds to plan automatically

Files:

- `packages/opencorvus/test/orchestrator/tools.test.ts`
- `packages/opencorvus/test/engine/workflow-integrity-step.test.ts`

## Acceptance Criteria

This batch is complete only when all of the following are true:

1. workflow tasks cannot bypass architect review and go straight from architect to build
2. the active spec snapshot must have a recorded integrity attempt before any workflow goal build starts
3. structural delivery failures automatically rewind the task to `plan`
4. targeted tests prove both forward and backward closure
