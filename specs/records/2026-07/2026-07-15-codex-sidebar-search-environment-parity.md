# Codex Sidebar, Search, and Environment Parity

## Recall

### User requirement

- Align the search action after `OpenCorvus Workspace` with the title baseline.
- Make the project pin action the same compact size as its sibling project actions.
- Reduce the project, task, Mission, and Chat row height while increasing title readability.
- Replace the current sparse search overlay and inline-close behavior with the supplied Codex command-search structure.
- Replace the current environment-information card with the supplied Codex layout, including source attachments.

### Acceptance criteria

- The sidebar search action stays visually aligned to the workspace title and remains a search icon while the command palette owns open/close, Escape, backdrop, and focus restoration.
- The command palette labels recent Mission/Chat/task rows as tasks, preserves `Ctrl+1` through `Ctrl+9`, and exposes New task, Open folder, and Settings as the first suggested actions.
- Project, Mission, Chat, task, and nested task rows share a tighter vertical rhythm; labels increase from the current 12px scale without clipping timestamps or hover actions.
- Project pin/new/delete actions use one 18px button and 12px icon contract.
- The environment trigger has one mount beside `WorkspaceEditorLaunchers`; the Right Dock runtime mount is deleted.
- The environment panel uses the existing active directory, `boardStore.vcs`, worktree service, change groups, and `ctx:user-request` file parts. No substitute environment state is introduced.
- Focused source tests, Overlay TypeScript, i18n, Node-launched Playwright interaction tests, real rendered screenshots, historical-document checks, and `bun run build:overlay` pass.

### Hard constraints

- Desktop-only parity; no tablet/mobile scope.
- Reuse the existing Kobalte `Dialog`, `ComboboxControl`, `DropdownMenu`, `Button`, and `Icon` primitives.
- Remove the inline Work Ledger search path instead of retaining two search experiences.
- Do not restart or refresh a running OpenCorvus/Overlay process. Visual validation must use an isolated preview and Node-launched Playwright/browser control.
- Do not create a worktree, bypass hooks, or push anywhere other than the configured git-cc remote.

### Supplied visual evidence

- Current sidebar: `codex-clipboard-a5b50516-c596-43ea-b486-599b27a84ff1.png`.
- Current search overlay: `codex-clipboard-40459873-2ffa-4135-983c-2c609dceb57e.png`.
- Target search overlay: `codex-clipboard-e86fc7ad-167b-46be-ad78-30795752e7a6.png`.
- Current environment panel: `codex-clipboard-63d78830-75e9-4e35-8481-4450cedcc8ee.png`.
- Target environment panel: `codex-clipboard-a78c02bd-0e11-4d50-a4bf-ff8dd8574525.png`.

### Sources read

- `packages/overlay/src/components/{App,CommandPalette,WorkLedger,ProjectLedgerGroup,RightDock,TaskDirBar,FilePart}.tsx`
- `packages/overlay/src/styles/surfaces/{cmdk,sidebar,work-ledger,conversation,activity,workspace,titlebar}.css`
- `packages/overlay/src/services/{work-ledger,diff,workspace,worktree}.ts`
- `packages/overlay/src/store/{board,card-tree,dialog}.ts`
- Command-palette, Work Ledger, project-action, titlebar, task-directory, and environment-menu source/browser tests.
- `specs/records/2026-07/2026-07-14-overlay-startup-and-chrome-parity.md` and `specs/records/2026-07/2026-07-14-overlay-workspace-surface-continuity.md`.

### Whole-repository search evidence

