# Overlay Scroll Follow-Lock Generation Plan

> Date: 2026-05-15
> Status: implementation plan

## Recall

- `specs/new-arch/2026-05-14-conversation-scroll-follow-lock.md` defines the
  operator contract: while the operator scrolls up, content growth must not
  force bottom-follow.
- `specs/new-arch/2026-05-14-overlay-refresh-single-source-plan.md` defines the
  recovery contract: selected-task recovery and hydrate replace the visible
  conversation tree through `cardTreeStore`, not through a legacy message
  mirror.
- `specs/new-arch/2026-05-15-overlay-scroll-single-source-plan.md` moved
  follow-to-bottom onto `cardTreeStore.visibleVersion`, but did not define the
  lifetime boundary of the follow-lock state itself.

## Full Call-Site Audit

### Persistent conversation mounts

- `packages/overlay/src/main.tsx:651` mounts `<Conversation container={chatScroll} />`
  once into the panel's persistent `#chatScroll` host.
- `packages/overlay/src/components/TaskDetailOverlay.tsx:104` mounts
  `<Conversation container={host()!} />` in the task detail overlay.

### Follow-lock owner

- `packages/overlay/src/components/Conversation.tsx:49-115`
  owns `tracking` locally and only re-arms it from `onAtBottom`.
- `packages/overlay/src/components/Conversation.tsx:110-113`
  drives follow-scroll only from `cardTreeStore.visibleVersion`.

### Whole-tree replacement boundaries

- `packages/overlay/src/services/task.ts:238`
  calls `resetWriter()` during selected-task switch.
- `packages/overlay/src/services/conversation.ts:168`
  calls `resetWriter()` at the start of `hydrateTaskConversation()`.
- `packages/overlay/src/services/selected-task-recovery.ts:38`
  re-enters `hydrateTaskConversation()` during sequence-gap / replay-expired
  recovery for the currently selected task.

### Tree reset primitive

- `packages/overlay/src/services/tree-writer.ts:171-195`
  clears `cardTreeStore.order` and `cardTreeStore.cards`, then only bumps
  `visibleVersion`.

## Confirmed Root Cause

The bug is a lifetime mismatch:

1. `Conversation` stores follow-lock (`tracking`) for the lifetime of the
   component instance.
2. The panel conversation component in `main.tsx` is persistent; it does not
   remount on task switch or selected-task recovery.
3. `resetWriter()` replaces the whole visible conversation tree, but there is
   no explicit signal saying "the previous transcript instance is gone."
4. If the operator had previously scrolled up, `tracking=false` survives into
   the next transcript generation.
5. During recovery/task switch, `resetWriter()` clears the DOM-backed content;
   the browser clamps the container to the top while content is empty.
6. When the new transcript hydrates, `contentChanged()` refuses to follow
   because `tracking` still belongs to the old transcript generation.

This is why the scrollbar "often jumps to the top instead of following the
bottom": the view is being replaced, but follow-lock is scoped to component
lifetime rather than transcript lifetime.

## Rejected Fixes

### Rejected: infer reset from `selectedTaskID`

This misses same-task recovery (`task.replay_expired`, sequence gap,
reconnect hydrate), where the selected task is unchanged but the transcript is
fully replaced.

### Rejected: infer reset from empty DOM / `order.length === 0`

This is heuristic and wrong for legitimate empty conversations, rewind/prune,
or future UI states that intentionally clear visible cards without replacing
the transcript instance.

### Rejected: force scroll in `setupAutoScroll()` when `scrollTop===0`

That hides the real boundary bug behind DOM heuristics and violates the single
source rule. The scroll utility should not guess transcript lifetime.

## Design

Add an explicit card-tree replacement generation:

1. `cardTreeStore` gains `treeEpoch`, a monotonic counter that increments only
   when the whole visible conversation tree is replaced.
2. `resetWriter()` increments `treeEpoch` alongside the existing visible
   mutation signal.
3. `Conversation` keys follow-lock reset to `treeEpoch`, not to task id, DOM
   emptiness, or scroll position heuristics.
4. On `treeEpoch` change, `Conversation`:
   - re-arms follow-lock (`tracking=true`);
   - performs an explicit controller-owned `scrollToBottom()` sync so the new
     transcript generation starts in follow mode.

This keeps responsibilities single-source:

- `visibleVersion` answers "did visible content change within this transcript?"
- `treeEpoch` answers "is this a new transcript generation?"

## Requirements

1. Manual upward scroll still disables follow-lock within the current
   transcript generation.
2. Whole-tree replacement always invalidates prior manual-scroll intent.
3. Same-task recovery and task switch use the same reset boundary.
4. Rewind/prune does not falsely count as a transcript replacement.
5. No DOM heuristics or fallback branching are introduced.

## Validation

- Add store tests proving `resetWriter()` advances `treeEpoch`.
- Add auto-scroll regression coverage for:
  - scroll up => `tracking=false`
  - transcript replacement => follow-lock re-armed
  - new content after replacement => scroll returns to bottom
- Add a static guard that `Conversation.tsx` listens to `cardTreeStore.treeEpoch`.
