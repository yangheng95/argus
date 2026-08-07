# Right Dock Overflow Icon Only

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | In the Right Dock, replace the visible `··· 2`-style overflow trigger with an ellipsis only; do not display the hidden-tab count, and preserve visual quality. |
| Acceptance | The trigger renders only the shared horizontal-more icon; no visible or DOM count remains; the menu, hidden-tab calculation, click target, tooltip, accessible name, hover, focus, and active-tab overflow behavior remain intact; a real desktop screenshot confirms centered geometry. |
| Hard constraints | Keep `RightDock.tsx` as the single overflow owner and keep the existing Kobalte dropdown plus shared Button/Icon primitives. Remove the count path instead of hiding it with CSS. Do not add fallback markup, duplicate overflow state, or interfere with the running OpenCorvus/Overlay process. Playwright runs through Node. |
| Sources read | User screenshot; `specs/records/2026-07/2026-07-27-right-dock-half-length-tabs.md`; `packages/overlay/src/components/RightDock.tsx`; `packages/overlay/src/styles/surfaces/workspace.css`; `packages/overlay/test/right-dock-panel-ownership.test.ts`; `packages/overlay/test/browser/titlebar-toolbar-toggle-browser.test.ts`; shared `CardHeaderChrome`, `ProjectLedgerGroup`, and `SubagentConversationPanel` horizontal-more icon usages. |
| Whole-repository grep | `RightDock.tsx` uniquely renders the overflow trigger, with one text ellipsis span and one `.right-dock-more-count` span. `workspace.css` uniquely owns the trigger gap and count typography. The hidden count remains valid internal data for `data-show` and the menu item list, but no other production surface renders this Right Dock count. Existing browser coverage opens `.right-dock-more`, validates the real menu, and captures `right-dock-many-tabs-stable.png`. |
| Independent agent feedback | Not requested; no sub-agent was started. |

## Call-Site Decision

| Surface | Decision |
| --- | --- |
| `RightDock.tsx` | Replace the two text spans with the existing `more-horizontal` Icon inside an icon-sized Button; preserve the title, accessible name, ref, and dropdown ownership. |
| `workspace.css` | Align the overflow control with the existing Add and Close icon-button geometry; delete the obsolete gap/count rules. |
| Focused regression | Assert the icon-only structure, explicit retirement of `.right-dock-more-count`, and shared icon-button geometry. |
| Existing Node browser fixture | Reuse the real many-tabs route for interaction and screenshot verification. |

## Verification Plan

1. Commit and push this Recall before production changes.
2. Implement the icon-only trigger and focused regression.
3. Run the focused test, Overlay typecheck, internationalization check, and Vite build.
4. Render the existing isolated Right Dock fixture, inspect the exact trigger geometry and screenshot, then correct any visual issue.
5. Re-run whole-repository search, perform a second diff/screenshot review, selectively commit only task-owned hunks, and push through normal git-cc hooks.

## Result

- `RightDock.tsx` now renders one shared `more-horizontal` Icon in an icon-sized, `data-chrome="icon-action"` Button. The count span and literal text ellipsis are absent, while `hiddenTabs().length` remains solely for overflow visibility and menu contents.
- `workspace.css` gives More, Add, and Close the same fixed icon-button width and removes the obsolete trigger gap and count typography.
- `bun test packages/overlay/test/right-dock-overflow-trigger.test.ts`: 1 passed, 0 failed.
- Overlay typecheck, internationalization validation, and the production Vite build passed; the build transformed 7,057 modules.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-toolbar-toggle-browser.test.ts`: 2 passed, 0 failed. The real many-tabs path opened the overflow menu and captured `.scratch/right-dock-many-tabs-stable.png`.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 22 passed, 0 failed.
- Visual review confirms one centered horizontal-more icon, no number, balanced spacing beside Add and Close, and an intact aligned dropdown.

## Second Review

- Whole-repository search finds no production or test reference to `.right-dock-more-count`; its only remaining mention is historical evidence in this record.
- The hidden-tab count remains a data fact used by the existing overflow algorithm and menu list, but it has no visual projection. No second state, fallback, display-none workaround, or manual interaction was introduced.
- The screenshot, real browser interaction, focused source contract, and production build agree on the same icon-only result.