| Owner / call site                                                                                | Decision                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkLedger` `search`, `searchOpen`, `toggleSearch`, `loadWorkLedger({ search })`, reorder guard | Delete the inline-search state and markup; the sidebar action dispatches the one command-palette open event. Ledger loading returns to its unfiltered canonical feed.                 |
| `TitlebarMenubar.openSearch`                                                                     | Keep its existing click-through to `work-ledger-search-toggle`; this now opens the same command palette.                                                                              |
| `CommandPalette`                                                                                 | Add the event listener, one chronological Mission/Chat/task list, and the three Codex suggested actions while retaining configuration/theme/locale/log commands under typed search.   |
| `ProjectLedgerGroup` + `sidebar.css` project action selectors                                    | Keep one primitive implementation and normalize pin/new/delete geometry together.                                                                                                     |
| `WorkLedgerRowView`, `ProjectLedgerGroup`, `work-ledger.css`, `sidebar.css`                      | Apply the shared compact row rhythm and readable label scale to every project/work/nested row owner.                                                                                  |
| `main.tsx` `ProjectRuntimeToolbarActions` import and `RightDock.runtimeActions` prop             | Delete both call sites; `App` owns the only environment mount after `WorkspaceEditorLaunchers`.                                                                                       |
| `RightDock` runtime prop and `right-dock-runtime-actions` CSS/tests                              | Delete the obsolete slot and its layout rules.                                                                                                                                        |
| `TaskDirBar.ProjectRuntimeStatusDropdown`                                                        | Reshape the existing Kobalte panel; retain worktree mutations and VCS data, and add change/source projections from canonical stores.                                                  |
| `currentChangeGroups` (`ChangesPanel`, diff services)                                            | Reuse as the only staged/unstaged totals source; no new diff fetch.                                                                                                                   |
| `cardTreeStore.cards["ctx:user-request"].parts` and `FilePart`                                   | Reuse persisted task file parts and authenticated media rendering for source thumbnails.                                                                                              |
| i18n keys in `en-US.json` and `zh-CN.json`                                                       | Replace English-only command labels and add environment/source/action labels in both locales.                                                                                         |
| focused source/browser tests                                                                     | Replace assertions for inline search and Right Dock runtime ownership with command-palette and chat-header environment ownership; add geometry, focus, Escape, and visual assertions. |

### Independent agent feedback

- None. The user did not request sub-agents; all affected surfaces share the same sidebar/header runtime and are being changed in one coordinated pass.

## Root cause

Search has two independent products: a sidebar-only filtered ledger and the global command palette. That split causes the sidebar icon to turn into a close action, gives the visible overlay a different information architecture, and prevents one consistent focus/close contract. Sidebar row families also use four unrelated height variables while their text remains fixed at 12px, producing excess whitespace and weak hierarchy. Finally, the environment trigger is owned by Right Dock and the content is organized as diagnostic cards; Codex treats it as a compact chat-header environment menu whose rows directly project directory, branch, changes, Git capability, and task sources.

## Implementation

1. Route the sidebar search action and titlebar Search command to the existing command palette; remove inline filtering and model recent ledger rows plus three suggested actions in that palette.
2. Normalize sidebar project/work row typography and action geometry through the existing shared CSS owners.
3. Move the one environment action to the chat header, reshape its Kobalte content around compact rows, and project current changes and task attachments from their canonical stores.
4. Update regressions, render isolated desktop screenshots, visually review all three delivery regions, and rebuild the Overlay artifact.

## Result

- The workspace search action now sits on the title baseline and opens the one Kobalte command palette. `Escape`, backdrop dismissal, command selection, and close all restore focus to that action; the deleted Work Ledger inline-search path can no longer turn the icon into a close button.
- The command palette now follows the supplied Codex information architecture: a `Tasks` group with chronological task/Mission/Chat rows and `Ctrl+1` through `Ctrl+9`, followed by `Suggested` actions for New task, Open folder, and Settings. Typed configuration commands remain available without creating a second visible command surface.
- Project, task, Mission, Chat, and nested rows now use the compact shared height/typography rhythm. Pin, new, and delete actions are all `18px` controls with `12px` icons; the browser geometry assertion verifies the three controls together.
- The old Right Dock runtime slot and mount were deleted. The only environment trigger now sits beside the chat-header editor launcher and opens a compact `520px` Kobalte menu projecting changes, local directory, branch, commit/push state, GitHub CLI state, worktrees, and `ctx:user-request` sources from existing stores.
- The popup contrast matrix exposed the titlebar shortcut metadata at `4.37:1`; the existing stronger text token now keeps those labels above the required `4.5:1` contrast without adding a parallel color source.

### Verification evidence

- Focused source regressions: `48 pass`, `0 fail`, including command-palette ownership, sidebar search unification, row layout, action geometry contracts, Right Dock ownership removal, environment mount ownership, and titlebar primitive/contrast contracts. Historical-document health added `20 pass`, `0 fail`.
- Focused architecture guard: project runtime controls `1 pass`, confirming one chat-header mount and no obsolete Right Dock runtime owner.
- `bun run typecheck`, `bun run check:i18n`, and `bun run build:vite`: passed; the Vite build reported only its existing chunk-size advisory.
- `bun run build:overlay` completed its OpenCorvus sidecar and Tauri/Cargo compilation after the outer command's four-minute capture timeout. The already-running child build generated `packages/overlay/src-tauri/target/release/opencorvus-overlay.exe`; because the timed-out parent did not execute its final copy, that exact artifact was copied to the canonical dist path after confirming no running process owned it. Final artifact: `169,436,160` bytes, SHA-256 `1C3D0F118D5B30EFD3CF82AA47953BAE345624B2BF7F40961AEE06B763F16DEF`.
- Node-launched browser checks passed for command-palette interaction/focus/Escape, environment-panel structure and geometry, expired-worktree cleanup preservation, and popup contrast.
- Browser screenshots were rendered and visually inspected at `.scratch/command-palette-first-highlight.png`, `.scratch/overlay-sidebar-project-actions.png`, `.scratch/task-dirbar-runtime-status-expanded-state.png`, and `.scratch/task-dirbar-runtime-status-panel-merged.png`.
- An isolated in-app browser preview verified direct search-button opening and `Escape` focus restoration to `work-ledger-search-toggle`; the isolated helper was stopped after inspection. No running OpenCorvus/Overlay process was restarted, refreshed, or terminated.
- Per the user's final instruction, the completed local commit is not pushed.

## Follow-up Recall — responsive environment menu

### User requirement

- Narrow the environment-information menu; the current `520px` surface is wider than its content requires.
- If the menu is open and the application switches to a small layout, temporarily collapse it; automatically restore it when the full layout returns.
- If the menu is open and the Right Dock expands, temporarily collapse it; automatically restore it when the Right Dock closes.
- Follow Codex semantics: layout suppression must preserve the user's open intent, while an explicit Escape, outside click, or trigger close must clear that intent.
- Preserve the prior instruction not to push.

### Acceptance criteria

- The panel uses one compact width contract and still fits the longest directory/branch/change rows without horizontal overflow.
- `ProjectRuntimeStatusDropdown` separates requested-open intent from effective Kobalte `open`; compact chat-workbench width and `rightToolbarOpen()` only suppress the effective value.
- The compact threshold is read from the existing `--ui-breakpoint-lg` design token and the actual `chat-workbench` container, not duplicated as a JavaScript literal or inferred from the Tauri window state.
- A Node-launched browser regression proves open → compact close → full restore and open → Right Dock close → Dock collapse restore, then visually inspects the final panel screenshot.

### Whole-repository search evidence

| Owner / call site                                                         | Decision                                                                                                                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskDirBar.ProjectRuntimeStatusDropdown` `open` / `setRuntimePanelOpen`  | Replace the single signal with requested-open plus effective-open projection; Kobalte remains the only dropdown primitive and dismissal owner. |
| `store/right-toolbar.ts` `rightToolbarOpen()`                             | Import the existing canonical accessor directly; do not observe duplicated DOM state or create another Dock signal.                            |
| `.chat-conversation-activity` / `container: chat-workbench / inline-size` | Observe this exact layout container because it owns the existing `900px` compact transition.                                                   |
| `--ui-breakpoint-lg`                                                      | Read the existing `900px` CSS design token at runtime; do not hard-code a parallel breakpoint.                                                 |
| `.project-runtime-status-panel`                                           | Reduce the single width/max-width declaration from `520px` to the compact Codex menu contract.                                                 |
| `task-dirbar-keyboard.test.ts`                                            | Extend the real browser path with viewport and Right Dock suppression/restore assertions plus new screenshot evidence.                         |

