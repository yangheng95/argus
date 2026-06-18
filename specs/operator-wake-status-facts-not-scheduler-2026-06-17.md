# Operator Wake: Status Facts Must Not Schedule

## Problem

Startup owner-death monitoring still mutates `task`, `run`, `goal_run`, session
status, and pending tool parts. That made restarted tasks such as economy_4
look terminal before the operator could send a real continuation message.

Task message/note paths also still branch on derived lifecycle status to decide
whether to wake, which contradicts the invariant that a real operator message
is always admissible input.

## Call Point Inventory

`convergeDeadOwnerLiveExecution`

- `packages/opencorvus/src/cli/cmd/serve.ts`: startup call. Remove it; describe
  already exposes `run_orphan` / orphaned goal facts.
- `packages/opencorvus/test/engine/goal-run-owner-orphan.test.ts`: tests expect
  terminalization. Reverse them to assert no mutation.
- `packages/opencorvus/src/engine/writer.ts`: implementation currently aborts
  goal runs, runs, tasks, sessions, and tool parts. Convert to read-only
  counting for compatibility with the existing exported diagnostic surface.

Operator wake status gates

- `packages/opencorvus/src/task-api/index.ts::appendAndWakeTaskOperatorMessage`:
  currently reopens by completed/failed/cancelled branches before dispatch.
  Replace with one task-reactivation helper driven only by the real operator
  message.
- `packages/opencorvus/src/task-api/index.ts::recordOperatorNote`: currently
  returns without dispatch for completed/cancelled/no-run cases. Use the same
  reactivation helper and always dispatch.
- `packages/opencorvus/src/engine/task-message-open.ts`: removed from
  user-message and operator-note wake paths. It rewrote a blocked active run to
  `running` on ordinary operator wake. The next orchestrator pass now reads the
  blocked/error facts and decides. See the BH-110 correction below for the
  explicit retry-only exception.
- `packages/opencorvus/src/engine/goal-status.ts::deriveGoalStatus`: currently
  projects an owner-orphan live goal run as `failed`. Keep lifecycle projection
  from the persisted run status; expose orphan confidence through
  `describeGoal.is_orphaned` / `observeOrphanRuns`.
- `packages/opencorvus/src/engine/describe.ts::describeGoal`: currently
  projects an owner-orphan live goal as not running. Keep `is_running` tied to
  persisted live status and expose `is_orphaned` separately.
- `packages/opencorvus/src/task-api/index.ts::EngineService.init`: remove the
  background `engine.poll` scheduler. Runtime observation must be triggered by
  explicit user / interaction / tool paths.
- `packages/opencorvus/src/engine/runtime.ts::monitorRuns`: keep only a
  read-only observation count; do not call `syncRun` from monitor code.
- `packages/opencorvus/src/engine/runtime.ts::syncGoalRuns`: terminal goal
  batch observation must not clear blocked runs or call `dispatchTaskLoop`.
  Record an observed batch fact only.
- `packages/opencorvus/src/engine/runtime.ts::syncRun`: remove executor queue
  polling, stale interaction auto-rejection, inactivity failure, and
  blocked/running/completed/failed run writes. `syncRun` is an observation
  surface, not a lifecycle state machine.
- `packages/opencorvus/src/engine/per-run-state.ts`: delete the leftover
  in-memory "executor completed notified once" set. Runtime polling no longer
  produces that notification, so keeping the module would preserve a dead
  scheduling state machine.
- `packages/opencorvus/src/engine/goal-status.ts::deriveGoalStatus`: terminal
  tips with `superseded_reason` must keep their persisted lifecycle projection
  (`passed` / `failed` / `pending` for aborted). `superseded_reason` is retry
  intent evidence for the LLM, not a hidden `pending` dispatch state.
- `packages/opencorvus/src/orchestrator/scheduler.ts::isRunReadyForGoalDispatch`:
  delete the run-status dispatch helper. Goal build already creates or
  activates the required coordinator run explicitly; a second status
  admission helper is a scheduler gate.
- `packages/opencorvus/src/engine/workflow.ts::projectGoalSteps`: owner-orphan
  confidence must not project workflow step/phase status to `failed`.
- `packages/opencorvus/src/engine/describe.ts::buildCollaborationClosure`:
  owner-orphan confidence must not enter `dispatchable_goal_ids`. The
  orchestrator still sees the `ORPHANED` fact and may explicitly call `build`.
