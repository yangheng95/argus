# Task Project Archive Export 2026-06-04

## Requirement

Add a download button on each overlay task row. The downloaded ZIP must contain:

- Project files for that task's project, excluding files ignored by Git ignore rules.
- The task execution flow persisted in OpenCorvus database projections.

## Call-Point Audit

| Surface | Existing call points | Change |
| --- | --- | --- |
| Task row actions | `packages/overlay/src/components/TaskList.tsx` renders start, cancel, rename, delete actions. | Add a download icon action for non-pending tasks. |
| Task-scoped API path | `packages/overlay/src/services/task.ts` uses `taskScopedPath()` for delete/title/retry/replan/cancel/session actions. | Reuse the same path builder for `GET /task/:taskID/project-archive`. |
| Binary transport | `apiRequest(..., { responseKind: "binary" })`, `tauri-transport.ts`, `vscode-transport.ts` already support binary responses. | Use the existing HostTransport binary path; no native command. |
| Server task routes | `packages/opencorvus/src/server/routes/orchestrator.ts` owns all `/task/:taskID/...` task endpoints. | Add one task-scoped archive endpoint there. |
| Task projections | `EngineService.getTask/getBoard/listRuns/listTaskInteractions/listArtifacts/getTaskTrace/listProtocolEvents` and route-local `loadTaskTranscript()`. | Build the execution-flow JSON from these existing projections. |
| Project directory | `EngineTaskTable.project_id` plus `Project.get(id).worktree`; `viewTask` exposes directory through listTaskRows. | Resolve the archive root from the task's project row, not from request cwd. |
| Git ignore source | Existing snapshot code uses `git ls-files --cached --others --exclude-standard -z -- .`. | Use the same Git command for archive file selection. |
| ZIP implementation | `@zip.js/zip.js` is already in package dependencies. | Use ZipWriter with Uint8ArrayReader/Writer; no new dependency. |

## Archive Shape

```
project/
  <git-tracked-or-unignored files>
opencorvus-task-execution-flow/
  manifest.json
  task.json
  board.json
  runs.json
  interactions.json
  artifacts.json
  protocol-events.json
  trace.json
  transcript.json
```

`manifest.json` records task ID, project ID, worktree, export time, selected file count, and execution-flow file names.

## Design Notes

- `git ls-files --cached --others --exclude-standard -z -- .` is the single source for "project files after gitignore exclusion". It includes tracked files and untracked non-ignored files, while excluding `.gitignore`-ignored content.
- Non-git/global tasks cannot produce this archive because there is no Git ignore source. The endpoint returns an explicit 422.
- The endpoint streams no hidden UI-only data. It exports observable task projections and persisted protocol events.
- The route does not read raw SQLite tables directly, except for resolving the task and project row. This avoids a parallel interpretation of task execution state.

## Tests

- Backend route test:
  - creates a git project with tracked, untracked, and ignored files;
  - seeds a task row;
  - downloads `/task/:taskID/project-archive`;
  - asserts ZIP includes tracked/untracked files and excludes ignored files;
  - asserts execution-flow JSON files exist and contain the task ID.
- Frontend service/component test:
  - verifies download uses `responseKind: "binary"`;
  - verifies TaskList renders a download button and calls the task download handler without selecting the row.