### Independent agent feedback

- None. The user did not request sub-agents; the change is one component with one existing browser fixture.

### Follow-up result

- The environment menu width is now `420px` instead of `520px`; the rendered fixture keeps directory, branch, changes, worktree actions, and source rows inside the panel without horizontal overflow.
- `openRequested` is the sole user-intent state. `panelOpen` projects that intent through the existing chat-workbench compact signal and `rightToolbarOpen()`, so both layout conditions temporarily suppress the Kobalte menu without erasing intent.
- The compact signal observes `.chat-conversation-activity` and reads `--ui-breakpoint-lg` from the existing design-token source. No duplicate Tauri window-size or Right Dock state was added.
- The DropdownMenu now uses Kobalte `modal={false}` so the Right Dock toggle remains interactive while the menu is open. Its `onInteractOutside` hook excludes that exact layout toggle, preventing Kobalte dismissal from racing ahead of the canonical Dock signal.
- PASS: focused source/architecture regressions `5 pass`, `0 fail`; Overlay TypeScript and i18n checks passed.
- PASS: the Node-launched browser regression proves open → compact suppression → full restore, open → Right Dock suppression → Dock-close restore, and explicit Escape → no later restore. The fixture also rebuilt Vite successfully.
- Visual review passed for `.scratch/task-dirbar-runtime-status-panel-merged.png`, `.scratch/task-dirbar-runtime-status-compact-suppressed.png`, and `.scratch/task-dirbar-runtime-status-right-dock-suppressed.png`.
- Per the user's standing instruction, this follow-up remains local and is not pushed.

