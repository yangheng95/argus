# Screenshot Top Level Incremental Index

Date: 2026-06-23
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the visible overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- SSE: Server-Sent Events, the live event stream that delivers task updates.

## Task Definition

Remove the remaining full top-level screenshot root merge from the card-tree
stats update path. Opening the screenshots panel already reads
`cardTreeStore.screenshotItems`; this round makes updates to that store-level
cache incremental so one dirty root does not rescan every screenshot-bearing
top-level root.

## Recall

| Source                                                    | Constraint carried forward                                                                                                                                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                               | No fallback, no duplicate source, recall disk plans before edits, test every change, visually verify UI-adjacent work, commit and push every round.                                                                         |
| `2026-06-22-screenshot-browser-top-level-index.md`        | The screenshot panel reads `cardTreeStore.screenshotItems`; the stats kernel owns the store-level cache.                                                                                                                    |
| `2026-06-22-screenshot-browser-card-tree-cache.md`        | Per-card `subtreeScreenshotItems` remains the canonical subtree aggregate and must not be replaced by a panel cache.                                                                                                        |
| `2026-06-22-screenshot-browser-bounded-card-collector.md` | The visible screenshot history is capped at `SCREENSHOT_BROWSER_ITEM_LIMIT` and ordered newest-first with existing dedupe semantics.                                                                                        |
| `2026-06-23-screenshot-cache-server-time-restamp.md`      | Server-time restamps must update card cache, subtree cache, and top-level screenshot cache together.                                                                                                                        |
| Cicero read-only audit                                    | `flushTopLevelScreenshotItems()` still calls `mergeScreenshotBrowserItemSets(topLevelScreenshotItemSets.values())`, making single-root updates proportional to all screenshot roots.                                        |
| Heisenberg read-only audit                                | Dirty-root update alone is insufficient; root append/remove/reorder must not fall back to full root-array reads, duplicate owner transfer and equal-time order must be covered, and stale heap entries must not accumulate. |

## Call Point Inventory

| Surface                | Evidence                                                                                                                   | Decision                                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel read             | `ScreenshotBrowserPanel.tsx` returns `cardTreeStore.screenshotItems`.                                                      | Keep unchanged; the panel is not the remaining full-scan owner.                                                                                                         |
| Top-level flush        | `card-tree-stats.ts::flushTopLevelScreenshotItems()` merges all `topLevelScreenshotItemSets.values()`.                     | Replace with an incremental root-owned item index and bounded heap read.                                                                                                |
| Root cache sync        | `syncTopLevelRootScreenshotItems(cardID, items)` runs when a top-level root's subtree screenshot cache changes.            | Update only that root's item ownership and heap entries.                                                                                                                |
| Order changes          | `replaceCardTreeOrder()` now passes old/new order to the stats handler.                                                    | Diff roots incrementally: added roots read only their own cache, removed roots remove their owned keys, retained reorders update rank/heap without reading root arrays. |
| Reset/prune            | `__resetCardStatsForTests()` clears index state; prune removes roots through `replaceCardTreeOrder()` before card pruning. | Reset clears the index; prune relies on root removal diff plus card dirty marks, not a second order rebuild source.                                                     |
| Per-node subtree cache | `recomputeNodeStats()` still uses `mergeScreenshotBrowserItemSets()` for one card's own items plus direct children.        | Keep this bounded subtree operation; this round targets only the top-level all-root merge.                                                                              |
| Tests                  | `tree-writer-stats-cache.test.ts` has a 5000-root initial bound test but no single-root update cost guard.                 | Add a proxy-backed regression proving one dirty root update does not read unrelated root item arrays.                                                                   |

## Root Cause

The store-level screenshot list is writer-maintained, but the writer-maintained
top-level cache still collapses every top-level root on each dirty flush. When
one screenshot part streams in, a screenshot timestamp is restamped, or one root
changes during task switching, the dirty flag turns into an all-root merge.
That keeps screenshot and task-switch work proportional to the number of
screenshot-bearing roots even though the UI can render only the newest bounded
set.

## Fix Plan

1. Export the screenshot item identity helper from `utils/screenshot-browser.ts`
   so merge and stats index share one dedupe key.
2. Replace `topLevelScreenshotItemSets + dirty full merge` with a root-owned
   incremental index: root item keys, item owners, active item representatives,
   and an indexed max heap for bounded newest reads.
3. Change the order stats handler to receive old/new order and apply an
   incremental diff for root add/remove/reorder.
4. Add a 5000-root regression where unrelated root `subtreeScreenshotItems`
   arrays are proxies; after initial build, updating one root must not read any
   unrelated root arrays.
5. Add append/remove, duplicate owner transfer, equal-time reorder, and reset
   regressions for the incremental index.
6. Add a static guard rejecting the old
   `mergeScreenshotBrowserItemSets(topLevelScreenshotItemSets.values())` path.
7. Run focused stats/screenshot tests, overlay typecheck, browser screenshot
   panel test, visual screenshot review, self-review, commit, and push.

## Acceptance

- A single top-level root screenshot cache update does not iterate unrelated
  root screenshot arrays.
- `cardTreeStore.screenshotItems` remains the single UI source; no panel-local
  cache or fallback traversal is introduced.
- Root append/remove/reorder does not read unrelated root screenshot arrays;
  reset clears the index and the next hydrate starts from live roots only.
- Duplicate screenshot keys transfer ownership according to root order, and
  equal-time distinct items follow top-level display order.
- Existing subtree screenshot cache semantics, item cap, and dedupe key remain
  shared with the screenshot browser utilities.
- Focused tests, typecheck, browser visual QA, self-review, commit, and push pass.

## Verification

- `bun test packages/overlay/test/tree-writer-stats-cache.test.ts packages/overlay/test/screenshot-browser-panel.test.ts packages/overlay/test/store-card-tree-prune.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`
- `bun test packages/overlay/test/selected-task-recovery.test.ts packages/overlay/test/delta-coalesce.test.ts packages/overlay/test/card-tree-visible-version.test.ts --timeout 30000`

## Visual Acceptance

Reviewed the Playwright screenshot browser outputs:

- `.scratch/screenshot-browser-panel-browser.png`
- `.scratch/screenshot-browser-panel-browser-narrow.png`
- `.scratch/screenshot-browser-panel-browser-narrow-panel.png`

The desktop and narrow screenshot panels still render grouped thumbnails,
toolbar selection, count text, and thumbnail labels without overlap or newly
introduced layout clipping.

## Self Review

The panel remains a direct reader of `cardTreeStore.screenshotItems`. The
per-card `subtreeScreenshotItems` cache still uses the existing bounded merge
for one node plus its direct child caches. Only the top-level all-root merge was
replaced: root updates mutate root-owned keys and heap entries; order changes
diff old/new roots without reading unrelated arrays; reset clears index state
instead of keeping a parallel rebuild path.
