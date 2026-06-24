# Project Delete Button

Date: 2026-06-23
Status: Implemented

## Requirement

Add a project-level delete button so an operator can delete the whole OpenCorvus project from the project group in the task ledger. This must not reuse the task row delete action; `DELETE /task/:taskID` remains a record-level task deletion route.

## Product Boundary

Deleting a project means deleting OpenCorvus-owned state for that project:

- the `ProjectTable` row for the current project;
- every task in that project, using the same active-task cancellation/settle path as `EngineService.deleteTask`;
- project-owned session, permission, workspace, memory, scheduler, event, and attachment metadata via existing foreign-key cascades;
- project-scoped tables that do not have a project foreign key cascade: `ControlMessageTable`, `QuickNoteTable`, and `DecisionLogTable`;
- the project-local `.opencorvus` runtime/config directory.

Deleting a project does **not** delete the user's source workspace directory. A sidebar button that recursively deletes arbitrary source files is too destructive for the current product contract and was explicitly outside the historical Close Project option. Source deletion needs a separate host-level confirmation design if it is ever required.

## Recall

| Source                                                                      | Constraint                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                                                 | No fallback, no double source, no gate/routing workaround, tests required for every change, screenshot required for frontend UI.                                                     |
| `specs/new-arch/2026-05-13-close-project-option.md`                         | Close Project only clears selection/UI and explicitly does not delete files, tasks, or database rows. Project delete must be a separate action.                                      |
| `specs/new-arch/2026-06-12-deleted-project-task-record-routes.md`           | `DELETE /task/:taskID` is record-level and must keep working without project directory bootstrap. Do not change task route policy for project delete.                                |
| `specs/new-arch/2026-06-22-delete-active-task-record-context.md`            | Active task deletion must cancel/settle real live state before deleting rows; project delete must reuse that service for each task instead of raw cascade deletion.                  |
| `specs/new-arch/2026-06-18-project-ledger-group-primitive.md`               | `ProjectLedgerGroup` is the shared project group owner. Header controls must use `Button` primitives.                                                                                |
| `specs/new-arch/2026-06-19-project-ledger-group-toggle-button-primitive.md` | The disclosure toggle remains `data-ui="project-group-toggle"` and must not be replaced by custom clickable markup.                                                                  |
| `specs/new-arch/2026-06-19-project-ledger-group-disclosure-controls.md`     | The body id and `aria-controls` relationship belong to `ProjectLedgerGroup`; adding project delete must not break disclosure semantics.                                              |
| `specs/new-arch/2026-06-23-task-list-row-directory-selection.md`            | Task list project groups are keyed by task directory, and task selection receives the directory explicitly. Project delete should target the group directory, not the selected task. |

## Call Point Inventory

Searches run before this plan:

```text
rg -n "deleteTask\(|DELETE /task|project/current|closeProject\(|removeRecentDirectory\(|ProjectLedgerGroup|project-group-toggle|task-row-delete|routeRequiresProjectDirectory|ProjectRuntimePaths|ControlMessageTable|QuickNoteTable|DecisionLogTable" packages specs
```

| Surface                 | File                                                                           | Decision                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project route owner     | `packages/opencorvus/src/server/routes/project.ts`                             | Add `DELETE /project/current`. This route is project-scoped and must require the existing directory context.                                                                                             |
| Task delete service     | `packages/opencorvus/src/task-api/index.ts::EngineService.deleteTask`          | Reuse for every task id in the current project so active tasks cancel and settle. Do not alter record-level task route behavior.                                                                         |
| Project runtime paths   | `packages/opencorvus/src/project/runtime-paths.ts`                             | Use `.opencorvus` as the only project-local state directory to remove. Do not delete source files.                                                                                                       |
| Cascading database rows | `packages/opencorvus/src/storage/schema.ts` and table definitions              | Rely on existing FK cascades for FK-owned rows; explicitly delete non-FK project/task projections.                                                                                                       |
| Non-FK control rows     | `packages/opencorvus/src/control/control.sql.ts`                               | Delete by `project_id`.                                                                                                                                                                                  |
| Non-FK quick notes      | `packages/opencorvus/src/quicknote/quicknote.sql.ts`                           | Delete by `project_id`.                                                                                                                                                                                  |
| Non-FK decision logs    | `packages/opencorvus/src/decision-log/schema.ts`                               | Delete by collected task ids before/after task row deletion.                                                                                                                                             |
| Overlay project service | `packages/overlay/src/services/workspace.ts`                                   | Add one `deleteProject(directory)` client method. It calls `DELETE /project/current?directory=...`, removes the directory from recent projects, and clears active UI when deleting the active directory. |
| Overlay task list       | `packages/overlay/src/components/TaskList.tsx`                                 | Add a group-level handler that invokes `deleteProject(group.directory)`. Do not put this on task rows.                                                                                                   |
| Project group primitive | `packages/overlay/src/components/ProjectLedgerGroup.tsx`                       | Add an optional `onDeleteProject` action rendered as a sibling of the disclosure toggle. Mission/Coding Assistant project groups omit this prop.                                                         |
| Sidebar CSS             | `packages/overlay/src/styles/surfaces/sidebar.css`                             | Add a stable header grid and danger icon button styles without changing the existing toggle's data-ui contract.                                                                                          |
| i18n                    | `packages/overlay/src/i18n/en-US.json`, `packages/overlay/src/i18n/zh-CN.json` | Add project delete title, armed confirmation, success, and failure strings.                                                                                                                              |
| Browser visual test     | `packages/overlay/test/browser/project-ledger-group-browser.test.ts`           | Verify the Task ledger project group shows a project delete button, shared mission/assistant groups do not, and screenshot the result.                                                                   |

