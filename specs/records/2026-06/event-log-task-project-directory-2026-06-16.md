# Event Log Task Project Directory Fix - 2026-06-16

## Evidence

- G1's latest build worktree exists and is a valid git worktree:
  `C:\Users\chuan\myhexin-local\demos\economy\economy_1\.opencorvus\r\w\In\qno3Hq\worktree`.
- Sidecar log `sidecar-1781594189-28216.log` shows `shutdown requested via http.shutdown` and
  `aborted live execution project=global runs=1 goalRuns=0 tasks=1 sessions=8 toolParts=0`.
- Older sidecar log shows repeated `unhandledRejection: instance: No context found for instance`.
- The stack maps to `packages/opencorvus/src/engine/event-log.ts`, where the global event subscriber calls
  `ProjectRuntimePaths.eventLogPath(Instance.directory, taskID)`.

## Call-Site Audit

Command:

```powershell
rg -n "EngineEventLog|Bus\.publish|ProjectRuntimePaths\.eventLogPath|engine\.event-log|engine\.task\.created" packages/opencorvus/test packages/opencorvus/src -g "*.ts"
```

Relevant findings:

- `packages/opencorvus/src/engine/event-log.ts` is the only `ProjectRuntimePaths.eventLogPath(...)` call site.
- `EngineEventLog.init()` is the only `engine.event-log` implementation.
- Engine task rows already have `project_id`; `Project.get(id)` returns the project worktree from the project table.

## Fix

- Resolve event-log paths from the task row and project row:
  `taskID -> requireTask(taskID).project_id -> Project.get(projectID).worktree`.
- Remove `Instance` from `event-log.ts`; a global subscriber must not depend on ambient instance context.
- Keep missing task/project as a hard initialization failure for that task log entry, logged by the existing catch.

## Tests

- Add a focused test proving event-log path resolution works outside `Instance.provide`.
- Assert the path is under the task project's runtime directory and does not use the process/global directory.