## Follow-up Recall — environment trigger remains actionable

### User requirement

- Fix the environment-information button that remains visible but appears to do nothing when clicked.

### Acceptance criteria

- A direct pointer or keyboard open request displays the environment menu even when the chat workbench is already below `--ui-breakpoint-lg`.
- A direct open request displays the environment menu when the Right Dock is already open; the button must not expose a dead interactive state.
- If an already-open menu subsequently enters compact layout or the Right Dock subsequently opens, it is temporarily suppressed and restores when that newly introduced constraint clears.
- Explicit Escape, outside interaction, or trigger close still clears the user's open intent and prevents later restoration.
- The existing Kobalte `DropdownMenu` remains the interaction owner; no alternate popup, duplicated breakpoint, or second runtime-data source is introduced.

### Hard constraints and sources recalled

- Read `AGENTS.md`, this record's original Recall and responsive-menu follow-up, `2026-07-08-right-toolbar-runtime-status-panel-merge.md`, and the current `TaskDirBar` source/browser regression before editing.
- Do not refresh, restart, resize, or otherwise mutate the running OpenCorvus Overlay. Reproduce and validate through the isolated Node-launched browser fixture.
- Preserve unrelated dirty files under `packages/opencorvus`; this repair owns only this record, `TaskDirBar.tsx`, and the focused environment browser/source tests.
- Pre-change git-cc push was attempted after fetch. All local hooks passed, but the remote rejected the pre-existing unpushed `23f31cd0bb` commit because its subject lacks the required `dsw-*` task prefix. That non-tip history is not rewritten without user authorization.

### Whole-repository search evidence

| Owner / call site | Decision |
| --- | --- |
| `ProjectRuntimeStatusDropdown.openRequested` | Keep as the sole user open-intent source. |
| `compactLayout()` from `.chat-conversation-activity` and `rightToolbarOpen()` | Keep as the canonical layout constraints, but observe their transition instead of continuously vetoing every open request. |
| `panelSuppressed` / `panelOpen` / `setRuntimePanelOpen` | Replace level-triggered suppression with one shared transition-suppression abstraction instantiated for the two canonical constraints; a new explicit open clears both temporary projections. |
| Kobalte `DropdownMenu.Root.open` / `onOpenChange` | Keep as the only popup primitive and dismissal surface. |
| `task-dirbar-keyboard.test.ts` environment test | Extend the real browser path to click while initially compact and while the Right Dock is already open, then retain transition suppression/restoration and explicit-dismissal assertions. |
| `task-cwd-row-layout.test.ts` | Replace the obsolete source-shape assertion for continuous `panelSuppressed` gating with the transition-suppression contract. |
| `historical-docs-links.test.ts` scratch scanner | The final validation encountered a Vite dependency source map under `.scratch/vite-cache/**`; add this generated build-cache directory to the existing build-output exclusions and prove the scanner still catches unknown snapshot extensions outside excluded caches. |

### Root cause

The previous responsive follow-up translated an edge-triggered requirement—temporarily hide a menu that was already open when layout constraints appear—into the level-triggered expression `openRequested() && !compactLayout() && !rightToolbarOpen()`. A click made `openRequested` true, but the persistent constraint kept Kobalte's controlled `open` false, leaving an enabled button with no visible response. The browser test only opened at wide width before introducing each constraint, so it verified restoration while omitting direct-open behavior in an already-constrained layout.

### Implementation plan

