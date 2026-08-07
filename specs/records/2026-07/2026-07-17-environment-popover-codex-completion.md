# Environment Popover Codex Completion

## Recall

### User request

- Use the supplied Codex environment-information popover as the reference for the current OpenCorvus popover.
- Repair the current surface because its buttons, Changes information, and related rows are not fully presented.
- Complete the Codex-backed behavior that OpenCorvus already has; leave Codex features without an OpenCorvus capability unchanged.

### Acceptance criteria

- The desktop popover follows the reference information architecture and density: Environment information, Changes, Local, branch, Commit or push, GitHub Command Line Interface (CLI) state, optional OpenCorvus runtime resources, and Sources remain in that order.
- The surface uses the reference's compact approximately `300px` logical width instead of the current `420px` logical width. At the user's display scale this reduces the rendered width from roughly `735px` to roughly `525px` without horizontal overflow.
- The Local row does not spend the compact row width on a redundant directory basename. The full active directory remains available through the row title, while the branch, caret, Changes totals, and source filenames remain visible.
- Changes is a real shared `Button` action. Activating it dispatches the existing `acceptance:focus-changes` navigation contract, closes the popover, and opens the canonical Files/Changes workbench instead of creating another diff surface.
- Changes totals continue to come only from `currentChangeGroups()`. This task does not mix live Git working-tree diffs into task acceptance changes and does not add a second changes source.
- The first three persisted `ctx:user-request` file parts render with their real `FilePart` thumbnails and complete ellipsized filenames; a fourth item exposes the existing View all row.
- Kobalte Popover remains the only positioning, focus, outside-click, and Escape owner. Existing Worktree mutations and task-scope shortcuts remain intact because they are OpenCorvus-only capabilities outside the supplied Codex reference.
- Focused source tests, Overlay TypeScript and internationalization checks, document health, a Node-launched browser test, a real desktop screenshot, and personal visual review pass.

### Hard constraints

- Desktop-only scope. Do not add tablet, mobile, or responsive deliverables.
- Reuse `Popover`, `Button`, `Icon`, `FilePart`, `currentChangeGroups`, and the existing `acceptance:focus-changes` event; do not hand-roll popup interaction or duplicate file-change navigation.
- Do not restart, refresh, resize, close, or otherwise interfere with the user's running OpenCorvus/Overlay. Validation uses an isolated fixture and browser page.
- Playwright must run through Node, not Bun.
- Preserve the current branch and current worktree; do not create another worktree.
- Commit subjects use the required `dsw-33987` prefix and delivery pushes only to the legacy remote.

### Supplied visual evidence

- Codex reference: `C:/Users/10132/AppData/Local/Temp/codex-clipboard-39023a03-9817-4279-9423-c2dcae82dd04.png`.
- Current OpenCorvus surface: `C:/Users/10132/AppData/Local/Temp/codex-clipboard-547a9046-3a5f-4376-a095-ca54b1906d33.png`.

### Sources read

- `AGENTS.md`.
- Browser control skill instructions.
- `specs/records/2026-07/2026-07-15-codex-sidebar-search-environment-parity.md`.
- `specs/records/2026-07/2026-07-14-overlay-startup-and-chrome-parity.md`.
- `specs/records/2026-07/2026-07-15-titlebar-worktree-expert-squad-layout.md`.
- `packages/overlay/src/components/{App,TaskDirBar,FilePart,FileChangesPanel,ChangesPanel,FileChangesView}.tsx`.
- `packages/overlay/src/components/ui/{Popover,Button}.tsx`.
- `packages/overlay/src/services/{diff,meta,workspace}.ts`.
- `packages/overlay/src/styles/{primitives/popover,surfaces/conversation}.css`.
- `packages/overlay/test/{task-cwd-row-layout,overlay-architecture-guards,focused-popup-surface}.test.ts`.
- `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`.

### Whole-repository search evidence

