# Wake Causality, Agent Retry, Mission, And Scheduler

Date: 2026-06-12

## Problem Statement

After the agent retry/finalizer-recovery refactor, Mission appears to be woken
too often. The first explanation framed the symptom as a Mission terminal-state
problem. That framing is wrong:

- Mission is a long-running coordinator session, not a terminal object.
- Scheduler is a delivery mechanism, not a terminal object.
- Terminal lifecycle belongs to engine task/run/goal_run rows and worker
  sessions, not to Mission or scheduler.

The real problem is a causality boundary failure. Wake events are appended as
ordinary user messages, but the durable message does not say why it exists. At
the same time, the current agent-runner diff added an internal same-session
finalizer recovery loop even though the existing same-session recovery spec
requires visible continuation through an explicit continuation artifact. That
makes the observable system hard to audit: we can see Mission was woken, but
not whether it came from a user Mission prompt, cron, event, task_queue, a child
task result, or an internal retry/recovery path.

## Evidence From Full-Repo Grep

### SessionWake Call Sites

| Caller                    | File                                                 | Current behavior                                                                                                         | Risk                                                                                                   |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Mission HTTP route        | `packages/opencorvus/src/server/routes/mission.ts`   | `POST /mission/wake` ensures a mission session and calls `SessionWake.wake({ agent: "mission" })`.                       | Correct entry, but the resulting user message has no persisted wake source.                            |
| Mission-owned task result | `packages/opencorvus/src/task-api/index.ts`          | `notifyTaskLineageTerminal` calls `SessionWake.wake({ agent: "mission" })` with a `Mission task terminal update` prompt. | Correct to notify Mission of dispatched task results, but source/reason is only embedded in free text. |
| Cron scheduler            | `packages/opencorvus/src/scheduler/cron-service.ts`  | Due cron jobs call `SessionWake.wake`, then update `last_run` / `next_run` or disable one-shot jobs.                     | Lease exists, but no durable per-fire record ties one wake message to one cron fire.                   |
| Event scheduler           | `packages/opencorvus/src/scheduler/event-service.ts` | Matching events call `SessionWake.wake`, then update `last_run` / `last_event`.                                          | Running guard is in memory; failures do not write a delivery fact; event storms are hard to audit.     |

No production `SessionWake.wake` call exists in `packages/opencorvus/src/agent`
or `packages/opencorvus/src/build`. Agent finalizer recovery is therefore not a
direct Mission wake source. Its impact is indirect: it changes worker-session
completion/failure timing and can increase downstream task-result messages.

### Agent Retry / Finalizer Recovery

Current diff in `packages/opencorvus/src/agent/runner.ts` adds:

- `FINALIZER_RECOVERY_ATTEMPTS = 1`
- `Worker Finalizer Recovery` prompt generation
- a loop that calls `SessionPrompt.prompt` again when terminal tool or
  StructuredOutput is missing

This conflicts with `specs/new-arch/2026-06-11-subagent-finalizer-recovery.md`,
which says:

- finalizer misses must be visible continuations, not hidden internal recovery;
- the orchestrator should receive a typed continuation-ready result;
- recovery must be driven by an explicit continuation artifact and same-session
  re-dispatch.

The hidden runner loop is not a Mission wake by itself, but it is still a bad
boundary because it creates an extra model turn that is not selected by the
orchestrator and not tied to a visible continuation request.

### Existing Wake-Reason Shape

`session_control_record.kind` already includes `"wake_reason"` in
`packages/opencorvus/src/session/session.sql.ts`, and
`SessionControl.Kind` includes it in `packages/opencorvus/src/session/control.ts`.
However, `SessionWake.wake` never writes a `wake_reason`, and
`session/loop.ts` treats only `compaction_request` / `manual_summarize` as
actionable controls. A pending `wake_reason` would currently be failed as an
unsupported control.

This means the project already has the beginning of a durable wake-reason
surface, but it is not connected to the wake entry point.

### Scheduler Delivery Shapes

| Scheduler  | File                                                      | Persistence today                                                                      | Gap                                                                                                                            |
| ---------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| cron       | `packages/opencorvus/src/scheduler/cron-service.ts`       | Job row stores lease, `last_run`, `next_run`, `failure_count`, `last_error`.           | No individual fire id or message id; one job row is overwritten across fires.                                                  |
| event      | `packages/opencorvus/src/scheduler/event-service.ts`      | Job row stores `last_run`, `last_event`, enabled flag.                                 | No per-event delivery fact; failed wake leaves no successful delivery row and only logs the error.                             |
| task_queue | `packages/opencorvus/src/scheduler/task-queue-service.ts` | `a2a_task_queue` rows store queued/retrying/running/completed/failed prompt execution. | It bypasses `SessionWake` and calls `SessionPrompt.prompt`, so it has execution facts but no common wake-causality vocabulary. |

