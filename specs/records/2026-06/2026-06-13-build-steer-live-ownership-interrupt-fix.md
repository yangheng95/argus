# 2026-06-13 Build Steer Must Not Interrupt Live Owned Goals

> Superseded for overlay targeted steer on 2026-06-29 by
> [2026-06-29-operator-steer-single-source.md](2026-06-29-operator-steer-single-source.md).
> This record remains historical evidence for live-ownership queuing, but its
> overlay build guidance contract is no longer current. Current contract:
> targeted build/sub-agent steer uses
> `POST /task/:taskID/session/:sessionID/operator-steer`; task-root
> `/task/:taskID/message` no longer accepts `target`, `build_session`, or
> `agent_session` payload fields.

## Problem

Sending an operator message from a failed build card can cancel other parallel
goal builds. The user-facing action looks like a targeted "resume / steer this
build" action, but the backend currently routes it as a task-level operator
interrupt. When the task has live orchestrator tool ownership, the queue layer
turns that interrupt into `abortLiveOrchestratorToolOwnership()` across every
current-process live owner for the task.

This is the wrong abstraction boundary. A task wake may interrupt idle
orchestrator reasoning, but it must not cancel live child tool executions unless
the operator invoked an explicit cancel surface for a concrete target.

## Evidence From Current Repo

### Frontend Route

| Surface                                                          | Current behavior                                                                                                                                        | Consequence                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `packages/overlay/src/components/Card.tsx`                       | Build cards wrap the reply text with `Build session steering from overlay.` and call `sendTaskOperatorMessage(..., { source: "overlay_build_steer" })`. | The UI knows this is build-targeted guidance. |
| `packages/overlay/src/components/ChatBubble.tsx`                 | Same build-stage routing as `Card.tsx`.                                                                                                                 | Same issue for top-level build message cards. |
| `packages/overlay/src/services/task.ts::sendTaskOperatorMessage` | Posts `{ text, source }` to `POST /task/:taskID/message`.                                                                                               | Source is available at the route boundary.    |

### Backend Message Route

| Surface                                                                       | Current behavior                                                                                      | Consequence                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `packages/opencorvus/src/engine/model.ts::TaskMessageInput`                   | Accepts `source?: string`.                                                                            | The API contract has a structured source field.    |
| `packages/opencorvus/src/task-api/index.ts::handleTaskMessage`                | Records `source`, but calls `continueTaskMessage(taskID, input.text, attachmentRefs)` without source. | Dispatch semantics lose the source.                |
| `packages/opencorvus/src/task-api/index.ts::appendAndWakeTaskOperatorMessage` | Always calls `dispatchTaskLoop({ ..., interrupt: true })`.                                            | Every task message becomes a task-level interrupt. |

### Queue / Ownership

