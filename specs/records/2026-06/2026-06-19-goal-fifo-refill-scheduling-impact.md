# Goal FIFO Refill Scheduling Impact Audit (2026-06-19)

## Terms

- FIFO (First In, First Out): first-ready work should be dispatched before later-ready work when capacity is available.
- DAG (Directed Acyclic Graph): the goal dependency graph; an edge means a goal cannot start until its dependency has passed.
- LLM (Large Language Model): the orchestrator model that decides graph diagnosis, repair, and build dispatch intent.
- UI (User Interface): the workbench or overlay projection. It must not become a scheduler source of truth.
- API (Application Programming Interface): the backend contract consumed by the UI and tools.
- DB (Database): the engine artifact store and task tables.
- SSE (Server-Sent Events): the event stream used by clients to observe backend updates.

## User Problem

The current goal execution model creates scheduling bubbles:

1. The orchestrator emits one assistant turn containing one or more `build({ goalID })` tool calls.
2. Each `build` call awaits `BuildAgent.run(...)`.
3. `AgentSemaphore` only FIFO-queues tool calls that have already been emitted by that assistant turn.
4. If goal `A` finishes early and unlocks downstream goal `C` while sibling goal `B` is still running, no new `build({ goalID: C })` call exists yet.
5. The root orchestrator turn cannot recompute the DAG until the current emitted build tool batch returns.

Therefore the bubble is not caused by the semaphore ordering itself. It is caused by the current source of scheduling truth: a synchronous model-issued tool-call wave, not a live refillable dispatch frontier.

## Design History Confirmed On Disk

Before changing code, these landed specs and source files were reviewed:

- `specs/current/architecture/16-unified-teardown.md`
  - Phase 5 removed `GoalPool`, `dispatch-queue`, and old dispatch tools.
  - Multi-goal parallelism became multiple `build({ goalID })` calls in the same orchestrator step.
  - `BuildAgent.run` became a synchronous tool implementation.
  - `AgentSemaphore` was introduced only as per-task parallelism accounting and FIFO waiting for already-issued calls.
- `specs/records/2026-06/operator-wake-status-facts-not-scheduler-2026-06-17.md`
  - Runtime monitoring is framed as fact observation, not a host-side scheduler.
- `specs/records/2026-06/goal-batch-wake-natural-message-2026-06-04.md`
  - Batch settlement wakes must be real engine facts, not synthetic user messages.
- `specs/records/2026-06/2026-06-06-integrity-wake-ownership-fix.md`
  - Durable wake facts dedupe orchestrator wake attempts.
- `specs/records/2026-06/2026-06-07-goal-batch-notification-preserve-stream-error.md`
  - Stream-error blocked runs must not be resumed by liveness automation.
- `specs/records/2026-06/2026-06-19-final-visual-qa-scoped-build-context.md`
  - Visual QA is final-task scoped. This change must not restore per-batch visual QA behavior.

## Current Runtime Chain

### Dispatch Entry

- `packages/opencorvus/src/engine/queue.ts`
  - `dispatchTaskLoop` serializes root orchestrator loops per task.
  - If the active task has live `orchestrator_tool_ownership`, a new wake is queued instead of running immediately.
  - `drainQueuedTaskEvent` starts the queued wake only after ownership clears.

### Orchestrator Loop

- `packages/opencorvus/src/orchestrator/loop.ts`
  - `runTaskLoopInner` is a single-pass root loop.
  - It calls `Orchestrator.processTask(taskID, event)` and exits.
  - There is no internal loop that keeps dispatching newly-ready goals while sibling builds remain live.

### Build Tool

- `packages/opencorvus/src/orchestrator/tools.ts`
  - `build` checks active spec, dependency blockers, and live ownership.
  - `build` calls `await BuildAgent.run(...)`; the tool result returns only after the child build finishes.
  - `openGoalRunForBuildSession` begins the goal attempt and writes `orchestrator_tool_ownership`.
  - `finalizeBuildAttempt` writes terminal `goal_run_attempt` and acceptance facts.
  - Ownership closes after finalization and tool result construction, so a terminal goal event can exist while ownership is still live.

### Build Agent

