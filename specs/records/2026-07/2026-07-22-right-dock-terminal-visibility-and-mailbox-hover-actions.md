# Right Dock Terminal Visibility and Mailbox Hover Actions

Status: complete

## Recall

| Item | Detail |
| --- | --- |
| User request | Hide the Terminal component from the right-side Tools surface. In the Mailbox list, stop showing the row selection and action buttons when the row is not hovered. |
| Acceptance criteria | Terminal is absent from the right Dock empty chooser, add menu, open-tab collection, Environment resource shortcuts, and mounted panel DOM. A resting Mailbox row hides its checkbox and Open Task/Delete actions after pointer-triggered focus remains on the row; pointer hover reveals them; keyboard `:focus-visible` still reveals the focused control and keeps it operable. Focused source tests, Overlay typecheck/build, isolated Node-launched browser checks, task-scoped screenshots, original-resolution visual review, second review, commit, and legacy remote push pass. |
| Hard constraints | Desktop-only scope. Keep the existing Button, Checkbox, Accordion, Tabs, and Dock primitives. Do not use CSS masking, a feature gate, a parallel visible-panel registry, responsive work, or a fallback route. Preserve system-terminal launch APIs and the retained embedded-terminal implementation; this task removes its right-Dock exposure and mount, not backend terminal capability. Do not restart, refresh, close, or reuse the user's running OpenCorvus/Overlay. Preserve unrelated dirty files and stage only this task. Commit subjects start with `dsw-33987`; push to `legacy-remote`. |
| Supplied evidence | `codex-clipboard-79e20ccf-f90c-4c00-bfb4-c2dd21814ee4.png` shows a Mailbox row outside pointer hover with both the left checkbox and right Open Task/Delete action cluster still visible. The original image was inspected. |
| Sources read | Root `AGENTS.md`; Browser control skill; `2026-07-22-mailbox-reading-and-compact-controls.md`; `2026-07-21-mailbox-global-project-grouping-and-action-geometry.md`; `2026-07-21-tools-context-spacing-consistency.md`; current `main.tsx`, `App.tsx`, `RightDock.tsx`, `TaskDirBar.tsx`, `MailboxPanel.tsx`, `mailbox.css`, terminal and Mailbox source tests, and the Node browser fixtures. |
| Whole-repository grep | `RightDock.tsx` is the only right-Dock catalog/meta/tab collection owner and lists `terminal`. `main.tsx` is the only embedded `TerminalPanel` importer/mounter and the only owner of `CenterWorkbenchPanel`, its order, view lookup, and terminal-session-count signal. `App.tsx` only forwards that count to `TaskDirBar.tsx`; `TaskDirBar.tsx` only uses it to project a Terminal Environment shortcut. `terminal-panel.test.ts`, `acceptance-panel-mount.test.ts`, `task-cwd-row-layout.test.ts`, `titlebar-toolbar-toggle-browser.test.ts`, and `terminal-reference-visual-browser.test.ts` cover those visibility paths. `mailbox.css` is the only row disclosure owner: its checkbox, avatar substitution, and action cluster use `:focus-within`; `mailbox-panel.test.ts` and `mailbox-left-sidebar-browser.test.ts` are the direct regression owners. No route, persistence schema, service contract, or second Mailbox renderer is involved. |
| Git baseline | After `git fetch legacy-remote`, `HEAD...legacy-remote/work-v0.0.15beta-yr-0722` is `0 0`. The task-owned files are clean. Unrelated Expert Squad/build/Cargo changes and their record are present in the shared worktree and remain untouched. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration boundary forbids unrequested delegation. |

## Causal chain

1. Terminal is visible because it is a first-class `RIGHT_DOCK_CATALOG` entry, a `CenterWorkbenchPanel`, an Environment resource shortcut derived from live terminal session count, and a force-mounted `TabPanel`. Hiding only one launcher would leave alternate exposure paths and violate the single-source rule.
2. Mailbox controls start hidden correctly, but row-level `:focus-within` promotes them to visible whenever any descendant retains focus. A pointer click on the Accordion trigger therefore leaves both control clusters visible after the pointer moves away.
3. `:focus-within` does not distinguish mouse focus from keyboard focus. The precise semantic is `:has(:focus-visible)`: resting pointer focus remains hidden, while keyboard traversal reveals the row controls before activation.
4. Existing tests assert initial rest and hover disclosure but do not move the pointer away after clicking the row; the reported focus-retention path therefore escaped coverage.

