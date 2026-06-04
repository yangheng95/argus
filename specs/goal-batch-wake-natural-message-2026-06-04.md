# Goal Batch Wake Natural Message Fix (2026-06-04)

## Problem

When all goal runs in a run reached terminal status, `EngineRuntime.syncGoalRuns`
called `OrchestratorEventNote.batchComplete(...)` and passed the resulting text
as `OrchestratorEvent.note`.

`orchestratorUserText(...)` renders `event.note` as the wake's user message, so
the runtime was creating a synthetic user-visible message such as:

```text
Goal batch complete on run ...
Read context (read_context) ...
Call query_failed_goals ...
```

This is the wrong boundary. Goal batch settlement is engine state, not an
operator-authored message. The orchestrator already receives the current task,
goal, run, and evaluation state from `describeTask` in its dynamic system
context. Prompting the model via a fake user message duplicates that source and
violates the natural-message invariant.

## Callsite Census

Full-repo grep before the change:

| Symbol / text | Callsites | Action |
| --- | --- | --- |
| `OrchestratorEventNote.batchComplete` | `packages/opencorvus/src/engine/runtime.ts` only; tests in `packages/opencorvus/test/orchestrator/event-note.test.ts` | Remove. |
| `Goal batch complete on run` | `packages/opencorvus/src/orchestrator/agent.ts`; assertions in `runtime-goal-run-convergence.test.ts` | Remove synthetic note and update tests to assert no note. |
| `read_context` / `query_failed_goals` guidance for failed goals | Already rendered by `describeTask` and orchestrator core prompt | Keep the real context surfaces; do not duplicate in `event.note`. |

## Change

- `syncGoalRuns` still wakes the orchestrator when a terminal goal batch settles.
- It dispatches the wake without `event.note`.
- Orchestrator internal wakes with an existing user message no longer call
  `SessionPrompt.prompt`, because that API always persists a new `role=user`
  message. They install the current dynamic context in the orchestrator runtime
  contract and call `SessionPrompt.loop` directly.
- The session loop merges runtime-contract `system` into the current model
  request's system prompt. This is request context, not a persisted message.
- Remove the now-dead `batchComplete` note helper and its note-level tests.
- Update convergence/session-reuse tests to assert batch settlement does not
  synthesize a user note and internal orchestrator wakes do not append a user
  message.

## Independent Review Feedback

Independent agent review confirmed the synthetic note removal is the correct
direction, but found three incomplete edges in the first implementation:

| Finding | Repair |
| --- | --- |
| `SessionPrompt.loop` can enter standby when the newest assistant already finished, so an internal wake may not produce a new model turn. | Add an explicit one-turn runtime wake marker to the session runtime contract. The loop consumes it only when it reaches `processTurn`, so controls/compaction do not lose the wake. |
| The old persisted `lastUser.system` can be appended together with the new runtime system. | Add a runtime system mode that makes the current runtime system complete for this turn and skips the persisted user-system block. |
| Attachment inventory is gated behind user-message creation. | Build attachment inventory for every orchestrator wake. Internal wakes inject the textual inventory into runtime system context without creating hidden user messages or non-visible model-only messages. Multimodal bytes remain visible via the original persisted user file parts; adding fresh hidden file parts would violate the natural-message invariant. |

The repair deliberately does not introduce a host-side routing gate. The engine
still wakes the orchestrator naturally; the runtime contract only describes the
session turn that is already being executed.
