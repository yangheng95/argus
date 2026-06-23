# Retire Titlebar Tools Menu Source

Date: 2026-06-18

## Problem

`2026-06-18-titlebar-brand-guide-popover-primitive.md` records the current
titlebar menu set as `Workspace, Provider, Run, View, Settings, Help` and says
`Tools` is retired. Current source still rendered `Tools` as a real top-level
Kobalte menu with `channel`, `permissions`, and `prompt` entries.

That was not just stale copy: those entries are already surfaced from
`CONFIG_SECTIONS` through the Settings menu, so keeping `Tools` created a second
settings entrypoint and locked the old behavior into browser tests.

## Recall

| Source                                                 | Existing decision                                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-titlebar-brand-guide-popover-primitive.md` | Top-level menus are exactly Workspace, Provider, Run, View, Settings, Help; Tools is retired.                              |
| `2026-06-18-retire-titlebar-nav-residue.md`            | Kobalte `TitlebarMenubar.tsx` is the live titlebar navigation source; retired titlebar selector families must stay absent. |
| `packages/overlay/src/store/dialog.ts`                 | `CONFIG_SECTIONS` is the single source for config sections and is consumed by `TitlebarMenubar`.                           |

The referenced historical file
`2026-06-17-titlebar-menu-order-tools-removal.md` is not present on the current
branch, so this record preserves the current repair rationale and acceptance
contract.

## Impact Sweep

| Sweep                                  | Result                                                                                           | Decision                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | -------- | ---------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `rg -n 'titlebar\\.menu\\.tools        | menu\\.id === "tools"                                                                            | type MenuID                                                                       | MENU_IDS | MENU_ACCESS_KEYS | id: "tools"' packages/overlay/src packages/overlay/test -S` | `Tools` existed in `MenuID`, `MENU_IDS`, access keys, menu definitions, render branch, i18n, and browser/static tests. | Delete the top-level source path and convert tests to absence guards. |
| `packages/overlay/src/store/dialog.ts` | `CONFIG_SECTIONS` already includes `permissions`, `prompt`, and `channel`; Settings consumes it. | Keep those sections in Settings only.                                             |
| Browser titlebar test                  | It required `tools` trigger and opened `titlebar-menu-tools`.                                    | Assert the exact six trigger IDs and remove `tools` from the panel geometry loop. |

## Fix

- Remove `tools` from `MenuID`, `MENU_IDS`, `MENU_ACCESS_KEYS`, and `menus()`.
- Delete the `menu.id === "tools"` render branch.
- Delete `titlebar.menu.tools` from both locale files.
- Consume unknown Alt+single-key combinations in the titlebar access-key handler
  so retired keys such as Alt+T cannot fall through to the focused menu trigger.
- Update browser coverage to require the exact six current top-level menus and
  explicitly reject `tools`.
- Add a static source guard that rejects the retired Tools top-level source.

## Acceptance

- The live titlebar renders only Workspace, Provider, Run, Settings, View, Help.
- `channel`, `permissions`, and `prompt` remain reachable through Settings via
  `CONFIG_SECTIONS`; there is no parallel top-level Tools entrypoint.
- Alt access-key behavior still works for the remaining menus, and Alt+T no
  longer maps to a titlebar menu.
- Static tests, browser geometry screenshots, typecheck, docs check, and second
  review pass succeed before commit and push.