## Call-site disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/RightDock.tsx` | Remove `terminal` from the panel union and the single right-Dock catalog. The remaining catalog continues to own empty chooser, add menu, tab collection, metadata, and Environment tool identity. |
| `packages/overlay/src/main.tsx` | Remove the embedded-terminal import, center-panel identity/order/view entry, session-count signal, App forwarding, and force-mounted Terminal `TabPanel`. |
| `packages/overlay/src/components/App.tsx` | Remove the terminal-session-count prop and forwarding edge. |
| `packages/overlay/src/components/TaskDirBar.tsx` | Remove the terminal-session-count prop and Terminal resource projection so Environment cannot reopen a hidden panel. |
| Embedded terminal implementation and system-terminal APIs | Keep unchanged. They are outside the requested visible right-Dock surface and may be retired only with explicit deletion scope. |
| `packages/overlay/src/styles/surfaces/mailbox.css` | Replace row `:focus-within` disclosure for checkbox/avatar/actions with row `:has(:focus-visible)`. Keep the row background focus treatment, pointer hover, selection-active, selected-item, and directly focused action behavior. |
| Source regressions | Reverse the former right-Dock Terminal registration assertions and require complete absence from catalog, mount, App forwarding, and Environment resource projection. Assert Mailbox disclosure uses hover/visible keyboard focus and rejects `:focus-within` for controls. |
| Node browser regressions | Assert the add menu and mounted DOM contain no Terminal surface; capture the real add menu. Extend the Mailbox fixture to click a row, move the pointer away, assert controls return hidden, then tab to a row control and assert visible keyboard disclosure. Capture resting-after-click, hover, and keyboard-focus screenshots. |

## Verification plan

1. Add source/browser regressions that fail on the current Terminal registration and Mailbox pointer-focus disclosure.
2. Remove Terminal at all visible right-Dock projection edges and change Mailbox control disclosure to `:focus-visible` semantics.
3. Run focused source tests, Overlay typecheck and production build, then isolated Node browser fixtures.
4. Inspect task-scoped screenshots at original resolution and iterate until resting, hover, keyboard focus, and Terminal absence match the requested behavior.
5. Run required documentation health checks, re-grep all owners, review the exact diff and visual evidence a second time, commit only task-owned files, fetch/converge, and push the current branch to `legacy-remote`.

## Progress

- [x] Supplied screenshot, production owners, test owners, prior records, and Git baseline inspected.
- [x] Failing regressions added.
- [x] Production repair complete.
- [x] Focused verification and original-resolution visual acceptance complete.
- [x] Second review complete; commit and legacy remote push are evidenced by Git history rather than asserted before execution.

## Codex review feedback

The first browser pass rejected two fixture assumptions rather than product behavior: the Terminal-absence fixture omitted the existing empty `/file` response and targeted the Tabs root instead of the stable `#rightDock` HTMLElement for its screenshot. Both were corrected and the original test passed. The first Mailbox keyboard pass also tried to Tab into actions while the read acknowledgement correctly disabled them; the regression was revised to `Shift+Tab` into the same row's enabled Checkbox, which proves the intended `:focus-visible` disclosure without weakening pending-action semantics.

The broad second review then exposed two stale fixed-count assertions after Terminal removal, one existing duplicate `.mailbox-item__task` selector that exceeded the architecture budget, and one import-format-coupled Composer assertion already invalidated by `createResource`. The panel counts now require eight mounts, the Mailbox declarations were merged without raising the debt limit, and the Composer regression validates individual Solid primitives rather than one obsolete single-line import. The related titlebar keyboard fixture replaced a fixed 50-millisecond delay with the real `ArrowDown`/`End` menu path and a state-based wait.

The first legacy remote pre-push run then correctly rejected the two now-unused `right_dock.tool.terminal` locale keys. Both English and Chinese keys were removed, the Terminal projection regression now asserts their absence, and the real i18n checker passes; no hook was bypassed.

## Verification results

- `bun test packages/overlay/test/terminal-panel.test.ts packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/mailbox-panel.test.ts --timeout 30000`: 39 pass, 0 fail.
- `bun run --cwd packages/overlay typecheck`: pass.
- `bun run --cwd packages/overlay build`: pass; Vite transformed 2,644 modules.
- `bun test packages/overlay/test/overlay-architecture-guards.test.ts packages/overlay/test/right-dock-panel-ownership.test.ts packages/overlay/test/tabs-primitive.test.ts packages/overlay/test/mailbox-panel.test.ts --timeout 30000`: 151 pass, 0 fail.
- `node test/browser-runner.mjs test/browser/terminal-reference-visual-browser.test.ts`: 1 pass, Terminal absent from empty chooser, add menu, tab shell, mount, embedded terminal DOM, and Environment shortcut.
- `node test/browser-runner.mjs test/browser/mailbox-left-sidebar-browser.test.ts`: 1 pass, including pointer-focus rest, hover disclosure, keyboard focus-visible disclosure, selection, read, and delete paths.
- `node test/browser-runner.mjs test/browser/titlebar-toolbar-toggle-browser.test.ts`: 2 pass, including seven-item right-Dock catalog, Terminal absence, and stabilized keyboard menu traversal.
- Original-resolution visual review passed for `left-sidebar-mailbox-pointer-focus-rest.png`, `left-sidebar-mailbox-project-group-hover.png`, `left-sidebar-mailbox-keyboard-focus-actions.png`, `right-dock-terminal-hidden-empty-state.png`, and `right-dock-terminal-hidden-add-menu.png`. Resting pointer focus shows neither control cluster; hover and keyboard focus show both; Terminal appears in neither right-Dock view.
- Documentation health, final diff checks, and delivery commit/push are recorded by the final delivery step.