## Root Causes

1. **Wake messages lack structured causality.**
   `SessionWake.wake` appends a normal user message with text only. All callers
   lose their typed source once the message is written.

2. **Runner hidden finalizer recovery violates visible continuation design.**
   The new automatic recovery loop is a host-side extra model turn. The existing
   spec requires the same-session continuation to be visible and explicitly
   chosen by the orchestrator through a continuation artifact.

3. **Scheduler delivery facts are not a single surface.**
   Cron/event/task_queue all deliver prompts but expose different facts. Cron
   and event cannot answer "which exact wake message came from which exact
   scheduler fire?" without reading logs and free text.

4. **Mission child-result wake is text-coupled.**
   `Mission task terminal update` is a real and valid Mission input, but its
   durable source is free text rather than structured provenance. That makes it
   easy to misdiagnose repeated wakes as Mission behavior instead of upstream
   delivery behavior.

5. **`wake_reason` exists but is currently dead wiring.**
   Adding a second wake-log table would create another source. The existing
   `session_control_record` kind should either be connected or removed; given
   the current need, connect it.

## Non-Goals

- Do not add Mission terminal states.
- Do not add scheduler terminal states beyond existing scheduler job/task row
  statuses.
- Do not add cooldown/debounce/gate logic to hide frequent wakes.
- Do not make Mission ignore valid user messages.
- Do not key behavior off free-text matching such as `Mission task terminal
update`.
- Do not create a parallel wake history table while `wake_reason` exists.

## Design

### 1. Make Wake Causality A First-Class Input To SessionWake

Extend `SessionWake.WakeInput` with a typed `reason`:

```ts
type WakeReason =
  | {
      source: "mission.operator"
      missionID: string
      route: "/mission/wake"
    }
  | {
      source: "mission.child_task_result"
      missionID: string
      taskID: string
      taskStatus: "completed" | "failed" | "cancelled"
    }
  | {
      source: "scheduler.cron"
      jobID: string
      fireID: string
    }
  | {
      source: "scheduler.event"
      jobID: string
      fireID: string
      eventType: string
    }
  | {
      source: "scheduler.task_queue"
      queueTaskID: string
    }
```

`SessionWake.wake` must persist that reason beside the user message. The single
source should be the visible user message plus a consumed wake control:

- write the user `message` with `extra.wake_reason`;
- write `session_control_record(kind="wake_reason")` with status `consumed`,
  payload containing the same reason plus `message_id`.

The message is the visible conversation fact. The control row is the queryable
audit index. They are not two competing sources because the control payload is
anchored to `message_id` and created in the same wake operation.

Implementation detail: `SessionControl.create` should set `time_consumed` when
called with `status: "consumed"`. Pending `wake_reason` records should not be
introduced; otherwise `session/loop.ts` will fail them as unsupported controls.

### 2. Thread Reasons Through All Wake Callers

| Caller                                         | Required reason                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| `server/routes/mission.ts`                     | `{ source: "mission.operator", missionID, route: "/mission/wake" }`      |
| `task-api/index.ts::notifyTaskLineageTerminal` | `{ source: "mission.child_task_result", missionID, taskID, taskStatus }` |
| `cron-service.ts`                              | `{ source: "scheduler.cron", jobID, fireID }`                            |
| `event-service.ts`                             | `{ source: "scheduler.event", jobID, fireID, eventType }`                |

For `task_queue`, do not force it through `SessionWake` because it already owns
queued prompt execution through `SessionPrompt.prompt`. Instead, add equivalent
`extra.wake_reason` to the queued prompt user message in
`TaskQueueService.executePrompt` / stored prompt input, with
`source: "scheduler.task_queue"` and `queueTaskID`.

### 3. Add Per-Fire IDs Without A New Scheduler State Machine

Cron/event need a fire id for evidence, not a flow gate:

- generate `fireID = Identifier.ascending("wake_fire")` immediately before the
  wake call;
- include it in `SessionWake.reason`;
- store it in the wake control payload and logs;
- optionally store `last_fire_id` in the existing job row only if schema reset
  is acceptable under project rules.

No cooldown or debounce is added. If a cron really fires every minute, it should
produce one fire id per minute. If it fires ten times, the audit trail must show
ten distinct causes.

### 4. Revert Hidden Runner Finalizer Recovery

Align `packages/opencorvus/src/agent/runner.ts` with
`specs/new-arch/2026-06-11-subagent-finalizer-recovery.md`:

- remove the internal `FINALIZER_RECOVERY_ATTEMPTS` loop;
- keep typed detection helpers if useful;
- surface finalizer misses as typed errors / continuation-ready tool results;
- use explicit `stage_continuation_request` artifacts for same-session
  recovery.

