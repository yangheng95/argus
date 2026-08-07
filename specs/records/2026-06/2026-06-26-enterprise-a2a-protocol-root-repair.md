# Enterprise A2A Protocol Root Repair

Date: 2026-06-26
Status: implementation contract

## Goal

Build an enterprise-grade internal A2A (Agent-to-Agent) protocol for
OpenCorvus task workers and the task orchestrator. The protocol must be
durable, request-bound, idempotent, recoverable, and observable end to end.

This supersedes the weak parts of
`2026-06-24-a2a-agent-lifecycle-coordination.md`; that earlier note introduced
the request/response surface but did not fully solve atomicity, durable wake,
timeout ownership, direct-reply fallback, malformed artifact visibility, or
conversation/SSE replay.

## Recall

| Source                                                               | Constraint                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                          | No fallback, no double source, no hidden/synthetic messages, no gate mechanism, no state-machine-style host routing, inspect plans before edits, test every behavior change.                                                          |
| `specs/current/architecture/13-agent-communication-matrix.md`                    | Current communication is still a hybrid of orchestrator tools, build tools, task subagents, channel ingress, and direct task messages. A2A must become the canonical durable mailbox for worker-to-orchestrator scheduling decisions. |
| `specs/records/2026-06/2026-06-24-a2a-agent-lifecycle-coordination.md`      | Introduced `request_orchestrator_decision` and `respond_agent_coordination`, but current implementation leaves half-commit, weak wake, and visibility gaps.                                                                           |
| `specs/records/2026-06/2026-06-24-remove-steer-subagent-tool.md`            | `steer_subagent` must not remain as a compatibility surface or replacement probe.                                                                                                                                                     |
| `specs/records/2026-06/2026-06-22-build-terminal-finalizer-continuation.md` | `stage_continuation_request` is a narrow same-session finalizer recovery artifact. Reuse its durable claim lessons, not its scope.                                                                                                    |
| `specs/README.md`                                                    | Historical notes are evidence unless explicitly marked current. This file is the current implementation contract for the enterprise A2A repair.                                                                                       |

## Current-State Evidence

Full grep before writing this contract covered:

- `request_orchestrator_decision`, `respond_agent_coordination`,
  `agent_coordination_request`, `agent_coordination_response`,
  `agent.coordination.*`, `steer_subagent`, and `stage_continuation_request`
  across `packages/opencorvus/src`, `packages/opencorvus/test`, and `specs`.
- `queued_operator_wake`, `queuedTaskEvents`, `enqueueTaskEvent`,
  `dispatchTaskLoop`, `recordOperatorNote`, `startQueuedTaskNow`,
  `claimQueuedTaskForCwd`, `drainPendingQueuedOperatorWakes`,
  `appendRestartMessagesForActiveTasks`, `task_queue_run_timeout_ms`, and
  `recover(` across source and tests.
- `replyAgentSession`, `appendDirectAgentSessionReply`,
  `directReplyRouteToTaskWake`, `overlay_agent_session_reply`,
  `BuildSessionDirectReplyError`, `SessionRuntimeContractMissingError`, and
  `overlay_direct_reply` across source and tests.
- `task_report`, `TaskReport`, `task.report`, `TaskReportTool`,
  `ProtocolStore.appendEvent`, `ProtocolStore.dispatchEphemeral`,
  `task.messages.changed`, `message.part.delta`, `session.status`, and
  `conversation/events` across source and tests.

## Defects to Repair

| Priority | Surface                                         | Current evidence                                                                                                                                                                                                                                         | Required replacement                                                                                                                                                                                                                      |
| -------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | `respond_agent_coordination`                    | `continue` appends a worker message and starts `SessionPrompt.loop` before the request is atomically claimed by `createAgentCoordinationResponse`. `cancel_worker` aborts before the response claim.                                                     | Claim the pending request first, persist the response/action identity, then perform exactly one visible action tied to that identity. No worker side effect may happen before claim.                                                      |
| P0       | `TaskQueueService` inactivity timeout           | `recover()` only runs inside `drainReadyTasks()` / `run()`. A silent running row is not recovered until another drain trigger.                                                                                                                           | Own a real no-activity timeout from the last heartbeat/touch. It must fire without requiring another enqueue/runNow/completion event.                                                                                                     |
| P1       | `request_orchestrator_decision` wake provenance | Durable queued wakes now cover operator messages, operator intents, coordination requests, lifecycle facts, and generic orchestrator events, but the persisted wake payload must be auditable without inferring its enqueue context from process memory. | Every accepted coordination wake behind ownership must be durable, visible, and include task/process/instance provenance so replay can prove where the wake was accepted.                                                                 |
| P1       | request creation                                | Current duplicate detection is one pending request per session and throws. `message_id` is stored but not used as an idempotency key.                                                                                                                    | Same message/tool-call replay returns the same request if payload matches. Different requests are distinct mailbox entries; no artificial one-pending-per-session gate.                                                                   |
| P1       | response decisions                              | `ask_user`, `redispatch`, and `fail_task` consume the request and then tell the orchestrator to call another tool in the same turn.                                                                                                                      | A request is consumed only by a concrete visible action already executed or durably linked. If a decision requires `question`, a worker tool, or `fail_task`, the action and response must be one observable chain, not a prompt promise. |
| P1       | task-owned handle binding                       | Request creation accepts session tree, live ownership, or goal-run ownership. Response validation falls back to session tree through `taskIDForSession`.                                                                                                 | Request create, response validate, continue, cancel, and redispatch use the same task-owned agent handle resolver.                                                                                                                        |
| P1       | malformed artifacts                             | `normalizeAgentCoordinationRequestPayload()` returns `undefined`; list/find silently hide corrupt rows.                                                                                                                                                  | Malformed A2A artifacts must be visible diagnostics. They must not disappear from prompt, event, API, or cancellation paths.                                                                                                              |
| P1       | direct reply fallback                           | `replyAgentSession()` catches structural direct-reply errors and rewrites the message into task-root wake.                                                                                                                                               | Structural direct-reply failures surface as precise errors. Operator-to-agent direct reply remains separate from scheduler A2A and never spoofs task-root input.                                                                          |
| P1       | `task_report`                                   | `TaskReportTool` publishes `task.report` on `Bus`, but it is not projected into durable protocol events, task conversation, SSE, or replay.                                                                                                              | Either make `task_report` a first-class observable status event or remove it from A2A semantics. It cannot remain a silent third channel.                                                                                                 |
| P1       | `startQueuedTaskNow`                            | `claimQueuedTaskForCwd()` does not check same-cwd active tasks; tests currently pin starting a clicked task even while another same-cwd task is active.                                                                                                  | Same-cwd queue serialization is invariant for every claim path unless the user explicitly authorizes an interrupting lifecycle action.                                                                                                    |
| P1       | restart liveness                                | Liveness writes `server_restart` / `请继续执行剩余任务` operator text and wakes active tasks.                                                                                                                                                            | Restart/orphan evidence must be a lifecycle fact, not a synthetic operator message.                                                                                                                                                       |
| P2       | response audit identity                         | `requireOrchestratorToolExecutionContext()` accepts non-empty metadata strings without proving the task orchestrator turn.                                                                                                                               | Response audit fields must bind to the actual task orchestrator session/message or fail visibly.                                                                                                                                          |
| P2       | message bridge                                  | Bridge errors can return/drop/log-only or filter foreign-key failures.                                                                                                                                                                                   | Bridge failures that affect task conversation or A2A visibility must become diagnostic protocol events or explicit errors.                                                                                                                |
| P2       | route tests                                     | Existing tests cover `ProtocolStore` and `task.messages.changed` more than actual A2A child message SSE/replay.                                                                                                                                          | Add HTTP route tests for live child `message.updated`, `message.part.delta`, `session.status/error`, and A2A event replay.                                                                                                                |

