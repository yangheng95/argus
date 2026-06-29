# Wait Cron Early Activity Consume - 2026-06-26

## Objective

Task and session `wait` now schedule one-shot cron rows. If real activity arrives
before the due time, the pending wait cron must be consumed immediately so the
old timer cannot fire a second stale wake later.

## Recall

- `AGENTS.md` forbids fallback logic, hidden messages, scheduler gates, and dual
  sources.
- `2026-06-26-task-cron-nonblocking-wait.md` made `cron_job` the single durable
  source for task waits and required task cron wakes to re-enter through
  `dispatchTaskLoop`.
- `task-queue-explicit-wake-no-poll-2026-06-17.md` requires task flow admission
  to come from real enqueue, user message, tool result, or queue completion
  events rather than background polling.
- `CronService` already owns cron job creation, lease claims, and due execution;
  early consumption belongs there, not in route-specific delete snippets.

## Call-Point Inventory

Command basis:

```powershell
rg -n "createTaskWake|dispatchTaskLoop|beforeAcceptedWake|Message.Event.PartUpdated|appendAndWakeTaskOperatorMessage|replyAgentSession|updatePart" packages/opencorvus/src packages/opencorvus/test -g "*.ts"
```

| Surface                                                   | Decision                                                                                                                                                                                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/scheduler/cron-service.ts`       | Add the single cron consumption primitive. It deletes enabled, one-shot, unclaimed or expired-lease task wait rows and wait-created session rows. Install activity subscriptions for terminal non-`wait` tool results and direct user replies in task session trees. |
| `packages/opencorvus/src/engine/queue.ts`                 | When `dispatchTaskLoop` accepts any real task wake, synchronously consume pending task wait cron rows before custom accepted-wake hooks run. Due cron jobs are leased and therefore are not deleted out from under their executor.                                   |
| `Session` message/part writes                             | Keep as the observable event source. Do not add hidden messages or route-specific fallback wakes.                                                                                                                                                                    |
| `packages/opencorvus/test/scheduler/cron-service.test.ts` | Cover deletion semantics, leased-row preservation, early terminal tool result wake, and `wait` tool result self-consumption prevention.                                                                                                                              |

## Acceptance

- Pending task wait cron rows are deleted synchronously when a task wake is
  accepted from a real message/result.
- Claimed due cron rows are not deleted by the early-consume path.
- A terminal non-`wait` tool result in a task session tree consumes the pending
  wait cron and dispatches the task loop early.
- The `wait` tool's own terminal result does not delete the cron it just
  scheduled.
- Wait-created session cron rows are deleted when a normal user message arrives
  before the due time.
- Focused scheduler/wait tests pass.
