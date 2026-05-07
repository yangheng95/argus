# Engine Wedge on Orchestrator Stream Error — Fix Plan

**Date**: 2026-04-30
**Trigger**: `_session-r2-glm5.out` 14:47:25 — orchestrator's first wake hit
HTTP 401 (international `alibaba-coding-plan` endpoint, since dropped in
commit `5fe320b28`). After the streamError artifact was recorded, the bench
spent the rest of its life in a tight loop emitting
`reviveZombieTasks: explicit orchestrator stream error exists, waiting for
external wake` every ~500 ms (lines 475-1286).

## Root Cause

Two architectural gaps stacked:

1. **`recordOrchestratorStreamError` writes an `orchestrator-stream-error`
   artifact, but `engine/describe.ts` does NOT include that kind anywhere
   in `describeTask` / `renderTaskDescription`.** Verified: full repo grep
   for `orchestrator-stream-error|orchestratorStreamError` inside
   `describe.ts` returns zero matches. So even if a wake re-enters
   `processTask`, the LLM cannot see the artifact via its system prompt.

2. **`reviveZombieTasks` (`engine/runtime.ts:91-114`) refuses to wake any
   task with such an artifact**, citing "the next retry must be an external
   wake". In CLI bench mode there is no external wake source — the bench
   only polls `/task/.../progress` (read-only). So the task sits `active`
   forever, blocking bench completion.

The author's stated fear (line 70 of `runtime.ts`):

> Reviving that task automatically replays the same failed wake forever
> when the failure is deterministic preflight configuration.

is a real concern, but the chosen fix trades **infinite burn-loop** for
**infinite wedge**. Rule 13 says trust LLM intelligence; the right fix
gives the LLM the artifact and lets it decide.

## Fix

Three coordinated changes (rule 8: single source — no parallel "wedge mode"
vs "auto-replay mode"):

### 1. `engine/describe.ts` — surface the artifact

Add to `TaskDesc`:

```ts
recent_stream_failures?: Array<{
  artifact_id: string
  time_created: number
  reason: string
  error_name?: string
  session_id?: string
}>
```

`describeTaskFromRow` queries `EngineArtifactTable` filtered by
`kind="orchestrator-stream-error"` and `time_created >= task.time_started`,
ordered descending, capped at the 5 most recent (avoid prompt bloat on a
chronically failing provider — the LLM doesn't need older entries to
decide).

`renderTaskDescription` emits, when the array is non-empty:

```
## Recent orchestrator stream failures (N)
- 2026-04-30T14:47:25Z [APIError] Provider alibaba-coding-plan returned HTTP 401: …
- …

Each entry is an upstream LLM-call failure that aborted a wake before any
decision was made. Use this history to decide: retry_task (transient),
restart_from_stage (config issue), or fail_task (permanent — e.g. quota).
```

### 2. `engine/runtime.ts` — drop the wedge guard

Delete `hasExplicitOrchestratorStreamErrorSinceTaskStart` and the early
`continue` it gates. `reviveZombieTasks` resumes any active task with no
in-flight loop, identical to the path for stream-idle aborts.

The burn-loop concern is bounded by:
- Each failed wake records a *new* artifact, so the LLM accumulates
  evidence and is expected to call `fail_task` after seeing N entries.
- Provider rate limits / budget caps stop runaway calls at the LLM layer,
  not the engine layer (rule 13 — trust LLM, no engine state machine).

### 3. Tests — flip the contract

- `test/engine/zombie-task-revive.test.ts`: replace the
  "does not auto-replay" assertion with "resumes even when stream-error
  artifact exists" + "drops the legacy guard helper".
- New `test/engine/describe-stream-error.test.ts`: seed two
  `orchestrator-stream-error` artifacts, assert `describeTask` returns
  `recent_stream_failures` with both, assert `renderTaskDescription`
  emits the section + the truncated reason text.

## Out of Scope

- Provider-level retry/backoff. Stays in `provider/provider.ts` per rule 7.
- Rate-limiting `reviveZombieTasks` itself. The poll cadence is already
  ~500 ms; the LLM stream call is the actual cost, not the revive call.
- Removing `recordOrchestratorStreamError`. The artifact remains the single
  source of truth for stream failures — what changes is who consumes it.

## Migration / Cleanup (rule 17)

`hasExplicitOrchestratorStreamErrorSinceTaskStart` is the only caller of
its imports beyond `EngineArtifactTable` itself; deleted entirely. No
migration needed — the artifact rows continue to be written and now flow
into describe instead.
