# Session Prompt Owner Inactivity Root Repair

Date: 2026-06-28
Status: implemented

## Problem

A workflow task can remain `active` after a terminal goal refill or operator
wake is accepted, while the orchestrator session has a durable user wake
message but no following assistant message, no session error, and no next goal
dispatch.

The immediate symptom is not the worker coordination request or the reference
asset that blocked a worker merge. Those were visible facts. The deeper break
is that a prompt wake can attach to an existing `SessionPromptState` owner and
wait forever when that owner has already stopped producing activity or was
cancelled without reaching `finish()`.

## Recall

| Source | Constraint |
| --- | --- |
| `AGENTS.md` | No fallback, no hidden messages, no gate mechanism, inspect plans before edits, test every behavior change. |
| `2026-06-26-enterprise-a2a-protocol-root-repair.md` | Wake durability and queue inactivity recovery are required; no-activity timeout means since last real heartbeat, not since process start. |
| `2026-06-26-coding-assistant-stop-prompt-state-lifetime.md` | Prompt state must survive instance disposal and explicit cancellation must remain fail-loud when no matching live owner exists. |
| `session/prompt/state.ts` | `cancel()` intentionally keeps the busy slot until the owning loop calls `finish()` to avoid overlapping provider/tool stacks. |
| `orchestrator/loop.ts` | `interruptTaskLoop()` can detach the task chain when an old loop is stuck on a non-signal-aware await; the prompt owner must not reintroduce the same permanent wait. |

## Current-State Evidence

Full grep before this plan covered:

- `SessionPromptState.start`, `cancel`, `finish`, `resume`,
  `waitForFinish`, and all direct test call sites.
- `SessionPrompt.prompt`, `SessionPrompt.loop`, `runTaskLoop`,
  `interruptTaskLoop`, `dispatchTaskLoop`, `goal_refill_notification`,
  `loopInFlight`, scheduler `recover`, and `task_queue_run_timeout_ms`.
- Existing prompt-state, cancellation-scope, task-queue-service, and
  orchestrator abort-funnel tests.

Observed code behavior:

1. `SessionPrompt.prompt()` persists the user wake message before calling
   `SessionPrompt.loop()`.
2. `SessionPrompt.loop()` calls `SessionPromptState.start()`.
3. If the state map already has the session id, `start()` returns `undefined`
   and the caller appends a callback to the existing owner.
4. `SessionPromptState.cancel()` aborts the owner and rejects callbacks that
   existed at cancellation time, but it leaves the busy slot in place.
5. A later prompt attached after cancellation adds a new callback that no
   cancellation path will reject until the old owner calls `finish()`.

That last point is the indefinite wait: durable input exists, but the caller is
parked behind an owner that has no guaranteed completion path.

## Decision

Add explicit owner state to `SessionPromptState`:

- Track owner creation time, last activity time, and cancellation time on the
  prompt-state entry.
- Route attach-through-existing-owner through a single `attach()` helper rather
  than open-coding `state(directory)[sessionID].callbacks.push(...)`.
- If the owner was already cancelled, reject new attach attempts immediately
  with a precise prompt-owner error. A cancelled owner cannot accept new wake
  callbacks.
- Keep normal active and standby owners attachable. This preserves the legal
  long-lived chat/orchestrator standby case.
- Keep `cancel()` fail-loud and keep the busy slot until owner `finish()` for
  ordinary cancellation-settle proof. This repair must not mark task cancel
  successful while the prompt state remains live.

This is not a fallback or a second prompt runner. It closes a corrupted owner
contract: once an owner is cancelled, later callers must receive an observable
error instead of waiting on a callback that can no longer be driven by that
owner.

Add an orchestrator prompt inactivity boundary:

- The inactivity window uses
  `assistant.activity.task_queue_run_timeout_ms`, the existing task-level
  activity configuration.
- The deadline resets on prompt owner activity, session status activity, and
  LLM stream activity.
- The signature covers the orchestrator session subtree, so active child agent
  work refreshes the deadline instead of being mistaken for an idle parent.
- On inactivity, the orchestrator cancels the prompt owner and lets the
  existing orchestrator error funnel write a visible
  `orchestrator-stream-error` artifact.

This is a prompt execution timeout, not a scheduler fallback. It does not
dispatch goals, invent user messages, or decide the workflow path.

## Acceptance

- A prompt attached after `SessionPromptState.cancel()` rejects immediately
  with a precise error instead of hanging.
- Existing cancellation-settle tests still prove a cancelled live prompt state
  keeps task cancellation incomplete until `finish()`.
- Normal active owner attach still works and receives `flushCallbacks()`.
- Prompt state continues to survive `Instance.disposeAll()` until explicit
  cancellation or owner finish.
- A hung orchestrator prompt records `OrchestratorPromptInactiveError` instead
  of leaving the task active with no visible result.
- Descendant session activity refreshes the orchestrator prompt inactivity
  deadline.
- Focused tests pass:
  - `bun test packages/opencorvus/test/session/prompt-state-terminal.test.ts --timeout 30000`
  - `bun test packages/opencorvus/test/session/extra-tools.test.ts --timeout 30000`
  - `bun test packages/opencorvus/test/task-api/cancel-task-abort-timeout.test.ts --timeout 30000`
  - `bun test packages/opencorvus/test/orchestrator/session-abort-funnel.test.ts --timeout 30000`
  - `bun run --cwd packages/opencorvus typecheck`
