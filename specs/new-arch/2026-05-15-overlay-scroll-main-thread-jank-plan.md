# Overlay Scroll Main-Thread Jank Plan

> Date: 2026-05-15
> Status: implementation plan

## Evidence

- Runtime process sampling shows the WebView2 renderer consuming multiple CPU
  seconds over a short wall-clock window while the native overlay host stays
  near idle.
- The user-visible symptoms are coupled: scrollbar jumps and the overlay stops
  accepting mouse clicks for seconds. This points to renderer main-thread long
  tasks, not just scrollbar styling.
- `setupAutoScroll()` currently:
  - observes the scroll container;
  - observes every top-level child card;
  - installs a subtree `MutationObserver`;
  - writes `scrollTop = scrollHeight` from resize/mutation callbacks while
    follow-to-bottom is enabled.
- Streaming text and expanding cards mutate nested DOM and resize card bodies.
  Observing the whole subtree plus every card can create callback storms and
  forced layout reads/writes on the same frame.

## Root Cause

The conversation scroll owner is too broad. It treats any nested child mutation
or any card resize as a reason to recompute and force the scroll position.
During active streaming this competes with browser scroll anchoring and layout,
which can block pointer handling and make the scrollbar jump.

## Requirements

1. Follow-to-bottom must still keep the latest message visible when the user is
   at the bottom.
2. Once the user scrolls away from the bottom, content growth must not write
   `scrollTop`.
3. Native scroll anchoring must remain enabled while the user is reading older
   content.
4. Native scroll anchoring must not fight programmatic bottom-follow while
   follow-lock is enabled.
5. The scroll owner must not observe the whole conversation subtree.

## Implementation

1. Replace all-child resize observation with only:
   - the scroll container itself;
   - the current last top-level child.
2. Replace subtree mutation observation with direct child-list observation on
   the scroll container. The observer only updates the last-child resize target.
3. Move bottom re-enable into `setupAutoScroll()` via an `onAtBottom` callback
   so the scroll owner has one place to derive follow-lock state.
4. Expose follow-lock state on the element with `data-follow-lock`.
5. Keep `.chat-scroll { overflow-anchor: auto; }` as the default, but set
   `.chat-scroll[data-follow-lock="true"] { overflow-anchor: none; }` so native
   anchoring does not fight programmatic bottom-follow.

## Validation

- Existing auto-scroll tests must continue to pass.
- Add tests that nested mutations do not trigger follow-scroll work directly.
- Add tests that only the last top-level child is resize-observed.
- Add CSS guard for dynamic overflow anchoring.
