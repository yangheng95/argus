# CWD Recent Trigger Button Primitive

Date: 2026-06-19

CWD means Current Working Directory. GUI means Graphical User Interface. CSS
means Cascading Style Sheets. DOM means Document Object Model.

## Recall

- `AGENTS.md` requires root-cause fixes, no fallback paths, no double source,
  mature UI primitives, and tests for code changes.
- `2026-06-18-task-dirbar-recent-trigger-semantics.md` separated the recent
  directory trigger from breadcrumb path buttons and kept `TaskDirBar` as the
  single CWD owner.
- `2026-06-18-recent-directory-actions-button-primitive.md` moved recent
  directory popup actions to the shared `Button` primitive.
- `2026-06-18-project-worktree-remove-button-primitive.md` and the current
  `ProjectWorktreeDropdown` already use `DropdownMenu.Trigger as={Button}` for
  TaskDirBar dropdown controls.

## Evidence

| Sweep                                                        | Result                                                                                | Decision                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `rg -n "task-dir-recent-trigger                              | cwd-recent-trigger                                                                    | DropdownMenu\\.Trigger\\s+as=\\{Button\\}" packages/overlay/src packages/overlay/test specs -g "_._"`    | The CWD recent trigger still used raw `class="task-dir-recent-trigger"` while the nearby worktree trigger already used `as={Button}`. | Migrate the recent trigger to the same primitive pattern. |
| `packages/overlay/src/styles/surfaces/conversation.css`      | `.task-dir-recent-trigger` owned raw button reset, hover, focus, and `outline: none`. | Delete the private button shell and retarget dimensions/state tint to `.oc-button[data-ui="cwd-recent-trigger"]`. |
| `packages/overlay/test/browser/task-dirbar-keyboard.test.ts` | The real browser flow already mounts, focuses, opens, and screenshots the CWD menu.   | Extend it to assert the trigger is an `.oc-button` with icon-action chrome.                                       |
| `flat-redesign-icon-coverage.test.ts`                        | The icon guard forbids JSX caret literals such as `>▾</`.                             | Replace the trigger's caret character with `Icon name="caret-down"`.                                              |

## Root Cause

The earlier semantics fix correctly split the menu trigger away from the
breadcrumb, but it left the trigger as a raw Kobalte button with local chrome.
That created a second button implementation beside `Button` and let a character
caret survive in the same control.

## Fix Plan

1. Render `DropdownMenu.Trigger as={Button}` with `variant="ghost"`,
   `size="icon"`, `tone="neutral"`, `data-chrome="icon-action"`, and
   `data-ui="cwd-recent-trigger"`.
2. Replace the literal caret with `Icon name="caret-down"`.
3. Remove `.task-dir-recent-trigger` selectors from `conversation.css`.
4. Retarget only geometry and open-state tint to
   `.task-dir-menu-actions .oc-button[data-ui="cwd-recent-trigger"]`.
5. Update static and browser tests to guard primitive ownership.

## Acceptance

- `TaskDirBar.tsx` contains `DropdownMenu.Trigger as={Button}` for the recent
  directory trigger.
- Production source and CSS no longer contain `.task-dir-recent-trigger`.
- The trigger remains separate from breadcrumb path buttons and keeps the same
  CWD shell anchor rect.
- Browser verification proves the focused trigger is an `.oc-button` and still
  opens the recent directory panel from the keyboard.
