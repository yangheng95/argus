# Scheduler Compact And Read Context Repair - 2026-06-24

## Acronyms

- DB: Database, the persisted project/task/session store.
- ID: Identifier, a stable task, goal, session, message, or artifact key.
- LLM: Large Language Model, the model running the orchestrator/session turn.

## Objective

Fix two scheduler-agent context failures as one root repair:

1. Scheduler-owned compact work must reuse the session automatic compaction
   mechanism. Scheduler code may queue or invoke compact intent, but the single
   durable compact request remains `SessionCompaction.create()` creating
   `manual_summarize` / `compaction_request`, and execution remains
   `SessionLoop` consuming that control.
2. `read_context` must stop being a default full-state dump for the scheduler
   agent. The tool must expose explicit narrow scopes only, so normal scheduling
   reads goal/runtime facts and deep evidence is requested only by its owning
   scope.

## Independent Review Consensus

- Explorer A confirmed automatic compact has one policy:
  `AutomaticCompaction.decision()` plus
  `SessionLoop.automaticCompactionDecision()`.
- Explorer A confirmed the real compact triggers are all in `SessionLoop`:
  predictive budget pressure, provider context overflow, and completed-turn
  token overflow. They all route through `SessionCompaction.create({ auto:
true })`.
- Explorer A confirmed the compact boundary is the source user
  `CompactionPart` plus a valid structured summary, consumed by
  `Message.filterCompacted()`.
- Explorer B confirmed the scheduler agent is the orchestrator role, and
  `read_context` currently has a `scope.default("all")` schema that can join
  goals, evaluations, integrity, decisions, research, fact-check, and deliveries
  into one latest tool result.
- Explorer B confirmed the orchestrator prompt already includes
  `renderTaskDescription(describeTask(...))`, so a default `scope=all`
  `read_context` repeats state the scheduler already received.

## Recall

- `2026-06-17-all-agent-auto-compaction-coverage.md`: automatic compact policy
  and queueing are owned by session metadata and `SessionCompaction.create`.
- `2026-06-22-read-context-output-budget.md`: the prior 20,000-character cap
  was necessary but insufficient because `scope=all` still creates one large
  current-state snapshot.
- `2026-06-19-goal-fifo-refill-scheduling-impact.md`: scheduler decisions need
  ordered dispatchable goals, failed goals, live runs, and terminal refill
  facts; those are goal-scope facts, not a whole task archive.
- `2026-06-21-dispatch-algorithm-agent-audit.md`: research context must expose
  compact pointer data and artifact IDs, not raw evidence bodies.

## Call-Point Sweep

Command basis:

```powershell
rg -n "read_context|SessionCompaction.create|SessionCompaction.process|automaticCompactionDecision|scope: \"all\"|default(\"all\")|TaskQueueMetadata|RawTaskMetadata|/summarize" packages/opencorvus/src packages/opencorvus/test specs -S
```

| Surface                                                         | Decision                                                                                                                                |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/session/loop.ts`                       | Keep automatic compact triggers and `SessionLoop` control consumption unchanged.                                                        |
| `packages/opencorvus/src/session/compaction.ts`                 | Keep `SessionCompaction.create/process` as the single compact request/execution owner.                                                  |
| `packages/opencorvus/src/scheduler/task-queue.sql.ts`           | Add a compact queue metadata intent only if scheduler queueing is needed; it must not use `previous_summary` or write summaries.        |
| `packages/opencorvus/src/scheduler/task-queue-service.ts`       | A compact executor may call `SessionCompaction.create` and `SessionPrompt.loop`; it must not call `SessionCompaction.process` directly. |
| `/session/:sessionID/summarize`                                 | If changed, reuse the thin compact executor while preserving active-project ownership and manual summary mode.                          |
| `packages/opencorvus/src/orchestrator/tools.ts::read_context`   | Remove `scope=all` and the default. Add explicit `research` and `fact_checks` scopes for facts formerly reachable only through `all`.   |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt`     | Replace generic `read_context` instructions with scope-specific scheduling guidance.                                                    |
| `packages/opencorvus/test/orchestrator/tools.test.ts`           | Update read-context tests to use explicit scopes and reject `scope=all` / missing scope at the schema contract.                         |
| `packages/opencorvus/test/scheduler/task-queue-service.test.ts` | Add compact queue tests only after the thin executor exists, proving no user message is appended and loop mode follows `auto`.          |

## Design

### Compact

The scheduler compact path is a delivery mechanism, not a second compactor.
Queued or synchronous compact execution resolves the source user message,
calls `SessionCompaction.create({ auto })`, then starts `SessionPrompt.loop`.
Manual summary uses `result_mode: "summary"`; automatic compact uses default
reply mode so `SessionCompaction.process()` can return `continue` and the same
session loop continues the business turn.

No scheduler code may:

- call `SessionCompaction.process()` directly;
- write `Message.CompactionPart`;
- write or read `a2a_task_queue.previous_summary`;
- define a second summary schema or compact policy;
- create fake user wake messages for compact.

### Read Context

`read_context` becomes explicit-scope only:

- `goals`: current task/goal/runtime/refill facts for normal scheduler
  dispatch.
- `evaluations`: latest evaluation verdicts.
- `deliveries`: latest acceptance/delivery summaries.
- `decisions`: decision-log context.
- `integrity_history`: integrity artifact status and root history.
- `research`: deep/frontend research brief pointers and compact summaries.
- `fact_checks`: latest fact-check attempt pointers.

There is no `all` scope and no default. This is a schema contract, not a gate:
the scheduler must ask for the exact state surface it is deciding from.

## Acceptance

- `read_context` input schema rejects omitted scope and `scope="all"`.
- Research and fact-check facts remain reachable through explicit scopes.
- Existing goal, delivery, evaluation, decision, and integrity facts remain
  reachable through their existing explicit scopes.
- The orchestrator prompt instructs normal scheduling to use `scope="goals"`
  and deep evidence scopes only when the decision requires them.
- Scheduler compact tests prove queued/synchronous compact uses
  `SessionCompaction.create` and `SessionPrompt.loop`, does not append a user
  message, and does not touch `previous_summary`.
- No `SessionLoop` automatic compact policy or compaction boundary logic is
  duplicated.
