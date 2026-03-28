# Parallel Goal Execution Design

## Summary

Enable concurrent execution of independent goals within a single orchestrator run. Currently goals are dispatched strictly one at a time (`ready[0]`), even when multiple goals have no dependency between them. This design introduces workspace isolation via git worktrees and concurrent goal dispatch to reduce end-to-end task execution time.

## Compass

### North Star

- Independent goals run in parallel, each in an isolated workspace.
- Dependent goals respect their dependency edges and remain sequential.
- The shared workspace is only mutated by a controlled merge step after goals pass evaluation.
- Retry/replan decisions operate correctly regardless of parallelism level.
- Existing serial execution is the `maxConcurrentGoals = 1` special case — no breakage.

### Do Not Regress

- Do not allow parallel goals to write to the same workspace without isolation.
- Do not skip evaluation for any goal, regardless of parallelism.
- Do not introduce fallback logic that silently degrades to serial execution.
- Do not couple worktree lifecycle to anything other than goal run lifecycle.
- Do not modify the goal dependency contract from `goal/service.ts` or `goal/scheduler.ts`.
- Do not break the existing `spec-goal-workflow-refactor-plan.md` contracts.
- Do not break the existing `spec-unified-stage-retry.md` retry philosophy.

### Verification Rule

- Each phase must pass `bunx tsc --noEmit` (no new errors in touched files).
- Each phase must pass the existing `overlay-web-benchmark` in both `materialize` and `full` modes.
- Phase completion requires a dedicated benchmark that exercises parallel dispatch.

## Existing Constraints (from disk)

### From `spec-goal-workflow-refactor-plan.md`

- Phase 4 stated: "Keep execution strictly single-goal / single-workspace." This design is the successor to that constraint.
- Goal dependencies come from `GoalContract.depends_on_goal_ids`, not plan waves.
- Plan nodes are workflow projections; goal contracts are the source of truth for dependencies.
- `GoalSnapshot` is the source of truth for executable workload decomposition.

### From `spec-unified-stage-retry.md`

- Agents are pure: attempt once, succeed or throw.
- `withStageRetry()` wraps all stages uniformly.
- Retry/replan decisions come from the orchestrator, not the executor.

### From `strategy.ts`

- `decideRetryOrReplan()` operates on task-level and run-level state.
- `buildRetryContext()` collects all goal run deliveries for context.
- Both are already multi-goal-aware (iterate `listGoalRunsByCoordinator`).

### From `task-queue-service.ts`

- TaskQueueService already supports concurrent execution: `CONCURRENCY_DEFAULT = 4`, `BATCH_SIZE = 10`.
- Per-session mutual exclusion: `NOT EXISTS ... running` SQL constraint prevents two tasks for the same session from running simultaneously.
- Each goal gets its own session → no session-level contention for parallel goals.

### From `worktree/index.ts`

- `Worktree.create()` creates isolated git worktrees with unique branches.
- `Worktree.remove()` cleans up worktrees and their branches.
- `Worktree.reset()` resets a worktree to the default branch.
- Worktrees are stored in `{Global.Path.data}/worktree/{projectID}/{name}/`.
- Each worktree has its own branch (`opencorvus/{name}`) and directory.
- Bootstrap (`InstanceBootstrap`) is run inside each worktree.

## Architecture

### Current Flow (Serial)

```
continueGoalPipeline()
  → queueReadyGoalRuns()
    → activeGoalRuns(run).length > 0 ? return : continue  // hard block
    → ready = readyGoalNodes(nodes, goals)
    → next = ready[0]                                       // only first
    → queueGoalRun(task, run, plan, next)
  → finalizeGoalRun() on completion
    → evaluateGoal()
    → applyGoalDelivery() to Instance.directory
    → continueGoalPipeline()                                 // next goal
```

### Proposed Flow (Parallel)

```
continueGoalPipeline()
  → queueReadyGoalRuns()
    → active = activeGoalRuns(run).length
    → slots = maxConcurrentGoals - active
    → if slots <= 0: return
    → ready = readyGoalNodes(nodes, goals)
    → batch = ready.slice(0, slots)
    → for next of batch:
        → worktree = Worktree.create()           // isolated workspace
        → queueGoalRun(task, run, plan, next, worktree)
  → finalizeGoalRun() on each completion (concurrent)
    → evaluateGoal() in goal's worktree
    → if passed: mergeGoalDelivery() to main workspace  // serialized
    → if all dispatched goals finalized: continueGoalPipeline()
```

### Workspace Isolation

Each parallel goal gets its own git worktree:

