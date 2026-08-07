# Right Dock Architecture Frontend Hiding

## Recall

| Item                       | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement           | Hide the right-side Architecture component in the frontend, including every entry and click-trigger path that can open it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Acceptance criteria        | Architecture is absent from the Right Dock empty-state chooser, the Right Dock add menu, the Environment Information task shortcuts, the open-tab strip, and the mounted Right Dock view set. Requirements, Goals, Browser, Review, Files, Screenshots, Agent transcript, and File behavior remain unchanged. Persisted `TaskBoard.architect` data and Architect conversation identity remain available to non-panel consumers. The real desktop page is opened, the Right Dock add surface and Environment Information surface are inspected, and screenshots are personally reviewed.                              |
| Hard constraints           | Frontend-only hiding. Remove the production panel integration and launchers directly; do not add a feature flag, visibility gate, fallback, compatibility branch, CSS-only concealment, synthetic state, duplicate catalog, local signal, query override, temporary frame, or handwritten interaction. Do not delete the persisted Architect model or runtime behavior. Preserve unrelated dirty-worktree changes. Do not add, modify, update, delete, or run User Interface (UI) automated tests. Browser interaction uses the Browser skill through Node.js, never Bun.                                            |
| Sources read               | Root `AGENTS.md`; Browser control skill; `specs/current/architecture/07-panel.md`; `2026-07-02-right-toolbar-task-scope-panels.md`; `2026-07-23-environment-summary-git-actions-and-resource-groups.md`; `main.tsx`; `RightDock.tsx`; `TaskDirBar.tsx`; `App.tsx`; `Board.tsx`; `ArchitectPanel.tsx`; both locale catalogs; and the existing historical UI-test assertion inventory without running those tests.                                                                                                                                                                                                     |
| Whole-repository grep      | Exact source searches enumerated every `RightDockPanel` / `CenterWorkbenchPanel` `architect` member, the single `RIGHT_DOCK_CATALOG` metadata row consumed by both empty-state and add-menu launchers, the Environment `taskScopeShortcuts` architect counter and generic click handler, the `main.tsx` mounted `TabPanel`, view lookup, order member, and `ArchitectBoardPanel` import. The remaining `architect` occurrences belong to Agent/session identity, persisted board data, card color/message presentation, or the dormant reusable `ArchitectPanel`; they do not open the Right Dock Architecture page. |
| Independent agent feedback | None. The user did not request sub-agents; the frontend path is small and shares one catalog plus one mount owner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Git baseline               | Delivery branch is `work-v0.0.24beta-yr-0729`; commit `4be3b20325` was pushed to `legacy-remote/work-v0.0.24beta-yr-0729` before this task's edits. Existing workspace-corner and wave-cadence changes are unrelated concurrent work and must remain untouched.                                                                                                                                                                                                                                                                                                                                                            |

## Cause Chain

1. **Observable behavior:** Architecture appears as a right-side tool and can be
   opened from more than one visible launcher.
2. **Direct triggers:** the shared `RIGHT_DOCK_CATALOG` row feeds both the Dock
   empty state and the `+` menu, while `TaskDirBar` independently derives a
   task-scoped Architecture shortcut from `TaskBoard.architect.contractCount`.
3. **Mounted destination:** `main.tsx` includes `architect` in the workbench
   panel domain, DOM view lookup, panel order, and force-mounted `TabPanel`, so
   both trigger families converge on a real Right Dock destination.
4. **Root correction:** remove Architecture from the production Right Dock
   catalog, Environment shortcut projection, workbench panel domain, and mounted
   destination together. This makes the visible navigation graph and mounted
   frontend surface agree without a hide flag or CSS concealment.
5. **Preserved boundary:** backend Architect execution, board persistence,
   conversation Agent roles, card coloring, and reusable data presentation are
   outside this frontend hiding request and remain unchanged.

## Complete Call-Site Disposition

