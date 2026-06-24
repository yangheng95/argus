# A2A Agent Lifecycle Coordination

Date: 2026-06-24
Status: implementation plan

## Goal

Fix OpenCorvus task interruption, worker continuation, and scheduler-worker
communication by introducing one visible, durable, request-bound internal A2A
coordination surface.

This is not an external A2A protocol implementation and not a wrapper around
the current `steer_subagent` tool. It is an internal coordination contract for
the host orchestrator and worker agents.

## User Problems

1. Cancelling or interrupting a task does not reliably stop every agent. Some
   worker sessions continue running after the user believes the task is closed.
2. Worker failures and interrupted turns often restart from scratch. The
   orchestrator must resume the existing failed session when its runtime
   contract is still valid, and only start fresh when there is concrete evidence
   that the old session cannot continue.
3. Worker-to-orchestrator communication is immature. Workers need a real,
   visible, durable way to ask the orchestrator for a scheduling decision
   without hidden messages, forked private chats, or task-root operator-message
   spoofing.

## Recall

| Source | Constraint |
| --- | --- |
| `AGENTS.md` | No fallback, no compatibility shim, no double source, no hidden/synthetic messages, no gate mechanism, inspect existing plans before editing, test every behavior change. |
| `specs/new-arch/01-agents.md` | The orchestrator is the only lifecycle decision host. Workers do not own task-level scheduling. |
| `specs/new-arch/13-agent-communication-matrix.md` | Current communication is a hybrid of channel ingress, control messages, orchestrator tools, build tools, and task subagents. There is no canonical durable A2A mailbox. |
| `specs/new-arch/2026-06-24-tool-pool-convergence.md` | Agent, tool, and skill contracts must move together. Tool pools express visibility and ownership, not duplicate semantic tools. |
| `specs/new-arch/2026-06-24-agent-abstraction-convergence.md` | Agent abstractions converge to `host` and `worker`; role-specific behavior is metadata, not another agent class. |
| `specs/new-arch/2026-06-24-remove-steer-subagent-tool.md` from the dirty main worktree | `steer_subagent` is a wrong surface and must not be preserved as A2A. A replacement must be request-bound and visible. |
| `specs/new-arch/2026-06-24-remove-restart-stage-goal-reset.md` from the dirty main worktree | `restart_from_stage` is task-wide rewind behavior and must not be the default repair path for worker failures. |
| `specs/new-arch/2026-06-22-build-terminal-finalizer-continuation.md` | `stage_continuation_request` is a narrow same-session finalizer-miss recovery artifact. Reuse its durable claim pattern, not its scope. |
| `packages/opencorvus/src/session/loop.ts` | `SessionPrompt.loop({ resume_existing })` and `SessionRuntimeContract` already support continuing a live worker session when its runtime contract remains valid. |
| `packages/opencorvus/src/agent/runner.ts` | Worker agents share one runner, install runtime contracts, create `WorkerTurnDescriptor`, and support visible same-session continuation messages. |
| `packages/opencorvus/src/engine/writer.ts` | Existing shutdown and live-execution abort code already models task-owned sessions, process ownership, goal runs, runs, and tool ownership, but task cancel still assembles those facts inline. |

## Impact Inventory