1. Keep user intent and effective open projection, but record temporary suppression only when a layout constraint transitions from absent to present while the menu is requested open.
2. Let a new explicit Kobalte open request clear that temporary suppression; preserve explicit close semantics when suppression is not active.
3. Add direct-open browser regressions for initially compact layout and already-open Right Dock, then re-run transition restore and Escape non-restore coverage.
4. Repair the document-health scanner's generated Vite-cache boundary with a focused positive/negative regression rather than deleting another task's cache artifact.
5. Run focused source/browser tests, Overlay TypeScript and i18n checks, inspect both constrained screenshots, and perform a final diff review.

### Result

- `openRequested` remains the sole user-intent source. `createLayoutTransitionSuppression` now observes the compact-layout and Right Dock accessors independently, so each newly introduced constraint can temporarily suppress the menu without continuously vetoing later explicit open requests.
- A Kobalte open request clears both temporary suppression projections before setting intent. Kobalte close requests still clear intent unless the close was the controlled consequence of an active temporary suppression.
- The browser regression now starts at the `1120px` minimum viewport and proves direct pointer opening there, keyboard reopening after compact transition suppression, and direct pointer opening while the Right Dock is already open. It then rechecks compact/Dock transition suppression, restoration, Escape dismissal, and non-restoration.
- PASS: `bun test packages/overlay/test/task-cwd-row-layout.test.ts --timeout 90000` — `7 pass`, `0 fail`.
- PASS: focused Node-launched browser test — `1 pass`, `0 fail`; its isolated fixture rebuilt Vite successfully.
- PASS: focused project-runtime architecture guard — `1 pass`, `0 fail`; Overlay TypeScript and i18n checks passed.
- The historical-document scanner now excludes `.scratch/vite-cache/**` through its existing generated-directory boundary and has a focused regression proving Vite dependency source maps are ignored while unknown snapshot extensions remain scanned.
- PASS: historical-document health — `21 pass`, `0 fail`; `git diff --check` passed.
- Visual review passed for `.scratch/task-dirbar-runtime-status-compact-direct-open.png` and `.scratch/task-dirbar-runtime-status-right-dock-direct-open.png`: the canonical menu is visible and contained in both previously dead interaction states.
- The running OpenCorvus Overlay process was only inspected read-only; it was not refreshed, restarted, resized, or terminated.
- Delivery push remains blocked by the pre-existing unpushed nonconforming commit subject recorded above; no existing commit history was rewritten.

## Follow-up Recall — persistent environment layout panel

### User requirement

- `workbench` means the middle conversation workbench, not the Right Dock.
- When the environment surface opens, it must occupy layout width so the middle workbench contracts instead of being covered by a floating menu.
- Clicking elsewhere and pressing Escape must not close the environment surface. Only another click on the environment trigger explicitly closes it.
- Preserve the previous behavior: compact layouts and an expanded Right Dock temporarily suppress the environment surface, then restore it when that constraint disappears.
- Preserve the standing instruction not to push.

### Acceptance criteria

- The environment surface is a persistent region in `workspaceMain`, with one `420px` width contract; it is no longer a dismissable Kobalte dropdown.
- The trigger remains an existing `Button` primitive with `aria-controls` and `aria-expanded`; worktree actions also use the shared `Button` primitive.
- Effective visibility remains `openRequested && !compactLayout && !rightToolbarOpen()`.
- Compact measurement includes the width reserved by the environment surface, preventing the surface from classifying its own contracted workbench as a small layout and oscillating closed/open.
- A Node-launched browser regression proves workbench contraction, outside-click persistence, Escape persistence, trigger-only close, compact suppression/restore, and Right Dock suppression/restore.

### Whole-repository search evidence

| Owner / call site                                               | Decision                                                                                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `App.workspaceMain` / `.conversation-workspace` / `.right-dock` | Add one environment host as a flex sibling between the middle workbench and Right Dock; its canonical open projection consumes the panel width.                                             |
| `TaskDirBar.ProjectRuntimeStatusDropdown`                       | Retain the existing data/worktree owner but replace dismissable `DropdownMenu.Root/Content/Item` semantics with a trigger button, a portalled persistent region, and shared action buttons. |
| `openRequested`, `compactLayout`, `rightToolbarOpen()`          | Preserve requested-open intent and both prior temporary suppression inputs.                                                                                                                 |
| `.chat-conversation-activity` `ResizeObserver`                  | Keep the existing real workbench measurement and add the currently reserved environment-host width before comparing with `--ui-breakpoint-lg`.                                              |
| `task-cwd-row-layout.test.ts`                                   | Replace dropdown-dismissal source assertions with persistent-host, trigger-only, and preserved-projection assertions.                                                                       |
| `task-dirbar-keyboard.test.ts`                                  | Extend the real browser path with geometry and non-dismissal assertions while retaining compact and Right Dock restoration coverage.                                                        |