| Owner or consumer                                                           | Decision                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/RightDock.tsx`                             | Remove `architect` from `RightDockPanel` and the sole `RIGHT_DOCK_CATALOG`. Because the empty chooser, add menu, fixed panel identities, metadata map, and Environment catalog derive from that source, none can expose an Architecture entry or tab. |
| `packages/overlay/src/components/TaskDirBar.tsx`                            | Remove the Architect board read, contract-count shortcut, label, and special Architecture `data-ui` mapping. Keep the generic mature shortcut renderer/click handler for the remaining panels.                                                        |
| `packages/overlay/src/main.tsx`                                             | Remove `ArchitectBoardPanel` import, `architect` from `CenterWorkbenchPanel` and order, its DOM lookup, and the force-mounted Architecture `TabPanel`. Generic open/close/select behavior remains unchanged for the surviving panel domain.           |
| `packages/overlay/src/components/App.tsx`                                   | Preserve. It forwards only the typed generic Right Dock callback and does not create an Architecture entry.                                                                                                                                           |
| `packages/overlay/src/components/Board.tsx` and `ArchitectPanel.tsx`        | Preserve existing reusable data projection code; the user requested frontend hiding, not deletion of persisted Architect presentation support. It is no longer mounted by the production Right Dock.                                                  |
| Overlay locale catalogs                                                     | Remove only the now-unused `right_dock.tool.architecture` launcher key from both catalogs. Preserve Architect Agent terminology and dormant panel copy because runtime Agent/session presentation still consumes the Architect role.                  |
| `packages/overlay/src/store/board.ts` and backend Architect/runtime sources | Preserve canonical `TaskBoard.architect` data and execution behavior. This task changes no data, protocol, API, scheduler, or Agent contract.                                                                                                         |
| `specs/current/architecture/07-panel.md`                                    | Replace the obsolete visible Architecture panel/launcher contract with the current hidden-frontend boundary while retaining Architect data ownership.                                                                                                 |
| Existing Overlay UI tests and browser fixtures                              | Do not add, modify, update, delete, or run. Existing source-string/UI assertions remain historical debt under the explicit UI-test prohibition.                                                                                                       |

## Implementation And Verification Plan

1. Commit and push this Recall before product edits.
2. Remove the Architecture panel from the single catalog, Environment shortcut,
   workbench panel domain, DOM lookup, and mounted view.
3. Update the current panel architecture without changing backend Architect or
   persisted Board contracts.
4. Run Overlay typecheck, localization validation, production build, required
   documentation health, targeted formatting/static integrity, whole-owner grep,
   and `git diff --check`; do not run UI tests.
5. Start the real current-source desktop page, inspect and capture the Right
   Dock empty/add surfaces plus Environment Information, and personally confirm
   that no Architecture entry, tab, component, or click trigger remains.
6. Re-grep every frontend call site, review the exact task-owned diff and visual
   evidence a second time, then commit with the required `dsw-33987` prefix,
   push to `legacy-remote`, and verify remote convergence.

## Progress

- [x] Read the current architecture, production owners, historical decisions,
      and every exact frontend call site.
- [x] Record Recall, cause chain, complete disposition, and verification plan.
- [x] Commit `7b0df00c33` and push the pre-change plan to legacy remote.
- [x] Remove the frontend Architecture destination and all launchers.
- [x] Complete non-UI verification and real-page visual acceptance.
- [x] Complete second review, commit `b8fa951c84`, and legacy remote convergence.

## Visual Evidence

The current-source Vite page at `http://127.0.0.1:5173/` was connected to the
real local OpenCorvus service and inspected through the in-app Browser. No
fixture, query override, local signal, temporary frame, synthetic data, or
handwritten interaction was introduced.

The opened Right Dock empty state visibly contains Browser, Review, Files,
Screenshots, Requirements, and Goals only. Its `+` add menu visibly contains
the same six choices. The expanded Environment Information surface retains its
real Goals, Requirements, Review, Files, and Screenshots content, but has no
Architecture classification or shortcut. Read-only page inspection confirmed
zero `right-dock-add-architect`, `right-dock-empty-architect`,
`project-runtime-category-architecture`, `centerWorkbenchArchitect`, or
`data-workbench-view="architect"` nodes. The screenshots were personally
reviewed at their original 1280-by-720 resolution; the remaining controls,
spacing, content hierarchy, and Dock resize boundary are visually intact.

- [`2026-07-30-right-dock-without-architecture.png`](../../artifacts/2026-07-30-right-dock-without-architecture.png)
- [`2026-07-30-environment-without-architecture.png`](../../artifacts/2026-07-30-environment-without-architecture.png)

## Verification

| Check                           | Result                                                                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overlay TypeScript typecheck    | Passed                                                                                                                                                                        |
| Overlay localization validation | Passed after removing only the unused Right Dock Architecture launcher key from both locale catalogs                                                                          |
| Overlay production Vite build   | Passed; existing dependency-directive and chunk-size warnings only                                                                                                            |
| Targeted Prettier check         | Passed for every task-owned source, locale, architecture, record, and index path                                                                                              |
| Historical documentation links  | Passed: 22 tests, 71 assertions                                                                                                                                               |
| `git diff --check`              | Passed                                                                                                                                                                        |
| Whole-owner grep                | Passed: no production Right Dock type, catalog entry, Environment shortcut, main workbench member, DOM lookup, mounted panel, or launcher locale key remains for Architecture |
| Real Right Dock empty state     | Passed: visible choices are Browser, Review, Files, Screenshots, Requirements, and Goals                                                                                      |
| Real Right Dock add menu        | Passed: visible menu items are Browser, Review, Files, Screenshots, Requirements, and Goals                                                                                   |
| Real Environment Information    | Passed: Goals, Requirements, and resource tools remain; Architecture shortcut count is zero                                                                                   |
| Real mounted view set           | Passed: Architecture panel/view node count is zero                                                                                                                            |
| UI automated tests              | None added, modified, updated, deleted, or run                                                                                                                                |