## Protocol Contract

### Artifact Model

The canonical mailbox is durable artifact-backed data:

- `agent_coordination_request`
- `agent_coordination_response`
- `agent_coordination_action`

`agent_coordination_action` is the durable bridge between a response and the
visible side effect it performs. It is not a hidden state machine. It is the
audit record for exactly one observable action:

- `continue_worker`
- `cancel_worker`
- `ask_user`
- `redispatch_worker`
- `fail_task`

Every action stores `request_id`, `response_id`, `task_id`, the target
task-owned handle, action-specific visible artifact ids, and final observable
outcome. If the action cannot be executed, the failure is itself visible and
the request must remain actionable from the orchestrator prompt.

### Request Idempotency

Request creation uses a stable idempotency key:

```ts
task_id + session_id + message_id + tool_call_id_or_part_id
```

If the same key is replayed with the same semantic payload, return the existing
request row and do not emit duplicate events. If the same key is replayed with
different payload, fail loudly with a visible protocol error. A different
message/tool call may create another pending request for the same worker
session; the orchestrator prompt must list them in deterministic created-time
order.

### Response Atomicity

Response handling has one ordering:

1. Resolve and validate the pending request through the shared task-owned
   handle resolver.
2. Atomically claim the request and insert response/action rows in the same DB
   transaction.
3. Execute the visible action referenced by the action row.
4. Persist the action result and emit protocol events.

No worker message append, worker loop resume, worker cancellation, question,
redispatch, or task failure may happen before step 2.

### Visible Decisions

`continue_worker` appends one visible user message to the worker session and
resumes that same session only when its runtime contract validates.

`cancel_worker` closes the request's task-owned worker handle, including
session subtree, goal-run session, live ownership, active run, and queued
prompt handles collected by the shared resolver.

`ask_user` creates a real task interaction through the existing question
surface and links that interaction id to the action. The request is not
considered fully resolved until the user answer is visibly available or the
question is rejected.

`redispatch_worker` links the response to the concrete worker tool call or
goal-run redispatch artifact. It must not rely on a plain-text instruction that
the orchestrator should call another tool later.

`fail_task` links the response to the actual task failure artifact/event. It
must not mark the coordination request responded before the task failure action
exists.

### Wake Durability

`dispatchTaskLoop()` may keep ephemeral in-process entries for already-live
loops, but an accepted A2A or operator note wake behind live ownership must
also have a durable `queued_operator_wake`-style artifact or its replacement.

Durable wake payload must include enough causality to recover after process
restart:

- wake id;
- task id;
- source kind (`coordination_request`, `operator_message`, `operator_note`,
  `cron_wait`, etc.);
- request id or message id when available;
- event note;
- created time;
- owner/process provenance.

### Inactivity Timeout

`task_queue_run_timeout_ms` means elapsed time since last real activity, not
elapsed time since process start and not elapsed time until another drain.

The owner of a running queue row must schedule or refresh a wake from the last
heartbeat/touch. Valid heartbeat sources are actual message part deltas,
message part updates, or explicit queue progress touches. A timeout marks the
row terminal, cancels the prompt, emits a session error, and drains the queue
without requiring another user/operator event.

### Observable Projection

Every A2A request, response, action, cancellation, malformed artifact, bridge
visibility failure, and structural direct-reply failure must be visible in at
least one durable task protocol event and reflected by task conversation
hydrate or replay.

Worker continuation message content remains single-sourced in the `message` /
`part` tables. Live SSE must carry child session `message.updated` events for
worker continuation; hydration reconstructs that message from the message
tables. Durable `conversation/events` replay reconstructs A2A artifacts and
session lifecycle facts from `protocol_event`; it must not persist duplicate
message snapshots.

Worker terminal/error lifecycle is durable protocol state: live SSE, hydration,
and `conversation/events` replay must all expose `session.status` /
`session.error` facts after reconnect.

## Implementation Matrix

