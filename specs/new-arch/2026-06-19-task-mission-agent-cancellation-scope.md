# Task, Mission, And Agent Cancellation Scope - 2026-06-19

## Objective

Fix user-visible stop behavior so stopping a task, Mission, or agent session
means every owned Large Language Model (LLM) loop, executor run, queued prompt,
tool call, and spawned process has actually been interrupted or terminated
before the surface reports success.

This plan intentionally replaces split stop paths with one cancellation scope.
It does not add fallback cleanup, compatibility behavior, route gates, hidden
state-machine routing, or user-interface-only success.

## Terms

- API: Application Programming Interface.
- UI: User Interface.
- SDK: Software Development Kit.
- LLM: Large Language Model.
- SSE: Server-Sent Events.
- PID: Process Identifier.
- PTY: Pseudoterminal.

## Existing Disk Plans Recalled

| Plan                                                 | Relevant constraint                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `specs/task-execution-terminalization-2026-06-16.md` | Shutdown cleanup must use current-process ownership and existing ownership writers; it is historical shutdown/startup evidence, not a user stop design. |
| `specs/orchestrator-no-decision-stop-2026-06-18.md`  | Do not solve stop hangs by adding liveness gates; no-decision orchestrator wakes are a separate contract failure.                                       |
| `specs/2026-06-10-cancelled-task-message-input.md`   | Cancelled task rows can be reopened by operator messages, so the stop fix must not make cancelled task conversation permanently inert.                  |
| `specs/bug-hunt-repair-plan-2026-06-17.md`           | Project ownership fixes must live in service boundaries, not UI route gates or compatibility paths.                                                     |

## Enterprise Comparison

- Temporal cancellation uses scoped cancellation semantics: a cancellation is
  requested through the owning workflow scope and child work must observe the
  cancellation path before the workflow treats it as complete.
  Reference: https://docs.temporal.io/develop/typescript/workflows/cancellation
- Kubernetes Pod termination separates deletion intent from real process exit:
  the Pod enters terminating flow, receives termination signals, and only later
  reaches a terminal phase after containers are gone.
  Reference: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/

OpenCorvus currently reports stop success at the control plane while some
execution handles can remain alive. The fix must make the control-plane result
match the actual owned-resource lifecycle.

## Evidence

| Surface                   | Evidence                                                                                                          | Problem                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Overlay task stop         | `packages/overlay/src/services/task.ts::cancelTask` and `interruptTask` both call `POST /task/:taskID/cancel`.    | UI exposes one "stop" operation, but backend cancellation is split across task, run, session, and queue helpers.                              |
| Overlay agent stop        | `packages/overlay/src/services/task.ts::cancelAgentSession` calls `POST /task/:taskID/session/:sessionID/cancel`. | Single child session cancellation does not share the same coverage as task cancellation.                                                      |
| Overlay Mission stop      | `packages/overlay/src/services/mission.ts::abortMission` calls `POST /mission/:missionID/abort`.                  | UI says stop Mission; backend only stops the Mission coordinator prompt.                                                                      |
| Mission route             | `packages/opencorvus/src/server/routes/mission.ts:334-352`.                                                       | Route description says "Abort the active Mission session loop" and only calls `SessionPrompt.cancel(session.id, session.directory)`.          |
| Mission child task source | `packages/opencorvus/src/engine/store.ts::listMissionTasks`.                                                      | Child tasks are enumerable but unused by Mission abort.                                                                                       |
| Task cancel               | `packages/opencorvus/src/task-api/index.ts:1773-1888`.                                                            | Current code catches abort timeout/failure and still writes `status="cancelled"`.                                                             |
| Task cancel test          | `packages/opencorvus/test/task-api/cancel-task-abort-timeout.test.ts:119-156`.                                    | Test pins the old behavior: hung executor abort still produces terminal cancelled task.                                                       |
| Session prompt cancel     | `packages/opencorvus/src/session/prompt/state.ts:70-94`.                                                          | If no prompt state matches, it still sets terminal aborted. Wrong directory can therefore change status without aborting the live controller. |
| Session prompt loop       | `packages/opencorvus/src/session/loop.ts:2294-2304`.                                                              | Prompt state is keyed by resolved session directory; callers must hit the same directory to abort the actual controller.                      |
| Child agent abort         | `packages/opencorvus/src/engine/execution-abort.ts:22-97`.                                                        | Uses `SessionPrompt.cancel(sessionID)` without directory and has different executor/run coverage than task cancel.                            |
| Queue cancel              | `packages/opencorvus/src/scheduler/task-queue-service.ts:204-228`.                                                | Updates queue rows to failed; it does not itself abort the live prompt loop.                                                                  |
| Executor abort            | `packages/opencorvus/src/executor/contract.ts:146`.                                                               | Executor adapter exposes `abort({ sessionID, queueTaskID })`, but current callers wrap it in raw elapsed-time timeout and still mark success. |
| OpenCorvus executor abort | `packages/opencorvus/src/executor/opencorvus.ts:91-105`.                                                          | Calls `SessionPrompt.cancel(input.sessionID)` without directory, then updates queue rows.                                                     |
| Background bash process   | `packages/opencorvus/src/tool/bash.ts:405-453`.                                                                   | `background: true` returns while process continues until lease expiry or manual stop; task cancellation does not own that process handle.     |
| Process supervisor        | `packages/opencorvus/src/shell/process-supervisor.ts`.                                                            | Can terminate process trees, but background handles are not registered under task cancellation ownership.                                     |
| Shutdown writer           | `packages/opencorvus/src/engine/writer.ts:396-728`.                                                               | Shutdown path has stronger task-owned session/tool ownership cleanup, but user task cancel does not call one complete cancellation primitive. |