| Surface                                                                        | Current behavior                                                                                                           | Consequence                                                                       |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/opencorvus/src/engine/queue.ts::dispatchTaskLoop`                    | If `interrupt === true` and live ownership exists, calls `abortLiveOrchestratorToolOwnership({ ownerships: liveOwners })`. | One operator message cancels all live owned build/integrity children in the task. |
| `packages/opencorvus/src/engine/writer.ts::abortLiveOrchestratorToolOwnership` | Cancels each child session, aborts the goal run if present, closes the tool part, and marks ownership `cancelled`.         | Sibling goal runs are terminalized as aborted.                                    |
| `packages/opencorvus/src/orchestrator/tools.ts::cancel_subagent`               | Uses `abortLiveOrchestratorToolOwnership` with a single resolved owner.                                                    | This is the correct explicit-cancel surface.                                      |

### Test Drift

`specs/records/2026-06/2026-06-06-integrity-wake-ownership-fix.md` says:

- `dispatchTaskLoop({ interrupt: true })` with live ownership must queue the
  wake behind live ownership.
- Operator interrupts must preserve the atomicity of a tool call already
  accepted by the model.

Current `packages/opencorvus/test/engine/queue.test.ts` now asserts the opposite:

- Test name: `interrupting a live-owned active task aborts the child goal and starts a new wake`.
- It expects `interruptTaskLoop` to run, the goal run to become `aborted`, and
  live ownership to be cleared.

`git blame` points the inversion to commit `5350412c60`
(`fix(engine): interrupt live-owned build goals`, 2026-06-07). That commit
overrode the 2026-06-06 ownership invariant and made the regression permanent
by changing the test expectation.

## Root Cause

Two locally reasonable changes were composed without preserving the global
ownership invariant:

1. Build direct reply was correctly forbidden because build sessions require a
   fresh stage runtime contract.
2. The overlay was changed to send build guidance through the task operator
   message route.
3. The task message route always dispatches with `interrupt: true`.
4. Queue-level `interrupt: true` was later given the power to cancel every live
   owner in the task.

The actual bug is not "build steer uses task message". The bug is that the queue
layer treats a wake scheduling hint as a destructive cancellation command.

## Impact

- Replying to one failed build card can abort unrelated live goal builds in the
  same task.
- Mission child-task terminal notifications that call the task message path with
  `interrupt: true` can also collide with live ownership.
- Any future UI/API caller using `/task/:taskID/message` inherits destructive
  behavior even if it only intended to append context.
- The current test suite protects the wrong behavior in `queue.test.ts`.
- Because `handleTaskMessage` drops `source` before dispatch, the backend cannot
  distinguish build steer, ordinary user note, panel tool note, or lineage note
  at the scheduler boundary.

## Non-Fixes

- Do not parse `Build session steering from overlay.` from message text. That is
  keyword routing and will create another hidden control channel.
- Do not make build direct reply accepted by adding `build` to
  `DIRECT_REPLY_AGENT_KINDS`.
- Do not add a fallback that retries a build with a new session when same-session
  resume fails.
- Do not preserve queue-level live-owner abort for "operator convenience". It is
  not target-scoped and violates live ownership.
- Do not hide or disable the build reply UI as a substitute for fixing routing.

## Target Invariants

1. A task operator message can wake the orchestrator, but it cannot cancel live
   tool ownership.
2. `dispatchTaskLoop({ interrupt: true })` may interrupt idle orchestrator
   reasoning only when no live current-process ownership is present.
3. When live ownership is present, every task wake is queued behind ownership,
   regardless of `interrupt`.
4. Explicit cancellation remains available only through target-scoped APIs:
   `cancel_subagent`, `/task/:taskID/session/:sessionID/cancel`, or task cancel.
5. Build guidance from the overlay remains visible task-root input, but its
   source and target must be structured facts, not only text.
6. Build retry/continuation still requires a fresh matching
   `SessionRuntimeContract`; generic direct reply remains forbidden.

## Design

### 1. Remove Destructive Queue Interrupt

Change `dispatchTaskLoop` so the live ownership branch always queues the event:

```ts
if (liveOwners.length > 0 && loopInFlightFor(task.id)) {
  if (input.event) queuedTaskEvents.set(task.id, input.event)
  log.info("dispatchTaskLoop: queued wake behind live orchestrator tool ownership", ...)
  return "queued"
}
```

Do not call `abortLiveOrchestratorToolOwnership` from `engine/queue.ts`.
Do not call `launchTaskLoop(..., interrupt=true)` from this branch.

`abortLiveOrchestratorToolOwnership` remains valid for explicit cancel surfaces
that pass a target owner or an explicit task-cancel path that intentionally owns
the whole task.

### 2. Preserve Source And Target As Durable Message Facts

Independent review correction: source/target must not live only in
`OrchestratorEvent`. `queuedTaskEvents` is a process-local single
`Map<taskID, OrchestratorEvent>`; later wakes can overwrite earlier events, and
restart/hydrate cannot explain queued wake causality from that map. The durable
single source must be the visible task-root user message and its anchored event
metadata.

Extend the task message service path so source/target metadata survives as
durable facts:

- `continueTaskMessage(taskID, text, attachments, source?)`
- `appendAndWakeTaskOperatorMessage({ ..., source })`
- `appendTaskSessionMessage(..., extra.operator_message_source/target)` or an
  equivalent `Message.User.extra` shape anchored to the message id
- `EngineProtocol.emit(Event.TaskMessageRecorded, ...)` with the same source and
  target anchored to the same message id
- `OrchestratorEvent.operatorMessage.source/target` as a projection of the
  persisted fact, not the only source

For build cards, add structured target metadata rather than relying on text:

```ts
operatorMessage: {
  text,
  attachmentSummary,
  source: "overlay_build_steer",
  target: {
    kind: "build_session",
    sessionID,
    goalID,
  },
}
```

The orchestrator may read this as context and choose whether to wait, inspect,
or dispatch a build retry. The host must not directly route the build from this
metadata unless implementing the explicit build retry entry point from the
2026-05-21 runtime-contract plan.

Machine semantics must read only the structured target. The visible build
guidance header is operator-facing display text and must either be generated
from the same structured target or reduced to non-authoritative prose. No host,
orchestrator tool, or test may parse `Target build session:` or `Target goal:`
from message text.

### 3. Keep Explicit Cancel Target-Scoped

No change to the existence of `cancel_subagent` or session cancel. The required
constraint is that they must resolve one concrete target owner/session before
calling cancellation. They must not use `listLiveOrchestratorToolOwnership(taskID)`
without narrowing unless the user explicitly cancels the entire task.

### 4. Repair Tests That Encode The Regression

Replace the current `queue.test.ts` expectation with the 2026-06-06 behavior:

- first `dispatchTaskLoop({ taskID })` starts a held loop;
- insert live ownership;
- `dispatchTaskLoop({ taskID, interrupt: true, event })` returns `"queued"`;
- `interruptTaskLoop` is not called;
- `runTaskLoop` is still called once while ownership is live;
- goal run remains live, not `aborted`;
- ownership remains live;
- after `completeOrchestratorToolOwnership`, release the held loop;
- queued event starts the second loop.

Add a second regression with two live goal owners: an operator message targeting
one build must not abort either sibling. This catches the exact user symptom.

### 5. Add Source Propagation Tests

- Overlay service test keeps posting `source: "overlay_build_steer"`.
- Backend route test asserts `handleTaskMessage` persists `source/target` on the
  visible task-root user message and `TaskMessageRecorded` event, then forwards
  the same values into `dispatchTaskLoop` event metadata.
- A build-card test asserts target session/goal metadata is sent structurally
  once the API schema supports it.

### 6. API / SDK Contract

Adding task-message `target` changes the public API. The implementation must
update all single-source generated surfaces together:

- `TaskMessageInput` Zod schema
- OpenAPI output
- JS SDK generated types/client
- overlay API caller types/tests

No overlay-only request field is allowed. If the backend schema does not accept
`target`, the overlay must not send it.

## Independent Review Feedback

Codex sub-agent review on 2026-06-13 accepted the root cause and required these
revisions:

| Finding                                                                                                                        | Revision                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `source/target` cannot live only in `OrchestratorEvent` because `queuedTaskEvents` is process-local and overwrites by task id. | Source/target must be persisted on the visible message and protocol event; `OrchestratorEvent` is only a projection. |
| Text header plus structured target can become a double source.                                                                 | Machine semantics must read only structured target; text is generated/display-only and never parsed.                 |
| Test matrix missed `/inject` and `panel.send_task_message`.                                                                    | Added coverage for both paths under live ownership.                                                                  |
| API target field requires OpenAPI/SDK sync.                                                                                    | Added schema/OpenAPI/SDK acceptance items.                                                                           |

Second independent review after the first implementation found two remaining
single-source violations:

| Finding                                                                                                                                                                                                                                           | Required fix                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/task/:id/message` still wrote the same operator text into `WorkbenchTaskNoteTable`, while also persisting a root-session message and `task.message` protocol event. `operator_notes` then rendered the Workbench copy without target/messageID. | Task message ingress must not call `recordNote(kind="operator_note")`. The root session user message plus `TaskMessageRecorded` event are the durable source. Workbench notes remain for distinct note/constraint/goal-update flows only. |
| `inject_operator_message` consumed the event text but called `EngineService.injectMessage` again, creating a second task message and dropping structured target/source/messageID.                                                                 | `inject_operator_message` must treat `input.operatorMessage` as an already recorded wake fact and return structured context to the orchestrator, not re-inject through `/inject`.                                                         |
| `source` was optional and filled by multiple `??` defaults.                                                                                                                                                                                       | Task message API callers must provide an explicit `source`; internal inject uses the single fixed source `api_inject`.                                                                                                                    |

