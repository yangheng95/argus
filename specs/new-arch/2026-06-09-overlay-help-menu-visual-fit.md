# Overlay Help Menu Visual Fit

## Grep Evidence

| Surface           | Evidence                                                                                                                                                                                          | Decision                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Help render       | `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx` renders `titlebar-help-docs`, `titlebar-help-sdk`, `titlebar-help-devtools`, and `titlebar-help-about` under `menu.id === "help"`. | Preserve the current Help contract and fix the menu geometry around it.                                                                   |
| Menu CSS          | `packages/overlay/src/styles/surfaces/titlebar.css` owns `.titlebar-menubar-panel`, the workspace width exception, and `.titlebar-menubar-item-meta`.                                             | Add a Help-specific width/alignment and item layout instead of changing unrelated menu surfaces.                                          |
| Existing tests    | `packages/overlay/test/browser/titlebar-menubar.test.ts` opens every titlebar menu across `320, 480, 600, 760, 1440` and both locales through the Node-owned browser runner.                      | Extend this Playwright-backed test to assert Help item text is visible, readable, and inside the viewport.                                |
| Primitive history | `specs/new-arch/2026-06-01-overlay-mature-ui-primitives-refactor.md` records that `@kobalte/core/menubar` migration is blocked by declaration errors.                                             | Do not hand-roll a new interaction system and do not add a second menu source; keep the existing menu implementation while fixing layout. |

## Root Cause

The Help menu became explanation-heavy after the documentation entries were added. The shared menu panel still opens from the trigger's left edge and caps width at `340px`, while each item lays out label and meta in a single flex row with `white-space: nowrap`. Near the right edge this creates the screenshot failure mode: the panel extends beyond the window or the meta copy is clipped into an unreadable strip.

## Implementation

1. Mark Help menu items with a menu-scoped item variant instead of changing the global `MenuItem` API.
2. Give the Help panel a right-aligned width that stays inside the viewport on desktop and still uses the existing fixed full-width mobile behavior.
3. Use a two-column grid for Help rows at desktop widths; allow the description column to wrap cleanly instead of ellipsizing.
4. Add Playwright-backed assertions that Help panel bounds, item bounds, and meta wrapping remain readable in English and Chinese.

## Verification

- `$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-concurrency=1 packages/overlay/test/browser/titlebar-menubar.test.ts`
- `bun run --cwd packages/overlay typecheck`