```
Instance.directory (main workspace)
  ├── .git/worktrees/
  │     ├── goal-brave-falcon/    (Goal A worktree metadata)
  │     └── goal-calm-tiger/      (Goal B worktree metadata)
  │
  {Global.Path.data}/worktree/{projectID}/
  ├── goal-brave-falcon/          (Goal A isolated files)
  └── goal-calm-tiger/            (Goal B isolated files)
```

**Lifecycle:**
1. `queueGoalRun()` → `Worktree.create({ name: goalRunID })` → worktree ready
2. Goal session executes in worktree directory
3. On completion → `deliveryFromSnapshot()` runs in worktree context
4. Evaluation runs in worktree context
5. If passed → diffs merged to main workspace
6. `Worktree.remove()` cleans up

### Delivery Merge Strategy

After a parallel goal passes evaluation, its delivery must be merged to the main workspace.

**Merge is serialized** via `withGoalRunFinalizeLock()` (already exists):

```typescript
// In _finalizeGoalRun(), after evaluation passes:
await withGoalRunFinalizeLock(run.id, async () => {
  // 1. Conflict check: do any delivered files overlap with files already applied in this run?
  const conflicts = detectFileConflicts(delivered.diffs, runAppliedFiles.get(run.id))
  if (conflicts.length > 0) {
    // Mark goal as failed with conflict reason — do not silently merge
    updateGoalRun(goalRun.id, { status: "failed", error: `File conflict: ${conflicts.join(", ")}` })
    return
  }
  // 2. Apply delivery to main workspace
  await applyGoalDelivery({ directory: Instance.directory, delivery: delivered })
  // 3. Track applied files
  for (const diff of delivered.diffs) {
    if (diff.status !== "deleted") appliedByRun.add(diff.file)
  }
})
```

**Conflict resolution:** fail the conflicting goal and let retry/replan handle it. No automatic merge — that would be a fallback.

### Concurrency Control

```typescript
// New constant in helpers.ts
export const MAX_CONCURRENT_GOALS = safeInt(process.env.OPENCORVUS_MAX_CONCURRENT_GOALS, 1)
```

Default is `1` (backward compatible — serial execution). Set to `2+` to enable parallelism.

Can also be set per-task via `task.budget.max_concurrent_goals`.

### Goal Readiness (No Change Needed)

`readyGoalNodes()` in `goal/scheduler.ts` already returns ALL ready goals:

```typescript
export function readyGoalNodes(nodes: PlanNodeRow[], goals: GoalRow[]) {
  const ordered = goalNodes(nodes)
  return ordered.flatMap((node) => {
    const goal = goals.find((item) => item.id === node.goal_id)
    if (!goal || goal.status !== "pending") return []
    const ready = (node.depends_on_ids ?? []).every((depID) => { ... })
    if (!ready) return []
    return [{ node, goal }]
  })
}
```

Only `nextGoalNode()` and `queueReadyGoalRuns()` artificially take `[0]`. The scheduler itself is already parallel-aware.

### Retry/Replan With Parallel Goals

When a blocking goal fails while other goals are still running:

1. **Do NOT abort running goals** — let them complete naturally.
2. Mark the failed goal status.
3. When all active goals finish, `continueGoalPipeline()` checks remaining pending blocking goals.
4. If no ready goals (due to failed dependency) → `handleEvaluationFailure()` → retry/replan as normal.

This matches the existing flow — `continueGoalPipeline()` already handles "no ready goals + pending blocking goals" as a failure case.

### Session & Event Streaming

No changes needed:
- Each goal already gets its own session via `createGoalSession()`.
- SSE streaming via `registerGoalRunSession()` already supports multiple concurrent goal sessions.
- Task-level SSE multiplexes all goal sessions through the same stream.

### Database Considerations

- SQLite handles concurrent reads and serialized writes.
- `withGoalRunFinalizeLock()` already serializes finalization per run.
- `finalizingGoalRuns` Set prevents concurrent finalization of the same goal run.
- `evaluatingRuns` Map guards against concurrent run-level evaluation.
- All existing guards are sufficient — no new locking needed.

## Phases

### Phase 1: Concurrency Configuration + Scheduler Unlocking

**Goal:** Allow dispatching multiple ready goals. No worktree isolation yet — only safe when goals are known to touch disjoint files.

**Files changed:**
- `src/orchestrator/helpers.ts` — Add `MAX_CONCURRENT_GOALS` constant
- `src/orchestrator/model.ts` — Add `max_concurrent_goals` to `Budget` schema
- `src/orchestrator/runtime.ts` — Modify `queueReadyGoalRuns()` to dispatch up to `maxConcurrentGoals` ready goals
- `src/goal/scheduler.ts` — No changes needed (already returns all ready goals)