| Surface | Current behavior | Required change |
| --- | --- | --- |
| `EngineService.cancelTask` in `packages/opencorvus/src/task-api/index.ts` | Cancels the task root session subtree, live tool ownerships, live goal runs, live execution, and active run through separate inline branches. | Replace inline enumeration with one task-agent lifecycle collector that gathers every task-owned live session/run/goal_run/tool ownership once and aborts them through one reportable path. |
| `packages/opencorvus/src/engine/cancellation-scope.ts` | Cancels and settles a session subtree rooted at one session id. | Keep this as the session-subtree primitive used by the lifecycle collector. Do not make it the whole task truth. |
| `packages/opencorvus/src/engine/execution-abort.ts` | Aborts child sessions and goal runs for targeted subagent cancellation. | Use its primitives from the lifecycle collector and request-bound orchestrator response paths. |
| `packages/opencorvus/src/engine/writer.ts` | Has shutdown-oriented task/session/tool ownership termination and `abortLiveOrchestratorToolOwnership`. | Extract the shared task-owned live-agent discovery and hard-close report here or beside it, then call it from cancel, shutdown, and explicit A2A response cancellation. |
| `Session.treeInProject` in `packages/opencorvus/src/session/index.ts` | Walks parent-child session trees, root first. | Keep as one discovery source, but supplement it with ownership child sessions and goal-run sessions so detached live workers cannot escape cancellation. |
| `TaskQueueService.cancelSessionPrompts` | Cancels queued prompt jobs for known session ids. | Feed it the complete collected live session id set, not only the task root subtree. |
| `orchestrator/tools.ts::steer_subagent` | Unsolicited direct injection into non-build sessions; build sessions return snapshots or fresh-build advice. | Remove as an orchestrator-private tool. Replace with `respond_agent_coordination` that requires a pending coordination request id. |
| `EngineService.replyAgentSession` and `appendDirectAgentSessionReply` | Overlay direct reply path; refuses build-like sessions and may route to task wake on direct-reply errors. | Keep for explicit operator-to-agent reply UI only. Do not use it as scheduler A2A. New orchestrator responses must be bound to a coordination request. |
| `TaskTool` in `packages/opencorvus/src/tool/task.ts` | Parent agent can create or resume a subagent via `task_id`, but it is parent-to-child and not worker-to-orchestrator communication. | Keep semantics. Do not treat `task_id` resume as A2A. |
| `TaskReportTool` | Emits `task.report` bus status for managed channel runtime. | Keep separate. It is status telemetry, not a scheduler decision request. |
| `stage_continuation_request` | Durable request for finalizer-miss same-session recovery. | Keep narrow. Do not overload it for general A2A. The new A2A artifact should mirror its claim/consume auditability. |
| `reopenActiveRunForOperatorWake` | Reopens blocked active task runs for operator messages when there is no pending interaction. | Keep for user messages. Do not use it to hide worker coordination. |
| `AgentToolPool` and `GLOBAL_TOOL_IDS` | Global/private tool pools still list old orchestrator tools and stage context tools. | Add canonical worker coordination tool to global pool only where workers need it; remove `steer_subagent` and `restart_from_stage` from orchestrator private pool when implementing the replacement. |
| `engine/model.ts`, `engine/event-log.ts`, overlay event policy | No first-class A2A request/response events. | Add visible events for coordination requested/responded/cancelled and route them into trace/panel event streams. |
| SDK/OpenAPI/server routes | No API for listing/observing coordination records outside artifacts/events. | Expose read-only projection only if existing task detail projection cannot surface events. Do not add a write route for hidden control. |
| Tests | Existing tests cover task message wake, cancel ownership, session abort cascade, runner continuation, and steer_subagent. | Replace steer tests with request-bound response tests; add hard-close, selective resume, and visible worker request tests. |

## Concepts

### Agent Lifecycle Handle

A task-owned agent handle is any live or resumable worker execution bound to a
task through one of these sources:

- a session in the task root session subtree;
- a live orchestrator tool ownership child session;
- a live or blocked goal run session id;
- an active run session id;
- a queued prompt for any collected session id;
- a runtime contract installed on any collected session id in the current
  process.

The lifecycle collector produces one deduplicated report:

```ts
type TaskAgentLifecycleReport = {
  taskID: string
  sessions: string[]
  promptCancellations: string[]
  queuedPromptCancellations: string[]
  ownerships: string[]
  goalRuns: string[]
  runs: string[]
  incomplete: Array<{ handle: string; reason: string }>
}
```

Cancellation success means `incomplete` is empty and no collected session
remains active after inactivity-based settlement. The task must not be stamped
`cancelled` while a live handle remains unproven.

### Selective Continuation

Fresh retry is the exceptional path. The orchestrator should continue an
existing worker session when all of these facts hold:

- the target session exists and belongs to the task;
- the session kind and goal id match the requested worker contract;
- the session is not physically active under another live prompt;
- the runtime contract and `WorkerTurnDescriptor` validate;
- the terminal collector is not already satisfied;
- no pending permission/user interaction blocks the run.

Fresh dispatch is required only when evidence shows one of:

- `SessionRuntimeContractMissingError` with reason `missing` or
  `terminal_satisfied`;
- provider/process session is gone and cannot be resumed;
- prior prompt did not settle after the inactivity timeout;
- the target goal run is terminal and its contract cannot accept another turn;
- explicit operator/orchestrator instruction asks for a new attempt;
- scope changed through `modify_goal`, `propose_task`, or another real
  contract-changing decision.

This is a fact classifier, not a workflow state machine. It does not decide the
repair. It tells the orchestrator whether an existing worker session is a valid
target for a request-bound response or continuation.

### Coordination Request

Workers get one canonical tool:

```ts
request_orchestrator_decision({
  summary: string,
  details: string,
  blocking: boolean,
  requested_decision: string,
  evidence_refs?: string[],
  goal_id?: string,
  goal_run_id?: string,
  severity?: "info" | "blocked" | "failure"
})
```

The tool must:

- require `ctx.extra.taskID`;
- bind to `ctx.sessionID`, `ctx.messageID`, `ctx.agent`, optional goal ids, and
  current process owner;
