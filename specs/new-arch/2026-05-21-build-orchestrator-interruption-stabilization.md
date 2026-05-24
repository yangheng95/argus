# 2026-05-21 Build Orchestrator Interruption Stabilization

## Problem

The G1/G2/G3 incident in task `tsk_e48e90d6c001TR5c16ATxGGKkb`
exposed one coupled failure, not three unrelated bugs:

1. A task-level direct build successfully repaired and merged the integrity
   findings.
2. While that build was settling, the orchestrator also superseded goal
   contracts and dispatched a per-goal retry.
3. The orchestrator re-entered while the per-goal build tool call was still
   unresolved, interpreted the unresolved tool execution as interrupted, tried
   to steer the build session through the generic direct-reply path, hit a
   stale terminal runtime contract, then cancelled the build attempt.
4. The cancelled session state was deleted before the old prompt loop had
   actually settled, so the same-session retry overlapped with the previous
   build loop and produced runtime contract mismatch errors.
5. The overlay card projection then made the situation look even more random:
   build session messages can be split across multiple visible cards inside
   the same runtime session.

The visible symptom was "build was interrupted for no reason". The actual
cause was orchestrator recovery logic acting on stale/incomplete lifecycle
facts while runtime session cancellation and retry were not atomic.

## Evidence From The Incident

Observed artifact/session facts:

- No `orchestrator-stream-error` artifact was present.
- No pending interaction blocked the task.
- G2V2 never ran. G2 was pending because its old tip was superseded by
  `modify_goal`, not because a second build failed.
- The task-level direct build session completed, merged, and reported passed
  after fixing the three integrity findings.
- The per-goal G1V2 build tool call was still unresolved when a later
  orchestrator turn claimed its tool execution had been interrupted.
- `steer_subagent` failed with
  `SessionRuntimeContract terminal collector is already satisfied`.
- `cancel_subagent` then marked G1V2 aborted.
- A later build continuation failed with a runtime contract mismatch:
  expected the new goal run id, found the previous goal run id.

Current code evidence:

- `packages/opencorvus/src/orchestrator/loop.ts` serializes
  `runTaskLoop()` calls by `taskID`, but `interruptTaskLoop()` can delete the
  chain tail to escape a zombie promise.
- `packages/opencorvus/src/orchestrator/agent.ts` starts each wake by aborting
  any currently running orchestrator pass.
- `packages/opencorvus/src/engine/queue.ts::dispatchTaskLoop` attaches a new
  loop completion handler for an already-active task without checking whether
  the current wake is blocked inside an unresolved orchestrator tool call.
- `packages/opencorvus/src/orchestrator/tools.ts::steer_subagent` calls
  `EngineService.replyAgentSession`, the generic manual direct-reply path.
- `packages/opencorvus/src/task-api/index.ts::appendDirectAgentSessionReply`
  validates the current session runtime contract but does not create a fresh
  build/stage attempt contract.
- `packages/opencorvus/src/orchestrator/tools.ts::cancel_subagent` calls
  `SessionPrompt.cancel()` and immediately mutates the goal run to aborted.
- `packages/opencorvus/src/session/prompt/state.ts::cancel` aborts the
  controller, rejects callbacks, deletes the session state immediately, and
  marks the session terminal.
- `packages/opencorvus/src/session/loop.ts` already validates
  `SessionRuntimeContract` identity and satisfied terminal collectors before
  contacting the model.
- `packages/opencorvus/src/orchestrator/tools.ts` and
  `packages/opencorvus/src/engine/persist.ts` already moved build attempts
  toward non-null `session_id` and `build_session_contract` artifacts, but the
  lifecycle around wake/retry/cancel is not yet closed.
- `packages/overlay/src/services/tree-writer.ts` now has
  `messageCardIDs`, `activeCardID`, and target-card-aware `partIndex`; this is
  correct for orchestrator interleaving, but build/phase presentation still
  needs a clear attempt-vs-message display rule.