- `packages/opencorvus/src/build/agent.ts`
  - `BuildAgent.run` wraps the whole build body in `AgentSemaphore.withSlot(input.task, ...)`.
  - Worktree and child session creation happen inside the acquired slot.
  - `onSessionCreated` is where the orchestrator tool opens the goal run and ownership.

### Semaphore

- `packages/opencorvus/src/engine/agent-semaphore.ts`
  - The semaphore is in-memory, per task, and intentionally not persistent.
  - It enforces `effectiveMaxAgentParallelism(task)`.
  - FIFO ordering applies only to waiters that already called `acquire`.
  - It cannot enqueue a downstream goal that the LLM has not yet dispatched.

### Runtime Monitor

- `packages/opencorvus/src/engine/runtime.ts`
  - `monitorRuns` polls active runs.
  - `syncNoLiveGoalRuns` wakes the orchestrator only when the active run has no live goal runs and no pending interactions.
  - It dedupes by a `goal_batch_notification` artifact fingerprint.
  - It deliberately preserves `orchestrator_stream_error` blocked runs.
  - A stale comment still mentions `GoalPool`; that is documentation debt.

### Event Model

- `packages/opencorvus/src/engine/model.ts`
  - `Event.GoalRunUpdated` exists and carries goal run status changes.
- `packages/opencorvus/src/engine/persist.ts`
  - `beginBuildAttempt`, `updateGoalRun`, and `finalizeBuildAttempt` emit `goal_run.updated`.
- Current production scheduling does not subscribe to `goal_run.updated`; it only polls run-level liveness.

### Context Projection

- `packages/opencorvus/src/engine/describe.ts`
  - `collaboration_closure.dispatchable_goal_ids` means never-dispatched goals whose dependencies passed.
  - Failed goals are surfaced separately as `failed_goal_ids`.
  - `recent_terminal_goal_batches` and rendered “Terminal goal batch wake facts” encode current batch semantics.

### Prompt Contract

- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
  - The prompt still teaches the model to dispatch `build({ goalID })`.
  - It contains batch/wave language such as recomputing after a build batch returns.
  - This prompt contract matches the current code and contributes to wave behavior.

### UI Projection

- `packages/opencorvus/src/workbench/board.ts`
  - Board data is derived from DB artifacts: goal runs, sessions, workspaces, acceptance, and events.
  - Board cache tags include `goal_run_attempt`, so terminal and running goal updates already refresh UI projections.
- `packages/overlay/src/services/event-policy.ts`
  - `goal_run.updated` is an allowed overlay event.
- Overlay components read `board.goalWorkflows`.
  - The UI is not the scheduler and should remain read-only projection.

## Full Callpoint Inventory

The following source and test surfaces are directly in scope for a no-bubble FIFO refill change:

| Surface                                | Current contract                                                 | Impact                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `engine/agent-semaphore.ts`            | FIFO only for already-issued build calls.                        | Keep as capacity primitive; do not treat it as DAG scheduler.                                       |
| `build/agent.ts`                       | Full build lifetime is inside `AgentSemaphore.withSlot`.         | If build dispatch becomes async, ownership/session creation timing must stay observable.            |
| `orchestrator/tools.ts`                | `build` is synchronous and returns after finalization.           | Core change point if `build` becomes start-and-return or if a new single dispatch tool replaces it. |
| `orchestrator/loop.ts`                 | Single-pass root loop.                                           | A refill design must define what wakes the next pass.                                               |
| `engine/queue.ts`                      | Queues wakes behind live ownership.                              | Must preserve duplicate prevention and drain queued wakes after ownership closes.                   |
| `engine/runtime.ts`                    | Wakes only at no-live-goal batch boundary.                       | Must change or augment if early terminal goal refill is required.                                   |
| `engine/persist.ts`                    | Emits terminal goal run events before all sibling builds finish. | Possible event source for refill wake; ownership timing must be respected.                          |
| `engine/model.ts`                      | Defines `goal_run.updated`.                                      | No schema gap for status events.                                                                    |
| `engine/describe.ts`                   | Surfaces dispatchable goals and terminal batch facts.            | Wording and facts likely need to move from batch to refill/frontier semantics.                      |
| `engine/store.ts`                      | Reads latest goal run attempts and batch notification artifacts. | May need a replacement artifact query if batch notification is replaced.                            |
| `engine/engine.sql.ts`                 | Goals have dependency list and order index; no cached status.    | FIFO can use existing order index and artifact-derived status.                                      |
| `prompt/core/orchestrator-core.txt`    | Teaches batch recompute and build dispatch.                      | Must be updated with the new scheduling contract.                                                   |
| `workbench/board.ts`                   | UI derives goal workflow state from artifacts.                   | Should remain projection only.                                                                      |
| `overlay` event policy and progress UI | Observes `goal_run.updated` and board state.                     | Should need little or no behavior change.                                                           |

