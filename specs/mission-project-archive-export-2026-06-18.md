# Mission Project Archive Export 2026-06-18

## Requirement

Add a project download action for Mission rows, matching the existing task project archive behavior:

- Download the Mission's project files as a ZIP.
- Use Git ignore semantics as the only project file selection source.
- Exclude OpenCorvus internal runtime/worktree files through the existing runtime-path filter.
- Include persisted Mission execution evidence in the ZIP instead of UI-only state.

## Recall

- `specs/task-project-archive-export-2026-06-04.md` defines the task archive contract and archive shape.
- `specs/new-arch/2026-06-14-runtime-memory-retention-hardening.md` records the later runtime-path filter and bounded JSON export requirement for task archives.
- `packages/opencorvus/src/engine/task-project-archive.ts` is the current archive implementation. It already owns Git file selection, internal runtime filtering, JSON bounding, and ZIP writing.

## Call-Point Audit

| Surface | Current call points | Change |
| --- | --- | --- |
| Backend archive builder | `buildTaskProjectArchive` in `packages/opencorvus/src/engine/task-project-archive.ts`; imported only by `server/routes/orchestrator.ts`. | Generalize the archive module with a shared project ZIP path and add `buildMissionProjectArchive`. |
| Task route | `GET /task/:taskID/project-archive` in `packages/opencorvus/src/server/routes/orchestrator.ts`; OpenAPI coverage in `packages/opencorvus/test/server/app-routes.test.ts`; behavior coverage in `task-project-archive.test.ts`. | Keep route behavior unchanged; catch the generalized unsupported-project error. |
| Mission routes | `packages/opencorvus/src/server/routes/mission.ts` owns `/mission`, `/mission/:missionID/status`, title, abort, delete, wake. | Add `GET /mission/:missionID/project-archive`, resolving the Mission by `(missionID, directory)` via `missionRouteSession`. |
| Mission data projections | `missionRecord`, `missionStatusRecord`, `projectMissionTasks` derive Mission row/status/task projections from session and engine projections. | Reuse these projections for archive JSON. Do not read raw engine task tables in the route beyond existing projection helpers. |
| Mission transcript | `session.ts` uses `Session.messages`, `enrichStandaloneSessionTranscript`, and `conversationMessageHasDisplay` for session conversation hydrate. | Reuse the same transcript projection for the archive. |
| Overlay binary download | `downloadTaskProjectArchive` in `packages/overlay/src/services/task.ts` owns binary request, filename parsing, and browser save. | Move shared binary save/filename/error helpers to `services/project-archive.ts`; task and mission downloads call it. |
| Mission service actions | `packages/overlay/src/services/mission.ts` uses `missionActionPath` for title/abort/delete with explicit row directory. | Add `downloadMissionProjectArchive(target)` using the same explicit Mission row directory. |
| Mission row actions | `packages/overlay/src/components/Mission.tsx` wires busy/error state into `MissionList`; `MissionList.tsx` renders abort/rename/delete through `Button`. | Add a download icon action with `data-ui="task-row-download"` and Mission-specific title text. |
| Route directory policy | `routeRequiresProjectDirectory` treats `/mission` as global but `/mission/:missionID/*` as project-scoped. | No policy change; the download route must require the row directory like other Mission actions. |

## Archive Shape

```
project/
  <git-tracked-or-unignored files>
opencorvus-mission-execution-flow/
  manifest.json
  mission.json
  status.json
  tasks.json
  transcript.json
```

`manifest.json` records Mission ID, session ID, project ID/worktree, export time, selected file count, execution-flow file names, and JSON bounding limits.

## Tests

- Backend route test:
  - creates a Git project with tracked, untracked, ignored, and internal runtime files;
  - creates a Mission session and a Mission-owned task;
  - downloads `/mission/:missionID/project-archive`;
  - asserts the ZIP includes tracked/untracked files, excludes ignored/runtime files, and includes Mission execution JSON.
- Backend non-Git test:
  - asserts `/mission/:missionID/project-archive` returns explicit 422 JSON for a non-Git Mission project.
- OpenAPI test:
  - asserts `/mission/{missionID}/project-archive` advertises `application/zip`.
- Overlay service/component tests:
  - asserts `downloadMissionProjectArchive` requests binary `mission/<id>/project-archive` with the Mission row directory;
  - asserts Mission rows render the download button and wire the handler without selecting the row.
