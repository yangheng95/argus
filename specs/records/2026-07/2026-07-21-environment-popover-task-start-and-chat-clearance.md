# Environment Popover Task-Start And Chat Clearance

## Recall

### User requirement

The supplied desktop screenshot shows the `Environment information` popover
covering the right side of the active conversation. The requested behavior is:

1. open the Environment popover automatically when the selected Task starts;
2. keep it open until the operator clicks its toolbar button or opens the Right
   Dock; and
3. reserve conversation space for the open popover so message content is not
   occluded.

### Acceptance criteria

- A selected Task with canonical `status: active` and a positive
  `task.time.started` opens the one existing Environment popover once for that
  exact runtime identity.
- Pointer leave, outside pointer/focus interaction, and Escape do not dismiss
  the popover. The Environment toolbar button closes it. Opening any Right Dock
  panel closes it.
- Closing the popover does not cause the same Task run to reopen. A later Task
  run with a different canonical runtime identity may auto-open once.
- While the popover exists, the chat content frame reserves tokenized
  inline-end clearance equal to the popover width, its placement gutter, and
  the header chrome trailing its anchor. The message pane and composer do not
  render underneath it.
- The Environment popover and Right Dock are mutually exclusive. The existing
  Environment contents, single `TaskProgressBar` mount, and task-scoped backend
  evidence remain unchanged.
- A Node-launched real browser fixture captures and reviews the open desktop
  state. No running OpenCorvus/Overlay process is restarted, refreshed, or
  reused.

### Hard constraints

- Keep the existing Kobalte Popover, Button, Icon, Right Dock catalog, board
  store, and task runtime identity helper. Do not add a second panel, hidden
  message, fallback, iframe, resize observer, or duplicate open-state source.
- Desktop-only scope. No mobile/tablet/responsive expansion is authorized.
- Preserve unrelated concurrent benchmark and Mirror Prism spec edits already
  present in the worktree.
- Every behavior change receives static and real-browser regression coverage;
  visual acceptance uses the real rendered page and screenshot.

### Material read before implementation

- `AGENTS.md`.
- `specs/current/architecture/07-panel.md` and
  `specs/current/architecture/07-panel-reactivity.md`.
- `specs/records/2026-07/2026-07-18-environment-popover-goal-and-dock-convergence.md`.
- `packages/overlay/src/components/TaskDirBar.tsx`, `App.tsx`,
  `ChatHeaderRightDockToggle.tsx`, and `ui/Popover.tsx`.
- `packages/overlay/src/store/board.ts`, `store/right-dock.ts`, and
  `services/task-runtime-activity.ts`.
- `packages/overlay/src/styles/tokens/design-language.css`,
  `styles/surfaces/conversation.css`, and `styles/surfaces/workspace.css`.
- `packages/overlay/test/task-cwd-row-layout.test.ts` and
  `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`.

### Whole-repository search and call-point disposition

The following searches were run before this plan was written:

```text
rg -n "ProjectRuntimeStatusPanel|project-runtime-status-panel|projectRuntimeStatusPanel" packages/overlay/src packages/overlay/test specs
rg -n "rightDockOpen|setRightDockVisible|toggleRightDockVisible|onOpenRightDockPanel" packages/overlay/src packages/overlay/test
rg -n "isTaskInterruptable|taskRuntimeActivityKey|time.started" packages/overlay/src packages/overlay/test
rg -n "workspace-main|conversation-workspace|chat-content-frame|chat-message-pane|right-dock" packages/overlay/src/styles packages/overlay/test
rg -n "Environment information|environment popover|TaskDirBar" specs/current specs/records/2026-07 packages/overlay
```