## Current State

### Build Attempt Persistence

The build path is partly on the desired architecture:

- `beginBuildAttempt` requires a concrete `sessionID`.
- A retry opens a new logical `goal_run_id`.
- The build session can be reused.
- `build_session_contract` artifacts exist.
- Runtime contracts include identity and terminal collector validation.

Remaining gap:

- The owning orchestrator tool call does not have exclusive ownership of the
  opened attempt until it returns terminal evidence.
- A later orchestrator wake can reason about that same attempt before the
  build tool call has returned.

### Orchestrator Wake Semantics

The intended model is "one wake equals one decision pass".

Remaining gap:

- The system has no durable "orchestrator turn is currently blocked in tool X"
  fact. External wakes can enqueue or interrupt, but the orchestrator can still
  produce later turns that treat an unresolved tool call as an interrupted
  child rather than as an in-flight owned operation.

### Steering And Cancellation

`steer_subagent` is still a generic direct reply into a child session.

Remaining gap:

- Build/stage sessions are not ordinary chat sessions. They require a fresh
  stage-attempt runtime contract with live tool closures and a fresh terminal
  collector. Generic direct reply is therefore the wrong entry point for build
  recovery.

`cancel_subagent` returns before the prompt loop is fully settled.

Remaining gap:

- Same-session retry can begin while the old provider/tool execution is still
  unwinding, so runtime contracts race.

### Goal Status Semantics

The current projection still encourages the orchestrator to treat goal status
as a hard completion gate after `modify_goal`.

Remaining gap:

- Goal status is an advisory implementation-attempt projection. If task-level
  build evidence already repaired the rejected behavior, the orchestrator
  should verify/deliver from evidence instead of forcing every superseded goal
  to rerun.

### Overlay Card Projection

The message-turn/contiguous-session design is mostly present in overlay code.

Remaining gap:

- Build sessions are special because they can be represented both as
  goal-phase cards and as runtime session message turns. The UI needs one
  explicit projection rule so "same build session, multiple visible cards"
  is either intentional phase segmentation or rejected as a projection bug.

## Root Causes

1. **Missing active-tool ownership invariant.** A build tool call that opened a
   goal attempt must own that attempt until the tool call returns, fails, or is
   explicitly cancelled by a real operator action or real idle timeout.

2. **Generic steering path for stage sessions.** `steer_subagent` can append a
   normal user message to a stage session without installing a new stage
   contract, so it collides with stale terminal collectors.

3. **Non-atomic cancellation.** `SessionPrompt.cancel` releases the session
   busy slot immediately. That makes cancellation visible as terminal before
   the old loop/provider/tool stack has actually stopped writing.

4. **Task-level build and per-goal build share completion signals without a
   strict scope boundary.** A task-level direct build completion can wake the
   orchestrator while a per-goal build tool is still live, making the model
   read inconsistent "build done" and "goal build running" facts.

5. **Goal status is overused as a workflow gate.** `modify_goal` supersession
   should be an implementation lineage fact, not a mandatory rebuild command
   when later evidence already satisfies the task.

6. **Overlay card identity and workflow attempt identity are still easy to
   conflate.** A message-turn card split is a display projection; a
   `goal_run_id` is an attempt projection; a `session_id` is the runtime
   conversation. The UI and board need to present these as separate axes.

## Target Invariants

1. A per-goal build attempt has exactly one owner while it is live: the
   orchestrator `build` tool invocation that opened it.
2. No orchestrator wake may steer, cancel, supersede, or redispatch a live
   attempt owned by an unresolved tool invocation.
3. A build/stage session can continue only through an entry point that installs
   a fresh matching `SessionRuntimeContract`.
4. Generic direct reply is not a build/stage recovery mechanism.
5. Cancellation is terminal only after the session prompt loop has settled.
6. Retry cannot start until the prior same-session attempt is fully settled.
7. Task-level direct build completion and per-goal build completion are scoped
   separately in artifacts, workflow events, and UI messages.