### Independent agent feedback

- None. The user did not request sub-agents; the affected behavior remains one component and its canonical workspace layout.

### Follow-up result

- The environment information surface is now a persistent `workspaceMain` flex column. Opening it reserves the existing compact `420px` contract and contracts the middle conversation workbench by the same amount instead of covering it.
- The dismissable Kobalte dropdown path was removed. The shared `Button` trigger now owns the only explicit close action and exposes `aria-controls` / `aria-expanded`; clicks in the conversation and Escape leave the region open.
- The previous `openRequested` projection remains intact. Compact layout and `rightToolbarOpen()` still suppress only effective visibility, so restoring full width or closing Right Dock automatically restores the environment region.
- Compact measurement now adds back the currently reserved host width before comparing against `--ui-breakpoint-lg`. This prevents the panel's own workbench contraction from causing a close/open oscillation.
- PASS: persistent-panel source regression `7 pass`, relevant architecture guard `1 pass`, complete Node-launched environment/worktree browser file `15 pass`, historical-document health `20 pass`, Overlay i18n, repository TypeScript, Prettier, and `git diff --check`.
- Visual review passed for `.scratch/task-dirbar-runtime-status-persistent-layout.png` and `.scratch/task-dirbar-runtime-status-panel-merged.png`; the panel occupies the right layout column and the conversation remains unobscured.
- The broad pre-existing Overlay architecture suite still reports unrelated baseline failures in retired shell IDs, duplicate selector budgets, and inspector/theme ownership. None of those failing owners or assertions are changed by this follow-up; the project-runtime ownership guard passes independently.
- Per the user's standing instruction, this follow-up remains local and is not pushed.

## Follow-up Recall — environment popover and Right Dock coexistence

### User requirement

- Repair the intermittent layout shown in `codex-clipboard-e6783319-74ed-4f8a-872e-a7b54d2adab1.png`, where opening environment information reserves a full-height fixed column and leaves a large blank region below the short information surface.
- When the Right Dock is already open, clicking the environment-information action must still open the environment popover.
- The current request supersedes the earlier persistent-column and Right-Dock-suppression requirements in this record.

### Acceptance criteria

- Environment information is a Kobalte Popover anchored to the existing chat-header trigger; it does not participate in `workspaceMain` flex sizing and does not contract the conversation.
- The popover uses the existing `420px` desktop width as a maximum, fits the viewport, and retains the canonical VCS (Version Control System), worktree, changes, and task-source projections.
- The Right Dock and environment popover can be visible at the same time. Neither `rightToolbarOpen()` nor duplicated Dock DOM state controls popover visibility.
- Kobalte owns trigger, outside-click, Escape, placement, focus, and dismissal behavior; no hand-written overlay interaction is introduced.
- Source regressions, the real Node-launched browser fixture, screenshots of the standalone and Right-Dock-coexistence states, typecheck, i18n, document health, and a second diff review pass succeed.

### Hard constraints

- Desktop-only repair; no tablet/mobile scope.
- Do not restart, refresh, or close the user's running OpenCorvus/Overlay process. Use an isolated browser fixture.
- Do not create a worktree or retain the fixed-column implementation as a compatibility path.
- New commit subjects use the required `dsw-33987` prefix and push to the configured git-cc remote.

### Sources read