| Call point / owner | Current fact | Disposition |
| --- | --- | --- |
| `TaskDirBar.ProjectRuntimeStatusPanel` | Owns separate hover and pinned signals; Kobalte dismissal, hover leave, and Escape can close the panel. | Replace with one component open signal, exact Task-run one-shot presentation memory, explicit toolbar close, and Right Dock close. |
| `TaskDirBar` task-scope shortcut and `openChanges` actions | Open canonical Right Dock content and already close Environment. | Keep; these are explicit Right Dock-open paths. |
| `ChatHeaderRightDockToggle` / `store/right-dock.ts` | The shared `rightDockOpen` signal is the canonical Dock visibility source. | Read this signal in `TaskDirBar`; do not add a callback or shadow Dock state. |
| `store/board.ts` / `task-runtime-activity.ts` | Board Task status and `taskID:time.started` are canonical runtime facts. | Reuse `taskRuntimeActivityKey`; do not infer start from messages, Goals, labels, or local time. |
| `App.tsx` chat frame | The Environment Popover is portaled and currently has no layout footprint. | Keep markup; use the actual portaled panel's presence as the CSS selector input for chat clearance. |
| `design-language.css` / `conversation.css` | Panel width is a literal 300px-scaled value and the chat frame reserves no inline-end space. | Add one structural panel-width token and consume it for both panel width and chat clearance. |
| `workspace.css` | Right Dock already consumes flex layout width. | Keep; Environment closes before Dock coexistence, so no second reservation path is needed. |
| `task-cwd-row-layout.test.ts` | Guards the obsolete hover-transient/no-reservation contract. | Replace with the requested start-open, explicit-dismissal, shared-Dock-source, and tokenized-clearance contract. |
| `task-dirbar-keyboard.test.ts` | Real browser evidence currently proves hover-open, Escape close, and Environment/Dock coexistence. | Reverse those assertions: active Task auto-open; passive interactions retain; toolbar closes; Dock opens only after Environment closes; message pane clears the popover bounds; save the reviewed screenshot. |
| 2026-07-18 convergence record | Historical record correctly established one Environment owner but explicitly accepted hover-open and Dock coexistence without message resizing. | Preserve as history; this record and current architecture supersede only those interaction/layout clauses. |

No backend route, API contract, database model, translation key, or second
Environment mount participates in this change.

## Implementation plan

1. Update current panel architecture with the exact Task-run auto-open,
   explicit-dismissal, mutual-exclusion, and chat-clearance contract.
2. Refactor the existing `ProjectRuntimeStatusPanel` state and dismissal
   handlers around canonical board and Right Dock sources.
3. Introduce one structural width token and reserve chat inline-end space from
   the actual open Popover DOM, keeping the header trigger and Popover placement
   unchanged.
4. Replace obsolete static and browser expectations, run focused tests and
   Overlay typecheck/build/i18n, run document health, capture the desktop
   screenshot, inspect it, and perform a second diff/review pass.

## Verification ledger

- `bun test packages/overlay/test/task-cwd-row-layout.test.ts`: 7 passed,
  including the start-open, explicit-dismissal, Right Dock source, and
  tokenized-clearance contract.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test
  --test-concurrency=1 packages/overlay/test/browser/task-dirbar-keyboard.test.ts`:
  15 passed in the Node-launched real browser fixture. The focused archive
  failure case also passed independently after one earlier browser-close
  transport timeout.
- The browser fixture asserted that the auto-open panel's `aria-expanded` is
  true, the chat frame clearance exceeds the rendered panel width plus its
  gutter, and the message pane's right edge does not cross the panel's left
  edge. It also proved that outside click and Escape retain the panel, the
  toolbar button closes it, returning to the same run does not auto-open it a
  second time, and opening the Right Dock closes it and removes the clearance.
- Visual review of
  `.scratch/task-dirbar-runtime-status-expanded-state.png` confirmed the
  conversation empty state and composer render wholly to the panel's left.
  Visual review of
  `.scratch/task-dirbar-runtime-status-right-dock-mutual-exclusion.png`
  confirmed that the Environment panel is absent while the Right Dock owns the
  right-side lane. No visual correction remained after the clearance token was
  expanded to include the header chrome trailing the Environment anchor.
- `git diff --check`: passed.
- `historical-docs-links.test.ts` and `document-health.test.ts`: 82 passed
  against the committed record and updated indexes.
- `bun test packages/overlay/test/diff-change-groups.test.ts`: 4 passed. The
  shared per-file change summarizer now keeps Environment totals correct when
  transport-level group aggregates are zero.
- The final post-merge focused browser rerun rebuilt the complete Vite bundle
  and passed the Environment scenario. An earlier post-merge build observed a
  missing `summarizeChangeGroups` export: the direct trigger was a concurrent
  merge that committed the `TaskDirBar` consumer while leaving its canonical
  `diff.ts` producer in an unstaged workspace change. The producer and its
  per-file aggregate regression test were committed together; the subsequent
  production build and browser scenario passed without a compatibility path.

Second review re-read the component, style tokens, CSS selector, static test,
real-browser assertions, current architecture, and this record together. It
found one initial clearance error: reserving only the 300-pixel panel and
8-pixel gutter still left 48 pixels of overlap because the Popover anchor has
trailing header controls. The final structural token includes that canonical
header chrome, and the browser geometry plus screenshots prove the corrected
layout. The review found no hover owner, duplicate Dock state, fallback,
additional Environment mount, or running-process intervention.