- persist an `engine_artifact kind="agent_coordination_request"`;
- publish `agent.coordination.requested`;
- wake the task orchestrator with a visible `OrchestratorEvent` note;
- return the persisted request id to the worker.

The tool does not call the orchestrator directly, does not fork a chat, and
does not write a task-root user/operator message.

### Coordination Response

The orchestrator gets one private tool:

```ts
respond_agent_coordination({
  request_id: string,
  decision: "continue" | "cancel_worker" | "redispatch" | "fail_task" | "ask_user",
  message?: string,
  reason: string
})
```

The tool must:

- require the request to be pending and bound to the same task;
- persist `engine_artifact kind="agent_coordination_response"`;
- publish `agent.coordination.responded`;
- for `continue`, append one visible response user message to the requesting
  worker session and resume it only if the selective-continuation classifier
  proves the session contract is still valid;
- for `cancel_worker`, hard-close the request's worker session subtree and any
  matching ownership/goal_run facts;
- for `redispatch`, mark the request answered with a redispatch decision and
  let the orchestrator call the real worker tool (`build`, `architect`,
  `frontend_design`, etc.) in the same visible turn;
- for `ask_user`, route through the existing `question` tool rather than
  inventing a hidden user prompt.

Unsolicited steering is not supported. A worker session can receive an
orchestrator continuation message only through a pending request id or an
explicit operator direct reply.

## Event and Artifact Shape

Add artifact kinds:

- `agent_coordination_request`
- `agent_coordination_response`

Request payload:

```ts
type AgentCoordinationRequestPayload = {
  request_id: string
  task_id: string
  session_id: string
  agent: string
  message_id: string
  goal_id?: string
  goal_run_id?: string
  owner: string
  summary: string
  details: string
  blocking: boolean
  requested_decision: string
  evidence_refs?: string[]
  severity: "info" | "blocked" | "failure"
  status: "pending" | "responded" | "cancelled"
  created_at: number
  responded_at?: number
  response_id?: string
}
```

Response payload:

```ts
type AgentCoordinationResponsePayload = {
  response_id: string
  request_id: string
  task_id: string
  orchestrator_session_id: string
  orchestrator_message_id: string
  decision: "continue" | "cancel_worker" | "redispatch" | "fail_task" | "ask_user"
  reason: string
  message?: string
  worker_message_id?: string
  created_at: number
}
```

Bus events:

- `agent.coordination.requested`
- `agent.coordination.responded`
- `agent.coordination.cancelled`

The task description must include pending requests so the orchestrator can
decide from the normal prompt context. The overlay trace must show request and
response events instead of silently treating them as consumed internals.

## Implementation Plan

1. Add the design record and tests that pin retired surfaces:
   `steer_subagent` is no longer in the orchestrator tool pool and
   `restart_from_stage` is no longer advertised for ordinary worker repair.
2. Add `engine/agent-coordination.ts` with request/response artifact helpers,
   normalizers, list-pending projection, and response state updates.
3. Add `tool/request-orchestrator-decision.ts`, register it in global tools,
   and mount it through worker tool pools that run under task context.
4. Add `respond_agent_coordination` to orchestrator private tools and remove
   `steer_subagent`.
5. Add task description rendering for pending coordination requests.
6. Extract a task-agent lifecycle collector from current cancel/shutdown
   primitives and call it from `cancelTask`.
7. Add selective-continuation helper for request-bound responses and worker
   redispatch decisions. It validates runtime contract before appending a
   response message.
8. Update overlay event policy and any SDK/OpenAPI schema projections needed
   for the new events.
9. Replace and expand tests:
   - hard task cancel closes root subtree, ownership child, goal_run session,
     active run session, and queued prompts;
   - worker request persists an artifact, publishes an event, and wakes the
     orchestrator;
   - orchestrator response cannot target a request from another task;
   - continue response appends a visible worker message and resumes the same
     session when runtime contract validates;
   - continue response refuses and reports when the contract is missing;
   - old `steer_subagent` is absent from tools and docs;
   - `TaskReportTool` remains status telemetry, not A2A;
   - overlay policy does not consume coordination events silently.

## Acceptance

- Cancelling a task produces one auditable lifecycle report and leaves no
  task-owned active prompt/session/tool ownership/goal_run/run handle behind.
- Workers can request orchestrator decisions through a visible artifact/event
  and the task orchestrator wakes from that request.
- Orchestrator responses are bound to a pending request id. There is no generic
  private steering channel.
- Existing worker sessions are resumed when their runtime contract validates.
  Fresh sessions are used only for the concrete unrecoverable cases listed in
  this spec.
- `steer_subagent` and ordinary `restart_from_stage` repair guidance are not
  part of the final tool surface.
- Tests cover cancel, request/response, continuation, missing-contract refusal,
  and event visibility.
