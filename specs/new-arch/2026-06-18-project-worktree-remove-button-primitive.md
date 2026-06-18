# Project Worktree Remove Button Primitive

Date: 2026-06-18

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model. ARIA means Accessible Rich Internet Applications.

## Problem

Independent GUI review found `ProjectWorktreeDropdown` already renders its
dropdown trigger through the shared `Button` primitive, but each worktree row
still renders the remove/cleanup action as a raw `<button>` with
`class="project-worktree-remove"`.

That local class duplicates the button shell, dimensions, hover, disabled, and
focus-visible styling in `conversation.css`. The focus-visible rule also sets
`outline: none`, bypassing the canonical `Button` focus ring. Because the
control is an ordinary destructive operation button, it belongs to
`components/ui/Button.tsx` and `styles/primitives/button.css`.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-18-workspace-split-launcher-button-primitive.md` | Kobalte menu triggers and visible operation controls should route through `Button`, preserving `data-ui` selectors for tests. |
| `2026-06-18-chat-composer-button-primitive-owner.md` | Raw operation buttons with local chrome create a second button system and must migrate to `Button`. |
| `2026-06-18-popup-disabled-effective-contrast.md` | Worktree popup disabled states are part of the light-popup contrast matrix and must stay readable without whole-surface opacity drift. |
| `packages/overlay/src/components/ui/Button.tsx` | `Button` owns `.oc-button`, `variant`, `size`, and `tone`. |
| `packages/overlay/src/styles/primitives/button.css` | Focus ring, hover, disabled, danger tone, and icon-action chrome are single-sourced here. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "project-worktree-remove|project-worktree-dropdown" packages/overlay/src packages/overlay/test specs/new-arch` | Production owner is `TaskDirBar.tsx`; CSS owner is `conversation.css`; tests are `task-cwd-row-layout.test.ts` and `popup-contrast-matrix.test.ts`. | Retire `class="project-worktree-remove"` and retarget tests to `data-ui="project-worktree-remove"`. |
| `TaskDirBar.tsx` import review | The component already imports `Button` for `project-worktree-dropdown`. | Reuse the existing import; do not add a second primitive. |
| `conversation.css` review | `.project-worktree-remove` duplicates `appearance`, dimensions, alignment, border, background, color, cursor, hover, focus, expired, and disabled chrome. | Delete the private button shell and keep only scoped `--oc-button-*` variables where row-specific sizing/tone is needed. |
| `popup-contrast-matrix.test.ts` review | The fixture samples disabled and expired worktree controls using raw `.project-worktree-remove` buttons. | Update the fixture to `.oc-button` with `data-chrome="icon-action"` and add primitive/focus/hover assertions. |

## Fix Plan

1. Replace the raw remove/cleanup `<button>` in `TaskDirBar.tsx` with
   `<Button variant="ghost" size="icon" tone="danger">`.
2. Add `data-chrome="icon-action"` and `data-ui="project-worktree-remove"`
   while preserving `title`, `aria-label`, `disabled`, `onClick`, and the close
   icon.
3. Replace `.project-worktree-remove*` CSS with scoped
   `.project-worktree-row .oc-button[data-ui="project-worktree-remove"]`
   variable overrides only.
4. Update static tests so `TaskDirBar` no longer contains
   `class="project-worktree-remove"` and the worktree action opts into the
   shared icon-action chrome.
5. Update the popup contrast browser fixture to use the shared primitive and
   assert removable, disabled, expired, hover, focus-visible, and screenshot
   evidence.

## Acceptance

- Worktree remove/cleanup actions render as `.oc-button`.
- `TaskDirBar.tsx` no longer emits `class="project-worktree-remove"`.
- `conversation.css` no longer owns a private worktree remove button shell or
  local `outline: none`.
- Expired cleanup, removable delete, and disabled states remain visible on the
  light popup surface.
- Browser evidence includes the worktree panel screenshot after hover/focus
  checks.