## Tests Directly Affected

- `packages/opencorvus/test/engine/runtime-goal-run-convergence.test.ts`
  - Current tests assert no-live-goal batch wake behavior and batch dedupe.
  - These tests must be replaced or extended for early terminal refill.
- `packages/opencorvus/test/engine/agent-semaphore.test.ts`
  - Existing FIFO waiter tests should remain.
  - They are insufficient for DAG refill and need a higher-level scheduling regression.
- `packages/opencorvus/test/engine/queued-wake-ownership-drain.test.ts`
  - Must keep proving terminal updates during live ownership do not duplicate builds and queued wakes drain after ownership closes.
- `packages/opencorvus/test/engine/describe-bootstrap-active.test.ts`
  - Must continue proving dispatchable goal projection is correct.
- `packages/opencorvus/test/engine/zombie-task-revive.test.ts`
  - Existing no-live liveness expectations must be reviewed if runtime starts early terminal wakes.
- `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`
  - Prompt assertions for “first eligible pending goal” and batch language must change with the contract.
- `packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts`
  - Tool descriptions that tell the model to dispatch after `add_goal` or after a batch must change.
- `packages/opencorvus/test/orchestrator/tools.test.ts`
  - `read_context` tests for terminal goal batch facts must change if facts are renamed or semantics shift.

## Root Cause

The system currently has no persistent or event-driven dispatch frontier. The only place where a newly-ready goal can be chosen is a later orchestrator model turn.

`AgentSemaphore` correctly prevents over-capacity execution for build calls that already exist, but it cannot create a missing build call for a downstream goal unlocked by an early sibling completion.

`EngineRuntime.syncNoLiveGoalRuns` intentionally waits for all live goal runs to end. That makes the no-live wake a batch settlement mechanism. It cannot produce FIFO refill while any sibling goal remains live.

## Forbidden Approaches

This change must not:

- Reintroduce old `GoalPool` or `dispatch-queue` as a parallel compatibility path.
- Add a host-side gate or hidden state machine that decides retries, graph repair, task failure, or agent behavior.
- Add synthetic user messages or UI-only messages.
- Make the UI a scheduler source of truth.
- Restore Visual QA to per-batch behavior.
- Hide early failures by auto-retrying failed goals without LLM diagnosis.
- Leave old batch and new refill paths active as dual sources.

## Selected Architecture Direction

This repair uses the async build lifecycle with real wake facts as the single scheduling contract. The host observes durable facts and wakes the orchestrator; the LLM keeps ownership of graph diagnosis, failure handling, and which eligible goal to dispatch next.

### Async Build Lifecycle With Real Wake Facts

Make the build lifecycle no longer block the root orchestrator on a full emitted tool batch:

1. A dispatch action opens the goal run, creates the child session, records ownership, and returns the root tool result quickly.
2. The child build continues as the existing observable goal run/session/workspace stream.
3. Terminal build completion writes the same `goal_run_attempt`, acceptance, and decision-log artifacts.
4. A single backend wake fact is written after terminal completion or after queued ownership drain.
5. The root orchestrator wakes and reads `collaboration_closure.dispatchable_goal_ids`.
6. The LLM dispatches newly-ready goals or diagnoses failures.

This keeps graph reasoning with the LLM while removing the synchronous batch barrier. The backend observes facts and wakes; it does not decide graph repair.

