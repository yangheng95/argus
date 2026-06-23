# Side Activity Toolbar ARIA Semantics

Date: 2026-06-20

ARIA means Accessible Rich Internet Applications. GUI means Graphical User
Interface. UI means User Interface.

## Problem

`SideActivityToolbar` rendered every active item with `aria-pressed`. The right
activity rail opens and keeps center workbench panels, so pressed-button
semantics are still appropriate there. The left activity rail is different:
Tasks, Mission, Assistant, Memory, Skill, and MCP are mutually exclusive
navigation destinations. Exposing the active left item as pressed implies a
toggle that can be turned off, while `selectLeftActivity()` only changes the
current destination.

## Recall

| Source                                             | Existing decision                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `2026-06-05-vscode-style-activity-toolbars.md`     | Left and right rails share `SideActivityToolbar`; missing ARIA semantics should be fixed in that single primitive. |
| `2026-06-18-file-explorer-row-button-semantics.md` | Plain command/navigation buttons use `aria-current`, not `aria-pressed`.                                           |
| `2026-06-18-prompt-profile-list-current-aria.md`   | Current command rows expose `aria-current` and avoid selected/toggle semantics.                                    |
| `2026-06-18-task-dirbar-current-location-aria.md`  | Current location commands use `aria-current` and explicitly reject `aria-pressed`.                                 |
| `2026-06-09-browser-preview-ready-open.md`         | Right activity toolbar clicks remain a toggle/open entry point.                                                    |

## Impact Sweep

| Sweep                                                               | Result                                                                                              | Decision                                                                                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `rg -n "SideActivityToolbar                                         | selectLeftActivity                                                                                  | selectRightActivity                                                                                                          | side-activity-button | aria-pressed | aria-current" packages/overlay/src packages/overlay/test specs/new-arch` | `SideActivityToolbar` is the single production source for both rails. Right-side browser tests inspect `aria-pressed`; left-side tests do not guard ARIA. | Add explicit per-call semantics instead of deleting `aria-pressed` globally. |
| `TaskList.tsx`, `MissionList.tsx`, `CodingAssistantSessionList.tsx` | Current ledger rows use `aria-current="page"`.                                                      | Left activity rail should match current-page navigation semantics.                                                           |
| `side-activity-toolbar-browser.test.ts`                             | Existing real browser flow clicks left Mission/Tasks/Skill/MCP/Memory and right Workflow/Inspector. | Extend the existing flow with left `aria-current`, left no `aria-pressed`, right `aria-pressed`, and a left rail screenshot. |

## Fix

Add a required `activeSemantics` prop to `SideActivityToolbar`:

- `current-page` emits `aria-current="page"` on the active item and omits
  `aria-pressed`.
- `pressed-toggle` emits boolean `aria-pressed` and omits `aria-current`.

The visual source remains `data-active`; CSS is unchanged.

## Acceptance

- Static tests require the left toolbar call to use `current-page` and the
  right toolbar call to use `pressed-toggle`.
- Static tests require the component to map each mode to only its matching ARIA
  attribute.
- Browser coverage verifies an active left activity has `aria-current="page"`
  and no `aria-pressed`, while active right activities keep `aria-pressed`.
- Browser coverage saves a left activity rail screenshot proving the visual
  active indicator survives the semantic change.
