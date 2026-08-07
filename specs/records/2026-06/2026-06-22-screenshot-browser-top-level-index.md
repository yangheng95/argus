# Screenshot Browser Top Level Index

Date: 2026-06-22
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the browser-rendered overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- RAF: Request Animation Frame, the browser callback used to run visual work once per frame.

## Task Definition

Remove the remaining screenshot toolbar open cost that scales with
`cardTreeStore.order` when many top-level cards exist.

## Recall

| Source                                                    | Constraint carried forward                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                               | No fallback, no duplicate source, test every change, visually verify UI changes, and commit/push each round.              |
| `2026-06-22-screenshot-browser-open-jank.md`              | Rendering is already virtualized and thumbnails lazy-load through `PreviewableImage`; do not change attachment ownership. |
| `2026-06-22-screenshot-browser-bounded-card-collector.md` | Screenshot data remains capped at 120 newest items.                                                                       |
| `2026-06-22-screenshot-browser-card-tree-cache.md`        | Per-card `subtreeScreenshotItems` is writer-maintained by `card-tree-stats.ts`; keep it as the single subtree source.     |
| Faraday GUI audit                                         | The current collector still loops every top-level id from `cardTreeStore.order` on toolbar activation.                    |

## Call Point Inventory

| Surface                | Evidence                                                                                                                                  | Decision                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel read             | `ScreenshotBrowserPanel.tsx` calls `collectScreenshotBrowserItemsFromCardTree(cardTreeStore.order, cardTreeStore.cards)` when active.     | Replace with a store-level stats cache read.                                                                                                |
| Card tree order writes | `resetWriter`, `removeCardReferences`, `rebuildTopLevelOrder`, and `pruneCardsAfterCursor` rewrite `cardTreeStore.order`.                 | Route these writes through one order helper so the stats kernel can reconcile top-level roots.                                              |
| Per-card cache writes  | `card-tree-stats.ts` recomputes `subtreeScreenshotItems` inside `flushCardStats()`.                                                       | When a top-level card cache changes, sync that root into the top-level screenshot index in the same kernel.                                 |
| Current collector      | `collectScreenshotBrowserItemsFromCardTree()` merges every top-level cached subtree on demand.                                            | Replace production usage with `cardTreeStore.screenshotItems`; keep utility behavior only for explicit cache construction tests if needed.  |
| Tests                  | `screenshot-browser-panel.test.ts`, `tree-writer-stats-cache.test.ts`, and `store-card-tree-prune.test.ts` pin screenshot cache behavior. | Add regression coverage proving panel open does not read `order`/`cards`, and store cache updates across append, removal, reset, and prune. |

## Root Cause

The previous fix removed recursive subtree traversal from toolbar activation,
but the activation path still iterates every top-level card id to merge each
root's cached subtree screenshots. Large transcripts with many top-level
segments still pay O(top-level roots) before the panel can render.

## Fix Plan

1. Add `CardTreeStore.screenshotItems` as the bounded newest screenshot list
   for the whole visible card tree.
2. Add a single card-tree order helper that marks top-level roots dirty when
   `order` changes.
3. Extend `card-tree-stats.ts` with a top-level screenshot index owned by the
   same dirty/flush kernel as `subtreeScreenshotItems`.
4. Update `ScreenshotBrowserPanel` to read `cardTreeStore.screenshotItems`
   directly, without reading `order`, `cards`, or a panel-local cache.
5. Add tests proving toolbar collection is O(1) with respect to top-level root
   count and that reset/prune/removal keep the store-level cache correct.
6. Run focused unit tests, typecheck, real browser screenshot-panel test, and
   visual screenshot review.

## Acceptance

- Screenshot toolbar open does not read `cardTreeStore.order` or
  `cardTreeStore.cards`.
- The visible screenshot list still derives from the canonical card tree stats
  kernel, not from a panel-local cache or a second source.
- Top-level root additions, removals, card-cache changes, reset, and prune keep
  `cardTreeStore.screenshotItems` synchronized.
- No fallback traversal is introduced for production UI.
- Focused tests, typecheck, browser test, visual screenshots, self-review,
  commit, and push all pass.

## Verification

- `bun test packages/overlay/test/screenshot-browser-panel.test.ts packages/overlay/test/tree-writer-stats-cache.test.ts packages/overlay/test/store-card-tree-prune.test.ts --timeout 30000`
- `bun test packages/overlay/test/selected-task-recovery.test.ts packages/overlay/test/delta-coalesce.test.ts packages/overlay/test/card-tree-visible-version.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`

## Visual Review

- `.scratch/screenshot-browser-panel-browser.png`: desktop screenshot panel opens with the screenshots toolbar selected, count shown, grouped thumbnails rendered, and no panel text overlap.
- `.scratch/screenshot-browser-panel-browser-narrow.png`: narrow shell keeps the bottom toolbar and screenshot toolbar selection intact.
- `.scratch/screenshot-browser-panel-browser-narrow-panel.png`: narrow panel crop shows the screenshot title, count, and first thumbnail text within the panel bounds.

## Self Review

- `ScreenshotBrowserPanel` now reads only `cardTreeStore.screenshotItems` for
  active data and no longer imports or calls the card-tree collector.
- `CardTreeStore.screenshotItems` is maintained by `card-tree-stats.ts`, the
  same kernel that maintains per-card `subtreeScreenshotItems`; no panel cache
  or fallback traversal was added.
- Production `order` rewrites now go through `replaceCardTreeOrder`, while the
  static test rejects direct `setCardTreeStore("order"` writes in
  `tree-writer.ts`.
- The 5000-root regression proves the top-level screenshot list is bounded
  before the panel reads it, and reset/prune tests prove the store-level cache
  clears with structural changes.
