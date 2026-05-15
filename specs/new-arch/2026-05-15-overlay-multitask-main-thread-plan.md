# Overlay Multitask Main-Thread Plan

> Date: 2026-05-15
> Status: implementation plan

## Recall

- `specs/new-arch/07-panel-reactivity.md` requires the overlay to keep the
  streaming path below a frame budget and forbids broad reactive tree scans.
- `specs/new-arch/2026-05-14-overlay-refresh-single-source-plan.md` makes
  `cardTreeStore` the visible conversation source and restricts board refresh
  to board-owned data.
- `specs/new-arch/2026-05-15-overlay-scroll-single-source-plan.md` removed DOM
  observers from scroll follow.
- `specs/new-arch/2026-05-15-overlay-streaming-text-main-thread-plan.md`
  removed markdown parsing and workflow text scans from streaming deltas.

## Evidence

- User testing shows single-task mode significantly reduces the jank, so the
  remaining hot path is likely multitask surfaces, not only one conversation
  card.
- `Gateway` is always mounted. Its HTTP resources are page-mode gated, but its
  task-derived JSX still reads `visibleTasks()` and renders the full ledger
  while the panel page is active and the gateway is hidden by CSS.
- `TaskList` and `Gateway` each call `visibleTasks()`. `Gateway` calls it for
  filtering, queue positions, and counts. `visibleTasks()` merges and sorts the
  task list every call.
- `applyTasks()` preserves row references by comparing JSON signatures, which
  is correct for DOM stability but still performs full-list work during cold
  boot and refresh.
- The existing perf test uses small synthetic rows; it does not catch hidden
  gateway DOM construction or large real task summaries.

## Root Cause

The overlay still builds multitask projections in consumers instead of owning
one task-list projection in the store. Hidden Gateway work is especially
harmful: the operator is on the conversation panel, but WebView2 still creates
and reconciles a second full task ledger. This doubles cold-start and refresh
work and matches the "single task is much smoother" observation.

## Requirements

1. `boardStore.tasks` and `boardStore.pendingTasks` remain the only task-list
   data source.
2. The merged visible task list is computed once in the board store and reused
   by TaskList and Gateway.
3. Gateway may keep its page-level signals mounted, but hidden page mode must
   not render the ledger/channel DOM or compute task filters/counts.
4. An open Gateway composer is stateful work and must remain mounted across a
   Panel round trip; hiding Gateway must not clear drafts or abort an active
   decomposition request.
5. Gateway resources and task projections must both be gated by
   `isGatewayPage()`.
6. The sidebar TaskList remains visible in panel mode and continues to own the
   panel task rows.
7. Existing row reference preservation must remain; unchanged rows must not
   remount after a task refresh.

## Implementation

1. Add a store-level `visibleTaskItems` memo and make `visibleTasks()` return
   that memo instead of sorting inside every caller.
2. Add a store-level task-id index for `taskByID()` so selected-item lookup in
   Gateway no longer scans the list.
3. In `Gateway`, introduce a `gatewayTasks` memo that returns `[]` while not on
   the Gateway page and use it for filter, queue-position, and counts.
4. Render Gateway's heavy ledger, selected-task detail, and channel body only
   when `isGatewayPage()` is true while keeping the top-level component and an
   open composer mounted.
5. Update architecture tests that previously required CSS-only page hiding; the
   corrected invariant is that page mode still owns the route, but hidden mode
   performs no heavy task rendering.
6. Extend the perf test so hidden Gateway rows are absent before page entry and
   large task payloads are represented.

## Validation

- Task-list creation-time/reference tests pass.
- Gateway component architecture tests pass.
- Task-list perf test verifies the hidden Gateway does not render task rows in
  panel mode and still renders rows promptly after page entry.
- Overlay typecheck and repository quality gates pass before commit and push.
