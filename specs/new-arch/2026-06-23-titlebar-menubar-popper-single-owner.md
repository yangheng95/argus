# Titlebar Menubar Popper Single Owner

Date: 2026-06-23
Status: Verified

## Acronyms

- CSS: Cascading Style Sheets, the browser styling and layout language.
- GUI: Graphical User Interface, the visible overlay surface.
- UI: User Interface, visible controls and interaction surfaces.

## Task Definition

Remove the titlebar menu's handwritten anchor-position source and the
layout-reading pointer toggle. Kobalte Menubar remains the menu primitive and
Kobalte Popper remains the positioning owner; the controlled root value keeps a
small pointer toggle because this Kobalte version otherwise closes controlled
menu content before the trigger disclosure can mount.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback logic, no duplicate source, recall before edits, test every change, visually verify UI work, commit and push every round. |
| `2026-06-20-kobalte-trigger-open-state-single-source.md` | Kobalte trigger state attributes are the open-state source; local mirrors and parallel open sources must stay retired. |
| `2026-06-19-titlebar-menubar-trigger-button-primitive.md` | `Menubar.Trigger as={Button}` is the single visible trigger chrome path. |
| `2026-06-20-titlebar-run-checkbox-menubar-primitive.md` | Run-menu booleans use Kobalte `Menubar.CheckboxItem`; current dirty auto-confirm rename must not be overwritten. |
| Herschel read-only audit 2026-06-23 | `toggleMenuFromTrigger()` manually writes `setOpenMenu` on pointerdown while Kobalte also opens from the trigger; `setMenuAnchor()` duplicates Popper anchor measurement. |
| Current dirty diff | `TitlebarMenubar.tsx`, titlebar tests, i18n, and the checkbox spec already contain unrelated auto-confirm-proposed-tasks edits. Stage only this round's hunks. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Kobalte value change | `handleMenuValueChange()` calls `setMenuAnchor()`, `setAutoFocusMenu(true)`, and `setOpenMenu()`. | Keep controlled Kobalte value state and remove the anchor call. |
| Pointer trigger | `Menubar.Trigger onPointerDown` calls `toggleMenuFromTrigger()`, which prevents default, measures the trigger, writes `--titlebar-menu-anchor-left`, and sets `openMenu`. | Keep only the controlled value toggle required by Kobalte's controlled root; delete trigger measurement and CSS writes. |
| Keyboard Alt path | `openFromKeyboard()` calls `setMenuAnchor()` before opening and focusing. | Keep Alt access-key behavior, but remove manual anchor measurement. |
| CSS panel width | `titlebar.css` uses `var(--titlebar-menu-anchor-left)` to derive width. | Use preferred shell-capped widths; Kobalte `fitViewport` keeps final viewport fitting through Popper. |
| Dead viewport shift | `TitlebarMenubar.tsx` writes `transform: translateX(var(--titlebar-menu-viewport-shift, 0px))`; CSS only defines the var as `0px`. | Remove the dead transform and variable. |
| Runtime token allow-list | `css-token-closure.test.ts` still whitelists `--titlebar-menu-anchor-left`, but that test currently exposes broader existing token-classification debt outside this titlebar path. | Do not widen or churn the allow-list in this round; the production writer and CSS consumer are removed and guarded by titlebar tests. |
| Browser coverage | `titlebar-menubar.test.ts` already opens top-level menus and captures screenshots. | Add a probe that opening menus does not write the retired anchor variable. |

## Root Cause

The post-Kobalte titlebar still kept two manual leftovers from the old menu:
pointerdown opened the same menu value Kobalte owns, and menu content width was
based on a trigger-left CSS variable measured by local code. Kobalte Popper
already measures the trigger, computes position, and exposes available viewport
dimensions when `fitViewport` is enabled, so the local anchor path is both a
layout cost and a second positioning source.

## Fix Plan

1. Delete `setMenuAnchor()`.
2. Replace `toggleMenuFromTrigger()` with a narrow controlled-value toggle that
   does not read layout or write CSS.
3. Remove anchor calls from `handleMenuValueChange()` and `openFromKeyboard()`.
4. Replace titlebar panel width calculations with shell-capped preferred
   widths and no trigger-left input.
5. Delete the dead `--titlebar-menu-viewport-shift` CSS variable and inline
   transform.
6. Update static and browser tests, then run focused tests, typecheck, visual
   QA, self-review, commit, and push.

## Acceptance

- `TitlebarMenubar.tsx` contains no `setMenuAnchor`, `getBoundingClientRect`, or
  `--titlebar-menu-anchor-left`.
- `titlebar.css` contains no `--titlebar-menu-anchor-left` or
  `--titlebar-menu-viewport-shift`; menu width no longer depends on trigger
  left.
- Pointer open/close keeps the controlled Kobalte root value synchronized
  without measuring DOM geometry or writing CSS; Alt access-key opening remains
  controlled through the existing root value.
- Browser titlebar test proves top-level menu opens without writing the retired
  anchor variable and screenshots remain visually coherent.
- No fallback positioning source, local iframe, duplicate menu owner, or
  compatibility branch is introduced.

## Implementation

- Removed `setMenuAnchor()` and every `--titlebar-menu-anchor-left` writer.
- Removed trigger `getBoundingClientRect()` reads from `TitlebarMenubar.tsx`.
- Replaced the old pointer handler with `toggleControlledMenuFromTrigger()`.
  It only prevents the native pointer focus chain, refreshes recent directories,
  and updates the controlled Kobalte root value; it does not measure layout,
  write CSS, or calculate positioning.
- Removed the dead `--titlebar-menu-viewport-shift` CSS variable and content
  transform.
- Replaced anchor-based panel widths with shell-capped preferred widths. Kobalte
  `fitViewport` remains enabled on each `Menubar.Menu`, so Popper owns final
  viewport fitting.
- Added a browser probe that intercepts `document.documentElement.style.setProperty`
  during pointer menu open and asserts the retired anchor variable is not
  written.

## Verification

- PASS: `bun test packages/overlay/test/titlebar-menubar-primitive.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-menubar.test.ts`.

## Visual QA

- Reviewed `.scratch/titlebar-run-checkbox-menuitem-focus.png`; the Run menu is
  full width, checkbox focus/checked states remain visible, and copy stays
  inside the panel.
- Reviewed `.scratch/titlebar-menubar-trigger-expanded-state.png`; trigger
  expanded styling remains visible.
- Reviewed `.scratch/titlebar-top-level-menus.png`; top-level titlebar layout
  remains compact and aligned.

## Self Review

- Rechecked production grep: `TitlebarMenubar.tsx` and `titlebar.css` no longer
  contain `--titlebar-menu-anchor-left`, `--titlebar-menu-viewport-shift`,
  `setMenuAnchor`, `getBoundingClientRect`, or `style.setProperty`.
- Rechecked `toggleControlledMenuFromTrigger()`: the only remaining pointer
  work is controlled value synchronization needed for this Kobalte Menubar root;
  the layout-reading and CSS-writing parts are gone.
- Rechecked dirty workspace boundaries: existing auto-confirm-proposed-tasks
  edits remain present but are not part of this round's intended patch.