## Backend Design

- Add `ProjectDeleteResult` with `{ ok, projectID, directory, deletedTaskCount }`.
- Implement project deletion outside `Project` namespace to avoid making `Project` depend on `task-api`.
- Read all current project task ids from `EngineTaskTable`.
- For each task id, call `EngineService.deleteTask(taskID)`.
- After task deletion, collect every remaining `SessionTable` row in the current project and cancel/wait its `TaskQueueService` and live `SessionPrompt` handles before removing project files or DB rows. This covers assistant/mission/coding sessions that are project-owned but not rooted at an `EngineTaskTable` row.
- If queue or prompt cancellation cannot be proven, surface `TaskCancellationIncompleteError` before deleting project files or project/session rows.
- Delete `DecisionLogTable` rows for the collected task ids.
- Delete `ControlMessageTable` and `QuickNoteTable` rows by current project id.
- Delete the `.opencorvus` directory after resolving and checking that the target stays inside the current project directory and the basename is exactly `.opencorvus`.
- Delete the project row so FK cascades remove dependent rows.
- Dispose the active `Instance` after deletion so the next project-scoped request cannot keep serving stale cached project state.

## Frontend Design

- `ProjectLedgerGroup` gets optional `onDeleteProject?: (directory: string) => void`.
- The delete action is an `ArmedConfirmButton` with `data-ui="project-group-delete"` and a second-click confirmation window, matching task row deletion behavior.
- The delete button is a sibling of the disclosure toggle inside a stable `.project-group-head` grid, so it does not intercept toggle clicks and does not resize the title/count columns.
- `TaskList` passes `onDeleteProject` only for task ledger groups and shows notifications based on the service result.
- `deleteProject(directory)` in `workspace.ts` is the only overlay-side writer for project deletion. When the deleted directory is active, it calls `closeProject()`; when it is not active, it reloads the task list through the caller.

## Acceptance

1. The task ledger project group shows a group-level delete button distinct from row-level task delete buttons.
2. Confirming the project delete calls `DELETE /project/current` with the deleted group's directory.
3. `DELETE /project/current` deletes all project tasks by going through active-task-safe task deletion, not by raw task row cascade alone.
4. Project delete removes the project DB row, non-FK project/task projections, and `.opencorvus`.
5. Project delete leaves normal source files in the workspace directory untouched.
6. `DELETE /task/:taskID` remains record-level and its route directory policy is unchanged.
7. Mission/Coding Assistant project groups keep using `ProjectLedgerGroup` without a project delete action.
8. Visual verification shows the project delete button aligned in the project group header without text overlap at desktop and mobile widths.
9. Project delete waits for project-owned non-task queue wakes/prompts before deleting `.opencorvus` or project/session rows.

## Verification

```powershell
bun test packages/opencorvus/test/server/project-routes.test.ts --test-name-pattern "DELETE /project/current" --timeout 60000
bun test packages/opencorvus/test/task-api/delete-running-task-settle.test.ts packages/opencorvus/test/scheduler/task-queue-service.test.ts --timeout 60000
bun run --cwd packages/opencorvus typecheck
bun test packages/overlay/test/project-delete-button.test.ts packages/overlay/test/workspace-active-directory.test.ts packages/overlay/test/task-list-buttons-primitive.test.ts --timeout 60000
node test/browser-runner.mjs test/browser/project-ledger-group-browser.test.ts
```

Visual evidence reviewed from:

- `packages/overlay/.scratch/project-ledger-group-tasks.png`
- `packages/overlay/.scratch/project-ledger-group-mission.png`
- `packages/overlay/.scratch/project-ledger-group-coding-assistant.png`
- `packages/overlay/.scratch/project-ledger-group-tasks-mobile.png`

The diff was reviewed for route policy drift and accidental source-directory deletion.
