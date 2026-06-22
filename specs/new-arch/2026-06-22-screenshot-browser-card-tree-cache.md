# Screenshot Browser Card Tree Cache

Date: 2026-06-22
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the browser-rendered overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- RAF: Request Animation Frame, the browser callback used to run visual work once per frame.
- DOM: Document Object Model, the browser element tree.

## Task Definition

Remove screenshot toolbar open's remaining full card-tree traversal by moving
bounded screenshot derivation into the existing card-tree stats kernel.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate screenshot source, test every change, visually verify UI changes, and commit/push every round. |
| `2026-06-22-screenshot-browser-open-jank.md` | Screenshot browser already virtualizes rows and lazy-loads thumbnails; do not change rendering or attachment fetch ownership. |
| `2026-06-22-screenshot-browser-bounded-card-collector.md` | Screenshot item derivation is capped at 120, but the previous fix did not prove traversal itself was bounded. |
| `2026-06-22-screenshot-browser-defer-initial-measure.md` | Panel open layout reads are already deferred through RAF; keep the same measurement path. |
| `tree-writer-stats-cache.test.ts` | Existing subtree aggregates are maintained by `markCardStatsDirty` and `flushCardStats` inside writer batches. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Panel source | `ScreenshotBrowserPanel.tsx` calls `collectScreenshotBrowserItemsFromCardTree(cardTreeStore.order, cardTreeStore.cards)` only when active. | Keep the panel call and active gate unchanged. |
| Current collector | `utils/screenshot-browser.ts` recursively calls `collectCardTreeScreenshots(childIDs, ...)`. | Replace recursion with cached top-level subtree screenshot aggregates. |
| Existing cache owner | `store/card-tree-stats.ts` owns `subtreeCounts`, `subtreeLatestHit`, and `subtreeTodoHit` updates. | Add `subtreeScreenshotItems` to the same kernel. |
| Card creation/update | `tree-writer.ts` dirty-marks parts, part deltas, part removals, phase reorder, timeline regroup, interaction cards, task context, and board rebuilds. | Reuse those dirty marks; no screenshot-specific writer path. |
| Browser test | `screenshot-browser-panel-browser.test.ts` uses real transcript ingestion, virtual rows, request budgets, scroll, resize, and screenshots. | Keep as real integration coverage after cache change. |

## Root Cause

The previous bounded collector limited retained screenshot items and avoided a
full intermediate message array, but `collectScreenshotBrowserItemsFromCardTree`
still walked every reachable card by recursing through `childIDs`. Opening the
screenshots toolbar therefore remained proportional to the visible card tree
size even when the newest 120 screenshots were already known.

## Fix Plan

1. Add `CardNode.subtreeScreenshotItems` as a bounded cached aggregate.
2. Export screenshot item helpers that compute one card's own items and merge
   bounded item sets without changing existing URL, role, dedupe, or ordering
   semantics.
3. Extend `card-tree-stats.ts` so every existing dirty/flush path also
   recomputes screenshot aggregates from own items plus direct child caches.
4. Change `collectScreenshotBrowserItemsFromCardTree()` to merge only
   top-level cached aggregates from `cardTreeStore.order`.
5. Extend unit/static tests so card-tree collection cannot recurse childIDs,
   and tree-writer cache invariants compare the cached screenshot items against
   a fresh recursive walk.
6. Rerun focused screenshot/unit/browser tests, typecheck/build, and visual QA.

## Acceptance

- Screenshot panel data still derives from the canonical card tree, not from a
  panel-local cache or second store.
- `collectScreenshotBrowserItemsFromCardTree()` does not recurse `childIDs` or
  reconstruct full messages.
- Writer-maintained `subtreeScreenshotItems` matches a fresh recursive
  recomputation after part create, part update, part delete, child relink, and
  board rebuild paths covered by existing stats tests.
- Browser screenshot panel still opens with bounded attachment requests, can
  scroll to old rows on demand, and remains visually correct at desktop/narrow
  sizes.
- No fallback traversal, local storage, iframe, direct object URL creation, or
  alternate toolbar source is introduced.

## Verification

- `bun test packages/overlay/test/screenshot-browser-panel.test.ts packages/overlay/test/tree-writer-stats-cache.test.ts packages/overlay/test/store-card-tree-prune.test.ts --timeout 30000`
- `bun test packages/overlay/test/selected-task-recovery.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`
- Browser runner build step: Vite production build completed before the Playwright test.

## Visual Review

- `.scratch/screenshot-browser-panel-browser.png`: desktop screenshot panel opens in the workbench, toolbar state is highlighted, count/group/thumbnail grid render without overlap.
- `.scratch/screenshot-browser-panel-browser-narrow.png`: narrow viewport keeps the bottom toolbar and main shell coherent.
- `.scratch/screenshot-browser-panel-browser-narrow-panel.png`: narrow panel crop shows the screenshot title, count, group, and first thumbnail without text/container collision.

## Self Review

- `collectScreenshotBrowserItemsFromCardTree()` now reads only top-level
  `subtreeScreenshotItems` caches and throws if the writer-maintained cache is
  missing.
- Recursive screenshot derivation is single-sourced in `card-tree-stats.ts`
  through the existing dirty/flush kernel; the panel owns no second cache.
- The focused proxy test proves collector open does not read `parts` or
  `childIDs`; the stats invariant test compares every cached screenshot
  aggregate against a fresh recursive walk after writer mutations.
- The i18n error printed by the stats test came from an uninitialized unit-test
  locale harness, not missing locale catalog data; the test now uses the
  existing real-locale fixture before importing tree-writer.