This restores the boundary: agent protocol recovery is a visible continuation
decision, not a hidden runner retry.

### 5. Preserve Mission Semantics

Mission should still wake for:

- a user Mission prompt from `/mission/wake`;
- a real result from a task it dispatched;
- an explicit scheduler delivery targeted at its session.

Mission should not need special logic to suppress or classify these. The
orchestrator/Mission prompt can read structured wake source if needed, but the
host should not gate Mission behavior.

### 6. Improve Diagnostics

Add read/query helpers:

- list recent wake reasons for a session;
- list recent wake reasons by source;
- include `wake_reason.source` in session/message debug routes used by overlay
  diagnostics.

The operator-facing answer to "why was Mission woken?" should come from DB:

```text
message msg_xxx
source mission.child_task_result
missionID abc
taskID tsk_123
taskStatus failed
```

not from logs or prompt text.

## Risks And Hidden Failure Modes

| Risk                                       | Why it matters                                                         | Mitigation                                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wake_reason` pending records fail in loop | `session/loop.ts` only treats compaction controls as actionable.       | Store wake reasons as consumed audit records, not pending controls.                                                                                                 |
| Two-source audit                           | Message `extra` and control payload can drift.                         | Create both in the same `SessionWake.wake` operation and anchor control to `message_id`. Tests assert equality.                                                     |
| Scheduler fire lost after failed wake      | Cron/event currently update durable state only after wake success.     | Record fire attempt reason before/with wake if audit of failures is required; otherwise at minimum log reason with `fireID`.                                        |
| Hidden agent recovery remains              | Current runner diff conflicts with existing spec.                      | Revert automatic loop and implement explicit continuation artifact path.                                                                                            |
| Free-text coupling remains                 | Child-result prompt text contains task facts but no structured source. | Put taskID/status/missionID in `WakeReason`; keep text for model readability.                                                                                       |
| TaskQueue excluded from wake audit         | It does not use `SessionWake`.                                         | Stamp `scheduler.task_queue` reason on queued prompt user messages and expose it through the same message debug surface.                                            |
| Event job duplicate after restart          | `EventService.running` is in memory.                                   | Do not hide duplicates; make each delivery auditable with `fireID`. Later dedupe can be data-integrity based on explicit event id if the event source provides one. |

## Test Plan

### SessionWake

- `SessionWake.wake` persists a user message with `extra.wake_reason`.
- `SessionWake.wake` creates a consumed `wake_reason` control anchored to the
  same `message_id`.
- Existing wake behavior still wakes a standby loop through `message.updated`.
- A consumed `wake_reason` control is not returned by `SessionControl.pending`.

### Mission

- `POST /mission/wake` writes `source=mission.operator` with mission id.
- Mission child task result writes `source=mission.child_task_result`, task id,
  mission id, and task status.
- Mission list/status routes remain unchanged; no Mission terminal state is
  added.

### Scheduler

- Cron due job writes a `scheduler.cron` wake reason with job id and fire id.
- Event job writes a `scheduler.event` wake reason with job id, fire id, and
  event type.
- TaskQueue prompt execution stamps `scheduler.task_queue` reason with queue
  task id.
- Cron one-shot failure still does not disable the job; on later success the
  wake reason exists.
- Event job failure does not block other jobs; successful jobs have distinct
  fire ids.

### Agent Runner

- runner no longer performs hidden finalizer recovery.
- terminal tool miss remains typed.
- StructuredOutput miss remains typed.
- protocol-level miss creates/returns a continuation-ready result through the
  explicit continuation artifact path defined in
  `2026-06-11-subagent-finalizer-recovery.md`.
- provider non-retryable errors do not produce continuation.

### Message Flow

- For each wake source, the visible user message exists in the session
  transcript.
- The wake reason query returns the same message id.
- No test relies on keyword matching the prompt text to determine wake source.

## Implementation Order

1. Revert the hidden finalizer recovery loop in `agent/runner.ts` and restore
   the explicit continuation design from the 2026-06-11 spec.
2. Extend `SessionWake.WakeInput` with `reason` and persist message
   `extra.wake_reason` plus consumed `wake_reason` control.
3. Thread reasons through Mission HTTP, Mission child-task result, cron, and
   event.
4. Add equivalent `scheduler.task_queue` reason stamping for queued prompt
   execution.
5. Add wake reason query/debug helpers.
6. Add tests in the order listed above.

## Acceptance Criteria

- The answer to "why was this Mission woken?" is available from SQLite without
  log scraping.
- Mission and scheduler are not modeled as terminal entities.
- No cooldown, debounce, or gate is introduced to reduce wake frequency.
- Hidden runner finalizer recovery is removed; same-session recovery is visible
  and explicit.
- Every wake source has a typed, test-covered causality record.