**Changes in `runtime.ts:queueReadyGoalRuns()`:**

```typescript
async function queueReadyGoalRuns(task: TaskRow, run: RunRow, plan: PlanRow, hooks: RuntimeHooks) {
  const maxConcurrent = effectiveMaxConcurrentGoals(task)
  const active = activeGoalRuns(run).length
  const slots = maxConcurrent - active
  if (slots <= 0) return 0
  const nodes = listPlanNodesByPlan(plan.id)
  const ready = readyGoalNodes(nodes, listGoalsForPlan(plan))
  const batch = ready.slice(0, slots)
  if (batch.length === 0) return 0
  let queued = 0
  for (const next of batch) {
    log.info("dispatching goal", { runID: run.id, goal: next.goal.description })
    await queueGoalRun(task, run, plan, next, hooks)
    queued++
  }
  return queued
}
```

**Changes in `continueGoalPipeline()`:**

```typescript
async function continueGoalPipeline(task, run, hooks) {
  // ... existing refresh logic ...
  if (hasPendingGoalEvaluations(refreshedRun)) return
  const queuedCount = await queueReadyGoalRuns(refreshedTask, refreshedRun, plan, hooks)
  if (queuedCount > 0) return
  if (activeGoalRuns(refreshedRun).length > 0) return  // wait for running goals
  // ... existing pending/failure handling ...
}
```

**Checks:**
- `bunx tsc --noEmit`
- `bun test test/server` (existing server regression)
- `overlay-web-benchmark --mode=materialize` with `OPENCORVUS_MAX_CONCURRENT_GOALS=1` (backward compat)

**Stop condition:**
- With `MAX_CONCURRENT_GOALS=1`, behavior is identical to current serial execution.
- With `MAX_CONCURRENT_GOALS=2+`, multiple ready goals are dispatched (verified via logs).

### Phase 2: Worktree Isolation Per Goal

**Goal:** Each dispatched goal executes in its own git worktree, preventing file system conflicts.

**Files changed:**
- `src/orchestrator/runtime.ts` — `queueGoalRun()` creates worktree and passes it as `workspace_dir`
- `src/goal/runner.ts` — `createGoalSession()` uses worktree directory; `cleanupGoalWorkspace()` removes worktree
- `src/orchestrator/runtime.ts` — `_finalizeGoalRun()` extracts delivery from worktree, merges to main workspace

**Changes in `queueGoalRun()`:**

```typescript
async function queueGoalRun(task, run, plan, next, hooks) {
  const maxConcurrent = effectiveMaxConcurrentGoals(task)
  let workspaceDir: string
  if (maxConcurrent > 1) {
    const worktree = await Worktree.create({ name: `goal-${next.goal.id.slice(-8)}` })
    workspaceDir = worktree.directory
  } else {
    workspaceDir = await taskDirectory(task)
  }
  // ... rest of existing queueGoalRun with workspaceDir ...
}
```

**Changes in `_finalizeGoalRun()` merge step:**

```typescript
// After evaluation passes, merge delivery to main workspace (serialized)
if (outcome.status === "passed" || (goal.priority === "advisory" && delivered.diffs.length > 0)) {
  await withGoalRunFinalizeLock(run.id, async () => {
    const appliedByRun = runAppliedFiles.get(run.id) ?? new Set<string>()
    const conflicts = delivered.diffs.filter((d) => d.status !== "deleted" && appliedByRun.has(d.file))
    if (conflicts.length > 0) {
      // Hard failure — do not silently overwrite
      log.error("file conflict during parallel goal merge", { goal: goal.description, conflicts: conflicts.map((d) => d.file) })
      updateGoalRun(goalRun.id, {
        status: "failed",
        error: `File conflict with earlier goal: ${conflicts.map((d) => d.file).join(", ")}`,
      })
      return
    }
    for (const diff of delivered.diffs) {
      if (diff.status !== "deleted") appliedByRun.add(diff.file)
    }
    runAppliedFiles.set(run.id, appliedByRun)
    await provideWorkspace(await taskDirectory(task), () =>
      applyGoalDelivery({ directory: Instance.directory, delivery: delivered })
    )
  })
}
```

**Checks:**
- `bunx tsc --noEmit`
- `overlay-web-benchmark --mode=full` with `OPENCORVUS_MAX_CONCURRENT_GOALS=2`
- New benchmark: `parallel-goal-benchmark.ts` (see Phase 5)