- `packages/overlay/src/components/{App,TaskDirBar,ChatHeaderRightToolbarToggle,RightDock}.tsx`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/styles/surfaces/{conversation,workspace}.css`
- `packages/overlay/test/{task-cwd-row-layout,app-shell,composer-file-loader-right-toolbar}.test.ts`
- `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`
- `specs/current/architecture/{07-panel,07-panel-reactivity}.md`
- This record's original environment parity work and both prior follow-ups.

### Whole-repository search evidence

| Owner / call site                                                                                                                           | Decision                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskDirBar.ProjectRuntimeStatusPanel` `openRequested`, `compactLayout`, `panelSuppressed`, `panelOpen`, `panelMount`, and `ResizeObserver` | Replace the fixed-layout visibility projection with the existing Kobalte Popover `open` contract. Remove Right Dock suppression and the layout-measurement path completely. |
| `TaskDirBar` `rightToolbarOpen` import                                                                                                      | Delete; the environment surface no longer derives visibility from Right Dock state.                                                                                         |
| `App.tsx` `#projectRuntimeStatusHost`                                                                                                       | Delete the fixed flex sibling; the Kobalte portal is the single overlay mount.                                                                                              |
| `workspace.css` `.project-runtime-status-host` rules                                                                                        | Delete both closed/open layout rules so no invisible or reserved column remains.                                                                                            |
| `conversation.css` `.project-runtime-status-panel`                                                                                          | Keep the one surface style, constrain it with a viewport-safe width, and let Kobalte own positioning.                                                                       |
| `main.tsx` `rightToolbarOpen()` effects and Browser Preview activity                                                                        | Keep; these are canonical Right Dock and Browser Preview owners, not environment visibility owners.                                                                         |
| `task-cwd-row-layout.test.ts`                                                                                                               | Replace persistent-host/suppression assertions with Kobalte Popover, no fixed host, and no `rightToolbarOpen` dependency assertions.                                        |
| `task-dirbar-keyboard.test.ts`                                                                                                              | Replace workbench-contraction and suppression/restore checks with no-layout-shift, outside/Escape dismissal, and simultaneous Right Dock + environment visibility checks.   |
| Historical record references to `projectRuntimeStatusHost`, `panelSuppressed`, and prior suppression                                        | Preserve as history and explicitly supersede them here; do not rewrite past evidence as current architecture.                                                               |

### Independent agent feedback

- None. The user did not request sub-agents; the repair has one component owner and one browser fixture.

### Root cause

The environment surface was recently changed from a floating Kobalte menu into a `420px` flex sibling of the conversation. Its short card content occupied only the top of that full-height column, which created the reported blank layout region and narrowed the conversation. The same implementation projected effective visibility through `rightToolbarOpen()`, making the second requested interaction impossible by design. Both symptoms therefore come from the fixed-column/suppression model, not from an isolated CSS race.

### Implementation plan

1. Restore the environment surface to the existing Kobalte Popover primitive at its chat-header trigger and delete the fixed workspace host and measurement code.
2. Keep the existing data and mutation owner intact while making the popover viewport-safe and independent of Right Dock state.
3. Rewrite regressions around user-observable behavior, run an isolated real browser fixture, inspect standalone/coexistence screenshots, then complete source checks and second review.

### Result

- `ProjectRuntimeStatusPanel` now uses the existing Kobalte Popover trigger, portal, placement, viewport fitting, outside-click dismissal, Escape dismissal, and focus restoration. The fixed `#projectRuntimeStatusHost`, its workspace flex rules, compact measurement, and `rightToolbarOpen()` suppression were deleted rather than retained as a second path.
- The popover remains open behind the existing application confirmation dialog by reading the canonical `dialogStore.app.open` projection. This preserves worktree cleanup/delete context without a DOM-derived dialog state or a second dialog implementation.
- The real browser fixture proves that opening the environment surface changes conversation width by at most one rendered pixel, outside click and Escape dismiss it, Escape restores trigger focus, and the Right Dock plus environment popover remain visible simultaneously without another conversation-width change.
- Visual review passed for `.scratch/task-dirbar-runtime-status-expanded-state.png`, `.scratch/task-dirbar-runtime-status-panel-merged.png`, and `.scratch/task-dirbar-runtime-status-right-dock-coexistence.png`.
- PASS: the full Node-launched `task-dirbar-keyboard.test.ts` browser file (`15 pass`, `0 fail`), focused source regression (`7 pass`, `0 fail`), Overlay TypeScript, i18n, Vite production build, formatting, and changed-file diff checks.
- The broad architecture and historical-document suites were also run. Their environment-control assertions pass, while unrelated concurrently edited files still report `settings.css` duplicate-selector debt and legacy documentation paths in `expert-squad/payload.ts`; neither file is part of this repair and neither failure is represented as passing evidence here.
