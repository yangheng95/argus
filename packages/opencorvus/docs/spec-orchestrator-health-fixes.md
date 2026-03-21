# Orchestrator Health Fixes — 2026-03-21

## Problem Statement

The OpenCorvus orchestrator suffers from systematic timeout, hang, and deadlock issues.
Root cause analysis identified 7 structural flaws; this document records the fixes applied.

## Fixes Applied

### P0-1: Timeout layer composition

**Before:** `SYNC_RUN_TIMEOUT_MS = 5 min`, `EVALUATION_HARD_TIMEOUT_MS = 10 min`.
syncRun timeout fires before evaluation can complete → cleanup (`evaluatingRuns.delete`) runs late →
next poll sees stale evaluating guard → waits `EVALUATING_STALE_MS = 11 min` → total stall: 16 min.

**After:** `SYNC_RUN_TIMEOUT_MS = EVALUATION_HARD_TIMEOUT_MS + 3 min` (13 min).
The outer timeout always exceeds the inner, so evaluation cleanup has time to run.

### P0-2: Pipeline advancement decoupled from sync guard

**Before:** `poll()` held a global `syncing = true` boolean for the entire tick.
Pipeline advancement (queued→spec→goal→plan) was inside the guard.
A 10+ min evaluation blocked new task pickup.

**After:** Pipeline advancement runs BEFORE the syncing guard (Phase 1).
Only run sync (Phase 2) is guarded by `syncing`. New tasks are always picked up
regardless of how long active run sync takes.

### P1-3: evaluatingRuns atomic guard

**Before:** `check has() → set()` across two statements. Concurrent syncRuns
(via `Promise.allSettled`) could both pass the check → double evaluation.

**After:** Early-return guard pattern: `if (...has(...)) return` then immediate `set()`.
Both operations execute in the same synchronous microtask — no yield point between them.

### P1-4: Database.effect promise safety

**Before:** `for (const effect of effects) effect()` — returned Promises discarded.
Bus event failures were silently lost.

**After:** `drainEffects()` wraps each effect in try-catch, and attaches `.catch()`
handlers to any returned Promises. Failures are logged via `db-effect` logger.

### P1-5: GET interfaces no longer trigger syncRun

**Before:** `listRuns`, `getRun`, `getDelivery`, `listArtifacts`, `listEvaluations`,
`getExecutorSession`, `listExecutorEvents`, `listTaskInteractions`, `getBrief`,
`getBoard`, `getBoardTag` all called `syncTask()`/`syncRun()`.
A GET request could trigger a 10+ min evaluation.

**After:** All read-only handlers just read from DB. Poll loop handles advancement.
Pattern matches `getProgress()` which was already fixed.

### P2-6: Bus subscriber timeout reduced

**Before:** 120s (2 minutes) — any slow subscriber back-pressured pipeline stages.

**After:** 15s — short enough to prevent cascading stalls.

### P2-7: Lock.process deadlock prevention

**Before:** `nextWriter()` could throw before setting `lock.writer = true`.
Lock would be permanently stuck — all subsequent readers/writers blocked forever.

**After:** Writer and reader wakeup wrapped in try-catch.
On exception, `process(key)` is re-invoked to wake the next waiter.

## Files Modified

- `src/orchestrator/runtime.ts` — P0-1, P0-2, P1-3
- `src/orchestrator/service.ts` — P1-5
- `src/storage/db.ts` — P1-4
- `src/bus/index.ts` — P2-6
- `src/util/lock.ts` — P2-7

## Verification

TypeScript compilation: zero new errors introduced (all errors pre-existing in `acp/agent.ts`, `persist.ts`).
