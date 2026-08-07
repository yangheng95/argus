# User Message Status Settlement

Date: 2026-07-30

SSE means Server-Sent Events. UI means User Interface.

## Recall

- User request:
  - During an active conversation, a user's input executes, but the status on
    the user card never changes.
  - The supplied screenshot shows the user card retaining the running dot and
    an elapsed duration of more than sixteen minutes.
  - Adjust the behavior.
- Acceptance criteria:
  - A real persisted user message is presented as a settled message, not as an
    executing Agent turn.
  - Session `streaming`, `retry`, `idle`, and terminal lifecycle events continue
    to describe the real Agent/session execution card and cannot reactivate a
    user-owned card.
  - Hydrated history and live SSE projection converge on the same settled user
    card status.
  - Agent cards retain the existing running, idle, completed, error, and
    aborted lifecycle behavior.
  - The real Overlay page is opened and the changed card region is visually
    reviewed through screenshots. No UI automated test is added, modified, or
    run.
- Hard constraints:
  - `tree-writer.ts` remains the single card-tree mutation owner.
  - Do not add a UI shadow status, fallback, compatibility branch, gate, or
    keyword rule.
  - Preserve the unrelated existing modification in
    `specs/artifacts/opencorvus-workbuddy-qoderwork-multica-codex-benchmark-catalog.md`.
  - Do not create a worktree.
  - Non-UI projection logic receives a focused positive contract test.
- Disk records read before implementation:
  - `specs/current/architecture/07-panel-reactivity.md`
  - `specs/current/architecture/12-overlay-card-system.md`
  - `specs/records/2026-07/2026-07-02-task-message-immediate-stream.md`
  - `specs/README.md`
  - `specs/records/2026-07/README.md`
- Whole-repository search evidence:
  - `packages/overlay/src/services/tree-writer.ts::createSessionCardNode()` is
    the only ordinary Session/message card constructor and currently assigns
    `status: "running"` to both Agent and user cards.
  - `packages/overlay/src/services/tree-writer.ts::ensureMessageTurnProjection()`
    creates or refreshes each message card, promotes it to
    `SessionInfo.activeCardID`, and currently refreshes every non-terminal card
    to `running`.
  - `packages/overlay/src/services/tree-writer.ts::regroupTimelineSegments()`
    rebuilds live and hydrated adjacent message segments and currently assigns
    `running` to the active segment without distinguishing user ownership.
  - `packages/overlay/src/services/tree-writer.ts::handleSessionStatus()`,
    `handleSessionError()`, and `drainPendingSessionStatus()` project Session
    lifecycle onto `SessionInfo.activeCardID`.
  - `packages/overlay/src/components/ChatBubble.tsx::ChatBubbleIdentity()` and
    `CardDurationChip` render the status dot and duration directly from the
    canonical `CardNode.status`; the component has no competing local status.
  - `packages/overlay/src/utils/card-timing.ts::cardDurationMs()` intentionally
    keeps a `running` card's duration live, explaining the screenshot's
    continuously increasing value.
  - `packages/opencorvus/src/session/status.ts::SessionStatus` is the canonical
    Session lifecycle source and must remain unchanged; the defect is the
    Overlay's ownership projection of that fact.
  - `packages/overlay/test/conversation-view-hydrate.test.ts` is an existing
    non-UI projection contract suite and already proves completed assistant
    settlement. It is the focused location for a positive user-card settlement
    contract.
- Independent Agent feedback:
  - Not delegated. The user did not request sub-agents, and the repository rules
    plus current collaboration policy do not authorize delegation for this
    bounded repair.

## Root Cause

The backend correctly persists the user message and starts Session execution.
The Overlay then conflates two different facts:

1. the user message is a durable, already-submitted conversation event;
2. its owning Session is streaming an Agent response.