## Test Matrix

| Test                                                                         | Expected                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `queue.test.ts`: interrupt with live build ownership                         | returns `queued`; no abort; no second loop until ownership closes               |
| `queue.test.ts`: interrupt with live integrity ownership                     | same as build                                                                   |
| `queue.test.ts`: two live owners, one operator message                       | neither owner is aborted by queue dispatch                                      |
| `orchestrator/tools.test.ts`: `cancel_subagent` live build                   | one selected owner is cancelled                                                 |
| `server/task-message-routes.test.ts`: `/task/:id/message`                    | records user message and dispatches wake with source metadata                   |
| `server/task-message-routes.test.ts`: `/task/:id/inject` with live ownership | records message/wake and does not abort any owner                               |
| `tool/panel-send-task-message-attachments.test.ts` or equivalent panel test  | `panel.send_task_message` uses the same non-destructive message path            |
| `overlay/agent-session-controls.test.ts`                                     | build card guidance posts task message with source/target, not direct reply     |
| `task-api/lineage-terminal-notification.test.ts`                             | child terminal notification wake remains a wake; it does not imply cancellation |
| OpenAPI / SDK generation checks                                              | `TaskMessageInput` target is documented and generated before overlay sends it   |

## Rollout Order

1. Update `queue.test.ts` to restore queued live-ownership semantics.
2. Remove the `abortLiveOrchestratorToolOwnership` call from `dispatchTaskLoop`.
3. Persist task message `source/target` on the visible message and protocol
   event; project those values into `dispatchTaskLoop`.