8. Goal status is advisory. Delivery/verification decisions are evidence-based,
   not "all goal rows must be completed".
9. Overlay card identity is message-display identity. Attempt identity remains
   `goal_run_id`; runtime identity remains `session_id`.

## Design

### 1. Add Build Tool Ownership Facts

When the orchestrator `build` tool opens a goal attempt, persist an append-only
artifact:

```ts
kind: "orchestrator_tool_ownership"
payload: {
  task_id: string
  orchestrator_session_id: string
  orchestrator_message_id: string
  tool_part_id: string
  tool_name: "build"
  goal_id?: string
  goal_run_id?: string
  child_session_id: string
  scope: "task" | "goal"
  time_started: number
  time_completed?: number
  outcome?: "completed" | "failed" | "cancelled"
  error?: string
}
```

This is not a workflow state machine. It is a data-integrity lease for an
irreversible side effect: one tool invocation owns one live child attempt.
The read model derives "live owner" from `time_completed == null`; no workflow
state is driven from the `outcome` label.

Rules:

- `build` writes the ownership start fact after the child session and goal
  attempt exist.
- `build` writes terminal ownership fields only when the tool returns or
  throws.
- `read_context` exposes live ownership facts.
- `steer_subagent`, `cancel_subagent`, `modify_goal`, and `build` must reject
  attempts to mutate a child session or goal run that has a live owner unless
  the caller is the owner or the user explicitly requested cancellation.
- `orchestrator_message_id` and `tool_part_id` must come from the real
  assistant tool-call part that is executing. Generating placeholder ids would
  violate the no synthetic message/card rule and would make ownership
  unauditable.
- `goal_run_attempt`, `orchestrator_tool_ownership`, and
  `build_session_contract` must be opened as one structural failure boundary.
  If any write fails, the build agent is not contacted and no live attempt is
  left without an owner.

### 2. Serialize Orchestrator Wakes At Active Tool Boundary

`runTaskLoop` can still serialize task wakes, but a wake that arrives while
the active orchestrator message has an unresolved tool call must be appended as
a real operator/task event for the next pass, not interpreted as "the tool was
interrupted".

Implementation shape:

- Detect unresolved tool ownership before starting a new orchestrator prompt.
- Store the wake event as queued context for the next orchestrator pass.
- Do not call `Orchestrator.processTask` again until owned tool invocations
  are terminal.
- `dispatchTaskLoop({ interrupt: true })` must also obey this gate. Operator
  messages can interrupt ordinary idle reasoning, but they must not abort an
  orchestrator pass that is blocked inside a live owned build tool call.
- Queued wake context must be persisted as a real visible fact: operator
  message, protocol event, or engine artifact. It must not live only in a
  process-local pending map, because reconnect/hydrate must explain why the
  next wake happened.

This remains prompt-over-host for decisions: the host is not choosing the next
workflow action; it is preserving the atomicity of an already-started tool
effect.

### 3. Split Stage Recovery Entry Points

Keep `EngineService.replyAgentSession` for manual conversation steering of
non-stage sessions.

Add explicit stage recovery APIs:

- `BuildAgent.continueAttempt(...)` for live build continuation with a matching
  runtime contract.
- `BuildAgent.retryAttempt(...)` for terminal prior attempts, same session,
  fresh `goal_run_id`, fresh collector, fresh runtime contract.

Rules:

- `steer_subagent` must not call `replyAgentSession` for build/stage sessions.
- For a live build attempt, `steer_subagent` returns a read-only activity
  snapshot with session status, last activity timestamp, activity age, and live
  ownership ids. The orchestrator uses this evidence to keep waiting or, when
  stale evidence is concrete, call `recover_stale_build`.
- For a terminal build attempt, `steer_subagent` returns a structural error:
  "stage session cannot be steered generically; use build retry".