**Stop condition:**
- Goals execute in isolated worktrees (verified via `goalRun.workspace_dir` pointing to worktree).
- File changes from one goal do not appear in another goal's workspace during execution.
- Delivery is correctly merged to main workspace after evaluation.

### Phase 3: Conflict Detection + Failed Goal Handling

**Goal:** Robust conflict detection and correct retry/replan behavior when parallel goals fail.

**Files changed:**
- `src/orchestrator/runtime.ts` — Conflict detection upgrade from warn to hard fail
- `src/orchestrator/strategy.ts` — `buildRetryContext()` includes parallel context
- `src/orchestrator/runtime.ts` — `continueGoalPipeline()` handles mixed pass/fail outcomes

**Key behaviors:**

1. **One goal fails, others still running:** Do nothing. Wait for all active goals to complete.
2. **All goals done, some failed:** `continueGoalPipeline()` → check if remaining pending goals are blocked → `handleEvaluationFailure()`.
3. **File conflict during merge:** Goal marked failed with conflict evidence → feeds into retry context.
4. **Retry a failed goal:** Next run retries only the failed goal. Passed goals remain `passed` and are not re-executed.

**No changes to `decideRetryOrReplan()`** — it already operates on run-level state and collects all goal run deliveries.

**Checks:**
- Test case: two goals touching the same file → conflict detected → goal fails → replan.
- Test case: one goal fails evaluation, other passes → only failed goal retried.
- `overlay-web-benchmark --mode=full`

**Stop condition:**
- File conflicts are detected and result in goal failure (not silent overwrite).
- Retry context includes information about parallel goal outcomes.
- Replan considers which goals already passed.

### Phase 4: Evaluation Pipelining

**Goal:** While one goal evaluates, continue executing the next ready goal. Currently evaluation blocks the pipeline.

**Files changed:**
- `src/orchestrator/runtime.ts` — `_finalizeGoalRun()` calls `continueGoalPipeline()` before evaluation completes
- `src/orchestrator/runtime.ts` — `hasPendingGoalEvaluations()` allows new dispatch while evaluations are pending

**Current behavior:**
```
Goal A completes → evaluate A (blocks) → merge A → dispatch Goal B
```

**New behavior:**
```
Goal A completes → start evaluate A → dispatch Goal B (if ready and slots available)
→ Goal B completes → start evaluate B
→ evaluate A completes → merge A
→ evaluate B completes → merge B
```

This requires decoupling "dispatch next goal" from "evaluation complete":

```typescript
async function _finalizeGoalRun(task, run, goalRun, hooks) {
  // ... extract delivery ...
  // Start evaluation (but don't wait for merge yet)
  const evaluationPromise = evaluateAndMerge(task, run, goalRun, goal, delivered, hooks)

  // While evaluation runs, try to dispatch next goals
  const maxConcurrent = effectiveMaxConcurrentGoals(task)
  if (maxConcurrent > 1) {
    // Don't await — let evaluation and next dispatch proceed in parallel
    void evaluationPromise.catch((err) => log.error("evaluation failed", { error: String(err) }))
    await continueGoalPipeline(requireTask(task.id), requireRun(run.id), hooks)
  } else {
    await evaluationPromise
    await continueGoalPipeline(requireTask(task.id), requireRun(run.id), hooks)
  }
}
```

**Checks:**
- Verify goal dispatch happens while evaluation is still running (via logs/timing).
- `overlay-web-benchmark --mode=full` with `OPENCORVUS_MAX_CONCURRENT_GOALS=3`

**Stop condition:**
- Goal N+1 starts executing before Goal N's evaluation completes.
- All evaluations still complete and merge correctly.

### Phase 5: Parallel Goal Benchmark

**Goal:** Dedicated benchmark that validates parallel execution correctness and measures speedup.

**Files:**
- `script/benchmark/parallel-goal-benchmark.ts` — New benchmark script

**Benchmark definition:**
- **Input:** A task request that produces 3+ independent goals (e.g., "Create three independent utility modules: string-utils.ts, math-utils.ts, date-utils.ts, each with 3 exported functions and tests").
- **Output:** All goals pass evaluation, all files present in final workspace, no conflicts.
- **Environment:** `OPENCORVUS_MAX_CONCURRENT_GOALS=3`, same model/env as existing benchmarks.
- **Timeout:** 3 minutes inactivity timeout per goal.
- **Acceptance criteria:**
  - All goals pass evaluation.
  - Execution wall time < serial baseline × 0.7 (at least 30% speedup).
  - No file conflicts logged.
  - No goals marked failed due to conflicts.
  - Final workspace contains all expected files.