- `packages/opencorvus/src/engine/queue.ts` and
  `packages/opencorvus/src/orchestrator/loop.ts` contained terminal guards.
  Remove those guards; task status is not a scheduler admission rule.
- `packages/opencorvus/src/orchestrator/agent.ts::processTask`: remove the
  terminal-task early return. The orchestrator can read terminal status as
  context and decide.
- `packages/opencorvus/src/orchestrator/tools.ts`: remove build/add_goal
  rejection branches that refuse solely because the task is terminal. Tools may
  still fail on real missing run/spec/goal data.

## Acceptance

- Server startup does not terminalize active tasks for dead owners.
- Dead-owner/orphan facts remain visible through describe/orphan projections.
- Goal lifecycle projection is not changed to failed or not-running only
  because an owner is dead; owner-death remains a confidence/fact channel.
- A user/operator message or note wakes a failed/completed/cancelled/active task.
- A user/operator message, note, or retry does not rewrite a blocked run to
  `running`.
- Runtime monitoring is registered only as the narrow `engine.liveness`
  scheduler, not as the old broad `engine.poll` poller.
- `monitorRuns` calls `syncRun` only for non-completed tasks' active live runs.
- A no-live-goal snapshot wakes the task loop and records a liveness fact
  without changing parent run status.
- `syncRun` does not poll executor queues, auto-reject stale interactions, or
  write run lifecycle status.
- The removed executor-completion notification set has no production import or
  standalone regression test.
- `superseded_reason` remains visible as `needs_redispatch` evidence but does
  not change `goalStatusByID` to `pending` and does not enter
  `dispatchable_goal_ids`.
- Goal build run creation has no `isRunReadyForGoalDispatch` status gate.
- Owner-orphan goals are not listed as dispatchable solely because of orphan
  confidence.
- `dispatchTaskLoop`, `runTaskLoop`, `Orchestrator.processTask`, build, and
  add_goal do not reject solely because a task is terminal.
- Tests assert the above behavior.

## Codex review correction: no-live-goal liveness wake

User correction on 2026-06-18: the intended removal is not the periodic
liveness signal itself. The required behavior is:

- when a task is not terminal;
- and its active run has zero live goal runs, including the case where no goal
  run was ever created;
- and there is no pending interaction blocking the run;
- the periodic engine liveness tick must check that state and wake the task
  loop once, because the scheduling process may have died after the child goal
  finished.

This is not the old executor queue polling path. The corrected boundary is:

| Surface | Decision |
| --- | --- |
| `EngineService.init` | Register a narrow `engine.liveness` scheduler tick. Do not restore the old `engine.poll` name or broad runtime poll semantics. |
| `EngineRuntime.monitorRuns` | Observe live active runs and call `syncRun`; `syncRun` remains limited to no-live-goal liveness. |
| `syncRun` | Must not call executor status, auto-reject stale interactions, write run lifecycle status, or fail inactive runs. |
| `syncNoLiveGoalRuns` | If a live parent run has zero live goal runs and no pending interaction exists, call `dispatchTaskLoop({ taskID })`. Record a liveness fact only after the dispatch starts so the same no-live-goal snapshot is not woken repeatedly. |
| `TaskQueueService` | Keep the A2A prompt queue on explicit enqueue/completion drains only. Do not restore `task-queue-service.poll` or `retrying`. |

Revised acceptance:

- `engine.poll` remains absent.
- `engine.liveness` is registered at `ORCHESTRATOR_POLL_INTERVAL_MS`.
- `monitorRuns` does not poll executor queue status.
- A non-terminal task whose active run has zero live goal runs wakes the task
  loop once and records a liveness fact.
- Repeating the same no-live-goal snapshot does not wake again; appending a new
  terminal goal-run snapshot changes the fingerprint and can wake again.
- Task queue background polling remains absent.

## BH-110 correction: explicit retry remains a retry control

The original acceptance line grouped user messages, operator notes, and retry
under the same blocked-run rule. BH-110 split the public controls:

- user/operator messages and operator notes still do not rewrite a blocked run
  to `running`;
- `retryTask(...)` is the explicit retry control and may clear a stale blocked
  active run when no pending interaction owns the block;
- `replanTask(...)` must not use that retry reopen path, and instead supersedes
  active plans before dispatching structured `operatorIntent.kind="replan"`.