### Rejected Direction For This Repair: Host FIFO Frontier As Sole Dispatch Source

If strict automatic FIFO dispatch is required, define a single host frontier that directly starts never-dispatched goals whose dependencies have passed:

1. The frontier orders goals by existing graph order index.
2. It dispatches only never-dispatched goals whose dependencies are passed.
3. It never retries failed or aborted goals.
4. It wakes the LLM for failure diagnosis and graph repair.
5. It replaces the synchronous model-issued parallel batch contract.

This is a larger architectural change because the host would choose successful-path build starts. If selected, it must be explicit in the spec and tests, not smuggled in as a liveness helper.

It is not selected for this repair because it would move success-path graph dispatch from the LLM into the host. That conflicts with the existing prompt-over-host rule unless the project deliberately decides to replace LLM-owned dispatch with a host-owned frontier. The current user-visible bubble can be fixed without that transfer by removing the synchronous build tool batch barrier.

## Detailed Repair Goal DAG

The implementation should proceed through these goals in order. A later goal must not begin until its dependencies have tests proving the new contract.

| Goal                                  | Depends on | Objective                                                                                                                                                                    | Primary files                                                                                                                                                                                                                                                          | Acceptance                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0 Contract lock                      | None       | Make this selected architecture the single written contract before code edits. Remove ambiguity that both batch scheduling and refill scheduling can coexist.                | This spec; `specs/records/2026-06/2026-06-29-spec-consolidation.md` if the project history index is updated.                                                                                                                                                                                        | The spec says async build lifecycle + terminal refill wake is selected; host FIFO frontier is explicitly rejected for this repair; no implementation step relies on both old batch and new refill semantics.                                                                                                                                       |
| G1 Async build start                  | G0         | Change `build({ goalID })` from "run child build to completion before returning" to "start child build, persist observable run/session state, then return a started result". | `packages/opencorvus/src/orchestrator/tools.ts`; `packages/opencorvus/src/build/agent.ts`; `packages/opencorvus/src/build/types.ts`; any new narrowly-scoped build lifecycle helper.                                                                                   | A mocked long build proves the root `build` tool returns after the goal run and session are created, before the child build completes; later child completion still writes the same terminal goal run, acceptance, and decision-log artifacts. No synchronous build-to-completion path remains.                                                    |
| G2 Live-build source of truth         | G1         | Replace child-build lifetime ownership as the duplicate-prevention source with goal-run/session facts that remain valid after the root tool result returns.                  | `packages/opencorvus/src/orchestrator/tools.ts`; `packages/opencorvus/src/engine/store.ts`; `packages/opencorvus/src/engine/persist.ts`; `packages/opencorvus/src/engine/queue.ts`.                                                                                    | A second `build({ goalID })` for a live goal run is rejected by a data-integrity check; a different goal can be dispatched while a sibling goal run is live; ownership close timing cannot suppress legitimate refill wakes.                                                                                                                       |
| G3 Terminal refill wake facts         | G2         | Replace no-live-goal batch settlement as the wake trigger with per-terminal-goal durable refill facts.                                                                       | `packages/opencorvus/src/engine/runtime.ts`; `packages/opencorvus/src/engine/engine.sql.ts`; `packages/opencorvus/src/engine/store.ts`; `packages/opencorvus/src/engine/describe.ts`; `packages/opencorvus/src/engine/model.ts` only if event payloads need extension. | When goal `A` reaches terminal status while sibling `B` is still live, runtime writes one refill notification and dispatches or queues a root orchestrator wake before `B` completes. Repeated monitor ticks do not create duplicate notifications or duplicate downstream starts. `orchestrator_stream_error` blocked runs are still not resumed. |
| G4 Refill context and prompt contract | G3         | Make describe/read_context/tool descriptions/prompt teach refill semantics instead of wave/batch semantics.                                                                  | `packages/opencorvus/src/engine/describe.ts`; `packages/opencorvus/src/orchestrator/tools.ts`; `packages/opencorvus/src/prompt/core/orchestrator-core.txt`; generated SDK/OpenAPI/docs only if public schema changes.                                                  | The model sees ordered `dispatchable_goal_ids`, recent terminal refill facts, failed goals requiring diagnosis, and live sibling goal runs. Prompt hygiene tests prove there is no instruction to wait for "current eligible wave" or "build batch" completion.                                                                                    |
| G5 FIFO refill behavior               | G4         | Ensure newly dispatchable goals are presented and acted on in deterministic FIFO order without host graph repair.                                                            | `packages/opencorvus/src/engine/describe.ts`; orchestrator prompt and tool tests; `packages/opencorvus/src/engine/agent-semaphore.ts` tests remain unchanged unless capacity plumbing changes.                                                                         | With goals `A`, `B`, `C(depends_on A)`, `D(depends_on A)` and `max_executor_groups = 2`, completing `A` while `B` is live causes the refill wake to surface `C` before `D`; the orchestrator dispatches in that order; semaphore FIFO still applies only to already-issued waiters.                                                                |
| G6 Early failure behavior             | G4         | Make failed goals wake the orchestrator immediately for diagnosis without auto-retry or hidden dependent failure.                                                            | `packages/opencorvus/src/engine/runtime.ts`; `packages/opencorvus/src/engine/describe.ts`; prompt/tool tests.                                                                                                                                                          | If `A` fails while `B` is live, a terminal refill fact is visible before `B` completes; dependents of `A` are not listed as dispatchable; host does not retry `A`; prompt directs the LLM to diagnose/modify/fail explicitly.                                                                                                                      |
| G7 UI and API projection              | G3, G4     | Keep board/overlay as artifact projections and update any schema/docs that changed names from batch to refill.                                                               | `packages/opencorvus/src/workbench/board.ts`; `packages/overlay/src/services/event-policy.ts`; overlay components only if display text references batch; `packages/sdk/*`; `packages/web/*`.                                                                           | UI updates from `goal_run.updated` and board invalidation as before. No front-end scheduler state is introduced. If `recent_terminal_goal_batches` is removed or renamed, SDK/OpenAPI/docs/tests are updated in the same change.                                                                                                                   |
| G8 Regression suite and second review | G1-G7      | Prove the bubble is gone and no old batch path remains.                                                                                                                      | Tests listed in this spec; any new targeted engine/orchestrator tests.                                                                                                                                                                                                 | Targeted tests pass with true inactivity timeouts. A second review confirms no synchronous build batch barrier, no duplicate scheduler source, no old batch wording, no stream-error resume regression, and no UI-owned scheduling.                                                                                                                |

