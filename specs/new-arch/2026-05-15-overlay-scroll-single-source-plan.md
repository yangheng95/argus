# Overlay Scroll Single-Source Plan

> Date: 2026-05-15
> Status: implementation plan

## Recall

- `specs/new-arch/07-panel-reactivity.md` requires `cardTreeStore` to be the
  single visible conversation source and forbids broad reactive tree scans on
  the streaming hot path.
- `specs/new-arch/2026-05-14-overlay-refresh-single-source-plan.md` requires
  visible message/run deltas to refresh through the card tree, not through
  board refreshes or duplicated message stores.
- `specs/new-arch/2026-05-14-conversation-scroll-follow-lock.md` requires
  native scroll anchoring while the operator reads older content.
- The interim main-thread-jank plan (since removed; superseded by this doc)
  narrowed DOM observers, but still left scroll follow driven by DOM mutation
  and resize observation. That is still a second source and does not satisfy
  the no-patch rule.

## Root Cause

The scroll layer currently treats DOM mutation/resize as the signal that
conversation content changed. During streaming, the writer already knows when
visible content changes because every visible card update flows through
`cardTreeStore`. Observing the rendered DOM duplicates that source and can run
layout work while WebView2 is trying to process pointer input.

## Requirements

1. Follow-to-bottom is driven by the card tree's visible data version.
2. `setupAutoScroll()` must not construct `MutationObserver` or
   `ResizeObserver`.
3. The scroll owner must only listen to user scroll events and explicit
   data-change notifications from its caller.
4. When the operator scrolls away from the bottom, content changes must not
   write `scrollTop`.
5. Native scroll anchoring remains enabled while follow-lock is off and is
   disabled only while programmatic bottom-follow is active.
6. LogViewer must keep its always-follow behavior through its own log-entry
   data version, not through DOM observation.

## Implementation

1. Add `visibleVersion` to `cardTreeStore` and increment it in the tree writer
   after visible card tree mutations.
2. Increment the same version for local prune/reset operations that mutate the
   visible tree outside SSE handling.
3. Replace observer-driven auto-scroll with an explicit
   `contentChanged()` controller method that schedules one requestAnimationFrame
   scroll if tracking is enabled.
4. In `Conversation`, call `contentChanged()` from a Solid effect keyed only by
   `cardTreeStore.visibleVersion`.
5. In `LogViewer`, call `contentChanged()` from a Solid effect keyed by the
   current log entries count while the dialog is open.
6. Update tests to assert the scroll utility does not rely on DOM observers and
   preserves manual scroll positions when tracking is disabled.

## Validation

- Targeted auto-scroll tests pass.
- Tree-writer/card-tree tests prove visible version changes on streaming
  deltas and pruning.
- Static test guards prevent reintroducing `MutationObserver` or
  `ResizeObserver` into `setupAutoScroll()`.
- Run overlay typecheck and architecture guards before commit/push.
