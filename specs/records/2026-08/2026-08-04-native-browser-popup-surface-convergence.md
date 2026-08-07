# Native Browser popup surface convergence

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | The supplied desktop screenshot shows the Environment Information `Local` submenu passing behind the live Browser page. The user asked to detect the remaining affected popups and repair them through one unified implementation. |
| Acceptance criteria | Every action menu that can enter the operating-system Browser child rectangle while Browser remains active uses the one parent-owned native styled menu surface. The Environment `Local` submenu and Right Dock overflow-tab menu remain completely visible and interactive above the unchanged live page, retain their canonical actions and selection state, and dismiss normally. |
| Hard constraints | Preserve the native Tauri/WebView2 child as the only live Browser source. Do not move, resize, hide, detach, recreate, retarget, or replace it for action-menu presentation. Reuse the existing shared native menu window and typed model; do not add a fallback, gate, state machine, duplicate popup implementation, iframe, screenshot substitute, worktree, or user interface (UI) automated test. Use real desktop interaction and personally reviewed screenshots for UI acceptance. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; current panel architecture; the August 4 shared-native-menu, Browser-continuity, and Browser-overlap records; `TaskDirBar.tsx`; `RightDock.tsx`; shared DropdownMenu, HoverCard, Popover, Tooltip, Dialog, native-menu surface, and native-surface occlusion owners; related surface styles. |
| Whole-repository grep | Enumerated every Overlay DropdownMenu, Popover, HoverCard, Tooltip, Dialog, native-menu call, and native-surface occlusion owner. Browser ellipsis, Right Dock add, and Environment branch already use the parent-owned native menu. Dialog and Settings surfaces use the full-surface occlusion owner. Left-sidebar and center-workbench menus are geometrically contained outside the Browser child, while panel-local split/sub-agent menus cannot coexist with an active Browser body. The remaining menus that can cross the native child while it stays active are Environment `Local` (`TaskDirBar.tsx`) and Right Dock hidden-tab overflow (`RightDock.tsx`); both still use host Kobalte portals. Current architecture also retains one stale sentence naming the add surface as a Kobalte menu. |
| Existing-test disposition | The prior task already removed the directly encountered prohibited Right Dock UI/source-string tests. No additional UI test is added, modified, or run. Positive non-UI transport and native-surface contracts remain untouched. |
| Independent agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and second review. |
| Git baseline | Branch `work-v0.0.29beta-yr-0803` is synchronized with `myhexin/work-v0.0.29beta-yr-0803` at `0 0`. Existing Browser annotation changes belong to parallel work and must remain outside this delivery. |

## Causal chain

1. The live Browser page is an operating-system child WebView and therefore
   z-orders above every host Hypertext Markup Language (HTML) portal.
2. `Local` and Right Dock overflow still render through Kobalte portal content,
   so Cascading Style Sheets (CSS) elevation cannot make them cover the child.
3. Their item sets are already ordinary typed action menus. The existing owned
   native styled menu window can render them without changing their business
   owners or the Browser lease.
4. Migrating those final crossing menus and deleting their portal-specific
   styles leaves one action-menu surface for every Browser-overlap case.

## Implementation and verification plan

1. Extend the native menu item model with an optional secondary description so
   the canonical Local working-directory context remains readable.
2. Replace the Local Kobalte portal with the shared right-start native menu,
   preserving current-directory context, open-directory, and browse actions.
3. Replace the Right Dock Kobalte overflow portal with the shared bottom-end
   native menu, preserving hidden-tab order, active selection, and tab action.
4. Remove obsolete portal imports and styles, and update the current single-
   surface architecture including the stale add-menu wording.
5. Run Overlay typecheck, localization, production build, documentation checks,
   and `git diff --check`; do not run UI tests.
6. Launch an isolated real desktop application with a live Browser page, open
   Local and overflow menus above it, exercise actions/dismissal, capture fresh
   screenshots, and personally review both results twice.
7. Record evidence here, commit with the `dsw-33987` prefix, fetch/reconcile the
   git-cc branch, and push through the normal hook without including parallel
   worktree changes.

## Progress

- [x] Recall, causal chain, and implementation plan recorded.
- [x] Product and architecture changes complete.
- [x] Non-UI/static verification complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Commit and git-cc push complete.

## Acceptance evidence

- `bun run typecheck`, `bun run check:i18n`, `bun run build:vite`,
  `bun run tauri build --no-bundle`, and `git diff --check` completed against
  the changed Overlay surfaces. No UI automated test was added, modified, or
  run.
- The isolated release application loaded `https://www.baidu.com/` through a
  real native Browser tab. Opening Environment Information → Local produced a
  separate owned native menu with `Working directory`, the full project path,
  `Open in file manager`, and `Switch directory…`; the menu remained fully
  composited over the unchanged Baidu WebView. Escape dismissed the menu and
  preserved the Browser URL. The personally reviewed screenshot is
  `.scratch/popup-convergence-qa/local-menu-over-browser.png`.
- Ten native Browser tabs forced five hidden tabs into overflow. The overflow
  trigger produced one shared native menu above the active Baidu WebView with
  the hidden tabs in their canonical order. Selecting a hidden Baidu tab
  dismissed the menu, made that tab active, and preserved all live Browser
  targets. The personally reviewed screenshot is
  `.scratch/popup-convergence-qa/overflow-menu-over-browser.png`.
- A second audit of every Overlay DropdownMenu, Popover, HoverCard, Tooltip,
  Dialog, shared native-menu caller, and native-surface occlusion owner found no
  other host portal that can enter a live Browser child rectangle while the
  Browser remains active. Full-window surfaces continue to use the existing
  native-surface occlusion owner, and panel-local or host-only-region popups do
  not share the Browser rectangle.