## Goal-Level Test Plan

### G1 Async Build Start Tests

- Add an orchestrator tool test with a controllable `BuildAgent` promise.
- Assert `build({ goalID })` returns a started result after session creation and before the promise resolves.
- Assert resolving the promise later finalizes the goal run with `completed`.
- Assert rejecting the promise later finalizes the goal run with `failed`.

### G2 Live-Build Source Tests

- Start a goal run and attempt a duplicate `build({ goalID })`; assert a precise duplicate-live-goal error.
- Start goal `A`, then dispatch independent goal `B`; assert sibling dispatch is allowed while `A` is live.
- Emit terminal completion before ownership drain; assert queued wake drains after ownership closes and does not create a duplicate build.

### G3 Terminal Refill Wake Tests

- Seed `A` and `B` live, with `C` depending on `A`.
- Finalize `A` while `B` remains live.
- Run `EngineRuntime.syncRun` or `monitorRuns`.
- Assert a terminal refill notification is written and `dispatchTaskLoop` is invoked before `B` completes.
- Run the monitor again and assert no duplicate notification.
- Repeat with a blocked `orchestrator_stream_error` run and assert no wake.

### G4 Prompt And Context Tests

- Update describe/read_context tests to assert recent terminal refill facts render with goal run id, status, and dispatch result.
- Update prompt hygiene tests to reject "current eligible wave" and "build batch returns" language.
- Update tool description tests so next action guidance says refill wake + dispatchable goals, not batch settlement.

### G5 FIFO Refill Tests

- Build a DAG with `A`, `B`, `C(depends_on A)`, `D(depends_on A)` and deterministic `order_index`.
- Complete `A` while `B` is live.
- Assert `dispatchable_goal_ids` lists `C` before `D`.
- In an orchestrator integration test with mocked model/tool dispatch, assert the next build dispatches `C` before `D`.