## Call-Point Inventory

Commands run before writing this plan:

```powershell
rg -n "cancelTask\(|abortRun\(|abortChildExecutionForSession|abortGoalRunExecution|abortLiveExecutionForTask|abortLiveOrchestratorToolOwnership|terminateTaskOwnedSessionsAndFail|SessionPrompt\.cancel|cancelSessionPrompts|abortActivityGate|registerActivityGate|Orchestrator\.abort|abortTaskPipeline" packages/opencorvus/src packages/opencorvus/test
rg -n "abortMission|cancelTask|interruptTask|cancelAgentSession|/cancel|/abort|mission.*abort|stop" packages/overlay/src packages/overlay/test packages/opencorvus/src/server/routes packages/opencorvus/test/server
rg -n "listMissionTasks|missionProvenance|mission\.child_task_result|metadata\.mission|actor.*mission|source.*mission" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test
rg -n "background: true|params\.background|DEFAULT_BASH_BACKGROUND_LEASE_MS|leaseTimeout|ProcessSupervisor|terminateChildTree|terminate\(\)|dispose\(\)|tool_ownership|orchestrator_tool_ownership|processOwner\(" packages/opencorvus/src packages/opencorvus/test
rg -n "Cancellation.*Error|Abort.*Error|Cancelled.*Error|Task.*Cancel|Incomplete.*Error|NotFoundError|Conflict" packages/opencorvus/src packages/opencorvus/test
```

