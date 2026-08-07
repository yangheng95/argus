# 2026-07-05 Live Goal-Phase SSE Board Projection Repair

## Recall

User request:

- Fix the selected-task SSE/render failure surfaced as
  `goal phase <goalID>/build/build missing backend board projection`.
- Keep the overlay live conversation visible instead of letting stale
  `goalID` routing turn into a render exception.

Current objective:

- Make live selected-task message routing use the same current-board
  phase-ownership contract that hydrate already uses.
- Keep true board projection bugs loud while stopping deleted/stale-owner
  build messages from being misrouted into nonexistent phase cards.
- Preserve fresh-board recovery for genuinely stale selected boards.

Acceptance criteria:

- Live `message.updated` / `message.part.updated` only route as `goal_phase`
  when the current board proves the same `goalID + stage + sessionID`
  ownership.
- Deleted/replaced goal build output and stale-owner build output stay visible
  as ordinary top-level conversation instead of throwing
  `missing backend board projection`.
- When selected-board sync is pending and the board cannot yet prove the
  phase owner, the existing fresh-board recovery path still triggers.
- If the current board does prove the phase owner but the derived phase card is
  still missing, the invariant stays loud.
- No fallback card, no swallowed error path, no process restart, and no
  backend dual-source workflow authority.

Hard constraints:

- No fallback or compatibility logic.
- No git reset/revert/worktree creation.
- Do not restart, refresh, or kill the running OpenCorvus / overlay.
- Keep requirements, acceptance criteria, grep evidence, and independent agent
  feedback in this record so context compaction does not shrink scope.

Sources read before implementation:

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-01-deleted-goal-conversation-phase-projection.md`
- `specs/records/2026-07/2026-07-05-goal-progress-overlay-workflow-selection-repair.md`
- `specs/records/2026-06/2026-06-30-overlay-goal-phase-board-sync-recovery.md`
- `packages/opencorvus/src/conversation/view.ts`
- `packages/opencorvus/test/server/conversation-view.test.ts`
- `packages/overlay/src/services/tree-writer.ts`
- `packages/overlay/src/services/events.ts`
- `packages/overlay/src/services/selected-task-recovery.ts`
- `packages/overlay/src/store/board.ts`
- `packages/overlay/test/tree-writer-hierarchy.test.ts`
- `packages/overlay/test/events-refresh.test.ts`

Whole-repository search evidence:

- `rg -n "missing backend board projection|goal phase|goal_phase|buildSessionID|boardSyncPending|projectConversationView|resolveGoalStagePhase|isPhaseAbsorbedSession|renderedConversationCardTargetForGoalPhase" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test`
- `rg -n "workflow\\.selected|goal_run\\.updated|taskSequence|sequence gap|scheduleBoard|recoverSelectedTaskConversation" packages/overlay/src packages/overlay/test packages/opencorvus/src -g "*.ts"`
- `rg -n "renderedConversationCardTargetForGoalPhase|conversation-agent-rail|phase owner mismatch|stale owner" packages/overlay/src packages/overlay/test -g "*.ts"`

Independent agent feedback:

- Read-only explorer `Darwin` independently audited the same failure and
  confirmed:
  - tree-writer only renders a goal build session on an existing phase card;
  - board-sync recovery only auto-refreshes when the exact projection error is
    seen under `boardSyncPending=true`;
  - `workflow.selected` remains the backend single authority for workflow
    boards, but the current direct-start regression is already fixed and cannot
    be re-assumed without new evidence;
  - the live-path mismatch between raw `goalID` and current board ownership is
    still a credible render-path root cause.

## Diagnosis

Confirmed causal chain:

1. Historical hydrate already projects display ownership from the current
   board. `projectConversationView()` strips `goalID` for deleted goals and
   stale build owners, keeping those messages top-level.
2. Live tree-writer still treats any build-session `goalID` as a direct phase
   claim. It does not first ask whether the current board still proves the same
   `sessionID` owns that goal phase.
3. Because of that mismatch, live stale-owner or deleted-goal build events can
   still call `resolveTurnCardID()` and throw
   `goal phase ... missing backend board projection`, even though the hydrate
   contract already says those messages should remain top-level.
4. The existing recovery path is still valid for a different case: when a
   selected board refresh is already pending and the board may simply be stale.
   In that case the live event should keep the phase claim loud long enough to
   trigger `requireFreshBoard=true`.

Why this is the right fix path:

- It preserves the current-board single source already established by the
- 2026-07-01 hydrate repair instead of inventing a frontend fallback card.
- It keeps true board/projection bugs loud.
- It explains why the user can see both SSE trouble and a render exception:
  the stream keeps delivering the event, but live projection still uses a stale
  routing assumption that hydrate no longer uses.

## Implementation Plan

1. Add a tree-writer helper that classifies live goal-phase routing as:
   - `goal_phase` when the current board proves the same session owner;
   - `top_level` when the current board disproves phase ownership;
   - `await_board` when board sync is pending and the board cannot yet prove
     or disprove the phase.
2. Use that helper for live message, part-first, lifecycle, hierarchy, and
   rendered-target phase routing so stale owner / deleted goal no longer throw.
3. Update tree-writer and SSE refresh tests to cover:
   - deleted goal live message becomes top-level;
   - stale owner live message becomes top-level;
   - pending board sync still triggers fresh-board recovery;
   - true missing phase projection stays loud once the current board proves the
     owner.

## Validation

- `bun test packages/overlay/test/tree-writer-hierarchy.test.ts packages/overlay/test/events-refresh.test.ts packages/overlay/test/conversation-agent-rail-records.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
