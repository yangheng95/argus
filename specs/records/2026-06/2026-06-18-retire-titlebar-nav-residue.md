# Retire Titlebar Nav Residue

Date: 2026-06-18

CSS means Cascading Style Sheets.

## Problem

The titlebar menu has already migrated to Kobalte Menubar and renders
`.titlebar-menubar*` selectors from `TitlebarMenubar.tsx`. The old
`.titlebar-nav` / `.titlebar-nav-group` layout selectors remained in
`titlebar.css` and architecture guards even though no production DOM creates
those classes.

Keeping both selector families makes the titlebar appear to have two navigation
sources and gives future changes a stale non-primitive contract to revive.

## Recall

| Source                                                | Existing decision                                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md` | Titlebar menubar root/menu/trigger/content/item/group semantics are owned by Kobalte Menubar.   |
| `2026-06-18-retire-titlebar-status-residue.md`        | Dead titlebar selector families should be removed while preserving live Kobalte menu selectors. |

## Impact Sweep

| Sweep                | Result             |
| -------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n "titlebar-nav | titlebar-nav-group | titlebar-menubar" packages/overlay/src packages/overlay/test specs/records/2026-06/2026-06-01-overlay-mature-ui-primitives-refactor.md` | `.titlebar-nav` and `.titlebar-nav-group` were CSS/test-only; live titlebar navigation is `.titlebar-menubar` in `TitlebarMenubar.tsx`. |

## Fix

- Delete `.titlebar-nav` and `.titlebar-nav-group` from `titlebar.css`.
- Change architecture guards from preserving those selectors to rejecting them.
- Keep `.titlebar-utility`, `.titlebar-actions`, `.titlebar-window-controls`,
  `.conn-badge`, `.titlebar-menubar*`, and brand guide styles untouched.

## Acceptance

- No production CSS preserves the retired titlebar nav selector family.
- Static tests reject retired nav selectors.
- Kobalte menubar tests and browser titlebar checks continue to pass.
