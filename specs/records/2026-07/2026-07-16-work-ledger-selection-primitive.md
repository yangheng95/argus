# Work Ledger Selection Primitive

Date: 2026-07-16
Status: Complete
Owner: Codex

## Recall

### User Request

The Projects ledger must never highlight a project row at the same time as one of its Mission, task, or Chat children. The visibly different selected-background corner radii also prove that project and child rows are not using one UI primitive.

### Acceptance Criteria

1. Selecting a Mission, task, or Chat leaves exactly one highlighted Work Ledger row; its owning project is not highlighted.
2. Selecting the already-current project clears the selected child even though the directory does not change.
3. Project headers and Mission/task/Chat rows share one navigation-row primitive for hover wash, selected wash, color, transition, and radius.
4. The selected project and selected child computed radii are equal and derive from the primitive token.
5. A real desktop browser fixture covers project-to-child and child-to-project selection, keyboard semantics, computed styles, and goal-scoped screenshots.

### Hard Constraints

- `boardStore.selectedSource` remains the only selected Mission/task/Chat source. No shadow project/task selection state, fallback, compatibility branch, or route/query override may be introduced.
- The active directory remains project runtime context, but it cannot by itself make a project row active while `selectedSource` owns a child selection.
- Same-directory project selection must repair the lifecycle at the existing `applyDirectory` entry point instead of adding a UI-only deselection patch.
- Visual validation is desktop-only for this task and must use the real Node-driven browser fixture without restarting the user's running OpenCorvus or Overlay.
- Existing concurrent edits in `project-ledger-group-browser.test.ts` and the font record must be preserved.

### Sources Read

- User screenshot `codex-clipboard-4508f61d-7308-4e75-b83d-74c94903a05b.png`.
- `packages/overlay/src/components/ProjectLedgerGroup.tsx`.
- `packages/overlay/src/components/WorkLedger.tsx` and `LedgerRowMainButton.tsx`.
- `packages/overlay/src/services/workspace.ts`, `services/task.ts`, `services/project-directory.ts`, and `store/board.ts`.
- `packages/overlay/src/styles/surfaces/sidebar.css`, `styles/surfaces/work-ledger.css`, and `styles/primitives/file-row.css`.
- `packages/overlay/test/workspace-active-directory.test.ts`, `work-ledger-consolidation.test.ts`, `project-delete-button.test.ts`, and `browser/project-ledger-group-browser.test.ts`.
- `specs/README.md`, `specs/records/2026-07/README.md`, and related Work Ledger/project action records.

### Whole-Repository Search Evidence

The required full-repository searches covered `activeTaskID`, `activeSessionID`, `selectedSource`, `settingsStore.directory`, `data-active`, `selected-wash`, `project-group-head`, `task-row-mini`, `applyDirectory`, `preserveSelection`, and all `WorkLedger` call sites.