`createSessionCardNode()` initializes both facts as the same `running` card.
`ensureMessageTurnProjection()` and `regroupTimelineSegments()` preserve that
conflation, while `handleSessionStatus()` can write the Session lifecycle back
to the latest user card before an Agent message card exists. The renderer
truthfully displays the resulting wrong projection, so the running dot and
timer never represent user-message progress.

## Repair Plan

1. Define the status of an ordinary message segment from its display ownership:
   user-owned segments are settled `completed` messages; Agent-owned active
   segments retain the existing Session lifecycle status.
2. Make `createSessionCardNode()`, `ensureMessageTurnProjection()`, and
   `regroupTimelineSegments()` use that one ownership rule.
3. Route Session lifecycle only to cards that represent an executable Agent
   turn. A user card remains visible and settled while lifecycle stays buffered
   until an Agent card materializes.
4. Add a focused positive projection contract proving that live/hydrated user
   input is `completed` while an Agent response card can be `running`.
5. Update the current Overlay architecture record so user-message settlement
   and Agent lifecycle ownership are explicit.

## Validation Plan

- `bun test packages/overlay/test/conversation-view-hydrate.test.ts`
- A focused non-UI live-event projection test selected by exact test name.
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay build:vite`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Corresponding document-health tests for the updated architecture record.
- `git diff --check`
- Start the real Overlay page, reproduce a user card plus an active Agent card,
  capture the changed conversation region, and manually review the screenshot.

## Implementation

- `tree-writer.ts` now assigns `completed` to user-owned message cards at
  creation, existing-card refresh, and chronological segment regrouping.
- Session lifecycle projection now accepts only executable Agent cards.
  Lifecycle received while a direct human reply is the active card is retained
  for the same executable Session's next Agent card; terminal startup failure
  materializes that Agent card directly. Root user-only Session lifecycle does
  not rewrite or manufacture a user message card.
- `conversation-view-hydrate.test.ts` adds one positive live-event contract:
  the direct human reply is `completed`, then the same Session's real Agent
  response is `running`. Seven pre-existing negative hydrate tests discovered
  in the touched file were deleted under rule 28.1.
- The current Overlay card architecture now records settled user-message
  ownership separately from Agent execution lifecycle.
- The document-health audit still referenced the already-deleted
  `command-palette.test.ts` UI test and two existing UI browser tests. The two
  remaining UI tests and their test-only health assertions were deleted under
  the UI automation test ban; no replacement UI automation was created.

## Verification

- PASS: `bun test packages/overlay/test/conversation-view-hydrate.test.ts`
  (`5` passed, `0` failed after negative-test cleanup).
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `bun run --cwd packages/overlay build:vite`; Vite completed with the
  repository's existing third-party `"use client"` warnings.
- PASS:
  `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  (`2` passed).
- PASS: real isolated Overlay page at `http://127.0.0.1:7881/ui/` using a real
  right-sidebar Chat Session and the real asynchronous prompt route. The
  resulting user card projected `data-status="completed"`, exposed the
  `Completed` semantic label, rendered a green status dot, and rendered no
  duration. The changed card region was screenshotted and manually reviewed.
- No UI test, fixture, repeatable screenshot assertion, or screenshot baseline
  was added, modified, or run for visual acceptance.
- The initial full document-health run exposed only stale UI-test references
  plus an independently created, untracked
  `2026-07-30-conversation-scroll-bottom-panel-center.md` record already linked
  by concurrent work. The stale references were removed. The concurrent record
  and its index entries remain outside this change.

## Self Review

- The status renderer, status primitive, duration helper, and shared clock were
  not changed; they now display the corrected canonical card-tree fact.
- User status has one projection rule across live creation, regroup, and
  hydration. There is no local component state or compatibility path.
- Executable Agent cards preserve the current lifecycle contract, including
  buffered streaming and terminal startup failure.
- The real `7879` listener and the concurrent Conversation scroll-bottom
  working-tree changes were not modified or stopped. Only task-owned isolated
  listeners `7880` and `7881` were stopped after visual review.