| Area                              | Files to change                                                                                                                                                                                             | Tests to add/update                                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A2A artifact helpers              | `packages/opencorvus/src/engine/agent-coordination.ts`, `packages/opencorvus/src/engine/engine.sql.ts`, `packages/opencorvus/src/engine/model.ts`                                                           | `packages/opencorvus/test/engine/agent-coordination.test.ts`                                                                                                                          |
| Orchestrator response tool        | `packages/opencorvus/src/orchestrator/tools.ts`                                                                                                                                                             | `packages/opencorvus/test/orchestrator/tools.test.ts`                                                                                                                                 |
| Worker request tool               | `packages/opencorvus/src/tool/request-orchestrator-decision.ts`                                                                                                                                             | `packages/opencorvus/test/tool/request-orchestrator-decision.test.ts`                                                                                                                 |
| Shared task-owned handle resolver | `packages/opencorvus/src/engine/task-agent-lifecycle.ts`, `packages/opencorvus/src/engine/execution-abort.ts`, `packages/opencorvus/src/engine/writer.ts`, `packages/opencorvus/src/task-api/index.ts`      | `packages/opencorvus/test/task-api/cancel-task-live-ownership.test.ts`, new lifecycle resolver tests                                                                                  |
| Queue wake durability             | `packages/opencorvus/src/engine/queue.ts`, `packages/opencorvus/src/task-api/index.ts`, `packages/opencorvus/src/scheduler/cron-service.ts`                                                                 | `packages/opencorvus/test/engine/queued-wake-ownership-drain.test.ts`, `packages/opencorvus/test/engine/queue.test.ts`, `packages/opencorvus/test/engine/task-message-revive.test.ts` |
| Real inactivity timeout           | `packages/opencorvus/src/scheduler/task-queue-service.ts`, `packages/opencorvus/src/engine/config.ts`                                                                                                       | `packages/opencorvus/test/scheduler/task-queue-service.test.ts`                                                                                                                       |
| Direct-reply no-fallback          | `packages/opencorvus/src/task-api/index.ts`, `packages/opencorvus/src/orchestrator/direct-reply.ts`, server error schema if needed                                                                          | `packages/opencorvus/test/server/reply-error-taxonomy.test.ts`, `packages/opencorvus/test/server/task-conversation-routes.test.ts`                                                    |
| `task_report` projection          | `packages/opencorvus/src/tool/task-report.ts`, `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts`, `packages/opencorvus/src/engine/model.ts`, `packages/opencorvus/src/conversation/view.ts` | new task-report route/projection tests                                                                                                                                                |
| Conversation/SSE/replay           | `packages/opencorvus/src/server/routes/orchestrator.ts`, `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts`, `packages/opencorvus/src/conversation/view.ts`                                  | `packages/opencorvus/test/server/task-conversation-routes.test.ts`, `packages/opencorvus/test/protocol/message-bridge.test.ts`                                                        |
| Tool pools/prompts/docs           | `packages/opencorvus/src/agent/tool-pool-contract.ts`, `packages/opencorvus/src/prompt/core/orchestrator-core.txt`, `specs/current/architecture/13-agent-communication-matrix.md`                                       | `packages/opencorvus/test/agent/agent.test.ts`, prompt hygiene tests                                                                                                                  |

## End-to-End Acceptance

Add an E2E test that proves the whole chain:

1. Create a real workflow task with a worker session and a live ownership row.
2. Worker calls `request_orchestrator_decision(blocking=true)`.
3. The request is persisted and visible in task description.
4. The orchestrator wake is accepted behind live ownership and is durable.
5. Simulate process/instance boundary by clearing volatile wake state or
   re-entering from durable state.
6. Drain wakes and run the orchestrator loop.
7. Orchestrator responds with `continue_worker`.
8. The response/action is claimed before the worker message is appended.
9. The worker receives the visible continuation message, resumes the same
   session, and emits terminal/status evidence.
10. `/task/:taskID/events` live stream shows request, response, action, worker
    message, and terminal/status facts.
11. `/task/:taskID/conversation` hydrate shows A2A durable events, the worker
    message from the message tables, and terminal/status facts.
12. `/task/:taskID/conversation/events` replay shows the durable A2A and
    terminal/status facts without duplicating worker message content outside the
    message tables.

Add sibling E2E or route-level tests for:

- `cancel_worker`;
- `ask_user` linked to a real question interaction;
- `redispatch_worker` linked to a concrete worker redispatch/tool artifact;
- `fail_task` linked to real task failure;
- malformed A2A artifact visibility;
- structural direct-reply failure without task-root fallback;
- real no-activity timeout firing without manual `runNow`;
- same-cwd queue serialization under `startQueuedTaskNow`.

## Verification Commands

Targeted commands must be updated as implementation lands:

```powershell
bun test packages/opencorvus/test/engine/agent-coordination.test.ts
bun test packages/opencorvus/test/tool/request-orchestrator-decision.test.ts
bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "respond_agent_coordination|cancel_subagent|removed steering"
bun test packages/opencorvus/test/engine/queued-wake-ownership-drain.test.ts
bun test packages/opencorvus/test/engine/queue.test.ts --test-name-pattern "startQueuedTaskNow|queued wake|dispatchTaskLoop"
bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts --test-name-pattern "inactivity|stale|timeout"
bun test packages/opencorvus/test/server/reply-error-taxonomy.test.ts
bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "A2A|agent coordination|task_report|message.part.delta|conversation/events"
```

Final verification must include typecheck and docs link tests after code and
spec updates.

## Non-Acceptance

The repair is not accepted if any of these remain true:

- `respond_agent_coordination` can execute worker side effects before request
  claim.
- A2A wake accepted behind live ownership can exist only in process memory.
- `ask_user`, `redispatch`, or `fail_task` can consume a request without a
  linked visible action.
- Any malformed A2A artifact is hidden by a normalizer.
- Any structural direct-reply error is rewritten into task-root input.
- Any A2A/task status channel is visible only as a tool result or process log.
- The timeout only runs when another drain is triggered.
- The same-cwd queue can be bypassed by `startQueuedTaskNow`.
- SSE/replay/hydrate tests do not cover the actual child-session A2A message
  chain.

## Current Verification Snapshot

Status on 2026-06-26:

