# Screenshot Cache Server Time Restamp

Date: 2026-06-23
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the visible overlay surface.
- SSE: Server-Sent Events, the live event stream that delivers message and part updates.
- UI: User Interface, visible controls and layout surfaces.

## Task Definition

Repair a card-tree screenshot cache invalidation gap in the part-before-message
path. When a displayable screenshot part arrives before `message.updated`, the
later authoritative server timestamp must update both the card and the cached
screenshot items used by the screenshots toolbar.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate source, no blind patching, test every change, visually verify UI work when relevant, and commit/push every round. |
| `2026-06-22-screenshot-browser-card-tree-cache.md` | Screenshot browser reads writer-maintained `subtreeScreenshotItems`; opening the toolbar must not walk the whole card tree. |
| `2026-06-13-overlay-part-first-regroup-stale-card.md` | `message.part.updated` can legitimately arrive before `message.updated`; `ensureMessageTurnProjection` owns deterministic card identity. |
| `2026-06-04-overlay-tool-agent-timer-single-source.md` | Normal repeated `message.updated` events must preserve the first authoritative message-created time; only part-first observation time is replaced by server time. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Part-first projection | `ensurePartProjection()` creates the deterministic message card at observation time when no message metadata exists. | Keep this path; it is the single durable reconstruction owner. |
| Server-time restamp | `ensureMessageTurnProjection()` sets `cards[cardID].time = opts.time` when the later `message.updated` arrives for an existing part-first card. | Mark the card stats dirty only when that time actually changes. |
| Screenshot cache | `collectScreenshotBrowserItemsFromCard(card)` reads `CardNode.time` into every screenshot item. | Recompute `subtreeScreenshotItems` through the existing stats kernel; do not add a panel-local cache. |
| Tests | `tree-writer-stats-cache.test.ts` already verifies screenshot cache invariants after writer mutations. | Add a part-before-message ordering regression. |

## Root Cause

The part-first path correctly replaces the observation timestamp with the
authoritative server timestamp when `message.updated` arrives. That write did
not call `markCardStatsDirty(cardID)`. The card's visible `time` changed, but
`subtreeScreenshotItems` and top-level `cardTreeStore.screenshotItems` kept the
old observation time, so screenshot ordering could remain stale even though the
card itself had the correct server time.

## Fix Plan

1. Add a regression where a screenshot file part arrives before its
   `message.updated`.
2. Assert the initial cache uses observation time.
3. Deliver `message.updated` with the authoritative server time.
4. Assert the card, subtree screenshot cache, and top-level screenshot cache all
   use the server time.
5. Mark card stats dirty when `ensureMessageTurnProjection()` changes `time`.
6. Run focused stats and screenshot tests, overlay typecheck, visual relevance
   review, self-review, commit, and push.

## Acceptance

- Part-before-message screenshot items are restamped to server time once
  `message.updated` arrives.
- Repeated `message.updated` events with the same preserved server time do not
  create a second timer source.
- Screenshot browser still reads only `cardTreeStore.screenshotItems`.
- No fallback traversal, panel-local screenshot cache, or duplicate timestamp
  source is introduced.

## Verification

- PASS: `bun test packages/overlay/test/tree-writer-stats-cache.test.ts packages/overlay/test/screenshot-browser-panel.test.ts packages/overlay/test/store-card-tree-prune.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS after one edge retry: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`.
  - First run failed at `screenshot browser first card took 1505ms` against a
    `1500ms` threshold.
  - Immediate rerun passed; threshold was not changed.
- Visual QA reviewed:
  `.scratch/screenshot-browser-panel-browser.png` and
  `.scratch/screenshot-browser-panel-browser-narrow-panel.png`.

## Self Review

- The dirty mark is attached to the existing server-time restamp branch; no
  alternate timestamp parser or screenshot cache was added.
- The regression asserts all three surfaces move together: `CardNode.time`,
  `subtreeScreenshotItems`, and top-level `cardTreeStore.screenshotItems`.
- Rechecked repeated-message behavior: `handleMessageUpdated()` preserves the
  first server time in the `messages` map, so repeated `message.updated` events
  do not keep changing `opts.time`.
