# Project Copy And Rename Buttons

Date: 2026-06-23
Status: Planned

## Requirement

Add project-level copy and rename buttons beside the existing project delete
button. These actions belong to the project group header, not task rows.

## Product Boundary

- Copy project means copying the project directory path to the clipboard. A
  one-click project-group button has no target directory input, so recursively
  copying source files or cloning project records would create a second project
  identity without an operator-selected destination.
- Rename project means updating the current OpenCorvus project record name in
  `ProjectTable.name`.
- Renaming does not rename the source directory on disk.
- The project directory remains the identity and request-routing source.

## Recall

| Source | Constraint |
| --- | --- |
| `2026-06-23-project-delete-button.md` | Project group actions live in `ProjectLedgerGroup`; delete targets OpenCorvus project state and not source files. |
| `2026-06-18-project-ledger-group-primitive.md` | `ProjectLedgerGroup` is the shared grouped ledger component. Header controls use `Button` primitives. |
| `2026-06-19-project-ledger-group-disclosure-controls.md` | Disclosure toggle and body id/`aria-controls` contract must remain intact. |
| `ProjectTable` | `name` is the existing single source for custom project display names. |
| `Project.update()` | Existing backend writer updates `ProjectTable.name` and emits `project.updated`; reuse it instead of adding a parallel writer. |

## Call Point Inventory

Searches run before implementation:

```text
rg -n "ProjectLedgerGroup|project-group-delete|deleteProject|Project.update|PATCH /project|project.current|ProjectTable|routeRequiresProjectDirectory|navigator.clipboard|writeText" packages specs
```

| Surface | File | Decision |
| --- | --- | --- |
| Backend current project route | `packages/opencorvus/src/server/routes/project.ts` | Add `PATCH /project/current` before `/:projectID`, using `Project.update({ projectID: Instance.project.id, name })`. |
| Existing generic project update | `packages/opencorvus/src/server/routes/project.ts` `PATCH /:projectID` | Keep unchanged; the UI uses the current-project route so directory scoping remains the single routing source. |
| Project cache | `packages/opencorvus/src/project/instance.ts` | Refresh the active instance after rename so `GET /project/current` returns the updated name. |
| OpenAPI route checks | `packages/opencorvus/test/server/app-routes.test.ts` | Assert PATCH `/project/current` is documented and has exactly one directory query. |
| Route policy | `packages/transport-protocol/test/contract.test.ts` and overlay API injection tests | Ensure `PATCH /project/current` remains project-directory scoped. |
| Overlay workspace service | `packages/overlay/src/services/workspace.ts` | Add `renameProject(directory, name)` as the single frontend project-name writer. |
| Overlay task list | `packages/overlay/src/components/TaskList.tsx` | Wire copy/rename handlers into task-ledger `ProjectLedgerGroup` only; open the shared app dialog for rename and reload tasks after rename. |
| Project group primitive | `packages/overlay/src/components/ProjectLedgerGroup.tsx` | Add optional `onCopyProject` and `onRenameProject` buttons. Mission/Coding Assistant groups omit these props. |
| Sidebar CSS | `packages/overlay/src/styles/surfaces/sidebar.css` | Reserve stable action slots for copy, rename, and delete; add input styling without overlapping text. |
| i18n | `packages/overlay/src/i18n/en-US.json`, `zh-CN.json` | Add project copy/rename labels and notification text. |
| Browser visual | `packages/overlay/test/browser/project-ledger-group-browser.test.ts` | Verify task project groups show copy/rename/delete while Mission/Coding Assistant groups do not, and screenshot desktop/mobile. |

## Visual Repair 2026-06-24

The first copy/rename/delete implementation used 24px action buttons beside a
26px project header. Three 24px buttons read as oversized standalone controls
and dominated the compact ledger row. The project action slot must be compact:
18px square hit visuals with 10px icons, while preserving accessible button
labels and keyboard focus through the existing button primitive.

## Acceptance

1. Task ledger project groups show copy, rename, and delete as distinct
   project-level icon buttons outside the disclosure toggle.
2. Mission and Coding Assistant project groups continue to use the same
   primitive without project action buttons.
3. Copy writes the project directory to the clipboard and reports success or
   failure through notifications.
4. Rename uses the shared app dialog input and sends `PATCH /project/current`
   with the group's directory.
5. Renamed project names render from `ProjectTable.name`; directory remains
   visible through tooltip/parent context and remains the request-routing key.
6. Source directories are not renamed or copied.
7. Project action buttons stay visually subordinate to the project header:
   18px square visual slots, compact spacing, and no text overlap on desktop
   or mobile.
8. Static, unit, OpenAPI, route-policy, typecheck, and browser visual checks
   pass.