- Implemented and verified:
  - A2A request idempotency by task/session/message/tool-call identity.
  - A2A response replay idempotency by exact orchestrator
    session/message/tool-call/tool-part audit identity. Replaying the same
    `respond_agent_coordination` call after a completed action now returns the
    existing response/action instead of appending another worker message,
    restarting another loop, asking another question, cancelling again,
    redispatching again, or failing the task again. Mismatched replay input
    fails loudly in the artifact helper.
  - `continue_worker` pending-action replay is recoverable after the worker
    continuation message has already been appended but before the action was
    completed. The worker message id and part id are derived from the action id,
    so re-executing the same response resolves the existing message, records
    action progress, resumes the same worker session, and completes the action
    without appending duplicate message rows or parts.
  - `ask_user` pending-action replay is recoverable after the durable task
    interaction exists but before the A2A action progress or completion was
    recorded. The question id is derived from the action id and `Question.ask`
    joins identical stable request ids, so replay reattaches to the same
    interaction, records progress, and completes from the eventual answer or
    rejection without creating a second question.
  - `fail_task` pending-action replay is recoverable after the terminal task
    failure is already durable but before the A2A action was completed. The
    terminal-task guard now admits only the exact existing
    `respond_agent_coordination` / `fail_task` response/action replay whose
    persisted task error equals `A2A request <request_id>: <failure detail>`;
    it still refuses new scheduler tools on terminal tasks. Replay skips the
    duplicate terminal write, continues terminal cleanup and task-loop
    interruption, completes the action with
    `recovered_terminal_failure=true`, and does not append a second
    `task.failed` protocol event.
  - `cancel_worker` pending-action replay is recoverable after the worker
    cancellation status is already durable but before the A2A action was
    completed. The cancel path initializes the task message protocol bridge,
    requires a projected `session.status` terminal/aborted protocol event for
    the target worker session, records that event id in action progress, and
    completes from the existing event on replay without repeating
    `SessionPrompt.cancel`. Idle workers that are cancelled by the
    orchestrator now receive the same visible terminal/aborted status event,
    so cancellation is not only a tool-result string.
  - A2A request/response/action protocol events are transaction-bound to the
    durable artifact mutation. `ProtocolStore.appendEventInTransaction()` is
    used while creating requests and claiming responses/actions, so a failure
    to write the visible protocol event rolls back the artifact state instead
    of leaving request/action rows invisible to replay.
  - Response/action atomic claim before `continue_worker`, `cancel_worker`,
    `ask_user`, and `fail_task` side effects.
  - Durable `coordination_request` wake causality for wakes queued behind live
    ownership.
  - Durable queued wake payloads now include `task_id`,
    `queued_by_process_id`, `queued_by_instance_directory`, and
    `queued_by_project_id` when accepted inside an active project instance.
    This makes wake replay auditable without relying on process-local
    scheduler memory or free-form event notes.
  - Loud malformed A2A artifact diagnostics instead of normalizer hiding.
    Request, response, and action artifacts all have typed read paths that
    throw on malformed payloads; `describeTask()` validates response artifacts
    while building the orchestrator view so a corrupt durable response cannot
    remain hidden outside prompt/API reconstruction.
  - Response audit identity is now bound to the actual persisted orchestrator
    tool execution: `respond_agent_coordination` requires the AI SDK tool call
    id to match `opencorvus.toolCallID`, the metadata session to equal the
    current task orchestrator child session, the session to resolve back to the
    same task, the persisted assistant message to exist, and the persisted tool
    part id/call id/tool name to match the active tool call. Response and
    action payloads persist `orchestrator_tool_call_id` and
    `orchestrator_tool_part_id`; action artifact replay rejects rows missing
    either field. Forged metadata now fails before request consumption, and
    route-level E2E fixtures use a non-root `kind: "orchestrator"` child
    session so task root sessions remain user-authored only.
  - Bridge foreign-key failures are diagnostic protocol events, not filtered
    log-only failures.
  - Bridge preparation/enrichment failures for task-owned status channels are
    also diagnostic protocol events instead of warn/drop-only paths:
    `session.status`, `session.error`, and `task.report` failures that can be
    resolved to a task-owned session now persist `session.bridge.persist_failed`
    with the original properties and exact error. The regression test covers a
    mismatched `task.report.taskID`, proving a report that cannot be projected
    is still visible in the owning task's protocol event log.
  - Live message bridge preparation failures for task-owned sessions are also
    durable diagnostics instead of silent live-SSE loss. Message events remain
    live-only and are not duplicated into `protocol_event`; the diagnostic row
    stores only routing coordinates (`sessionID`, `messageID`, `partID`,
    `field`, and sanitized `info` / `part` identity) plus the bridge error.
    The regression test covers `message.part.delta` for a missing message role
    and proves the raw `delta` text is not persisted as a second message source.
  - Cross-instance message relay failures from worker/worktree Instances are
    also projected into the host task protocol log when the event can be tied
    to a task-owned session. The diagnostic stores the sanitized message event
    identity plus `sourceDirectory`, not message content. The regression test
    emits a malformed `message.updated` envelope through `GlobalBus` from a
    different directory and proves the host task receives
    `session.bridge.persist_failed` instead of relying on `log.error` only.
  - `task_report` is no longer a silent in-process Bus-only status channel:
    the tool now requires a task-owned session, emits the single registered
    `Event.TaskReport` definition, and the message bridge persists
    `task.report` into `protocol_event` so task conversation hydrate and
    `/conversation/events` replay expose the report. Non-task-owned sessions
    reject instead of returning an acknowledged but unprojectable report.
  - Structural direct-reply failures reject without task-root fallback.
  - A2A request creation and response-side task-owned handle validation now
    share `resolveAgentCoordinationSessionOwnership()` as the single ownership
    resolver for task session tree, live orchestrator tool ownership, and
    `goal_run.session_id`. `continue_worker`, `cancel_worker`, stage-specific
    `redispatch_worker`, and `cancel_subagent` all reject cross-task handles,
    validate goal/goal_run consistency, and accept a goal-run-owned session
    even when it is not under the task root session tree. Model resolution is
    ownership-aware: task-tree sessions keep the strict taskID+sessionID
    resolver check, while non-tree but durably owned sessions resolve from the
    actual session root used by `SessionPrompt.loop`, avoiding contradictory
    resolver inputs without weakening `agent/model.ts`.
  - Restart liveness no longer appends the synthetic `server_restart` /
    `请继续执行剩余任务` operator message. The startup scan records a durable
    `task.lifecycle` protocol event with fact
    `server_restart_active_task_recovered`, then wakes the orchestrator with a
    structured `lifecycleFact` event that carries the protocol event id. The
    regression test proves no visible user message or `operatorMessage` wake is
    synthesized, current in-process active loops are not duplicated, and
    repeated liveness registration in the same instance does not duplicate the
    lifecycle fact.
  - Generic same-kind direct-control `redispatch_worker` is no longer accepted:
    the orchestrator does not create a replacement session from free-text
    redispatch guidance, does not append an "Orchestrator Coordination
    Redispatch" prompt, does not start a loop, and keeps the request pending
    until a concrete stage/tool dispatcher binding exists. This removes the
    weak same-kind session fallback that previously looked like a completed
    A2A action without using a mature dispatcher contract.
  - Stage-specific runtime-contract `redispatch_worker` now supports the
    concrete `frontend_research_stage` binding: a `frontend-research`
    coordination request with one source URL in `evidence_refs` is answered by
    the shared `FrontendResearchAgent.run` dispatcher, persists a
    `frontend_research_brief`, and completes the A2A action with the new
    session/artifact ids.
  - `frontend_research_stage` redispatch now records a durable pending-action
    start marker before invoking the dispatcher. If the process stops after the
    brief artifact is persisted but before the A2A action is completed, replay
    recovers only from one exact `frontend_research_brief` whose
    `research_session_id` belongs to a `frontend-research` child of the same
    orchestrator session and whose `webpage_contract.source_url` matches the
    request source URL; the regression test proves replay completes the
    existing action without calling `FrontendResearchAgent.run` again.
  - Stage-specific runtime-contract `redispatch_worker` now supports the
    concrete `frontend_design_stage` binding: a `frontend-design`
    coordination request is answered by the ordinary `frontend_design` tool
    dispatcher, materializes the existing visual references, calls
    `FrontendDesignAgent.analyze`, persists `task.design_specs` plus the
    frontend-design decision-log public report/template/contract/source
    manifest entries, and completes the A2A action with the new session id,
    design spec count, decision entry count, template review pass count,
    reference artifact count, frontend project status, and source URL count.
    This remains frontend handoff evidence; downstream repair still belongs to
    build/visual/integrity stages.
  - The ordinary `frontend_design` side-tool path remains the single
    implementation used by A2A redispatch, so the protocol does not create a
    second frontend-design source or bypass existing visual reference
    materialization.
  - Stage-specific runtime-contract `redispatch_worker` now supports the
    concrete `deep_research_stage` binding: a `deep-research` coordination
    request is answered by the shared `DeepResearchAgent.run` dispatcher,
    persists a `research_brief`, and completes the A2A action with the new
    session/artifact ids.
  - `deep_research_stage` redispatch now records a durable pending-action
    start marker plus the preexisting deep-research child session ids and
    preexisting `research_brief` artifact ids before invoking the dispatcher.
    Replay recovers only from one new `research_brief` whose
    `research_session_id` belongs to a new `deep-research` child of the same
    orchestrator session; old artifacts are excluded by the recorded
    preexisting sets, and ambiguous new matches fail loudly instead of choosing
    the latest artifact. The regression test proves recovery completes the
    existing A2A action without calling `DeepResearchAgent.run` again.
  - The ordinary `deep_research` side-tool path also uses the same shared
    stage dispatcher and is covered by an execution test that verifies input
    propagation and `research_brief` persistence.
  - Stage-specific runtime-contract `redispatch_worker` now supports the
    concrete `requirements_stage` binding: a `requirements` coordination
    request is answered by the shared `RequirementsAgent.run` dispatcher,
    persists a new active requirements spec snapshot plus requirement rows,
    and completes the A2A action with the new session/spec ids.
  - `requirements_stage` redispatch now records a durable pending-action start
    marker plus preexisting requirements child session ids and preexisting spec
    snapshot ids before invoking the dispatcher. Replay recovers only when it
    sees exactly one new `requirements` child session, exactly one new spec
    snapshot, and at least one requirement row attached to that spec; ambiguous
    new sessions/specs are hard failures rather than latest-row fallback. The
    regression test proves recovery completes the existing A2A action without
    calling `RequirementsAgent.run` again.
  - The ordinary `requirements` side-tool path also uses the same shared stage
    dispatcher and is covered by an execution test that verifies active spec
    and requirement-row persistence.
  - Stage-specific runtime-contract `redispatch_worker` now supports the
    concrete `architect_stage` binding: an `architect` coordination request
    with an active requirements spec is answered by the shared
    `ArchitectAgent.coordinate` dispatcher, persists a new active v2 spec
    snapshot plus copied requirements, goal rows, and contract graph, and
    completes the A2A action with the new session/spec ids.
  - `architect_stage` redispatch now records a durable pending-action start
    marker plus preexisting architect child session ids, spec snapshot ids, and
    architect contract graph artifact ids before invoking the dispatcher.
    Replay recovers only when it sees exactly one new architect child session,
    exactly one new v2 spec snapshot, at least one goal row attached to that
    spec, and exactly one new `architect_contract_graph` artifact; ambiguous
    new sessions/specs/graphs are hard failures rather than latest-row
    fallback. The regression test proves recovery completes the existing A2A
    action without calling `ArchitectAgent.coordinate` again.
  - The ordinary `architect` side-tool path also uses the same shared stage
    dispatcher and is covered by an execution test that verifies copied
    requirements remain attached to the promoted active spec.
  - Stage-specific runtime-contract `redispatch_worker` now supports the
    concrete `visual_qa_stage` binding: a `visual-qa` coordination request is
    answered by the shared `VisualQaAgent.analyze` dispatcher, records the
    durable `visual_qa` report/latest_summary decision-log evidence, and
    completes the A2A action with the new session id plus effective/submitted
    acceptance and report counters. This remains visual/product QA evidence;
    it does not replace final `integrity`.
  - `visual_qa_stage` redispatch now records a durable pending-action start
    marker plus preexisting visual-qa child session ids and preexisting
    `visual_qa` decision-log row ids before invoking the dispatcher. Replay
    recovers only when it sees exactly one new visual-qa child session, exactly
    one new `report_*` decision row bound to that session, and exactly one new
    `latest_summary` decision row; ambiguous new sessions/reports/summaries are
    hard failures rather than latest-row fallback. The regression test proves
    recovery completes the existing A2A action without calling
    `VisualQaAgent.analyze` again.
  - The ordinary `visual_qa` side-tool path also uses the same shared stage
    dispatcher and is covered by an execution test that verifies input
    propagation and `visual_qa` decision-log persistence.
  - Stage-specific runtime-contract `redispatch_worker` now supports the
    concrete `integrity_stage` binding: an `integrity` coordination request is
    answered by the shared final review dispatcher, persists an
    `integrity_attempt` artifact when the review result is persistable, records
    any artifact-persistence failure as visible A2A action result data, and
    completes the A2A action with the new session id, spec snapshot id, review
    phase, verdict, reviewer count, finding count, required repair count, and
    unresolved disagreement count. This is final integrity evidence only; task
    completion still requires the explicit `complete_task` tool path.
  - `integrity_stage` redispatch now records a durable pending-action start
    marker plus preexisting integrity child session ids and preexisting
    `integrity_attempt` artifact ids before invoking the dispatcher. Replay
    recovers only when it sees exactly one new integrity child session and
    exactly one new `integrity_attempt` artifact whose payload `session_id`
    binds to that session; ambiguous new sessions/artifacts are hard failures
    rather than latest-row fallback. The regression test proves recovery
    completes the existing A2A action without calling `reviewIntegrity` again.
    The separate artifact-missing visibility path remains visible failure
    evidence, not a recovered persisted-attempt path.
  - The ordinary `integrity` side-tool path also uses the same shared final
    review dispatcher and is covered by tests that verify post-build pass
    evidence is recorded without auto-completing the task.
  - Stage-specific runtime-contract `redispatch_worker` now supports the
    concrete goal-scoped `build_stage` binding: a `build` coordination request
    with `goal_id` and source `goal_run_id` is validated against the build
    runtime contract, records a pending A2A action, visibly stops the source
    build attempt/ownership, calls the ordinary `build({ goalID })` dispatcher,
    and completes the A2A action with the replacement build session, new
    `goal_run`, `build_session_contract`, worktree facts, and source-stop
    evidence. Task-level direct build redispatch remains unbound because it
    has no mature direct-build retry contract to reuse without guessing.
  - The ordinary `build` side-tool path remains the single implementation used
    by A2A redispatch, so the protocol does not create a second build source or
    bypass the existing goal-run/worktree/build-session-contract lifecycle.
  - `build_stage` redispatch now records a durable pending-action start marker
    after source-stop evidence and before invoking `build({ goalID })`, including
    the preexisting goal_run ids and preexisting `build_session_contract`
    artifact ids for that goal. Replay recovers only when exactly one new
    goal_run and exactly one new `build_session_contract` exist for the same
    goal, and the contract payload's `task_id`, `goal_id`, `goal_run_id`, and
    `session_id` bind to that recovered goal_run. Missing or ambiguous durable
    build-start evidence is exposed as structural failure instead of being
    treated as a successful redispatch.
  - Stage-specific runtime-contract `redispatch_worker` now supports the
    concrete `intent_analysis_stage` binding: an `intent-analysis`
    coordination request is validated against the installed runtime contract,
    answered by the ordinary `analyze_intent` tool dispatcher, persists
    `intent_analysis` decision-log evidence, and completes the A2A action with
    the replacement intent-analysis session id, decision-log evidence count,
    and `intent_summary`. This keeps intent redispatch on the same
    task-scope analysis path instead of inventing a parallel retry protocol.
  - `intent_analysis_stage` redispatch now records a durable pending-action
    start marker plus preexisting intent-analysis child session ids and
    preexisting `intent_analysis` decision-log entry ids before invoking
    `analyze_intent`. Replay recovers only when exactly one new
    intent-analysis child session and exactly one new `intent_summary`
    decision entry exist. Missing one side or multiple candidates is a
    structural redispatch recovery failure, not a reason to silently run a
    second intent-analysis pass.
  - Stage-specific runtime-contract `redispatch_worker` now supports the
    concrete `explore_stage` binding: an `explore` coordination request is
    validated against the installed runtime contract, answered by the ordinary
    `explore` tool dispatcher, persists `phase=explore` decision-log evidence
    and an `exploration` artifact, and completes the A2A action with the
    replacement explore session id, decision-log evidence count, exploration
    artifact count, and exact question. `explore` is added only to the direct
    agent session control kind set for A2A/cancel ownership; it remains outside
    the generic operator direct-reply kind set.
  - `explore_stage` redispatch now records a durable pending-action start
    marker with the exact synthesized question plus preexisting explore child
    session ids, `phase=explore` decision-log ids, and `exploration` artifact
    ids. Replay recovers only when exactly one new explore child session, one
    new `repo_investigation_<session>` decision entry, and one new
    `exploration` artifact exist, with the artifact payload's `session_id`,
    `question`, and `result` matching the decision entry. Incomplete or
    ambiguous evidence is a structural recovery failure rather than a second
    repository investigation.
  - Stage-specific runtime-contract `redispatch_worker` now supports the
    concrete `workload_analysis_stage` binding: a `goal-workload-analyst`
    coordination request is validated against the installed runtime contract
    plus active spec/goal preconditions, answered by the ordinary
    `workload_analysis` tool dispatcher, persists a new `goal_workload`
    artifact, and completes the A2A action with the replacement workload
    analyst session id, artifact id, spec snapshot id, analyzed brief count,
    expected goal count, and flagged goal count. This is advisory workload
    evidence only; it does not split goals, mutate plans, or gate build.
  - `workload_analysis_stage` redispatch now records a durable pending-action
    start marker with active spec id, expected goal count, preexisting
    workload-analyst session ids, and preexisting `goal_workload` artifact ids.
    Replay recovers only when exactly one new workload-analyst child session
    and exactly one new `goal_workload` artifact exist, the artifact
    `spec_snapshot_id` matches the active spec, and the artifact contains at
    least one brief per architect goal. The current `goal_workload` artifact
    schema does not carry `session_id`, so recovery does not invent a fake
    artifact/session binding; it uses the strict one-new-session plus
    one-new-artifact boundary from the pending marker.
  - Stage-specific runtime-contract `redispatch_worker` now supports the
    concrete continuation-bound `fact_check_stage` binding: a `fact-check`
    coordination request is accepted only when the same source fact-check
    session has a pending `stage_continuation_request` for
    `report_fact_check_result` with valid `normalized_stage_input` and matching
    digest. The A2A action calls the ordinary `fact_check` tool with
    `continuation_artifact_id`, then completes only after a durable
    `fact_check_attempt` artifact exists, recording the resumed session,
    continuation artifact, target session/message/hash, verdict, outcome, and
    inspected-item counters. Fresh fact-check redispatch without a continuation
    artifact remains pending because parsing `target_session_id`,
    `target_message_id` / `target_message_hash`, and `fact_check_items` from
    free-text summary/details or generic `evidence_refs` is rejected as a weak
    protocol.
  - `fact_check_stage` redispatch now records a durable pending-action start
    marker with the continuation artifact id, source session id, exact target
    session/agent/message/hash, target kind, and preexisting
    `fact_check_attempt` artifact ids. Replay can recover after the
    continuation has already been claimed/consumed, but only for the same
    responded A2A action whose pending action result proves
    `redispatch_started=true` and carries that continuation artifact id.
    Recovery accepts exactly one new `fact_check_attempt`, validates the
    artifact schema, source fact-check session, invoking orchestrator session,
    target fields, report scope, and inspected counters, then completes the
    action as `recovered_redispatch=true`. Missing, ambiguous, or mismatched
    attempt evidence is a structural recovery failure rather than a second
    fact-check dispatch. The normal non-recovery completion path now applies
    the same `fact_check_attempt` schema and scope validation before completing
    the action, so recovery is not stricter than the primary path. Replaying
    the same `respond_agent_coordination` call after that action is already
    completed still reads the durable continuation scope for response replay
    validation and returns the completed response/action instead of refusing on
    the now-consumed continuation or calling `fact_check` again.
  - `startQueuedTaskNow` preserves same-cwd serialization.
  - Queued wake drain is no longer allowed to outrun loop acceptance:
    `advanceQueue()` peeks the durable wake, starts the claimed task loop, and
    only marks the wake `drained` if the loop was actually attached. If a same
    task loop is still in flight, the wake remains `pending` and is consumed by
    the existing loop's completion drain hook.
  - Scheduler inactivity recovery fires from last activity without requiring a
    later `runNow`. Fresh running rows now time out from their own recovery
    timer, timer boundary checks that fire just before the `<= timeout`
    predicate reschedule instead of dropping the token, and real
    `message.part.delta` / `message.part.updated` events refresh
    `time_updated` and the recovery timer.
  - Accepted direct agent-session replies no longer hide loop startup failure
    in process logs only. If the target session message is accepted but
    `SessionPrompt.loop()` rejects, the target session is marked
    `terminal/error`; the existing session-status bridge persists that
    `session.status` into `protocol_event` for task replay/hydration without
    creating a task-root fallback message.
  - Full A2A workflow E2E drives worker request creation, task description
    visibility, durable queued wake drain, orchestrator response, worker
    continuation, live SSE, hydrate, and `conversation/events` replay in one
    chain.
  - Sibling route-level A2A decision coverage proves `cancel_worker`,
    `ask_user`, and `fail_task` each execute a real visible action and replay
    through task conversation hydrate and `conversation/events`; the same test
    now also proves generic same-kind `redispatch_worker` is refused without
    consuming the request or creating response/action artifacts.
  - 2026-06-27 independent audit repair: request idempotency lookup now runs
    inside the same DB transaction that inserts the request. If historical or
    concurrent corruption leaves multiple `agent_coordination_request` rows for
    the same task/session/message/tool-call invocation, replay fails loudly
    instead of picking a latest row.
  - 2026-06-27 independent audit repair: when a failed A2A action reopens its
    request, replaying the same orchestrator session/message/tool-call now
    returns the original failed response/action (`createdNow=false`) instead of
    creating a second response/action. A different orchestrator audit identity
    remains the explicit retry path.
  - 2026-06-27 independent audit repair: `cancel_subagent` is no longer an A2A
    cancellation side path. Prompt, tool description, runtime check, and tests
    all require pending worker coordination cancellation to go through
    `respond_agent_coordination(decision="cancel_worker")`; direct
    `cancel_subagent` refuses when the target session/goal_run has pending A2A
    requests.
  - 2026-06-27 route coverage: `agent.coordination.cancelled` now has live
    `/task/:taskID/events`, `/task/:taskID/conversation` hydrate, and
    `/task/:taskID/conversation/events` replay coverage.
  - 2026-06-27 route coverage: an accepted `redispatch_worker` response/action
    with a concrete dispatcher binding now has task conversation hydrate and
    `conversation/events` replay coverage, in addition to the existing generic
    same-kind redispatch refusal coverage.
