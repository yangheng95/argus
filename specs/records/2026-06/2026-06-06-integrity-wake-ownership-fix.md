# Integrity Wake Ownership Fix (2026-06-06)

## Problem

Task `tsk_e987284d100125psjCzCMhnDbd` produced multiple real `integrity`
tool calls from the same orchestrator session. This was not a card projection
bug. The database contained four running `integrity` tool parts, each spawning
its own supervisor/reviewer sessions.

Two lifecycle facts were missing or unstable:

1. `EngineRuntime.syncGoalRuns` used a process-local `goalBatchNotifications`
   map and a terminal-batch fingerprint that included mutable append-only
   timestamps. Repeated terminal `goal_run_attempt` append rows could look like
   new terminal batches, and process restart lost the notification entirely.
2. `orchestrator_tool_ownership` only represented `build`. Queue wake
   serialization therefore could not see a running task-scoped `integrity`
   tool call, even though `integrity` is an orchestrator tool with a real
   persisted message part and long-running child sessions.

## Callsite Census

Full-repo grep before implementation:

| Surface                                                     | Callsites                                                                                                                               | Decision                                                                                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `goalBatchNotifications`                                    | `packages/opencorvus/src/engine/runtime.ts` only                                                                                        | Replace process-local wake notification with durable `engine_artifact` rows.                                             |
| `terminalGoalBatchFingerprint`                              | `packages/opencorvus/src/engine/runtime.ts`; tests in `runtime-goal-run-convergence.test.ts`                                            | Fingerprint logical terminal batch identity: `goal_run_id + status`, not mutable timestamps.                             |
| `orchestrator_tool_ownership`                               | `engine/tool-ownership.ts`, `engine/queue.ts`, build callsites in `orchestrator/tools.ts`, tests in `queue.test.ts` and `tools.test.ts` | Generalize ownership payload to `tool_name: "build"                                                                      | "integrity"` while preserving build-specific helpers. |
| `requireOrchestratorToolExecutionContext`                   | `orchestrator/tools.ts` build path only                                                                                                 | Use the same real message/tool-part identity for integrity ownership.                                                    |
| `reviewIntegrity()`                                         | `orchestrator/tools.ts`, `integrity/team-agent.ts`, integrity tests                                                                     | Use its existing `onSessionCreated` callback to open ownership after the real supervisor session exists.                 |
| `dispatchTaskLoop({ interrupt: true })` with live ownership | `engine/queue.ts`; test currently expects replacement wake                                                                              | Align with 2026-05-21 independent review: queue the wake behind live ownership instead of interrupting a tool in flight. |

## Design

- Add durable `engine_artifact kind="goal_batch_notification"` after a terminal
  goal batch wake has been successfully dispatched. A later sync with the same
  logical terminal batch reads this artifact and does not wake again.
- `dispatchTaskLoop` returns whether a wake was actually started, queued behind
  live ownership, or ignored. `syncGoalRuns` only records the notification for
  `started`; queued/ignored outcomes remain retryable by the next real sync.
- Keep later terminal batches valid: if a new logical `goal_run_id` appears
  under the same run, the fingerprint changes and a new wake is emitted.
- Extend orchestrator tool ownership to include `integrity` as a task-scoped
  owned tool. The ownership row uses the real orchestrator session id, message
  id, tool call id, tool part id, and the real integrity supervisor session id.
- Stamp ownership rows with `processOwner()` so a restarted process does not
  treat foreign live ownership as current-process work.
- Queue active-task wakes behind any current-process live ownership, including
  operator interrupts. The host is not choosing the next workflow action; it is
  preserving the atomicity of a tool call already accepted by the model.

## Tests

- `runtime-goal-run-convergence.test.ts`: same logical terminal goal batch with
  later append-only timestamp rows must not wake again.
- `queue.test.ts`: `interrupt: true` while a live ownership row exists must not
  start a replacement loop; the queued wake runs after ownership closes.
- `tool-ownership` coverage through queue tests uses both build-compatible
  default payloads and integrity-capable generic payload shape.

## Non-Goals

- Do not add UI folding or duplicate-card suppression.
- Do not add prompt wording that tells the model not to call `integrity` twice.
- Do not add a route bypass, keyword gate, or workflow state machine.