- Build retry must not call `EngineService.replyAgentSession` or
  `appendDirectAgentSessionReply`.
- External executor retry inherits the build retry runtime contract plan:
  retry must call `provider.resume` with a provider-native resume reference.
  Missing native resume reference is a structural error; it must not call
  `provider.run`, open a new session, or replay the full prompt.

Why amended: `2026-05-24-steer-subagent-probe-snapshot.md` preserves the
no-`replyAgentSession` invariant but replaces the live-owned build error shape
with a read-only snapshot so the orchestrator can distinguish active from stale
live ownership before deciding whether recovery is justified.

### 4. Make Cancellation Settled, Not Immediate

Replace fire-and-forget cancellation for stage sessions with:

```ts
cancelSessionAndWait(sessionID, {
  reason,
  idleTimeoutMs,
}): Promise<{ settled: true }>
```

Rules:

- Abort is requested immediately.
- The session remains busy until `SessionPromptState.finish` observes the same
  abort signal or an explicit settled event fires.
- Pending callbacks are rejected, but the busy slot is not deleted until
  settled.
- `SessionPrompt.cancel` itself must not clear the runtime contract before the
  old loop has settled. The wrapper in `session/prompt/index.ts` is part of
  this change, not only `session/prompt/state.ts`.
- `cancel_subagent` updates the goal run to aborted only after settled.
- Retry dispatch must reject if the prior same-session loop has not settled.
- Timeout is based on no activity after abort request, not wall time from
  process start.
- Activity sources for cancel wait are message/part deltas, session status,
  provider events, and tool events. A process-local map signature is not
  sufficient evidence of inactivity.

### 5. Scope Build Completion Signals

Every build completion fact must carry `scope`:

- `scope="task"` for direct task build.
- `scope="goal"` with `goal_id` and `goal_run_id` for per-goal build.

Rules:

- A task-level build completion cannot close, supersede, or imply completion of
  a per-goal attempt.
- A per-goal build completion cannot mark the whole workflow build step done
  unless the orchestrator explicitly decides that from evidence.
- Workflow projections may show both facts, but the orchestrator prompt must
  label them separately.

### 6. Make Goal Status Advisory In Prompts And Projections

Update orchestrator prompt/context language:

- Goal status describes the latest implementation attempt.
- Superseded/pending goal status is not itself a mandatory rebuild command.
- If direct build, delivery evidence, or integrity evidence already satisfies
  the requirement, choose verification/delivery rather than retrying a goal for
  cosmetic status convergence.

Host code should not auto-route this. The prompt/context must make the evidence
model explicit so the LLM decides.

`modify_goal` must also respect live ownership. If the goal has a live owned
goal run, the tool must reject the goal row mutation itself; it is not enough
to avoid superseding or aborting the current run. A contract mutation while a
build owner is editing against the old contract recreates the same ambiguity
that caused this incident.

### 7. Define Overlay Build Projection

For non-phase top-level agent sessions:

- Keep contiguous-session message cards.
- Multiple cards for one `session_id` are valid only when another visible
  session interrupted the timeline between them.

For goal build phase sessions:

- The goal phase card is the primary board projection.
- Attempt labels and files use `goal_run_id`.
- Trace/reply/cancel use `session_id`.
- If build messages are displayed outside the phase card, the UI must label
  them as turns of the same session and must not imply separate build agents.

Regression rule:

- Same build session, consecutive messages, no visible intervening session:
  one card.
- Same build session, visible other session in between: split cards are valid
  contiguous-session segments.
- Goal phase card and top-level session card must not both claim to be the
  canonical build attempt status.

## Source Inventory

