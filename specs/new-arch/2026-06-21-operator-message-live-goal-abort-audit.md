# Operator Message Live Goal Abort Audit

Date: 2026-06-21

## Problem

The user reports that appending a message to a running scheduler task aborts all
live goals. This is a scheduling/ownership bug class, not a UI wording issue.

The current architecture after the dynamic queue change must preserve these
invariants:

- A task-level operator message is a visible wake fact.
- A live orchestrator-owned build/integrity child must not be cancelled by a
  generic wake or by `interrupt=true`.
- Only explicit target-scoped cancellation may abort live ownership.
- Dynamic queue code may return `queued`; that is not a failed decision.
- Once an orchestrator LLM wake runs, the no-decision contract still applies to
  that LLM decision turn.

## Acronyms

- API: Application Programming Interface, the HTTP route and generated contract.
- LLM: Large Language Model, the orchestrator decision maker.
- PID: Process Identifier, the operating-system process id.

## Recall And Evidence

Reviewed before edits:

- `AGENTS.md`
- `specs/new-arch/2026-06-13-build-steer-live-ownership-interrupt-fix.md`
- `specs/orchestrator-no-decision-stop-2026-06-18.md`
- `specs/new-arch/2026-06-19-goal-fifo-refill-scheduling-impact.md`
- `specs/new-arch/2026-06-19-g1-g2-orchestrator-runtime-single-source-repair.md`
- `specs/new-arch/2026-06-20-goal-continue-stale-run-blocker-pressure.md`

Current source evidence:

| Surface | Evidence | Status |
| --- | --- | --- |
| `engine/queue.ts::dispatchTaskLoop` | Live ownership branch stores the event in `queuedTaskEvents` and returns `queued`; it does not call `abortLiveOrchestratorToolOwnership`. | Correct in HEAD. |
| `task-api/index.ts::appendAndWakeTaskOperatorMessage` | `/message` and `/inject` dispatch a wake event without any scheduler-level interrupt flag. | Correct after repair: task messages are wake facts, not cancellation commands. |
| `engine/tool-ownership.ts::completeOrchestratorToolOwnership` | Ownership completion drains queued wake events. | Correct in HEAD. |
| `engine/writer.ts::abortLiveOrchestratorToolOwnership` | Cancels sessions, aborts goal runs, closes tool parts. | Must remain explicit-cancel only. |
| `engine/runtime.ts::syncTerminalGoalRefills` | Wakes the task through `dispatchTaskLoop` from durable terminal-goal facts. | Must never abort live siblings. |

Existing targeted tests already passing on HEAD:

- `test/engine/queue.test.ts --test-name-pattern "interrupting a live-owned active task queues"`
- `test/engine/queue.test.ts --test-name-pattern "operator wake with multiple live owners"`
- `test/engine/queued-wake-ownership-drain.test.ts`
- `test/server/task-message-routes.test.ts --test-name-pattern "queues behind live build ownership"`

## Current Coverage Gap

The real user path says "append a message". HEAD has `/inject` live ownership
coverage, and queue-level multi-owner coverage, but lacks the combined route
case:

- `POST /task/:taskID/message`
- active task
- multiple live build goal runs
- multiple live orchestrator tool ownership rows
- `interrupt=true` flows through the route
- expected result: the wake is queued, no live ownership is cancelled, no goal
  run is marked aborted, and the message metadata remains durable.

This is the minimum benchmark for the reported bug.

Independent agent review found two additional gaps beyond the initial
benchmark:

- The async build path closes `orchestrator_tool_ownership` after returning
  `started`, while the `goal_run` and build session remain live. During that
  window, `/message` and `/inject` still passed `interrupt: true` to
  `dispatchTaskLoop`; if the root orchestrator loop was still in flight, this
  called `interruptTaskLoop`, then `Orchestrator.abort`, then the abort cascade
  cancelled descendant build sessions.
- `dispatchTaskLoop` only queued behind live ownership when
  `loopInFlightFor(taskID)` was true. That contradicted the live ownership
  invariant: ownership, not the root loop, is the scheduling boundary.

## Benchmark Definition

Input:

- A task with two running goal build attempts and two live orchestrator tool
  ownership artifacts.
- A real `POST /task/:taskID/message` request with `source` and a build-session
  `target`.

Output:

- HTTP 200 response.
- The message is persisted as a real root-session user message.
- `dispatchTaskLoop` is reached through the real route semantics.
- `interruptTaskLoop` is not called while live ownership exists.
- Both ownership rows remain live.
- Both goal runs remain `running`.

Timeout:

- Use targeted tests.
- Test waits must be activity-based when waiting for asynchronous dispatch
  calls; avoid fixed total-time assumptions for long benchmark loops.

Acceptance:

- The new `/message` multi-live-goal benchmark passes.
- Existing queue, ownership-drain, `/inject`, runtime refill, and no-decision
  tests still pass.
- A grep audit finds no generic task message path that calls
  `abortLiveOrchestratorToolOwnership` or `abortLiveExecutionForTask`.
- Independent agent review finds no remaining untested abort-on-message path.

## Forbidden Fixes

- Do not special-case message text or parse operator prose.
- Do not add fallback retries or compatibility dual paths.
- Do not make host code choose the next goal.
- Do not remove `interrupt=true` by hiding the route semantics; the queue must
  own the non-destructive interpretation.
- Do not weaken explicit `cancel_subagent`, task cancel, or restart semantics.

## Proposed Repair Sequence

1. Add the missing route-level benchmark for `POST /task/:taskID/message` with
   multiple live goal owners.
2. Run it and confirm whether HEAD passes. If it fails, repair the root cause in
   the single owner path, not by adding a route-specific bypass.
3. Audit all production imports/calls of live abort functions and ensure only
   explicit cancel/restart/shutdown/dead-owner convergence sites remain.
4. Run targeted regression suite and second review.

## Implemented Repair

The repair removes wake/cancel double meaning from scheduler dispatch:

- `dispatchTaskLoop` no longer accepts an `interrupt` field.
- `launchTaskLoop` no longer calls `interruptTaskLoop`.
- Task-level operator/system wake sources (`/message`, `/inject`,
  `replyAgentSession` fallback, `notifyTaskLineageTerminal`) append the visible
  message and schedule a non-destructive wake.
- Live `orchestrator_tool_ownership` queues a wake regardless of whether the
  root loop is currently in flight.
- Explicit cancellation paths remain separate: `cancel_subagent`, task
  cancel/restart/rewind, and task failure still use their dedicated abort
  writers or direct `interruptTaskLoop` call sites.

New failing-before-fix regressions:

- `test/engine/queue.test.ts`: live ownership queues operator wake even after
  the root loop has exited.
- `test/server/task-message-routes.test.ts`: `POST /task/:taskID/message` does
  not interrupt an async goal after ownership closes.

The scheduler interrupt parameter was deleted instead of retained as a dormant
option because keeping a generic wake-level cancellation flag would leave the
same bug class available to the next caller.