4. Extend `OrchestratorEvent.operatorMessage` with optional source/target as a
   projection only.
5. Update `TaskMessageInput`, OpenAPI, SDK, and overlay build guidance payload
   together so structured target is a real contract.
6. Run focused tests:
   - `packages/opencorvus/test/engine/queue.test.ts`
   - `packages/opencorvus/test/server/task-message-routes.test.ts`
   - `packages/opencorvus/test/task-api/lineage-terminal-notification.test.ts`
   - `packages/opencorvus/test/orchestrator/tools.test.ts`
   - panel task-message tests
   - `packages/overlay/test/agent-session-controls.test.ts`
7. Run typecheck and review the changed dispatch/cancel call sites.

## Acceptance Criteria

- Replying to a failed build card cannot abort a parallel live goal.
- `dispatchTaskLoop({ interrupt: true })` with live ownership queues the wake.
- Queue dispatch no longer imports or calls `abortLiveOrchestratorToolOwnership`.
- Explicit target-scoped cancellation still cancels the selected owner.
- Build direct reply remains rejected.
- Build guidance source/target are durable structured message/protocol facts,
  with `OrchestratorEvent` carrying only a projection.
- No code path parses build target identity from message text.
- OpenAPI and SDK include the target contract before overlay sends it.
- Tests no longer encode the 2026-06-07 destructive queue behavior.
