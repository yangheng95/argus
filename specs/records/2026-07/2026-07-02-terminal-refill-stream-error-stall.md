# 2026-07-02 Terminal Refill Stream-Error Stall

## Recall

- User request: attached task debug info shows a Mission task whose cron appears stuck: "这个任务cron卡住不动了".
- Attachment facts:
  - task id `tsk_f1ea10bf0001wmLbNSF5Gd6bIL`
  - run id `run_f21f43589001k4aR2VlmpspdUH`
  - session id `ses_0e15ef40effew79bAXafzZNpHS`
  - task status `active`, terminal `-`
  - created `2026-07-01 17:01:38Z`, updated `2026-07-02 10:36:16Z`
  - exported goals list shows all listed goals as `passed`, with numbering up to `#64`
- Acceptance criteria:
  - A non-terminal active task whose child goal runs have terminal evidence must receive a durable terminal-refill wake.
  - The wake must be visible to the Orchestrator through existing task snapshot evidence.
  - The engine must not auto-complete the task; `complete_task` remains an explicit Orchestrator decision.
  - Existing stream-error protection must still prevent generic passive retry loops.
  - No synthetic user message, fallback, gate, or compatibility path.
- Hard constraints:
  - No fallback or compatibility logic.
  - No host-side automatic task completion or workflow state machine.
  - No restart, refresh, or kill of running OpenCorvus / overlay processes without explicit user approval.
  - Code changes require focused regression tests.
  - Preserve unrelated dirty worktree changes.
- Sources read:
  - `specs/current/architecture/16-unified-teardown.md`
  - `specs/current/architecture/99-principles.md`
  - `specs/README.md`
  - `specs/records/2026-07/README.md`
  - `packages/opencorvus/src/orchestrator/loop.ts`
  - `packages/opencorvus/src/orchestrator/agent.ts`
  - `packages/opencorvus/src/orchestrator/tools.ts`
  - `packages/opencorvus/src/engine/runtime.ts`
  - `packages/opencorvus/src/engine/queue.ts`
  - `packages/opencorvus/src/engine/orphan.ts`
  - `packages/opencorvus/src/engine/describe.ts`
  - `packages/opencorvus/src/task-api/index.ts`
  - `packages/opencorvus/test/engine/runtime-goal-run-convergence.test.ts`
  - `packages/opencorvus/test/engine/queue.test.ts`
  - `packages/opencorvus/test/engine/task-message-revive.test.ts`
  - `packages/opencorvus/test/engine/restart-active-task-message.test.ts`
- Whole-repository search evidence:
  - `rg -n "syncTerminalGoalRefills|goal_refill_notification|orchestrator_stream_error|blocking_reason|dispatchTaskLoop|lifecycleFact" packages/opencorvus/src packages/opencorvus/test`
  - `rg -n "type OrchestratorEvent|interface OrchestratorEvent|lifecycleFact|beforeAcceptedWake|goal-refill|terminal refill|run_orphan|run orphan" packages/opencorvus/src packages/opencorvus/test/engine packages/opencorvus/test/orchestrator packages/opencorvus/test/task-api`
  - `rg -n "event\\.lifecycleFact|lifecycleFact|operatorIntent|operatorMessage|event\\.note|processTask\\(|runTaskLoop\\(" packages/opencorvus/src/orchestrator packages/opencorvus/src/engine packages/opencorvus/test/orchestrator packages/opencorvus/test/engine`
- Independent agent feedback:
  - Not spawned. Current Codex tool policy only allows sub-agents when the user explicitly asks for delegation or parallel agent work.

## Diagnosis

This is not primarily a cron scheduler interval issue. The exported task is
still active with no terminal row while child-goal evidence appears terminal.
The relevant liveness path is:

1. `EngineService.init()` registers `engine.liveness`.
2. The liveness job calls `EngineRuntime.monitorRuns(hooks())`.
3. `EngineRuntime.syncRun()` calls `syncTerminalGoalRefills()` for a live run.
4. `syncTerminalGoalRefills()` records `goal_refill_notification` facts and
   dispatches the task loop so the Orchestrator reads the fresh snapshot.
5. The Orchestrator must then decide whether to dispatch more work, run
   Integrity, fail, ask, or call `complete_task`.

The stuck path appears when the active run is blocked by
`orchestrator_stream_error`. Two independent protections combine:

- `syncTerminalGoalRefills()` returns immediately for
  `status=blocked` plus `blocking_reason=orchestrator_stream_error`, so no
  terminal-refill notification fact is written.
- `dispatchTaskLoop()` suppresses generic passive wakes for the same blocker
  unless the wake has operator intent, operator message, coordination request,
  or lifecycle fact.

That pair is stricter than the design contract. It correctly prevents blind
passive retry loops, but it also prevents new terminal child evidence from
reaching the Orchestrator. The result is a visible active task with terminal
child work and no final Orchestrator decision.

## Selected Repair

Treat terminal goal refill as a structured engine lifecycle fact:

- Keep generic passive stream-error wakes suppressed.
- Remove the runtime early-return that refuses terminal-refill processing for
  `orchestrator_stream_error`.
- Dispatch terminal-refill wakes with an internal `lifecycleFact` event so the
  queue accepts evidence-backed internal lifecycle wakes without treating them
  as operator input.
- Continue recording `goal_refill_notification` only after the queue accepts
  the wake.
- Do not clear `run.blocking_reason`, mutate the stream-error blocker, or
  synthesize a user message.

This preserves Orchestrator ownership: the engine only delivers durable facts;
it does not decide task completion.

## Regression Coverage

- Add a runtime test for an active `orchestrator_stream_error` blocked run with
  new terminal goal-run evidence:
  - `EngineRuntime.syncRun()` accepts a terminal-refill lifecycle wake.
  - One `goal_refill_notification` fact is written.
  - `run.status`, `run.blocking_reason`, and `run.error` remain unchanged.
  - `runTaskLoop` receives `event.lifecycleFact.kind=terminal_goal_refill_dispatched`.
- Keep the existing queue test that generic passive wakes remain ignored for
  stream-error blocked runs.
- Add or update queue coverage showing lifecycle-fact wakes pass the
  stream-error suppression path.
