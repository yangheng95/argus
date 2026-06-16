# Task Execution Terminalization - 2026-06-16

## Evidence

- Economy task shutdown logs showed `aborted live execution project=global` even
  though the active task lived under a concrete Git project. `serve.ts` derived
  the shutdown scope from `projectDir || process.cwd()` and then used
  `Instance.project.id`.
- Restarted tasks can render as active while `activeSessions=[]` and latest goal
  attempts are owner-orphaned. `listActiveSessionsForTask` already treats
  process-local `SessionStatus` as the live source; goal/run/task terminalization
  lacks the matching owner-death convergence.
- `orphan.ts` is fact-only. That is correct for describe, but incomplete while
  live run/goal artifacts still participate in task wake and board projections.
- `TaskGlobalProjectBindingError` already protects task creation, task message,
  and inject paths. Additional task lifecycle entry points still need the same
  data-integrity guard.

## Call-Site Audit

Command:

```powershell
rg -n "TaskGlobalProjectBindingError|assertTaskProjectIsConcrete|prepareProject|persistQueuedTask|recoverTaskByChannelBinding|retryTask|recordOperatorNote|mergeTaskFileRef|appendTaskAttachment|appendTaskSystemArtifact|dispatchTaskLoop|abortLiveExecutionOnShutdown|abortActiveTasksForProject|abortLiveExecutionForProject|abortRuns|processOwner|orchestrator_tool_ownership|SessionStatus|taskIDForSession|recordOrchestratorStreamError|maybeTripOrchestratorStreamErrorFuse|Pending response rejected" packages/opencorvus/src packages/opencorvus/test -g "*.ts"
```

Relevant findings:

| Area | Evidence | Decision |
| --- | --- | --- |
| Global task guard | `task-api/index.ts::assertTaskProjectIsConcrete`, `prepareProject`, `handleTaskMessage`; `engine/pipeline.ts::persistQueuedTask`. | Keep hard failures. Add missing wake/file/recovery boundaries. |
| Shutdown scope | `cli/cmd/serve.ts::abortLiveExecutionOnShutdown` derives `projectID` from `Instance.project.id`. | Replace ambient-project shutdown with task/ownership-scoped shutdown. |
| Active session source | `engine/store.ts::listActiveSessionsForTask` filters durable active session rows by current-process `SessionStatus`. | Shutdown should consume current-process session ownership and terminate those task trees. |
| Goal owner source | `engine/store.ts::GoalRunRow.owner`; `engine/orphan.ts::isGoalRunOrphaned`. | Dead-owner rows are physical facts and must converge to terminal artifacts when the process starts. |
| Tool ownership | `engine/tool-ownership.ts::listLiveOrchestratorToolOwnership`; `writer.ts::abortLiveOrchestratorToolOwnership`. | Reuse existing ownership writer; do not add a second teardown path. |
| Stream errors | `persist.ts::recordOrchestratorStreamError` and fuse tests already exist. | Do not swallow process-level errors; owner-bound execution paths must write durable terminal facts. |

## Fix

1. Extend `TaskGlobalProjectBindingError` coverage:
   - `mergeTaskFileRef` rejects `task.project_id="global"` before resolving file
     references.
   - `retryTask` and `recordOperatorNote` reject legacy global tasks before
     writing progress/reopening/dispatching.
   - `recoverTaskByChannelBinding` returns only a concrete task in the current
     project; a binding to `global` or another project is treated as corrupt.

2. Replace shutdown scope:
   - Add one engine writer entry point for process shutdown that discovers work
     from current-process ownership:
     - live `orchestrator_tool_ownership` rows whose payload owner equals
       `processOwner()`;
     - current-process `SessionStatus` rows in `streaming` or `retry`, mapped
       through `taskIDForSession`;
     - current-process live goal attempts where `owner === processOwner()`.
   - For each discovered concrete task, abort live tool ownership, abort live
     execution for that task, terminate its session tree, and fail the task.
   - Corrupt `project_id="global"` tasks are counted and logged as corrupt, not
     treated as a valid project scope.
   - `serve.ts` calls this task/ownership-scoped entry point. It no longer
     passes `shutdownDirectory` through `Instance.provide` to discover a project.

3. Add startup owner-death convergence:
   - On server startup, before accepting work, scan live goal attempts whose
     owner PID is dead and whose owner is not this process.
   - Abort those goal attempts, abort their parent runs when no live non-orphan
     goal attempts remain, and fail the concrete task with an explicit owner
     death reason.
   - Do not auto-dispatch, auto-wake, synthesize messages, or retry. A later
     real operator message/retry can reopen the failed task through normal
     entry points.

## Acceptance

- Shutdown from a non-Git sidecar cwd with a concrete active task cannot log or
  execute `project=global` as the teardown scope.
- A dead-owner live goal attempt cannot leave progress as
  `active + orphan + no activeSessions` after startup convergence.
- Legacy global tasks cannot be retried, reopened by operator note, or receive
  direct attachments/system artifacts.
- Channel binding recovery cannot return a task outside the current concrete
  project and cannot return `project_id="global"`.
- Provider/tool stream errors remain owner-bound durable failures; process-level
  unhandled rejection handling is not weakened.
