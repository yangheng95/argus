# Environment Popover Goal And Dock Convergence

## Recall

### User requirement

- Move the floating Goals progress surface out of the message panel and into the Environment Information popover in the message-panel header.
- Open Environment Information on hover and let a click pin it open.
- Make every Right Dock feature a child feature of Environment Information.
- Render a related section only when its canonical source contains information.

### Acceptance criteria

1. `Conversation` no longer mounts a floating `TaskProgressBar`; `ProjectRuntimeStatusPanel` owns the single mount and renders it only when `boardStore.board.goals` is non-empty.
2. The existing Kobalte `Popover` is the only Environment Information overlay. Pointer hover opens it transiently, clicking the trigger toggles a pinned-open intent, and Escape/outside dismissal clears that intent.
3. The popover does not flicker while the pointer crosses between its trigger and portal content.
4. Requirements, Architect, Goals, Explorer, Diff, Browser, Screenshots, Terminal, Mailbox, and the selected File feature are projected from the canonical Right Dock catalog/owners; a child row is absent when its canonical content source is empty.
5. Changes, Worktrees, child tools, Sources, and Goals do not leave empty headings, placeholders, or spacing.
6. Focused source tests, Overlay TypeScript, i18n, isolated Node-launched browser interaction tests, a real rendered screenshot, visual review, and document-health tests pass.

### Hard constraints

- Desktop-only scope.
- Reuse the current Popover, Button, Icon, and navigation-row primitives.
- Do not retain the floating message-panel implementation, resize handles, floating frame state, or a second Goals progress mount.
- Do not introduce a second board, mailbox, terminal, screenshot, file, browser-target, or diff source.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay process.
- Preserve the existing staged worktree changes and do not create another worktree.

### Sources read