| Call site / owner                         | Current evidence                                                                                                                                   | Decision                                                                                                                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tsx` `WorkLedger` mount             | Passes `activeTaskID()` and `activeSessionID()` from `boardStore.selectedSource`.                                                                  | Preserve as child-selection input.                                                                                                                                                  |
| `WorkLedger.selected`                     | Compares each item row against the task/session identifiers.                                                                                       | Preserve; this is the child-row projection of the canonical source.                                                                                                                 |
| `WorkLedgerProjectGroupView`              | Marks a project active solely when `settingsStore.directory` equals the group directory.                                                           | Replace with a derived project-selected predicate that also requires no selected child source.                                                                                      |
| `selectWorkLedgerProject`                 | Calls `applyDirectory(projectDirectory, { save: true, restoreWorkspace: false })`.                                                                 | Preserve the caller; repair same-directory selection semantics in the lifecycle owner.                                                                                              |
| `workspace.applyDirectory`                | Returns early for the same directory before `clearSelectionForDirectorySwitch`.                                                                    | On a manual same-directory selection, stop the selected stream and clear the child projection without reloading project scope. Preserve `preserveSelection: true` for task handoff. |
| `task.selectTask` cross-directory handoff | Calls `applyDirectory(..., { preserveSelection: true })`.                                                                                          | Preserve; destination task hydrate must retain ownership.                                                                                                                           |
| `.project-group-head` surface CSS         | Owns hover/selected wash and `--oc-radius-large`.                                                                                                  | Remove state chrome ownership and consume the shared primitive.                                                                                                                     |
| `.task-row-mini` surface CSS              | Separately owns hover/selected wash and `--oc-radius-soft`.                                                                                        | Remove duplicated state chrome ownership and consume the shared primitive.                                                                                                          |
| `index.html` primitive load order         | Loads primitives before surfaces.                                                                                                                  | Add the navigation-row primitive alongside existing primitive styles.                                                                                                               |
| `project-ledger-group-browser.test.ts`    | Existing real fixture already renders projects plus Mission/task/Chat rows and saves screenshots; it also contains concurrent secondary-menu work. | Extend this fixture in non-overlapping assertions and preserve the concurrent menu coverage.                                                                                        |

### Independent Agent Feedback

No independent agent was requested or started. The repository's multi-agent policy forbids delegation unless the user explicitly asks for it; the main agent owns the investigation, implementation, visual review, and second review.

## Root Cause

The UI combines two different concepts as if they were one selection: `settingsStore.directory` is persistent project runtime context, while `boardStore.selectedSource` is the selected conversational work item. Because selecting a child retains its owning directory, both predicates remain true. A same-directory project click then hits `applyDirectory`'s pre-lifecycle no-op and cannot relinquish the selected child. Independently, project and child rows paint their selected states in separate surface selectors with different radius tokens, so the double highlight also exposes a missing shared navigation-row primitive.

## Implementation Plan

1. Add a small CSS navigation-row primitive as the sole owner of hover/selected wash, text color, transition, and soft radius, then load it with the other primitives.
2. Apply the primitive class to `.project-group-head` and every `.task-row-mini` Work Ledger item; delete their duplicated state chrome from `sidebar.css`.
3. Derive project active state from directory equality plus absence of a selected task/session identifier.
4. Make manual same-directory `applyDirectory` clear the selected source and task-scoped projection while leaving project-scope data and its task-list stream intact.
5. Add focused source/unit tests and extend the real desktop browser fixture to prove mutual exclusion and equal computed radii in both selection directions.
6. Build, run focused tests, inspect the resulting screenshots, repair any visual mismatch, run spec/document health checks, then perform a second diff review before commit and git-cc push.

## Validation Plan

```powershell
bun test packages/overlay/test/workspace-active-directory.test.ts packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/project-delete-button.test.ts packages/overlay/test/navigation-row-primitive.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-ledger-group-browser.test.ts
bun run --cwd packages/overlay typecheck
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
```

## Codex Review Feedback

- The focused same-directory lifecycle test exposed a pre-existing ownership defect in `startTaskListSSE`: it calculated the active directory but omitted it from the stream query. The implementation now passes that directory through the existing stream transport, so clearing a child selection can be proven to leave the correctly scoped project task-list stream intact.
- The first browser-fixture attempt overlapped concurrent secondary-menu test edits and timed out before completion. A later rerun exposed that the menu-close assertion observed focus before Kobalte completed its restoration; the fixture now waits for the real trigger-focus outcome. The complete Node-driven fixture then passed, and the concurrent menu coverage was preserved.
- The final diff review found no second selected-state source: project activity is a projection of active directory plus the absence of the canonical task/session selection, and all selected/hover paint for both row families is owned by `oc-navigation-row`.

## Validation Record

- Focused Work Ledger tests passed across workspace lifecycle, consolidation, delete-button, navigation primitive, pseudo-state, and the relevant architecture-guard assertion. The full architecture-guard file still reports unrelated concurrent terminal, memory/search, brand-guide, palette, and chat-bubble worktree drift; none intersects the navigation-row selectors or this delivery.
- Overlay TypeScript typecheck: passed.
- Overlay localization/hash check: passed with panel revision `6a8b3b1996db8977`.
- Real desktop browser fixture: passed under Node. It asserted exactly one active navigation row in project and child states, equal non-zero computed corner radii, and preserved the existing keyboard/menu semantics.
- Goal-scoped screenshots were inspected after the successful run: `.scratch/work-ledger-task-only-selected.png` shows only the task selected; `.scratch/work-ledger-project-only-selected.png` shows only the project selected. Both use the same soft-radius selected wash. Direct RGB sampling also confirmed that a black area shown by one image-viewer rendering was not present in the opaque PNG source.
- Historical-links and product-docs single-source checks passed. Document-health was rerun after the record entered the Git index so it validated the tracked spec graph rather than reporting an untracked-record false negative.
