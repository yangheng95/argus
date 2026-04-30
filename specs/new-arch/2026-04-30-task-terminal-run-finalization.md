# 2026-04-30 Task Terminal Run Finalization

## Evidence

- Live task `tsk_ddceedabf001760U5O4QH2Gk1I` was not blocked in delivery by the time the database was inspected.
- `engine_task.time_completed = 1777530033347` and the latest `task.updated` event reported `completed`.
- Delivery artifacts reached `delivery-task.status = delivered`, `verification-evidence.status = passed`, and `delivery-agent-verdict.verdict = accepted`.
- The latest artifact for run `run_ddcf8cea3001xiJp0M6kIuV5nR` still had `payload.status = running`; no later `run-completed` artifact existed.

The bug is therefore not a delivery agent stall. The append-only run stream can remain live after a task is completed through publishing.

## Call-Point Exhaustion

`rg -n -e 'updateTask\(' packages/opencorvus/src packages/opencorvus/test -g '*.ts'`

| Call point | Current role | Decision |
| --- | --- | --- |
| `orchestrator/tools.ts:373` | created run activates task | keep; non-terminal |
| `orchestrator/tools.ts:416` | submitted run activates task | keep; non-terminal |
| `orchestrator/tools.ts:474` | requirements starts | keep; non-terminal |
| `orchestrator/tools.ts:944` | stores visual contract | keep; non-terminal |
| `orchestrator/tools.ts:2150` | fail_task marks task failed | covered by state writer terminal-run convergence |
| `orchestrator/tools.ts:2300` | build dispatch activates task | keep; non-terminal |
| `orchestrator/tools.ts:3074` | auto-publish git failure marks task failed | covered by state writer terminal-run convergence |
| `orchestrator/tools.ts:3081` | recovery activation before completion | keep; non-terminal |
| `orchestrator/tools.ts:3084` | auto-publish marks task completed | covered by state writer terminal-run convergence |
| `orchestrator/tools.ts:3094` | auto-publish non-delivered marks task failed | covered by state writer terminal-run convergence |
| `orchestrator/tools.ts:3445` | manual publish git failure marks task failed | covered by state writer terminal-run convergence |
| `orchestrator/tools.ts:3450` | manual publish marks task completed | covered by state writer terminal-run convergence |
| `orchestrator/tools.ts:3492` | manual publish non-delivered marks task failed | covered by state writer terminal-run convergence |
| `engine/runtime.ts:292` | run executing activates task | keep; non-terminal |
| `engine/runtime.ts:343` | operator note reactivates task | keep; non-terminal |
| `orchestrator/loop.ts:175` | loop starts task | keep; non-terminal |
| `orchestrator/agent.ts:434` | records orchestrator error without terminal status | keep; no terminal run write |
| `task-api/index.ts:622` | attachment/system-artifact metadata update | keep; non-terminal |
| `task-api/index.ts:1143` | cancelTask marks task cancelled | covered; existing explicit run abort stays idempotent |
| `task-api/index.ts:1204` | retry resets task queued | keep; non-terminal |
| `task-api/index.ts:1450` | abortRun marks owning task failed | covered; existing explicit run abort stays idempotent |
| `engine/state.ts:260` | criteria upsert | keep; non-terminal |
| tests | mocked or seeded updateTask calls | update with focused regression tests |

`rg -n -C 4 -e 'updateRun' -e 'run-completed' packages/opencorvus/src packages/opencorvus/test -g '*.ts'`

| Call point | Current role | Decision |
| --- | --- | --- |
| `orchestrator/tools.ts:417` | queued run becomes running | keep |
| `engine/writer.ts:221` | aborts runs during shutdown/project teardown | keep |
| `engine/runtime.ts:225/229/235/268/287/309/377` | runtime monitor updates run liveness and terminal status | keep |
| `task-api/index.ts:1132` | cancelTask explicitly aborts active run | keep; state writer terminal step no-ops when run is already aborted |
| `task-api/index.ts:1434` | abortRun explicitly aborts run | keep; state writer terminal step no-ops when run is already aborted |
| tests with seeded `run-completed`/`run-failed` | fixtures | keep |

## Design

`engine/state.ts::updateTask` is the single writer for task terminal facts. When it receives a terminal task intent, it should also close the latest live run for that task:

- task `completed` -> run `completed`
- task `failed` -> run `failed`
- task `cancelled` -> run `aborted`

This avoids duplicate publishing-specific fixes and also covers `fail_task`, `abortRun`, `cancelTask`, and future terminal task writers.

The writer must not mutate historical terminal runs. It reads the latest run through `findActiveRunForTask` and only writes a new run artifact when that run is live per `isLiveRunStatus`.

## Verification

- Add focused unit tests for completed, failed, and cancelled task writes.
- Run the new test file.
- Run opencorvus typecheck.