- `AGENTS.md` and the Browser control skill.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-15-codex-sidebar-search-environment-parity.md`.
- `specs/records/2026-07/2026-07-15-task-progress-empty-goal-body-repair.md`.
- Current `Conversation`, `TaskProgressBar`, `TaskDirBar`, `RightDock`, `TerminalPanel`, `MailboxPanel`, `main.tsx`, environment/card CSS, and focused unit/browser tests.

### Whole-repository search evidence

| Owner / call site                                                                                                         | Decision                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `Conversation.tsx` single `<TaskProgressBar overlayMount={mount} />`                                                      | Delete; the message overlay is no longer a Goals owner.                                                                                         |
| `TaskProgressBar.tsx` floating frame, ResizeObserver, pointer move/resize, and eight resize handles                       | Delete; reshape the same board-backed progress component as an embedded section.                                                                |
| `task-progress-floating-frame.ts` and its focused geometry/browser tests                                                  | Delete after all production call sites are removed; this geometry has no remaining owner.                                                       |
| `TaskDirBar.ProjectRuntimeStatusPanel`                                                                                    | Keep as the single Environment Information owner; add the one Goals progress mount and hover/pin intent.                                        |
| `RIGHT_DOCK_CATALOG`, `RIGHT_DOCK_ENVIRONMENT_TOOL_CATALOG`, and `FILE_PANEL_META`                                        | Export one canonical environment-child catalog that includes every Dock feature, including the programmatic File panel.                         |
| Requirements / Architect / Goals in `boardStore.board`                                                                    | Keep as the only task-scope availability source; Goals render through the embedded progress section rather than a duplicate shortcut row.       |
| Browser target, diff groups, file directory listing, and `cardTreeStore.screenshotItems`                                  | Keep as the existing resource availability sources.                                                                                             |
| `TerminalPanel` local `sessions` and `MailboxPanel` local `counts`                                                        | Lift only content-count callbacks to `main.tsx`; retain each panel as the sole data loader/owner and pass counts into the Environment launcher. |
| `selectedFileTarget` in `services/file-workbench.ts`                                                                      | Use as the canonical File feature availability source.                                                                                          |
| `requestSources()` and `visibleWorktrees()`                                                                               | Keep their canonical sources; wrap whole sections in non-empty `Show` conditions and remove the Sources empty placeholder.                      |
| `task-progress-collapse`, floating-frame, resize-scheduler, environment layout, Dock ownership, and Node browser fixtures | Replace obsolete floating assertions with single-owner, hover/pin, non-empty-section, and visual integration assertions.                        |

### Independent agent feedback

- The independent retirement review rejected the first tree because deleting the synthetic Goal-pill focus test also removed real keyboard-focus and Enter-activation coverage, and because the deleted floating-frame module was absent from the canonical retired-module guard.
- The review otherwise confirmed the single `TaskProgressBar` mount, canonical Right Dock catalog reuse, Mailbox/Terminal owner boundaries, non-empty section conditions, and removal of floating-frame imports.
- The reviewer rejected the first attempted correction because it used `page.focus()` and a capture listener that prevented the production Goal handler from running. That false coverage was removed.
- The current correction uses real Tab navigation to reach the production Goal pill, presses Enter without intercepting the event, and observes the click emitted by that production activation. It also adds `task-progress-floating-frame.ts` to the retired-module guard.
- A second review found that the first diagnostic assertion read nonexistent `appStore.logs` instead of canonical `appStore.logEntries`; that deterministic oracle bug was corrected before rerunning the headed case and was not attributed to the Windows helper.
- The next headed run exposed a task-selection race: the fixture helper waited only for the Environment trigger, so it could observe the previous task's VCS tone before the target board projection settled. The helper now waits for both `boardStore.selectedSource` and `board.task.id` to equal the requested task before any runtime assertion.
- After task synchronization, the headed case exposed a real hover-close defect: Kobalte's default open autofocus moved focus into the content, which promoted a hover-only opening into the former `focusOpen` identity and prevented dismissal. That third open source was removed; the Environment content now prevents autofocus for hover-only openings, while keyboard/click activation pins the panel explicitly.
- A subsequent headed run showed a short trigger-region DOM transition could schedule close while the pointer still physically hovered the trigger or portal content. The single close timer now checks the two owned DOM regions' actual `:hover` state before clearing hover intent.
- Final headed review exposed a separate click-ownership conflict: Kobalte's Trigger toggle competed with the explicit hover/pin intent whenever the pointer had already opened the popover. The canonical Popover primitive now exports Kobalte Anchor, while the Environment button owns the one explicit pin toggle; Escape restores trigger focus through Content close-autofocus without reintroducing focus as a third open source.
- The Goal keyboard assertion now observes the real Enter-generated click directly. It no longer uses the timing of an asynchronous diagnostic log as a proxy for whether the keyboard activation happened.
- The first otherwise-complete headed run invalidated Environment resource scopes before immediate fixture responses had settled, producing teardown-visible `ERR_ABORTED` events. The browser case now uses the existing inactivity-based observer to wait for every observed non-streaming fixture request before each close, task switch, or Dock navigation boundary; no request-failure allowlist was added.

## Root cause

The message surface and Environment Information independently project the same goal facts, while the Environment panel maintains a partial, explicitly filtered copy of the Right Dock feature catalog. This creates two competing contextual overlays and makes feature visibility inconsistent. The repair is to make the header popover the one contextual aggregation surface, while every child continues to read its existing canonical owner.

## Implementation plan

1. Convert `TaskProgressBar` from a floating/resizable message overlay into an embedded non-empty Goals section and mount it only in `ProjectRuntimeStatusPanel`.
2. Replace Environment Information's single open signal with transient hover/focus intent plus explicit pinned intent on the existing Popover.
3. Project every Dock feature from a canonical catalog and its real availability source; lift Terminal/Mailbox counts without duplicating their data.
4. Hide entire empty resource sections, update styles and tests, then run isolated browser interaction and screenshot review.
5. Run focused tests, typecheck, i18n, production build, document health, diff review, commit with the required `dsw-33987` prefix, and push the current main delivery branch to `legacy-remote` if the shared dirty worktree can be safely committed as one coherent delivery.

## Validation status

- Focused source tests: `159 pass / 0 fail` across eight affected files, including the Popover primitive contract and retired-module architecture guard.
- Exact Node-launched headed Environment browser case: `1 pass / 0 fail`. It covers hover-transient open, pointer-leave close, click pin, Escape dismissal and focus restoration, Goal keyboard activation, non-empty child projection, empty-section omission, and Right Dock coexistence/opening.
- Overlay TypeScript, i18n, Vite production build, and `git diff --check`: pass.
- Document health and historical-link validation: `83 pass / 0 fail`.
- Current screenshots were personally reviewed: `.scratch/task-dirbar-runtime-status-expanded-state.png`, `.scratch/task-dirbar-runtime-status-empty-resources.png`, and `.scratch/task-dirbar-runtime-status-right-dock-coexistence.png`. The first shows Goals, Worktree, and non-empty Dock children in the one Environment surface; the second contains no empty resource/source/change sections; the third shows the Environment popover coexisting with the open Dock without resizing the message workbench.
- Second review confirmed one `TaskProgressBar` production mount, no floating-frame production owner, a canonical Right Dock catalog projection, and no empty placeholder section. Acceptance criteria are met.