| Owner / call site | Decision |
| --- | --- |
| `App.tsx` `ProjectRuntimeToolbarActions` | Keep the one chat-header mount beside the editor launcher. |
| `TaskDirBar.ProjectRuntimeStatusPanel` | Keep the one Kobalte Popover/data owner; compact its markup and add the Changes action here. |
| `main.tsx`, `Board.tsx`, and `ChangesPanel.tsx` `acceptance:focus-changes` | Reuse this existing navigation contract. Do not add another callback, route, or window bridge. |
| `currentChangeGroups()` call sites in `TaskDirBar` and `ChangesPanel` | Preserve the task acceptance change source and totals semantics. Do not call `GET /vcs/diff` from the popover. |
| `cardTreeStore.cards["ctx:user-request"]` and `FilePart` | Preserve persisted request attachments and authenticated media rendering as the only Sources projection. |
| `conversation.css` `.project-runtime-*` | Replace the four-column `420px` geometry with the compact three-column reference geometry; retain one style owner. |
| `task-cwd-row-layout.test.ts` | Bind source ownership, compact width, non-redundant Local row, and shared Changes navigation. |
| `task-dirbar-keyboard.test.ts` | Add large Changes totals, four source attachments, exact geometry/no-overflow assertions, real Changes activation, and refreshed screenshot evidence. |
| `specs/README.md` and `specs/records/2026-07/README.md` | Index this record as the latest environment-popover repair. |

### Independent agent feedback

- None. The user did not request sub-agents, and current collaboration policy does not authorize spawning them for this task.

## Root cause

The current popover uses `width: 420px * --ui-scale`; at the user's display scale that becomes approximately `735px`, while the Codex reference is approximately `525px`. Its information grid also reserves four columns so the Local row can show both the `Local` label and the project directory basename. That redundant value forces the content contract to stay wide and leaves less predictable room for Changes totals, long branches, carets, and filenames. Finally, Changes is styled as an information row but is not interactive even though OpenCorvus already has one canonical Changes navigation event.

## Implementation plan

1. Convert only the Changes row to the shared `Button` primitive and dispatch the existing Changes focus event before closing the popover.
2. Remove the redundant Local basename projection, collapse information rows to a three-column grid, and reduce the panel/padding/row geometry to the supplied Codex proportions.
3. Extend focused source and real browser coverage with large totals and four persisted sources, including exact width, overflow, row-action, Dock-opening, filename, and screenshot assertions.
4. Run document, type, internationalization, focused unit, and Node-launched browser checks; inspect the rendered screenshot and correct any visual mismatch before acceptance.
5. Perform a second diff review, update this record with result evidence, commit with `dsw-33987`, and push the current branch to `legacy-remote`.

## Verification plan

```powershell
bun test packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/overlay-architecture-guards.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
$env:OPENCORVUS_OVERLAY_BROWSER_RUNNER_IDLE_MS='120000'
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts
git diff --check
```

## Result

- Replaced the static Changes row with the shared `Button` primitive. Activation reuses `acceptance:focus-changes`, closes the popover, opens the Right Dock, and selects its canonical Changes view.
- Reduced the popover from `420px` to `300px`, collapsed the information grid to three columns, removed the redundant Local basename while retaining the full directory as its title, and tightened row/source spacing without adding a second layout source.
- Preserved `currentChangeGroups()` as the only Changes projection and `ctx:user-request` `FilePart` values as the only Sources projection. Real-browser evidence covers `+375,786`, `-211,596`, three long visible filenames, `View all`, and zero horizontal overflow.
- Personal screenshot review passed at the desktop delivery surface. The resulting image is `.scratch/task-dirbar-runtime-status-panel-merged.png`; the matching full page is `.scratch/task-dirbar-runtime-status-expanded-state.png`.
- The first full composite browser-file run reached the new assertions and exposed two sidecar-fixture defects: it called an unsupported `waitForResponse` facade method, and directory switches treated their intentionally aborted Mailbox read as unexpected. The fixture now waits through its supported response event and recognizes that exact directory-switch abort. The complete 15-test file passes without suppressing any unrelated network or console failure.

## Verification evidence

```powershell
bun test packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/overlay-architecture-guards.test.ts --timeout 90000
# 134 passed

bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
git diff --check
# passed

bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 90000
# 21 passed

$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'
node --test --test-concurrency=1 --test-name-pattern="chat header environment panel matches" packages/overlay/test/browser/task-dirbar-keyboard.test.ts
# 1 passed; Vite production build and Node-launched real browser fixture completed

node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts
# 15 passed; the supported response-event and directory-switch Mailbox cancellation paths both completed cleanly
```
