# Recent Directory Actions Button Primitive

Date: 2026-06-18

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model. ARIA means Accessible Rich Internet Applications. CWD
means Current Working Directory.

## Problem

Independent GUI review found the CWD recent-directory popup still renders two
operation controls as raw buttons:

- `recent-dir-edit-submit`, the icon-only submit control for the typed path
  form.
- `recent-dir-remove`, the destructive action for deleting a recent directory.

Both controls duplicate button shell, hover, focus, disabled, and geometry rules
in `conversation.css`. The submit control is icon-only and has no accessible
name. Its focus-visible style also clears the outline, bypassing the shared
`Button` primitive focus ring.

## Recall

| Source                                                   | Relevant constraint                                                                                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-task-dirbar-recent-trigger-semantics.md`     | Breadcrumb buttons, the recent trigger, editable path entry, detected projects, and recent rows are all owned by `TaskDirBar`; do not split the popup into a second source. |
| `2026-06-18-popup-disabled-effective-contrast.md`        | Recent-directory submit disabled contrast is part of the light popup matrix; disabled text must stay readable without whole-element opacity drift.                          |
| `2026-06-18-project-worktree-remove-button-primitive.md` | `TaskDirBar` destructive row actions should route through `Button` and style through `.oc-button[data-ui="..."]`.                                                           |
| `packages/overlay/src/components/ui/Button.tsx`          | The shared primitive owns `.oc-button`, `variant`, `size`, `tone`, disabled state, and focus-visible ring.                                                                  |

## Impact Sweep

| Sweep                                                                                                                | Result                                                                                                                                                                                   | Decision                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `rg -n -e "recent-dir-edit-submit" -e "recent-dir-remove" packages/overlay/src packages/overlay/test specs/new-arch` | Production owners are `TaskDirBar.tsx` and `conversation.css`; tests are `recent-dir-remove-hover-layout.test.ts`, `hover-action-geometry.test.ts`, and `popup-contrast-matrix.test.ts`. | Migrate both action controls in one slice so the recent-directory popup has one button source.                                 |
| `TaskDirBar.tsx` import review                                                                                       | `Button` is already imported and used for nearby worktree and init-git actions.                                                                                                          | Reuse the existing primitive import.                                                                                           |
| `conversation.css` review                                                                                            | `.recent-dir-edit-submit` and `.recent-dir-remove` define private button shell, hover, disabled, opacity, and focus rules.                                                               | Delete private shells and keep only scoped geometry/visibility variables on `.oc-button[data-ui="..."]`.                       |
| Browser tests review                                                                                                 | `task-dirbar-keyboard.test.ts` already opens the real recent-directory popup and saves a screenshot.                                                                                     | Extend that real browser flow to verify accessible names, disabled/enabled states, focus-visible, and remove sibling geometry. |

## Fix Plan

1. Replace the typed path submit raw button with
   `<Button variant="ghost" size="icon" tone="neutral">`, `data-chrome="icon-action"`,
   `data-ui="recent-dir-edit-submit"`, and a visible accessible name through
   `title` and `aria-label`.
2. Replace the recent directory remove raw button with
   `<Button variant="ghost" size="icon" tone="danger">`, `data-chrome="icon-action"`,
   and `data-ui="recent-dir-remove"`.
3. Retarget `conversation.css` to
   `.recent-dir-edit-form .oc-button[data-ui="recent-dir-edit-submit"]` and
   `.recent-dir-row .oc-button[data-ui="recent-dir-remove"]`.
4. Update static tests to reject `class="recent-dir-edit-submit"` and
   `class="recent-dir-remove"` in `TaskDirBar.tsx`, while keeping the row action
   slot behavior.
5. Update the popup contrast and hover geometry fixtures to use real
   `.oc-button[data-ui="..."]` selectors.
6. Extend the existing TaskDirBar browser test with real popup keyboard/focus
   checks and screenshot evidence.

## Acceptance

- `TaskDirBar.tsx` renders both recent-directory operation controls through
  `Button`.
- `TaskDirBar.tsx` no longer emits raw `recent-dir-edit-submit` or
  `recent-dir-remove` classes.
- `conversation.css` no longer owns private button shell or local
  `outline: none` rules for these two actions.
- Typed-path submit has a usable accessible name.
- Recent-directory remove remains hidden at rest, gets an explicit hover/focus
  action slot, and does not overlap row text.
- Browser evidence proves the popup controls keep readable disabled, hover, and
  focus-visible states on the real UI.
