# Usage Strip Card Tree Aggregate

Date: 2026-06-22
Status: Verified

## Acronyms

- UI: User Interface, visible controls and layout surfaces.
- SSE: Server-Sent Events, the incremental event stream that updates the overlay card tree.

## Task Definition

Remove the chat-header usage strip's full `cardTreeStore.cards` scan from every
card-tree update while preserving the existing token/cost aggregation semantics.

## Recall

| Source                                             | Constraint carried forward                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                        | No fallback/compatibility path, no duplicate source, test every change, and do not hide root causes with gates. |
| `2026-06-19-deep-performance-investigation.md`     | Usage aggregation was identified as a deferred always-mounted overlay pressure source.                          |
| `2026-06-22-screenshot-browser-top-level-index.md` | Store-level card-tree stats are the right owner for bounded top-level projections.                              |
| `tree-writer-message-tokens.test.ts`               | `aggregateUsageAcrossSessions` is the source of truth for message usage semantics across sessions.              |
| `card-tree-stats.ts`                               | Existing subtree aggregates are maintained by the writer dirty/flush kernel.                                    |

## Call Point Inventory

| Surface                   | Evidence                                                                                                                                | Decision                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Usage pure kernel         | `utils/format-usage.ts` exports `aggregateUsageAcrossSessions` and `formatUsageStrip`.                                                  | Keep this kernel as the single token/cost rule source.                                                                                        |
| UI effect                 | `main.tsx` currently calls `aggregateUsageAcrossSessions(Object.values(cardTreeStore.cards))`.                                          | Replace with `formatUsageStrip(cardTreeStore.usageAggregate)`.                                                                                |
| Card usage writes         | `tree-writer.ts` writes `card.usage`, `contextTokens`, and `contextTokensEstimated`, then marks card stats dirty.                       | Reuse existing dirty marks and `flushCardStats()`.                                                                                            |
| Stats kernel              | `card-tree-stats.ts` already computes subtree counts, latest activity, todo, and screenshot items.                                      | Add `subtreeUsageAggregate` and a per-card own-usage index that publishes `cardTreeStore.usageAggregate`.                                     |
| Reset/prune/order changes | Card deletion happens through reset, message removal, migrate, task-context removal, goal GC, interaction GC, and prune reconciliation. | Each deletion path removes the card from the usage index; prune reconciliation removes index keys no longer present in `cardTreeStore.cards`. |
| Tests                     | `format-usage.test.ts`, `tree-writer-message-tokens.test.ts`, and `tree-writer-stats-cache.test.ts` cover current semantics.            | Extend tests so store-level aggregate matches the pure kernel and UI no longer scans `Object.values(cardTreeStore.cards)`.                    |

## Root Cause

The usage strip is always mounted, so every reactive card-tree change can rerun
the DOM glue effect in `main.tsx`. That effect reads `Object.values(cardTreeStore.cards)`,
which subscribes broadly to the whole card dictionary and recomputes the usage
aggregate from scratch. During screenshot toolbar open and live streaming, this
adds a global O(card count) projection unrelated to the visible screenshot work.

## Fix Plan

1. Add a `UsageAggregate` type to `utils/format-usage.ts`.
2. Add `CardNode.subtreeUsageAggregate` and `CardTreeStore.usageAggregate`.
3. Extend `card-tree-stats.ts` so each dirty card recomputes its own usage with
   `aggregateUsageAcrossSessions([card])`, then combines child subtree usage.
4. Maintain a per-card own-usage index inside `card-tree-stats.ts` and publish
   `cardTreeStore.usageAggregate` from that index. This preserves the old
   `Object.values(cardTreeStore.cards)` semantics, including cards with usage
   before they have displayable parts.
5. Change `main.tsx` to format the store-level aggregate without reading
   `cardTreeStore.cards`.
6. Add tests comparing the store-level aggregate to the pure kernel after
   writer events, message removal, reset, and source guards rejecting the old
   UI-side full-map scan.

## Acceptance

- `main.tsx` no longer calls `aggregateUsageAcrossSessions(Object.values(cardTreeStore.cards))`.
- The usage strip still renders the exact same `formatUsageStrip` output for
  cross-session assistant usage and context-token estimates.
- Usage aggregation is maintained by the existing writer stats kernel; no
  panel-local cache, UI-side full-map scan, polling, or second usage rule is introduced.
- Focused usage/tree-writer tests, overlay typecheck, visual sanity, self-review,
  commit, and push pass.

## Verification Plan

- `bun test packages/overlay/test/format-usage.test.ts packages/overlay/test/tree-writer-message-tokens.test.ts packages/overlay/test/tree-writer-stats-cache.test.ts --timeout 30000`
- `bun test packages/overlay/test/agent-file-changes.test.ts packages/overlay/test/acceptance-panel-mount.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`

## Verification

- `bun test packages/overlay/test/format-usage.test.ts packages/overlay/test/tree-writer-message-tokens.test.ts packages/overlay/test/tree-writer-stats-cache.test.ts --timeout 30000`
- `bun test packages/overlay/test/agent-file-changes.test.ts packages/overlay/test/acceptance-panel-mount.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/message-card-chronological-turns-browser.test.ts`

Visual evidence reviewed: `.scratch/message-card-chronological-turns-browser/usage-header.png`.

## Self Review

- The production `main.tsx` effect no longer imports or calls
  `aggregateUsageAcrossSessions(Object.values(cardTreeStore.cards))`.
- `projectUsageOntoCard` marks the target card dirty after usage/context writes.
- Card deletion paths call `markCardStatsRemoved`, and prune reconciliation
  removes stale usage-index keys that no longer exist in `cardTreeStore.cards`.
- Store aggregate tests compare against the pure kernel over
  `Object.values(cardTreeStore.cards)`, so the optimization does not narrow the
  previous whole-dictionary semantics to only visible top-level roots.
