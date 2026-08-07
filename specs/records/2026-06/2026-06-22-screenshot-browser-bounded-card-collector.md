# Screenshot Browser Bounded Card Collector

Date: 2026-06-22
Status: Implemented

## Acronyms

- GUI: Graphical User Interface, the browser-rendered overlay surface.
- UI: User Interface, the visible overlay controls and panels.
- URL: Uniform Resource Locator, the stored attachment address rendered by screenshot thumbnails.

## Task Definition

Reduce screenshot toolbar open CPU work by keeping screenshot derivation bounded
while preserving the existing card tree source, agent grouping, and stored
attachment rules.

## Recall

| Source                                                 | Constraint carried forward                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                            | No fallback, no second screenshot source, test every change, and visually verify UI work.                           |
| `2026-06-14-right-toolbar-screenshot-browser.md`       | Screenshot history derives from task card/message data and only accepts stored `/attachment/<project>/<name>` URLs. |
| `2026-06-22-screenshot-browser-open-jank.md`           | The panel already virtualizes visible rows and lazy-loads thumbnails; the remaining hotspot is data derivation.     |
| `2026-06-18-right-activity-toolbar-responsive-rail.md` | Right toolbar remains the single `SideActivityToolbar` source.                                                      |

## Call Point Inventory

| Surface             | Evidence                                                                                                                                    | Decision                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Panel source        | `ScreenshotBrowserPanel.tsx` calls `collectScreenshotBrowserItemsFromCardTree(cardTreeStore.order, cardTreeStore.cards)` only while active. | Keep the panel call and active gate unchanged.                                      |
| Card tree collector | `collectScreenshotBrowserItemsFromCardTree()` builds a full `messages` array and then calls `collectScreenshotBrowserItems()`.              | Replace full message materialization with direct bounded traversal.                 |
| Message collector   | `collectScreenshotBrowserItems()` pushes all items, then sorts and slices to `SCREENSHOT_BROWSER_ITEM_LIMIT`.                               | Replace with bounded newest-first insertion so retained data never exceeds the cap. |
| Dedupe              | `pushUnique()` deduplicates by role/source/message/part/source URL.                                                                         | Keep the same key and seen-set semantics.                                           |
| Rendering           | `ScreenshotBrowserPanel` already uses `virtua/solid`, `IntersectionObserver`, and `PreviewableImage`.                                       | Leave rendering unchanged in this round.                                            |

## Root Cause

The previous screenshot jank repair bounded rendering and thumbnail requests,
but item derivation still traversed the full card tree into an intermediate
message array and sorted all screenshot items before slicing to 120. Large task
histories therefore still do synchronous CPU work on screenshot panel open even
when only the newest bounded set can ever render.

## Fix Plan

1. Add a small collector object with the existing `seen` set and bounded item list.
2. Replace push-then-sort with stable newest-first insertion capped at
   `SCREENSHOT_BROWSER_ITEM_LIMIT`.
3. Make `collectScreenshotBrowserItemsFromCardTree()` traverse cards directly
   and add each card message to the collector without building a full message
   array.
4. Add tests for bounded newest-first behavior, no full collector sort, and no
   full card-tree message materialization.
5. Rerun screenshot browser unit/browser tests, typecheck, build, and visual QA.

## Acceptance

- Retained screenshot item count never exceeds `SCREENSHOT_BROWSER_ITEM_LIMIT`.
- Newest-first ordering and dedupe behavior remain unchanged.
- Card tree traversal does not build a full intermediate message array.
- No local storage, second screenshot source, iframe, direct object URL creation,
  or toolbar fallback is introduced.

## Verification

- `bun test packages/overlay/test/screenshot-browser-panel.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay build:vite`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`
- Re-ran `bun test packages/overlay/test/screenshot-browser-panel.test.ts --timeout 30000` after expanding the bounded collector case to 5000 cards and 500 screenshot candidates.
- Visual QA: viewed `.scratch/screenshot-browser-panel-browser.png`, `.scratch/screenshot-browser-panel-browser-narrow.png`, and `.scratch/screenshot-browser-panel-browser-narrow-panel.png`; desktop thumbnails, right toolbar, narrow internal panel layout, and overflow behavior remain correct.

## Self Review

- Rechecked `ScreenshotBrowserPanel.tsx`; rendering, virtualization, lazy thumbnail loading, `PreviewableImage`, and active gating remain unchanged.
- Rechecked `screenshot-browser.ts`; production collector no longer contains `items.sort(` or a full `const messages: any[] = []` card-tree materialization path.
- Rechecked the new 5000-card test preserves newest-first ordering by retaining `/attachment/project/4990.png` through `/attachment/project/3800.png`.
