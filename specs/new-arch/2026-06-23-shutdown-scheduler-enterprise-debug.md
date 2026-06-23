# Shutdown Scheduler Enterprise Debug

Date: 2026-06-23

## Objective

Debug "task interruption leaves scheduler wakeups running and the process cannot
close" to enterprise software standards. The result must separate confirmed
bugs from already-tested historical risks, and every fix must be tied to an
executable regression test.

## Benchmark Definition

| Field       | Contract                                                                                                                                                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input       | A server/task lifecycle with explicit stop, cancellation, scheduler ticks, and shutdown triggers.                                                                                                                                                                |
| Output      | Cancelled or terminal work does not receive passive scheduler wakeups; shutdown reaches an explicit process-exit path even when server stop does not settle.                                                                                                     |
| Environment | Local repository tests using Bun, without touching a live OpenCorvus or overlay process.                                                                                                                                                                         |
| Timeout     | Tests must use event-driven or no-activity waits. Shutdown tests may use a small synthetic stop timeout because the simulated server deliberately never settles.                                                                                                 |
| Acceptance  | A2A queue has no background poll; liveness ignores terminal tasks; passive stream-error wakes are suppressed; queued operator wakes drain only through the canonical queue path; serve shutdown has a bounded stop path and reaches explicit exit after cleanup. |

## Recall

| Source                                                   | Constraint                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `task-queue-explicit-wake-no-poll-2026-06-17.md`         | `TaskQueueService.init()` must not register a background task-flow poller. Enqueue/completion are the explicit wake boundary.                 |
| `operator-wake-status-facts-not-scheduler-2026-06-17.md` | `engine.liveness` is a narrow runtime observer, not the old broad `engine.poll` scheduler.                                                    |
| `orchestrator-no-decision-stop-2026-06-18.md`            | Do not use `engine.liveness` as a generic retry path for no-decision or stopped tasks.                                                        |
| `2026-06-21-dispatch-algorithm-agent-audit.md`           | SCHED-003/005/006/008/009 fixed duplicate refill wakes, durable queued wakes, cwd serialization, and passive stream-error restart.            |
| `cli-entrypoint-lifecycle-2026-06-17.md`                 | Long-running commands own their shutdown. Do not restore global unconditional exit or command-name gates.                                     |
| `2026-06-01-mission-benchmark.md`                        | Isolated benchmark shutdown must dispose instances, stop server, then explicitly exit so scheduler handles cannot keep unattended runs alive. |
| `2026-06-23-task-stop-agent-settle-validation.md`        | Stop success must wait for prompt state settlement, not terminal UI projection alone.                                                         |

## Call-Point Sweep

Command:

```powershell
rg -n "server\\.stop\\(|Instance\\.disposeAll\\(|registerServerShutdownHandler|clearServerShutdownHandler|Scheduler\\.register|task-queue-service\\.poll|TaskQueueService\\.init|drainPendingQueuedOperatorWakes|goal_refill_notification|dispatchTaskLoop\\(|EngineRuntime\\.monitorRuns|EngineRuntime\\.syncRun|cancelTask\\(|TaskQueueService\\.cancelSessionPrompts|setTimeout\\(\\(\\) => process\\.exit|process\\.exit\\(" packages/opencorvus/src packages/opencorvus/test packages/opencorvus/script specs -g "*.ts" -g "*.md"
```

| Surface             | Evidence                                                                                                                           | Decision                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A2A queue           | `TaskQueueService.init()` only logs initialization; tests assert no task-flow poller.                                              | Keep; no task queue poll repair needed unless benchmark disproves it.                           |
| Engine liveness     | `EngineService.init()` registers `engine.liveness`; `EngineRuntime.monitorRuns()` filters out tasks with `time_completed != null`. | Keep narrow observer; do not add status gates or remove liveness.                               |
| Terminal refill     | `goal_refill_notification` facts are deduped and tests cover same logical terminal append.                                         | Add only concurrency evidence if a real race is reproduced.                                     |
| Passive blocked run | `dispatchTaskLoop()` and queued drain suppress passive `orchestrator_stream_error` wakes.                                          | Keep; verify with existing regression before claiming old zombie loop exists.                   |
| Serve shutdown      | `serve.ts` awaits `server.stop(true)` without the timeout that `sidecar.ts` already uses.                                          | Reproduce with a fake never-settling stop and add a bounded shutdown test before changing code. |
| Benchmark shutdown  | `mission-benchmark.ts` already disposes instances, stops server, and exits; tests pin order.                                       | Keep as existing coverage.                                                                      |

## Acceptance Tests

- `scheduler.task-queue-service` proves no background task-flow poll and stale
  in-flight cleanup.
- `engine.queue` proves cancelled queued tasks drop retained wake events and
  passive stream-error wakes do not restart.
- `runtime-goal-run-convergence` proves terminal tasks and stale live runs are
  ignored, and refill facts do not duplicate the same logical terminal append.
- New serve shutdown test proves a stuck `server.stop(true)` cannot prevent the
  explicit shutdown exit path.

## Current Known Gaps

The old "scheduler keeps waking cancelled tasks" claim is not currently
reproduced. The confirmed enterprise risk is narrower: ordinary `serve`
shutdown lacks the bounded stop convergence that `sidecar` already has, so a
hung `server.stop(true)` can block the command-owned exit path.
