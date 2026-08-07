# Environment Popover Right Dock Open Dismissal

Date: 2026-08-05
Status: Planned
Owner: Coding Assistant

## Glossary

- UI: User Interface, the visible application surface.
- DOM: Document Object Model, the browser-rendered element tree.

## Recall

### User requirement

When the desktop Overlay is fullscreen and the Environment Information HoverCard
is visible, opening the right-side component Panel must close that HoverCard.

### Acceptance criteria

- Opening the canonical Right Dock closes an already-visible Environment
  HoverCard and clears its pinned state.
- The dismissal reacts to the Right Dock's closed-to-open transition, regardless
  of whether the Dock was opened by its chat-header button or another canonical
  panel-opening call point.
- Closing the Right Dock does not change Environment visibility.
- While the Right Dock is already open, the operator may explicitly reopen the
  Environment HoverCard; the existing responsive coexistence layout remains
  available.
- Environment child-feature navigation, hidden-anchor teardown, hover preview,
  click pinning, automatic conversation presentation, placement, motion, and
  right-edge alignment remain unchanged.
- No second visibility state, callback bridge, event bus, timer, fallback, CSS
  workaround, or UI automation test is introduced.
- Overlay typecheck, build, localization, document health, isolated real desktop
  interaction, screenshots, and a second manual review complete before delivery.

### Hard constraints

- Preserve unrelated working-tree changes and do not create a worktree.
- Do not restart, close, refresh, or otherwise interfere with the operator's
  running OpenCorvus/Overlay process. Visual verification uses an isolated Vite
  process and Node-driven browser interaction.
- Do not add, modify, update, or run UI automation tests.
- Commit subjects use `dsw-33987`; delivery goes to `myhexin`.

### Material read before implementation

- `AGENTS.md` and `CLAUDE.md`.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-23-environment-popover-right-dock-responsive-coexistence.md`.
- `specs/records/2026-08/2026-08-04-environment-popover-anchor-motion-and-conversation-presentation.md`.
- `specs/records/2026-08/2026-08-04-environment-popover-right-edge-alignment.md`.
- `packages/overlay/src/components/TaskDirBar.tsx`, `App.tsx`,
  `ChatHeaderRightDockToggle.tsx`, and `RightDock.tsx`.
- `packages/overlay/src/store/right-dock.ts` and `packages/overlay/src/main.tsx`.

### Whole-repository search evidence

Searches covered `ProjectRuntimeStatusPanel`, `ProjectRuntimeToolbarActions`,
`panelOpen`, `panelPinned`, `openRuntimePanel`, `closeRuntimePanel`,
`openRuntimeShortcut`, `rightDockOpen`, `toggleRightDockVisible`, and every
`setRightDockVisible` call point.

| Owner / call point                                                                                   | Current fact                                                                                                  | Disposition                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `TaskDirBar.ProjectRuntimeStatusPanel`                                                               | Owns the only Environment open/pin state and every explicit close path.                                       | Observe the canonical Dock signal's closed-to-open edge and call the existing `closeRuntimePanel()`. |
| `TaskDirBar.openRuntimeShortcut`, Goal, Subagent, and add-menu actions                               | Explicit navigation from inside Environment already closes the HoverCard before opening Dock content.         | Keep unchanged.                                                                                      |
| `ChatHeaderRightDockToggle`                                                                          | The direct visible component-Panel control toggles the canonical Dock store and has no Environment ownership. | Keep unchanged; do not duplicate a close callback at the button.                                     |
| `main.openRightDockPanel`, `openRightDockAddMenu`, `openCenterWorkbenchPanel`, `openBlankBrowserTab` | Canonical programmatic Dock-opening paths converge on `setRightDockVisible(true)`.                            | Keep unchanged; the owner observes their shared result.                                              |
| `main.resetCenterWorkbenchToPrimaryPanel`, `RightDock.onCloseDock`                                   | Canonical Dock-closing paths write `false`.                                                                   | Keep unchanged; the falling edge does not dismiss Environment.                                       |
| `store/right-dock.ts`                                                                                | Owns the single `rightDockOpen` signal and its setter/toggler.                                                | Keep as the event fact; add no callback registry or second state.                                    |
| `App.tsx`                                                                                            | Mounts one Environment owner and one trailing Right Dock toggle.                                              | Keep component structure unchanged.                                                                  |
| Responsive coexistence CSS and Kobalte HoverCard                                                     | Allow Environment to be reopened while Dock remains open.                                                     | Keep unchanged by responding only to a new opening edge.                                             |
| UI test paths                                                                                        | UI automation is prohibited for this task.                                                                    | Do not modify or run them; use isolated real-page interaction and manual screenshots.                |

No backend route, database model, conversation protocol, Right Dock width,
panel catalog, localization key, CSS token, or component hierarchy changes.

### Independent feedback

Claude Code 2.1.147 was invoked read-only with `Read,Grep,Glob`, medium effort,
no session persistence, and a bounded budget. The local CLI is not authenticated
and returned `Not logged in · Please run /login` with `is_error: true`; it made no
file changes and supplied no review conclusion.

## Evidence-backed root cause

Environment and Right Dock intentionally have independent visibility owners so
they can coexist after explicit operator interaction. The Environment owner
already closes itself for navigation initiated inside the HoverCard, but the
chat-header component-Panel button and programmatic Dock entry points write only
the canonical `rightDockOpen` signal. Therefore an already-open Environment
surface survives the Dock's opening transition.

The missing behavior is not a layout or z-index defect. The Environment owner
must consume the one canonical Dock closed-to-open edge as an explicit dismissal
gesture. Treating the sustained `true` value as mutual exclusion would regress
the established ability to reopen Environment while Dock remains visible.

## Implementation plan

1. Read `rightDockOpen` in `ProjectRuntimeStatusPanel` and add one Solid reactive
   edge observer initialized from the current Dock value.
2. On `false` to `true`, call the existing `closeRuntimePanel()` so both open and
   pin state clear through the sole Environment owner. Ignore the initial value,
   falling edge, and sustained open value.
3. Update current panel architecture to distinguish opening-edge dismissal from
   subsequent responsive coexistence.
4. Run non-UI validation, launch an isolated real Overlay page at fullscreen
   desktop geometry, open Environment, activate the actual Right Dock control,
   capture and inspect the dismissed state, then reopen Environment while the
   Dock remains open and inspect coexistence.
5. Perform a second source/spec/diff and screenshot review, commit only this
   task's files, fetch/reconcile the delivery branch, and push to `myhexin`.

## Status

- [x] Component, store, architecture, history, and call-point diagnosis.
- [ ] Right Dock opening-edge dismissal implementation.
- [ ] Architecture and index convergence.
- [ ] Non-UI validation.
- [ ] Real-page interaction and screenshot review.
- [ ] Second review, commit, reconciliation, and push.

## Validation results

Pending implementation.
