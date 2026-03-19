# Unified Stage Retry Design

## Problem

Spec/Planner failures are fatal — no retry, no recovery. Goal execution has mature retry/replan via `strategy.ts`, but the same philosophy doesn't cover earlier stages.

## Design Principle

1. **Agent 不管重试** — spec/planner/executor/evaluator are pure functions: attempt once, succeed or throw.
2. **调度器统一决策** — All stage failures route through the same classification and retry logic.
3. **`withStageRetry()`** — Single generic wrapper for all retryable stages. Lives in `strategy.ts`.
4. **连续失败升级** — Consecutive same-stage failures → escalate upstream → exhaust → terminate.
5. **无 fallback** — Retry is re-execution with same expectation. Rewind is upstream re-planning with guidance. Neither is degradation.

## State Machine (closure — all transitions defined)

```
Stage failed | Classification      | Action
------------|---------------------|------------------------------------------
spec        | transient           | retry spec (up to STAGE_RETRY_LIMIT)
spec        | input / permission  | FAIL
plan        | transient           | retry plan (up to STAGE_RETRY_LIMIT)
plan        | strategy            | rewind → spec (via existing replan path)
plan        | input / permission  | FAIL
execute     | transient           | retry execute (existing strategy.ts)
execute     | strategy/env        | replan (existing strategy.ts)
execute     | input / permission  | FAIL
evaluate    | rejected            | retry / replan (existing strategy.ts)
evaluate    | inconclusive (≥3)   | FAIL
deliver     | timeout             | FAIL
```

## Core Abstraction

```typescript
// strategy.ts
async function withStageRetry<T>(stage, fn, options?): Promise<T>
```

- Retries `fn()` up to `STAGE_RETRY_LIMIT + 1` attempts
- Classifies errors via `classifyStageError()`
- Non-retryable (input/permission) → throw immediately
- Retryable (transient) → retry with logging
- Budget exhausted → throw last error

## Integration Points

| Call site | File | Wraps |
|-----------|------|-------|
| Initial task creation | `service.ts` `bootstrapCreatedTask()` | `compileTransition()` |
| Replan creation | `persist.ts` `createReplanRun()` | `compileTransition()` |
| Inconclusive eval | `runtime.ts` | evaluation loop (treat as transient) |

## Constants

- `STAGE_RETRY_LIMIT = 2` (env: `OPENCORVUS_STAGE_RETRY_LIMIT`)
- Existing `SAME_PLAN_RETRY_LIMIT`, `DEFAULT_MAX_RUNS`, `DEFAULT_MAX_REPLANS` unchanged

## Files Changed

- `helpers.ts` — Add `Stage`, `StageFailure` types, `STAGE_RETRY_LIMIT` constant
- `strategy.ts` — Add `classifyStageError()`, `withStageRetry()`
- `service.ts` — Wrap `compileTransition()` in `bootstrapCreatedTask()`
- `persist.ts` — Wrap `compileTransition()` in `createReplanRun()`
- `runtime.ts` — Route inconclusive verdict through decision logic