**Checks:**
- `bun run script/benchmark/parallel-goal-benchmark.ts`
- Compare wall time against serial baseline (`OPENCORVUS_MAX_CONCURRENT_GOALS=1`)

**Stop condition:**
- Benchmark passes with `OPENCORVUS_MAX_CONCURRENT_GOALS=3`.
- Measurable wall time improvement over serial execution.
- Zero file conflicts in the benchmark scenario.

## File Change Summary

| File | Phase | Change |
|------|-------|--------|
| `src/orchestrator/helpers.ts` | 1 | Add `MAX_CONCURRENT_GOALS` constant |
| `src/orchestrator/model.ts` | 1 | Add `max_concurrent_goals` to Budget |
| `src/orchestrator/runtime.ts` | 1-4 | Core parallel dispatch, worktree lifecycle, merge, pipeline |
| `src/goal/runner.ts` | 2 | Worktree-aware session creation, cleanup |
| `src/orchestrator/strategy.ts` | 3 | Parallel-aware retry context |
| `script/benchmark/parallel-goal-benchmark.ts` | 5 | New benchmark |
| `docs/benchmarking.md` | 5 | Document new benchmark |

## Constants

| Name | Default | Env | Description |
|------|---------|-----|-------------|
| `MAX_CONCURRENT_GOALS` | `1` | `OPENCORVUS_MAX_CONCURRENT_GOALS` | Max goals executing in parallel per run |

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| File conflicts between parallel goals | High | Phase 3 hard-fail on conflict, no silent merge |
| Worktree creation overhead | Low | `git worktree add` is <1s; cleanup is async |
| LLM API rate limit with concurrent goals | Medium | `MAX_CONCURRENT_GOALS` capped; TaskQueue has its own concurrency limit |
| Evaluation context pollution | Low | Each goal evaluates in its own worktree |
| Replan state inconsistency | Medium | Phase 3 explicitly handles mixed outcomes |
| Worktree cleanup on crash | Low | Existing `cleanupStaleGoalWorkspaces()` handles orphans |

## Resume Protocol

If work is interrupted, resume in this order:

1. Read this file and confirm the last completed phase.
2. Check whether `MAX_CONCURRENT_GOALS` constant exists in `helpers.ts`.
3. Check whether `queueReadyGoalRuns()` dispatches multiple goals.
4. Check whether `queueGoalRun()` creates worktrees.
5. Validate the current phase against its stop condition before opening the next one.
6. Update `Progress Snapshot` immediately after each completed phase.

## Progress Snapshot

### Completed

- Phase 1: Concurrency Configuration + Scheduler Unlocking
  - Added `MAX_CONCURRENT_GOALS` constant (default 1, env `OPENCORVUS_MAX_CONCURRENT_GOALS`)
  - Added `maxConcurrentGoals` to Budget schema and OrchestratorBudget type
  - Added `goalDependencyLayers()` to scheduler for topological layer analysis
  - Updated `queueReadyGoalRuns()` to dispatch multiple ready goals up to `maxConcurrentGoals`
  - Updated `continueGoalPipeline()` to handle multiple active goals
  - Updated `_finalizeGoalRun()` to defer failure handling when other goals are still active
  - Updated `syncRun()` to not immediately fail when one goal fails while others are running
  - Upgraded conflict detection to hard-fail in parallel mode (no silent overwrite)
  - Updated planner prompt to describe isolated workspace model
  - `bunx tsc --noEmit` passes (no new errors in touched files)

### Cleanup (2026-03-28)

- Removed multi-group shadow pipeline (goal-grouping.ts, group-dispatch.ts, group-merge.ts)
- Removed ~1000 lines of multi-group dispatch/sync/merge code from runtime.ts
- Removed multi-group store functions (listGroupIDsByRun, listGoalRunsByGroup, listDeliveriesByRun)
- Removed debug console.logs from managed.ts and claude-agent.ts
- Kept: executor cwd propagation (compat.ts, managed.ts, codex-app-server.ts, claude-agent.ts, bootstrap.ts)
- Kept: worktree module with sync checkout support (worktree/index.ts)
- Kept: goal fidelity review with retry (fidelity-review.ts)
- Kept: goal graph validation (pipeline.ts, persist.ts)
- Kept: config keys (max_executor_groups) — will be repurposed for per-goal parallelism
- `bunx tsc --noEmit` passes (no new errors in touched files)

### Current Phase

Phase 2: Worktree Isolation Per Goal
