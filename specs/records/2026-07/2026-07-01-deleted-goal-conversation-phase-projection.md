# Deleted Goal Conversation Phase Projection

## Recall

User request:

- Explain and fix the repeated overlay failures shown after selecting task
  `tsk_f17e432c2001tH12z7TjZFKf7M`, including
  `goal phase gol_f18697e4e00ctF0J3KkaMsfidt/build/build missing backend board projection`.
- The user explicitly rejected uncertain conclusions and complained that
  exceptions must not make messages disappear.

Acceptance criteria:

- The task conversation hydrate response must not label a historical build
  message as `goal_phase` unless the same response's board contains the exact
  goal workflow phase projection that the overlay can render.
- Deleted or replaced goal build transcript must stay visible as ordinary
  top-level conversation, without a display `goalID` that forces phase routing.
- A concrete goal phase still requires the current board goal, materialized
  step phase, positive phase start time, and matching `buildSessionID`.
- No frontend fallback card, no swallowed tree-writer invariant, no hidden
  message path, no DB repair, and no process restart.

Hard constraints:

- No fallback or compatibility logic.
- Do not restart, reload, refresh, or kill the running OpenCorvus / overlay.
- Do not mutate the live DB.
- Do not create a new worktree.
- Do not revert unrelated dirty worktree changes.
- Every code change must have targeted tests.

Read before implementation:

- `specs/current/architecture/07-panel-reactivity.md`: goal phase cards are
  backend-declared phase cards, and unknown or impossible card identities must
  remain loud.
- `specs/records/2026-06/2026-06-30-overlay-goal-phase-board-sync-recovery.md`:
  stale live board ordering recovery is valid only while a selected board sync
  is pending; a fresh board missing the phase must stay loud.
- `specs/records/2026-06/2026-06-30-sessionless-goal-completion-phase-projection.md`:
  build phase projection is session-owned.
- `packages/opencorvus/src/conversation/view.ts`: `placementOf()` currently
  checks only the global workflow phase declaration.
- `packages/overlay/src/services/tree-writer.ts`: hydration routes by
  `stage + goalID` and requires an existing board phase card with matching
  `phaseSessionID`.

Whole-repository grep evidence:

- `rg -n "missing backend board projection|boardSyncPending|goal phase|phaseLocation|buildSessionID|goal_phase|taskConversationBoard|projectConversationView|placementOf" packages/opencorvus/src packages/overlay/src packages/opencorvus/test packages/overlay/test specs/records specs/current`
- `rg -n "task.select-from-list|select-from-list|loadTaskConversation|hydrateTaskConversation|conversation view|writeConversation|replaceBoard|setBoardData|loadBoard\\(|routeSSEEvent|projectConversationView" packages/overlay/src packages/overlay/test packages/opencorvus/src/server/routes/orchestrator.ts`
- `rg -n "function rebuildBoardDerivedCards|rebuildBoardDerivedCards|goalPhaseCardID|phaseSessionID|buildSessionID" packages/overlay/src/services/tree-writer.ts packages/overlay/test/tree-writer-hierarchy.test.ts packages/opencorvus/test/server/conversation-view.test.ts`

Live DB and API evidence:

- `engine_task.id=tsk_f17e432c2001tH12z7TjZFKf7M` is completed with
  `error="task cancelled"`.
- `session.id=ses_0e6c28c20ffeW4Y7rqIaNCqwhU` is a build session with
  `goal_id=gol_f18697e4e00ctF0J3KkaMsfidt`.
- `engine_goal` no longer contains `gol_f18697e4e00ctF0J3KkaMsfidt`; the task
  contains replacement goal `gol_f19452272001ACh7DkjO7llakn`.
- Live `/task/tsk_f17e432c2001tH12z7TjZFKf7M/conversation?tail_limit=80`
  returned a board without the deleted goal, while `view.messages` still
  contained eight `placement="goal_phase"` rows for the deleted goal.

Independent agent feedback:

- No sub-agent was spawned for this record. The current user request asked for
  immediate diagnosis and repair; the evidence above comes from direct source,
  DB, and API inspection.

## Decision

`projectConversationView()` must project display ownership from the current
board, not from a persisted transcript `goalID` alone.

A persisted message can keep its raw transcript metadata in `transcript`, but
the display `view` must only carry `goalID` and `placement="goal_phase"` when
the current board can render the same goal phase. For deleted/replaced goals,
there is no current board owner, so the message remains visible as an ordinary
top-level session and the display `goalID` is omitted to prevent the overlay
from resolving a nonexistent phase card.

## Implementation Plan

1. Replace global `phaseLocation(board, stage)` placement with concrete
   `goalPhaseLocation(board, stage, goalID, sessionID)`.
2. Require:
   - matching `board.goalWorkflows[].goalID`;
   - matching goal step phase declared by `board.workflow.steps`;
   - materialized phase entry with positive `startedAt`;
   - matching `step.payload.buildSessionID` for the build phase.
3. Emit display `goalID` only for `goal_phase` rows.
4. Update server projection tests for:
   - valid goal phase still projects;
   - deleted goal build transcript becomes top-level and visible;
   - mismatched build owner does not project as goal phase.
5. Run focused tests and docs health checks.

## Validation Plan

- `bun test packages/opencorvus/test/server/conversation-view.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