- Verified commands:
  - `bun run --cwd packages/opencorvus typecheck`
  - `bun test packages/opencorvus/test/engine/agent-coordination.test.ts`
  - `bun test packages/opencorvus/test/tool/request-orchestrator-decision.test.ts`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "respond_agent_coordination"`
  - `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "A2A|agent coordination|conversation/events"`
  - `bun test packages/opencorvus/test/engine/protocol.test.ts --test-name-pattern "bridge diagnostics|cross-instance relay|live message event preparation|terminal status"`
  - `bun test packages/opencorvus/test/protocol/message-bridge.test.ts`
  - `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "task_report|A2A|agent coordination|conversation/events"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "respond_agent_coordination.*redispatch|runtime-contract redispatch"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "frontend-research stage dispatcher|unsupported runtime-contract redispatch"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "deep_research persists a research brief|deep-research stage dispatcher|frontend-research stage dispatcher|unsupported runtime-contract redispatch|respond_agent_coordination"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "requirements persists a spec snapshot|requirements stage dispatcher"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "requirements persists a spec snapshot|deep_research persists a research brief"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "architect promotion keeps requirements|architect stage dispatcher"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "requirements stage dispatcher|frontend-research stage dispatcher|deep-research stage dispatcher|unsupported runtime-contract redispatch"`
  - `bun test packages/opencorvus/test/engine/agent-coordination.test.ts --test-name-pattern "idempotency|redispatch|malformed|response"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "visual_qa records|visual-qa stage dispatcher|unsupported runtime-contract redispatch"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "architect stage dispatcher|requirements stage dispatcher|frontend-research stage dispatcher|deep-research stage dispatcher|visual-qa stage dispatcher|unsupported runtime-contract redispatch"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "integrity stage dispatcher|unsupported runtime-contract redispatch"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "architect stage dispatcher|requirements stage dispatcher|frontend-research stage dispatcher|deep-research stage dispatcher|visual-qa stage dispatcher|integrity stage dispatcher|unsupported runtime-contract redispatch"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "frontend-design stage dispatcher|unsupported runtime-contract redispatch"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "architect stage dispatcher|requirements stage dispatcher|frontend-design stage dispatcher|frontend-research stage dispatcher|deep-research stage dispatcher|visual-qa stage dispatcher|integrity stage dispatcher|unsupported runtime-contract redispatch"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "frontend_design materializes Figma references through MCP before analysis|frontend-design stage dispatcher"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "post-build integrity pass records evidence|complete_task completes only from the latest post-build pass integrity attempt"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "build stage dispatcher|unsupported runtime-contract redispatch"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "intent-analysis stage dispatcher|unsupported runtime-contract redispatch"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "explore stage dispatcher|unsupported runtime-contract redispatch"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "workload-analysis stage dispatcher|unsupported runtime-contract redispatch"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "same-kind redispatch pending"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "goal-run-owned session outside|continue consumes a pending request|cancel_worker completes"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "resumes a fact-check continuation"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "fact-check redispatch pending without a continuation"`
  - `bun test packages/opencorvus/test/fact-check/orchestrator-tool.test.ts --test-name-pattern "continuation|terminal finalizer miss|cached"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "architect stage dispatcher|requirements stage dispatcher|frontend-design stage dispatcher|frontend-research stage dispatcher|deep-research stage dispatcher|visual-qa stage dispatcher|integrity stage dispatcher|build stage dispatcher|intent-analysis stage dispatcher|explore stage dispatcher|workload-analysis stage dispatcher|unsupported runtime-contract redispatch"`
  - `bun test packages/opencorvus/test/engine/queued-wake-ownership-drain.test.ts`
  - `bun test packages/opencorvus/test/engine/queue.test.ts --test-name-pattern "startQueuedTaskNow|queued wake|dispatchTaskLoop"`
  - `bun test packages/opencorvus/test/engine/queue.test.ts --test-name-pattern "startQueuedTaskNow|queued wake|dispatchTaskLoop|advanceQueue"`
  - `bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts --test-name-pattern "cancelSessionPrompts|inactivity|timeout"`
  - `bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts --test-name-pattern "inactivity|timeout|heartbeat"`
  - `bun test packages/opencorvus/test/server/reply-error-taxonomy.test.ts`
  - `bun test packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts --test-name-pattern "respond_agent_coordination"`
  - `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "task_report"`
  - `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "A2A|agent coordination|task_report|message.part.delta|conversation/events"`
  - `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "A2A E2E"`
  - `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "A2A sibling decisions"`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "cancel_subagent"`
  - `bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts --test-name-pattern "A2A cancellation|complete_task|fallback|orchestrator"`
  - `bun test packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts --test-name-pattern "respond_agent_coordination|cancel_subagent|steering"`
  - `bun test packages/opencorvus/test/engine/agent-coordination.test.ts`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "respond_agent_coordination continue"`
  - `bun test packages/opencorvus/test/engine/event-log.test.ts`
  - `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "session.error through hydrate|lifecycle events without blank sessions|agentView status uses latest durable status"`
  - `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "A2A E2E"`
  - `bun test packages/overlay/test/tree-writer-hierarchy.test.ts --test-name-pattern "session.error"`
  - `bun test packages/opencorvus/test/protocol/message-bridge.test.ts`
  - `bun test packages/opencorvus/test/protocol/session-mirror.test.ts`
  - `bun test packages/opencorvus/test/server/session-conversation-routes.test.ts`
  - `bun test packages/opencorvus/test/tool/schema-snapshot.test.ts`
  - `bun run docs:check`
  - `bun run api:routes-check`
- Current route/docs caveat resolved in the `task_report` projection slice:
  generated SDK/OpenAPI/API docs were regenerated through the existing
  `packages/sdk/js` build and `docs:api` scripts, then `docs:check` and
  `api:routes-check` passed against the current dirty worktree.
- 2026-06-27 independent-audit closures:
  - Live tool ownership request/respond now has focused positive/negative
    coverage: a detached worker session is accepted when the task has a live
    `orchestrator_tool_ownership` artifact for that child session, and the same
    worker is rejected when only another task owns that live binding.
  - `continue_worker` delayed loop rejection is now an explicit protocol
    contract: once the worker-visible continuation message is appended and the
    same-session loop is scheduled, the A2A action remains `completed`; a later
    asynchronous `SessionPrompt.loop()` rejection is represented as terminal
    session error/status instead of reopening the request or failing the
    completed action.
  - Bridge diagnostics and `session.error` visibility now have focused
    backend/UI-adjacent coverage: task hydrate and `/conversation/events` replay
    expose `session.error` and `session.bridge.persist_failed`, the single-session
    route returns lifecycle-only `session.error`, overlay tree-writer marks the
    affected session card as error with the original stream message, and
    `EngineEventLog` writes `task.report`, `session.status`, `session.error`, and
    bridge diagnostics to task runtime log files using the durable protocol event
    task identity instead of payload-only task IDs.
  - Process restart recovery now has a single destructive E2E: the first phase
    runs in an isolated Bun child process and writes the task root, worker,
    live `orchestrator_tool_ownership`, pending A2A request, and durable
    queued coordination wake, then holds the process alive until the parent
    test observes the `complete` activity marker and terminates it. The parent
    process then reopens the same test DB, verifies the old process owner no
    longer counts as live ownership, drains the queued wake, answers
    `respond_agent_coordination decision=continue`, and asserts worker message,
    terminal `session.status`, conversation hydrate, and paged replay all expose
    the complete A2A chain.
- Remaining independent-audit risks not yet closed by this snapshot:
  - None known in the audited A2A request/response/action, durable wake,
    restart recovery, SSE/replay, and event-log surfaces covered above.
- Explicitly rejected / out of scope for this A2A repair:
  - Stage-specific runtime-contract `redispatch_worker` is accepted only for
    concrete worker dispatchers that have a mature ordinary tool path. The
    current accepted bindings cover the runtime-required worker stage set in
    `AgentRoleContract`:
    `requirements_stage` for requirements spec extraction,
    `architect_stage` for goal/spec decomposition,
    `frontend_design_stage` for visual-reference-grounded frontend handoff
    evidence,
    `frontend_research_stage` for source-page-scoped frontend investigation,
    `deep_research_stage` for source-backed research evidence,
    `visual_qa_stage` for focused frontend visual/product QA evidence,
    `integrity_stage` for final integrity review evidence,
    `intent_analysis_stage` for task-scope intent reinterpretation through the
    ordinary `analyze_intent` dispatcher,
    `explore_stage` for repository investigation through the ordinary
    read-only explore dispatcher,
    `workload_analysis_stage` for advisory goal-sizing evidence through the
    ordinary workload-analysis dispatcher, `fact_check_stage` for same-session
    fact-check finalizer recovery through a pending continuation artifact, and
    `build_stage` for goal-scoped build retry through the ordinary build
    dispatcher after the source build attempt is visibly stopped. The
    runtime-required non-worker contexts (`orchestrator` and `acceptance`) are
    not A2A worker redispatch targets.
  - Task-level direct build redispatch remains rejected because the build
    dispatcher's mature retry contract is goal-scoped and requires a source
    `goal_run`. Fresh/free-text fact-check redispatch remains rejected because
    parsing target session/message/hash/items from summary/details would create
    a weak protocol; only continuation-bound `fact_check_stage` is accepted.
    Generic same-kind direct-control redispatch remains rejected because it
    would recreate the old hidden prompt/session fallback instead of invoking a
    concrete dispatcher action.
  - `queue=false` remains explicitly parallel by the later
    `2026-06-20-runtime-isolation-second-repair.md` decision. This contract only
    requires `startQueuedTaskNow` not to bypass same-cwd serialization.
