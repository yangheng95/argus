# Titlebar View Radio Focus Single Source

Date: 2026-06-18

UI means User Interface.
DOM means Document Object Model.
CSS means Cascading Style Sheets.

## Problem

The titlebar View menu already renders its theme picker with Kobalte Menubar
`RadioGroup` and `RadioItem`, but keyboard opening still called a local
`focusFirstMenuItem()` helper after setting `autoFocusMenu`.

That helper queried only `.titlebar-menubar-item:not([data-disabled])`, so it
skipped the theme radio items and moved focus to the later Language command.
After removing the helper, the raw controlled menubar `autoFocusMenu=true` path
still left focus on the top-level View trigger because Kobalte's Menubar
controlled-value effect opens the menu with a boolean focus strategy. The
product Alt+letter shortcut therefore needs a focused access-key adapter, but
that adapter must use Kobalte's generated menu roles and ARIA state instead of
titlebar CSS classes.

## Recall

| Source                                                | Existing decision                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md` | Titlebar Menubar root/menu/trigger/content/item/group and View theme radio semantics are owned by Kobalte Menubar.             |
| `2026-06-18-retire-titlebar-nav-residue.md`           | Old titlebar navigation selectors are retired; live titlebar navigation is the Kobalte `.titlebar-menubar*` surface.           |
| `2026-06-18-retire-titlebar-status-residue.md`        | Kobalte runtime selectors such as `.titlebar-theme-option[data-highlighted]` are live and must not be treated as dead residue. |

## Impact Sweep

| Sweep                         | Result                                  |
| ----------------------------- | --------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n "focusFirstMenuItem    | #titlebar-menu-.\*titlebar-menubar-item | autoFocusMenu                                                        | onAutoFocusMenuChange                                                                                                                      | focusTrigger | openFromKeyboard" packages/overlay/src packages/overlay/test specs/new-arch` | Before the fix, `focusFirstMenuItem` existed only in `TitlebarMenubar.tsx`; after the fix, it remains only in this record and a negative source guard. `focusTrigger` remains the Alt release trigger focus path; Kobalte `autoFocusMenu` is already wired on `Menubar.Root`. |
| `rg -n "titlebar-theme-option | titlebar-menu-view                      | Language" packages/overlay/src packages/overlay/test specs/new-arch` | The View menu theme radio items are live production DOM; the browser test was locking the wrong keyboard-open focus by expecting Language. |

## Fix

- Delete the local `focusFirstMenuItem()` helper and its class-specific
  `.titlebar-menubar-item` query.
- Keep `autoFocusMenu` and `onAutoFocusMenuChange` on `Menubar.Root` for
  primitive-owned menu open state.
- For the product Alt+letter shortcut, open the controlled menu and focus the
  current checked `menuitemradio` when one exists, otherwise the first
  non-disabled `menuitemradio` / `menuitem` exposed by Kobalte.
- Keep `focusTrigger()` because it only returns focus to the top-level trigger
  for the product Alt-key behavior.
- Update the browser test so Alt+V expects the checked View theme radio item to
  receive focus, not the later Language command.
- Add a source guard rejecting the retired class-specific focus query.

## Acceptance

- Opening View with Alt+V focuses a `.titlebar-theme-option` with
  `role="menuitemradio"`.
- The checked `vscode-dark` theme radio remains readable and focused in the
  real browser menu.
- There is no local `focusFirstMenuItem` or titlebar class-specific item query.
- Targeted primitive tests, real browser titlebar test, overlay typecheck, docs
  check, visual screenshot review, and a second diff review pass succeed before
  commit and push.
