# 2026-07-05 Agent Rail Build Hydrate Live Retention

## Recall

User request:

- Fix the overlay regression where the agent rail disappears when execution
  enters `build`, the build message card is not visible, and the user cannot
  inspect current status.

Current objective:

- Keep live `session.status` build rail records visible even when conversation
  hydrate / tail-merge snapshots lag behind the live SSE stream.
- Keep a current live build target message/card attached when the backend
  snapshot includes the session but has not yet caught up with that display
  message.

Acceptance criteria:

- A live build rail record created from `session.status` does not disappear
  just because `hydrateConversationAgentView()` receives an older or empty
  `agentView`.
- If the same session already has a live visible message target, hydrate keeps
  that target unless the current hydrate snapshot provides a newer canonical
  target.
- No fallback rail row, no duplicate session record, no UI-only fake status,
  and no restart / refresh of the running overlay process.

Hard constraints:

- No fallback or compatibility logic.
- No git reset/revert/worktree creation.
- Do not restart, refresh, or kill the running OpenCorvus / overlay.
- Keep task requirements, acceptance criteria, grep evidence, and root-cause
  chain in this record so context compaction cannot shrink scope.

Sources read before implementation:

- `AGENTS.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-01-deleted-goal-conversation-phase-projection.md`
- `specs/records/2026-07/2026-07-05-live-goal-phase-sse-board-projection-repair.md`
- `packages/overlay/src/services/events.ts`
- `packages/overlay/src/services/conversation.ts`
- `packages/overlay/src/services/tree-writer.ts`
- `packages/overlay/src/store/conversation-agents.ts`
- `packages/overlay/src/components/ConversationAgentRail.tsx`
- `packages/overlay/test/conversation-agent-rail-records.test.ts`

Whole-repository search evidence:

- `rg -n "applyLiveConversationAgentSessionStatus|hydrateConversationAgentView|attachConversationAgentViewTargets|mergeLatestConversationTail|selectedConversationAgentSourceKey" packages/overlay/src packages/overlay/test -g "*.ts" -g "*.tsx"`
- `rg -n "renderedCardID|targetMessageID|live session.status creates a rail record|retargets goal-phase|task.messages.changed" packages/overlay/src packages/overlay/test -g "*.ts" -g "*.tsx"`
- `rg -n "goal phase|missing backend board projection|boardSyncPending|task.messages.changed" packages/overlay/src/services packages/overlay/test -g "*.ts"`

Independent agent feedback:

- None for this round. The current fix is local to overlay hydrate/live merge
  semantics and was derived from direct code-path evidence in the workspace.

## Diagnosis

Confirmed causal chain:

1. Live SSE `session.status` creates a rail record immediately through
   `applyLiveConversationAgentSessionStatus()`, even before hydrate catches up.
2. Later, `hydrateConversation()` / `mergeLatestConversationTail()` call
   `hydrateConversationAgentView()` with backend `agentView`.
3. `hydrateConversationAgentView()` currently rebuilds the store only from the
   hydrated snapshot and discards same-source live records that are not yet
   present in that snapshot.
4. If the backend snapshot is older than the live SSE stream, the build rail
   row disappears. If the snapshot includes the session but not the latest
   build message, the row survives but its `targetMessageID/renderedCardID`
   are cleared, so the build card becomes unlocatable.

Why this is the right fix path:

- The problem is not the rail component. It only hides when the store becomes
  empty.
- The problem is not a pure tree-writer render failure either. The live target
  can already exist, then disappear when hydrate rewrites the rail store.
- The fix must therefore make hydrate merge with current same-source live
  records instead of treating a lagging snapshot as a destructive replacement.

## Implementation Plan

1. Teach `hydrateConversationAgentView()` to merge current same-source live
   records into hydrated records instead of replacing them blindly.
2. Preserve an existing projected target for the same session when hydrate has
   not yet supplied a newer canonical target.
3. Add regression tests for:
   - live lifecycle-only build rail surviving an empty/lagging hydrate;
   - live build target surviving a lagging hydrate for the same session.

## Validation

- `bun test packages/overlay/test/conversation-agent-rail-records.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`