### G6 Early Failure Tests

- Complete `A` as failed while `B` is live.
- Assert a refill wake is visible before `B` completes.
- Assert `C(depends_on A)` is not dispatchable.
- Assert no host retry goal run is created.
- Assert context surfaces `A` under failed goals requiring same-graph diagnosis.

### G7 UI/API Tests

- If API shape changes, update OpenAPI/SDK/docs snapshots in the same commit.
- Assert board goal workflows still update from goal run artifacts.
- Assert overlay event policy continues to accept `goal_run.updated`.
- Assert no UI component stores or computes dispatch eligibility.

### G8 Review Checklist

- Grep for `goal_batch_notification`, `recent_terminal_goal_batches`, `current eligible wave`, and `build batch`.
- Remove or rename old batch semantics instead of leaving compatibility aliases.
- Grep for direct callers of `BuildAgent.run` and ensure none expect root-tool synchronous completion.
- Grep for live ownership checks and ensure they do not block unrelated sibling refill.
- Run the targeted tests above and inspect failures as root-cause work, not as assertions to weaken.

## Required Acceptance Coverage

1. Bubble regression
   - Given `max_executor_groups = 2`, goals `A` and `B` ready, and `C` depends on `A`.
   - When `A` completes while `B` is still live.
   - Then `C` is started, or at minimum a refill orchestrator wake is observably dispatched, before `B` completes.

2. FIFO order
   - Given multiple newly-ready goals share the same dependency completion.
   - Then dispatch order follows graph order index and existing semaphore FIFO for already-issued waits.

3. Early failure
   - Given `A` fails while `B` remains live.
   - Then failure facts become visible and the orchestrator is woken without waiting for `B`.
   - The host must not auto-retry `A` or auto-fail dependents.

4. Ownership drain
   - Given terminal `goal_run.updated` is emitted before build ownership closes.
   - Then refill does not start a duplicate live build.
   - Queued wake drains after ownership closes.

5. Stream-error preservation
   - A run blocked with `orchestrator_stream_error` remains blocked and is not resumed by refill or liveness logic.

6. Duplicate prevention
   - The same terminal goal fact cannot trigger multiple builds for the same downstream goal.

7. Prompt and tool hygiene
   - The prompt and tool descriptions no longer teach “current eligible wave” or “after build batch returns” semantics.

8. UI projection
   - Board and overlay continue to render from goal run/session/artifact projections.
   - No front-end scheduler state is introduced.

## Implementation Notes For The Next Phase

- Start with G0 and keep the async-build-wake direction as the only implementation path.
- The main hard part is separating root tool result lifetime from child build lifetime without losing observable terminal facts.
- In either direction, ownership close and queued wake drain are the main race surface.
- Existing `dispatchable_goal_ids` already gives a graph-derived frontier for never-dispatched success-path goals; failed goals remain a separate LLM diagnosis surface.
- Do not begin code edits until the selected direction is written into the implementation spec with callpoints and tests.

## Implementation Update

- `build({ goalID })` now returns after the child build session and `goal_run` are created. The child build continues in the background and finalizes the same `goal_run_attempt`, acceptance, and decision-log artifacts.
- Duplicate goal dispatch is keyed by live `goal_run` facts, not live root tool ownership. Root tool ownership closes at started-result time so terminal refill wakes are not queued behind unrelated live sibling builds.
- Runtime wake facts now use `engine_artifact.kind = "goal_refill_notification"`. The old terminal batch artifact name is not used by the new runtime, describe, or read_context path.
- `TaskDesc` now projects `recent_terminal_goal_refills`, and rendered context says "Terminal goal refill wake facts".
- The orchestrator prompt now tells the LLM to read context on terminal goal refill wakes and recompute from ordered dispatchable goals, failed goals, and live sibling goal runs.
- Targeted tests cover async started return, background finalization, duplicate live goal-run rejection, per-terminal refill wake, FIFO dependent projection, early-failure diagnosis projection, stream-error preservation, and prompt/context hygiene.
