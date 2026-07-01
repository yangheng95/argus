# Overlay Goal Phase Board Sync Recovery

## Recall

User request:

- Diagnose and fix the overlay render failure:
  `goal phase gol_f17833453001LuJkRv3EAq70jE/build/build missing backend board projection`.
- The user rejected uncertain conclusions and requested independent agent review before repair.

Acceptance criteria:

- A goal-owned build `message.part.updated` that arrives after `goal_run.updated`
  but before the debounced board projection must not crash the overlay.
- The repair must use the backend board projection as the single source.
- No temporary phase card, no top-level message relocation, no swallowed error,
  no hidden fallback, and no backend synthetic phase event.
- If a fresh board projection still lacks the goal phase, the original writer
  invariant must remain loud.
- Owner mismatch, session kind mismatch, missing backend build-session owner, and
  missing `buildSessionID` must not be classified as recoverable stale projection.
- Add focused overlay tests for the event/recovery path.

Hard constraints:

- No fallback or compatibility logic.
- Do not restart, reload, refresh, or kill the running OpenCorvus / overlay.
- Do not create a new worktree.
- Do not revert unrelated dirty worktree changes.
- Preserve `tree-writer.ts` as the only writer for `cardTreeStore`.
- Keep `tree-writer` fail-fast behavior for direct impossible projections.

Read before implementation:

- `specs/current/architecture/07-panel-reactivity.md`: `tree-writer.ts` is the
  only rendered card-tree writer; SSE ordering may be temporarily incomplete
  but must converge through the same projection source.
- `specs/records/2026-06/2026-06-02-overlay-card-projection-fragility-audit.md`:
  non-reconstructable message stream prerequisite failures should recover by
  replaying from the selected stream cursor, not by reconstructing local state.
- `packages/overlay/src/services/events.ts`: message stream events are written
  immediately; selected-task recovery currently catches only unknown
  session/message/part prerequisite failures.
- `packages/overlay/src/store/board.ts`: `loadBoard({ requireFresh: true })`
  forces a post-boundary selected-task board request and rejects on failure.
- `packages/overlay/src/services/selected-task-recovery.ts`: selected-task
  recovery restarts the task SSE from the current sequence/live cursor.
- `packages/overlay/src/services/tree-writer.ts`: missing backend board phase
  projection throws before creating any phase stub.
- `packages/overlay/test/events-refresh.test.ts` and
  `packages/overlay/test/selected-task-recovery.test.ts`: existing tests cover
  selected message prerequisite recovery and selected stream cursor behavior.

Whole-repository grep evidence:

- `rg -n "missing backend board projection|isMessageWriterPrerequisiteError|recoverSelectedTaskConversation|loadBoard\\(|boardSyncPending|scheduleBoard|goal_run.updated|selected-task recovery" packages/overlay/src packages/overlay/test specs/records/2026-06 specs/current/architecture -S`
- `rg -n "goal_run.updated|goal_run_attempt|time_started=now|Emit goal_run.updated|beginBuildAttempt" packages/opencorvus/src/engine/persist.ts packages/opencorvus/src/engine/workflow.ts packages/opencorvus/src/workbench/board.ts -S`

Independent agent feedback:

- Volta confirmed the overlay route: `goal_run.updated` is board-invalidating,
  board refresh is debounced by 500 ms, and `message.part.updated` writes to
  tree immediately. The observed image part arrived 134 ms after
  `goal_run.updated`.
- Averroes confirmed backend facts: `goal_run_attempt` already had
  `session_id=ses_0e87c6be6ffezlcu5L25zsY5mz` and
  `time_started=1782805926991`; current board projects the build phase and
  `buildSessionID`.
- Franklin confirmed the repair boundary: recover only through a fresh board
  projection when there is an existing pending board sync fact; fresh board
  failure or still-missing projection must stay loud.

## Decision

The root cause is a frontend causal ordering gap. Backend facts are present,
but the selected overlay can process a goal build message before the debounced
board projection creates the phase card.

The fix belongs in the overlay event/recovery layer. A message writer failure
with the exact `missing backend board projection` shape is recoverable only
when `boardStore.boardSyncPending` proves a selected board refresh is already
owed. Recovery first performs `loadBoard({ sync: true, requireFresh: true })`,
then restarts the selected task SSE without consuming the failed live event.
After the fresh projection, the same tree-writer invariant remains authoritative.

## Implementation Plan

1. Add a narrow message-writer recovery classifier in `events.ts`:
   - existing unknown session/message/part prerequisites keep existing recovery;
   - exact `goal phase ... missing backend board projection` recovers only when
     `boardStore.boardSyncPending === true`;
   - other goal phase errors still throw.
2. Extend selected-task recovery with an optional `requireFreshBoard` flag that
   runs `loadBoard({ sync: true, requireFresh: true })` before replaying.
3. Add event-layer tests for:
   - stale goal phase board projection triggers require-fresh board recovery and
     does not advance cursors;
   - fresh-board path issues the selected board request before reopening SSE;
   - owner/session-kind/build-session-owner errors remain non-recoverable.
4. Run focused overlay tests.

## Validation Plan

- `bun test packages/overlay/test/events-refresh.test.ts packages/overlay/test/selected-task-recovery.test.ts packages/overlay/test/tree-writer-hierarchy.test.ts`