| Call point                                          | Decision                                                                                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EngineService.cancelTask`                          | Replace internals with the canonical cancellation scope. It remains the public task API entry.                                                                       |
| `EngineService.abortRun`                            | Route through the same cancellation scope for run-owned handles, or delete duplicated abort logic if no unique behavior remains.                                     |
| `abortChildExecutionForSession`                     | Replace with scope-limited cancellation for the target session subtree. Do not keep a parallel child-agent abort path.                                               |
| `abortGoalRunExecution`                             | Keep only as an internal handle terminator called by the scope, or merge into the scope if its standalone API is no longer needed.                                   |
| `abortLiveExecutionForTask`                         | Reuse its run/goal ownership logic inside the scope; do not let it mark live resources terminal without the session/process handles.                                 |
| `terminateTaskOwnedSessionsAndFail`                 | Extract the session/tool-part termination pieces that are valid for user cancel; keep shutdown-specific task-fail behavior separate.                                 |
| `abortLiveOrchestratorToolOwnership`                | Reuse as the single source for live orchestrator tool ownership cancellation.                                                                                        |
| `SessionPrompt.cancel(sessionID)` with no directory | Replace production call sites with a directory-resolved cancellation primitive. A missing live prompt state must be observable, not silently converted into success. |
| `TaskQueueService.cancelSessionPrompts`             | Move under the scope as queue-row terminalization after prompt abort is requested; it cannot be the only stop signal.                                                |
| `Orchestrator.abort` and `abortTaskPipeline`        | Keep as in-memory fast interrupt handles invoked by the scope before durable resource termination.                                                                   |
| Mission abort route                                 | Change from coordinator-only abort to Mission cancellation scope: Mission coordinator session plus active Mission child tasks from `listMissionTasks`.               |
| Overlay task/Mission/agent stop                     | Keep route names initially; update semantics and tests so returned success means real cancellation scope completed.                                                  |
| Background bash and browser-preview process handles | Register owned process handles under task/session scope when they outlive a tool call. Stop must terminate those handles before success.                             |
| Existing named errors                               | No same-semantic `TaskCancellationIncompleteError` exists. Add one NamedError and map it to HTTP 409 Conflict if incomplete cancellation is exposed through routes.  |

## Root Cause

The system has stop signals but no single cancellation domain. A task can own
sessions, goal runs, executor queue tasks, prompt queues, tool parts, and
background processes, yet each stop endpoint currently aborts only a subset.
Several paths update database or UI status even when the underlying handle was
not proven stopped. This creates false terminal state and makes remaining live
agents hard to locate.

The most dangerous behavior is `cancelTask`: it records abort timeout evidence
but still marks the task cancelled. That is a control-plane success over a
possible live execution child.

## Design

Add one engine service, tentatively named `TaskCancellationScope`, with three
public entry points:

```ts
cancelTaskScope({ taskID, reason })
cancelMissionScope({ missionID, directory, reason })
cancelSessionScope({ taskID, sessionID, reason })
```

The exact file name can be `packages/opencorvus/src/engine/cancellation-scope.ts`
or another engine-local name chosen during implementation. The important rule is
that every user-facing stop route calls this service and no route keeps its own
partial cancellation algorithm.

The scope must gather these owner-bound handles from existing sources:

- Task root session tree from `Session.treeInProject`.
- Session rows from `Session.get` so prompt cancellation always uses the stored
  directory.
- Current activity gate from `SessionStatus`.
- Task pipeline controller from `abortTaskPipeline`.
- Orchestrator controller from `Orchestrator.abort`.
- Live goal runs and runs from the task tables.
- Executor references from run and goal-run rows.
- Task queue rows for the owned session IDs.
- Live orchestrator tool ownership artifacts.
- Open tool parts currently associated with task-owned sessions.
- Background process handles registered by tools that outlive a tool call.
- Mission child task rows from `listMissionTasks`.

Cancellation order:

1. Resolve scope membership from durable task/session/Mission ownership.
2. Abort in-memory task/orchestrator/prompt/activity handles.
3. Abort executor handles using exact `sessionID` and `queueTaskID` references.
4. Terminate owned long-lived process handles through `ProcessSupervisor`.
5. Terminalize queue rows, run rows, goal-run rows, tool ownership, and task row.
6. Return success only after all collected handles are stopped or already
   terminal.

If any collected handle cannot be stopped, the service throws
`TaskCancellationIncompleteError` with the handle kind and identifier. It must
not mark the task cancelled in that case. The route can return HTTP 409 Conflict
with that typed error so the UI and logs show exactly which handle still needs
investigation.

No compatibility branch should preserve the old "possible zombie but cancelled"
behavior. The old timeout test must be replaced, not updated with another
status-only assertion.

## Required Code Changes

| Area                                                       | Change                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session/prompt/state.ts`                                  | Add a directory-resolved cancel primitive, or make `cancel` require a resolved session row for project sessions. Wrong-address cancellation must not publish terminal success. |
| `task-api/index.ts`                                        | Replace `cancelTask` internals with `TaskCancellationScope.cancelTaskScope`. Remove swallowed abort-timeout success behavior.                                                  |
| `engine/execution-abort.ts`                                | Replace route-facing child/goal abort functions with scope calls or make them private handle terminators.                                                                      |
| `server/routes/mission.ts`                                 | Mission abort calls `cancelMissionScope`, which cancels the coordinator and all active Mission child tasks.                                                                    |
| `server/routes/orchestrator.ts`                            | Task cancel, child session cancel, and run abort route through the canonical scope.                                                                                            |
| `server/routes/session.ts` and `server/routes/coding.ts`   | Stop routes must use directory-resolved prompt cancellation and queue terminalization through the scope, not direct no-directory `SessionPrompt.cancel`.                       |
| `executor/opencorvus.ts`                                   | Replace no-directory `SessionPrompt.cancel(input.sessionID)` with a directory-resolved call.                                                                                   |
| `tool/task.ts`, `agent/runner.ts`, `orchestrator/agent.ts` | Replace local abort hooks that call no-directory `SessionPrompt.cancel` with the directory-resolved primitive or pass the already-known session directory.                     |
| `tool/bash.ts` and `tool/browser-preview.ts`               | Register background process handles under the task/session cancellation scope when `background: true` creates a long-lived process.                                            |
| `engine/writer.ts`                                         | Share reusable owner-bound termination helpers with the new cancellation scope; keep shutdown-specific fail behavior separate.                                                 |
| `server/error-handler.ts` and OpenAPI metadata             | Map `TaskCancellationIncompleteError` to 409 and document stop failure responses.                                                                                              |
| Overlay services/tests                                     | Keep the public user actions but update tests so success requires backend success; show typed failure instead of hiding it behind stopped UI state.                            |