| Area | Current source | Decision |
| --- | --- | --- |
| Orchestrator loop serialization | `packages/opencorvus/src/orchestrator/loop.ts` | Keep task-chain serialization, add active-tool ownership gate before new prompt. |
| Queue dispatch | `packages/opencorvus/src/engine/queue.ts` | Queued wakes for active tasks must not bypass active tool ownership. |
| Orchestrator wake | `packages/opencorvus/src/orchestrator/agent.ts` | Stop aborting a running orchestrator pass as a normal preamble when it is blocked in an owned tool call. |
| Build tool | `packages/opencorvus/src/orchestrator/tools.ts` | Persist tool ownership and scope; terminalize ownership with tool result. |
| Steer tool | `packages/opencorvus/src/orchestrator/tools.ts` | Reject build/stage generic steering; do not call `replyAgentSession` for stage sessions. |
| Cancel tool | `packages/opencorvus/src/orchestrator/tools.ts` | Use cancel-and-wait for stage sessions before mutating goal run status. |
| Cancel wrapper | `packages/opencorvus/src/session/prompt/index.ts` | Do not clear runtime contract before settled cancellation. |
| Other cancel callers | `packages/opencorvus/src/agent/runner.ts`, `packages/opencorvus/src/engine/writer.ts`, `packages/opencorvus/src/executor/opencorvus.ts`, `packages/opencorvus/src/tool/task.ts`, `packages/opencorvus/src/server/routes/session.ts`, `packages/opencorvus/src/server/routes/orchestrator.ts`, `packages/opencorvus/src/task-api/index.ts` | Classify each caller as hard operator cancel, stage cancel-and-wait, or non-stage immediate cancel. |
| Direct reply API | `packages/opencorvus/src/task-api/index.ts` | Remains manual reply only; not a build retry or stage recovery path. |
| Session cancellation | `packages/opencorvus/src/session/prompt/state.ts` | Do not delete busy state until prompt loop settles. |
| Runtime contract validation | `packages/opencorvus/src/session/loop.ts` | Keep identity validation; add tests for retry-after-cancel and generic steer rejection. |
| Build attempt persistence | `packages/opencorvus/src/engine/persist.ts` | Keep non-null `sessionID`; prevent live owner supersession. |
| Build agent | `packages/opencorvus/src/build/agent.ts` | Split live continue/retry entry points from first-run session creation. |
| External build executor | `packages/opencorvus/src/build/agent.ts`, `packages/opencorvus/src/executor/session-ref.ts` | Retry must use provider-native `resume`; no run/full-replay fallback. |
| Goal contract mutation | `packages/opencorvus/src/orchestrator/tools.ts::modify_goal` | Reject contract row mutation when the goal has a live owned run. |
| Overlay writer | `packages/overlay/src/services/tree-writer.ts` | Preserve contiguous-session card identity; add build-specific projection regressions. |
| Goal phase card ids | `packages/overlay/src/services/tree-writer.ts::goalStepCardID` | Decide explicitly whether retries share one rolling phase card; do not imply `goal_run_id` card identity if implementation discards it. |
| Board goal run projection | `packages/opencorvus/src/workbench/board.ts` | Fix delivered-vs-tip `goalRunID` projection if Files/status panels need current attempt identity. |
| Conversation hydrate | `packages/overlay/src/services/tree-writer.ts` and `packages/opencorvus/src/conversation/view.ts` | Hydrate must match live contiguous-session projection. |
| Orchestrator prompt | `packages/opencorvus/src/prompt/core/orchestrator-core.txt` | Remove wording that turns advisory pending/failed goal status into a mandatory final-integrity blocker when evidence already satisfies the task. |

## Test Plan

### Unit / Integration

1. Active build ownership blocks a second orchestrator wake from starting a new
   prompt while the build tool call is unresolved.
2. `steer_subagent` rejects a live build session with a structural error and
   does not call `EngineService.replyAgentSession`.
3. `steer_subagent` rejects a terminal build session with a stale/satisfied
   collector and tells the orchestrator to use build retry.
4. `cancel_subagent` waits for session settlement before marking the goal run
   aborted.
5. Same-session retry is rejected while the prior loop has not settled.
6. After cancellation settlement, retry installs a fresh runtime contract and
   old terminal collector state cannot satisfy the new attempt.
7. Task-level direct build completion does not terminalize a live per-goal
   attempt.
8. `modify_goal` cannot supersede a live goal run owned by an unresolved build
   tool invocation.
9. Orchestrator context labels goal status as advisory and task/goal build
   evidence separately.
10. The G1V2-style timeline regresses to: one build owner, no generic steer,
    no premature cancel, no runtime contract mismatch.
11. Existing tests that expect `steer_subagent` to call
    `EngineService.replyAgentSession` for build sessions are changed to expect
    structural rejection.
12. Existing tests that expect immediate `cancel_subagent` goal abort are
    changed to expect settled cancellation.

### Overlay

1. Consecutive messages from the same build session hydrate and stream into one
   visible segment card.
2. Messages from the same build session separated by a visible orchestrator
   card become two segment cards with the same `sessionID`.
3. Goal phase card status is keyed by `goal_run_id`; trace/reply/cancel is
   keyed by `session_id`.
4. Late deltas for an older build message land in the owning card, not the
   newest active card.
5. `goalStepCardID` and board `goalRunID` projection have explicit tests for
   the three identity axes: `session_id`, `goal_run_id`, and message card id.

## Rollout Order

1. Add tests for the incident timeline before changing behavior.
2. Add tool ownership artifact and read-model projection.
3. Make goal attempt, ownership, and build session contract creation one
   structural failure boundary.
4. Gate orchestrator wake start, including `interrupt:true`, on live owned
   tool calls.
5. Split `steer_subagent` behavior for stage sessions and add structural
   errors.
6. Implement cancel-and-wait and block retry until settled across all cancel
   callers.
7. Scope task-level and goal-level build completion facts in context and UI.
8. Adjust orchestrator prompt/context wording so goal status is advisory.
9. Add overlay build projection regressions.
10. Re-run the original task flow or a minimized benchmark with the same event
   ordering.

## Non-Goals

- Do not add a fallback path that retries with a new build session when
  same-session retry fails.
- Do not let generic direct reply become a hidden stage continuation path.
- Do not introduce synthetic messages or UI-only build cards.
- Do not use goal status convergence as a substitute for evidence-based
  verification.
- Do not add host-side workflow routing that decides whether to retry,
  deliver, or verify. The host only protects data integrity and live ownership.

## Acceptance Criteria

- The original incident timeline cannot produce a generic steer into a build
  session.
- The original incident timeline cannot cancel G1V2 unless the build owner has
  terminalized or the operator explicitly cancels it.
- Same-session retry cannot overlap with an old loop.
- Direct task build pass and per-goal build running are presented as distinct
  scoped facts.
- G2 does not appear as "failed V2" when no G2V2 attempt ran.
- Build cards make clear whether a visible split is a contiguous timeline
  segment or a separate attempt; they never imply separate runtime sessions
  when `session_id` is the same.
- All new behavior is covered by tests before implementation is considered
  complete.

## Independent Review Integration

Codex independent review on 2026-05-21 accepted the primary root cause but
required the following corrections, now reflected above:

- `SessionPrompt.cancel` wrapper behavior is in scope because it currently
  clears runtime contracts before the old loop settles.
- Cancellation call sites must be classified across the repository, not only
  in `cancel_subagent`.
- Active ownership writes must be atomic with goal attempt and build contract
  creation.
- Ownership ids must be real message/tool-part ids.
- `modify_goal` must reject live owned goal contract mutation.
- `dispatchTaskLoop({ interrupt: true })` must respect live build ownership.
- External executor retry must keep using provider-native `resume` only.
- Queued wake context must be visible and hydratable.
- Ownership uses append-only facts plus derived liveness, not a host workflow
  state machine.
- Overlay projection must reconcile existing rolling phase-card ids with
  attempt/file status keyed by `goal_run_id`.