## Test Plan

Focused tests must be added or replaced before implementation is accepted:

| Test file                                                             | Required assertion                                                                                                                                                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/test/server/mission-routes.test.ts`              | `POST /mission/:missionID/abort` cancels the Mission coordinator and every active child task returned by `listMissionTasks`.                                                                  |
| `packages/opencorvus/test/server/task-conversation-routes.test.ts`    | `POST /task/:taskID/session/:sessionID/cancel` cancels the target session subtree through the canonical scope and does not leave descendant streaming sessions active.                        |
| `packages/opencorvus/test/task-api/cancel-task-abort-timeout.test.ts` | Replace old expectation: a stuck abort handle must not produce `status="cancelled"` success. It must surface `TaskCancellationIncompleteError` or a deterministic process termination result. |
| `packages/opencorvus/test/session/extra-tools.test.ts`                | Wrong-directory or missing-state prompt cancel must not silently publish terminal aborted as success. Correct-directory cancel still aborts the registered activity gate.                     |
| `packages/opencorvus/test/scheduler/task-queue-service.test.ts`       | Queue row terminalization happens only as part of scope cancellation after prompt abort is requested.                                                                                         |
| `packages/opencorvus/test/tool/bash.test.ts`                          | A background bash handle registered to a task is terminated when the task cancellation scope runs; lease expiry is not the normal stop path.                                                  |
| `packages/opencorvus/test/engine/writer.test.ts`                      | Shutdown cleanup and user cancellation share termination primitives without sharing shutdown-only task-fail semantics.                                                                        |
| `packages/opencorvus/test/server/onerror-mapping.test.ts`             | `TaskCancellationIncompleteError` maps to 409 Conflict.                                                                                                                                       |
| `packages/overlay/test/mission-service-actions.test.ts`               | Mission abort remains the same route but test names describe whole Mission cancellation, not coordinator-only abort.                                                                          |
| `packages/overlay/test/browser/side-activity-toolbar-browser.test.ts` | After accepted Mission abort, UI hides stop only after backend success; typed failure remains visible.                                                                                        |

Run focused suites first, then package-level checks:

```powershell
bun test packages/opencorvus/test/server/mission-routes.test.ts packages/opencorvus/test/server/task-conversation-routes.test.ts packages/opencorvus/test/task-api/cancel-task-abort-timeout.test.ts --timeout 60000
bun test packages/opencorvus/test/session/extra-tools.test.ts packages/opencorvus/test/scheduler/task-queue-service.test.ts packages/opencorvus/test/tool/bash.test.ts --timeout 60000
bun test packages/opencorvus/test/server/onerror-mapping.test.ts packages/overlay/test/mission-service-actions.test.ts --timeout 60000
bun run --cwd packages/opencorvus typecheck
bun run --cwd packages/overlay typecheck
bun run api:routes-check
bun run docs:check
```

Timeouts used by new runtime tests must be inactivity-based: the timer starts
or resets on observed child/tool/executor activity and aborts only after no
activity, not merely after process start.

## Acceptance

- Clicking task stop cannot return success while any owned session, executor,
  queue row, tool ownership, or background process is still live.
- Clicking Mission stop cancels the Mission coordinator and all active Mission
  child tasks in the same project and Mission lineage.
- Clicking child agent stop uses the same cancellation scope limited to that
  session subtree; it cannot leave descendant sessions active.
- `SessionPrompt.cancel` cannot silently convert a miss into terminal success.
- The old `cancelTask` zombie-success behavior is removed and its regression
  test is replaced.
- Background processes started by task-owned tools are owner-bound and killed by
  task cancellation before API success.
- API, SDK, and documentation expose a typed 409 cancellation-incomplete error
  when a collected handle cannot be stopped.
- No fallback cleanup, route gate, UI-only stopped state, hidden retry loop, or
  compatibility branch is introduced.
- After focused tests pass, a second manual review confirms there is no remaining
  independent stop path that can mark success without the cancellation scope.
