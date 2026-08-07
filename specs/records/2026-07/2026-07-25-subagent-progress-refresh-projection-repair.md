# 2026-07-25 Sub-agent Progress Refresh Projection Repair

## Recall

### User request and observed evidence

- The user reported that one active Task first showed complete cards, then
  temporarily rendered child-agent messages as scattered ordinary cards, and
  after refresh retained only compact cards whose bodies said
  `Waiting for activity...`.
- The supplied Task was
  `tsk_f98043840001cqEeODYdBWjJg3`, rooted at
  `ses_067fbc655ffeRyIdCoFqMv0wpr`.
- The first screenshot showed completed child sessions retaining identity and
  status but losing real activity rows. The second screenshot showed repeated
  `mirror-prd-competitor-scout` turns as ordinary cards instead of one stable
  card per child `sessionID`.
- Read-only live route evidence proved that six old completed child sessions
  had zero messages in the global hydrate window while their exact
  `/task/:taskID/conversation/session/:sessionID` routes still returned 8–50
  messages and 44–202 Tool parts. Persisted data was intact.
- The user then required a complete root-cause repair.

### Acceptance criteria

- Initial Task selection, live streaming, scheduled tail reconciliation, and
  manual refresh expose the same session-level child progress cards.
- A child session never appears as scattered ordinary message cards while its
  identity projection is being established.
- Every persisted child session keeps a bounded truthful activity list after
  refresh even when its full transcript is outside the main conversation
  window.
- Main Orchestrator/user cards receive a protected bounded transcript lane and
  cannot be evicted merely because child agents emitted many messages.
- Child progress cards, Agent Rail, the inner `Squad agents` selector, and the
  full Right Dock transcript retain the exact same canonical `sessionID`.
- Lifecycle-only child sessions remain visible without invented activity.
- Full child transcripts continue to load only through the existing exact
  session route; the progress projection is not a second transcript.
- A real Node-launched Vite page must visibly survive a simulated truncated
  refresh without scattered rows, empty completed cards, or loss of the
  Orchestrator card.

### Hard constraints

- Preserve all parallel tracked and untracked work. In particular, do not
  overwrite the in-progress `Squad agents` inner-tab changes already present
  in `SubagentConversationPanel.tsx`, `main.tsx`, localization, inspector CSS,
  the Vite fixture, or the earlier Sub-agent record.
- Do not reset, restore, stash, create a worktree, or broadly stage files.
- Do not restart, refresh, close, or otherwise interfere with the currently
  running OpenCorvus/Overlay process.
- Use Node, not Bun, for Playwright/browser execution.
- Keep the persisted message/session tables and exact session transcript route
  as the only durable sources. Do not add local-storage state, a loading gate,
  a hidden/synthetic message, a compatibility fallback, or another transcript
  store.
- Keep the global Task message budget for unrelated transcript payloads; do
  not solve the defect by raising `80` or returning every child transcript.
- Use the `dsw-33987` commit prefix and push the reviewed commit only to
  `legacy-remote`.

### Sources read

- `AGENTS.md` and the Browser control skill.
- Both supplied screenshots and the Task debug payload.
- `specs/current/architecture/07-panel.md`.
- `specs/current/architecture/07-panel-reactivity.md`.
- `specs/current/architecture/12-overlay-card-system.md`.
- `specs/records/2026-07/2026-07-25-subagent-progress-grid-and-conversation-dock.md`.
- `packages/opencorvus/src/conversation/view.ts`.
- `packages/opencorvus/src/engine/model.ts`.
- `packages/opencorvus/src/server/routes/orchestrator.ts`.
- `packages/opencorvus/src/server/routes/session.ts`.
- `packages/opencorvus/src/session/message-store.ts`.
- `packages/opencorvus/src/session/message.ts`.
- `packages/transport-protocol/src/index.ts`.
- `packages/overlay/src/store/card-tree.ts`.
- `packages/overlay/src/store/conversation-agents.ts`.
- `packages/overlay/src/services/conversation.ts`.
- `packages/overlay/src/services/events.ts`.
- `packages/overlay/src/services/tree-writer.ts`.
- `packages/overlay/src/components/Conversation.tsx`.
- `packages/overlay/src/components/SubagentProgressGrid.tsx`.
- `packages/overlay/src/utils/subagent-presentation.ts`.
- Focused server, projection, hydrate, event, and real-browser tests.

### Whole-repository grep

- `rg -n "SubagentProgressGrid|subagentProgressEvents|buildSubagentConversationItems|conversationAgentRecordsForSource" packages/overlay/src packages/overlay/test specs`
- `rg -n "hydrateConversationAgentView|applyLiveConversationAgent|agentView" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test packages/sdk`
- `rg -n "TaskConversationHydration|TaskConversationSessionView|projectConversationAgentView|ConversationSessionView" packages/opencorvus/src packages/opencorvus/test packages/sdk`
- `rg -n "loadTaskTranscript|loadFullTaskTranscript|latestAcrossSessions|tail_limit|tailLimit" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test packages/sdk`
- `rg -n "messagePartHasDisplayContent|conversationPartHasDisplay|isConversationDisplayMessagePartType|describeToolPart" packages`
- `rg -n "parentSessionID" packages/overlay/src/store packages/overlay/src/services packages/overlay/test`

### Independent agent feedback

- None. The user did not request delegation. The primary Agent owns the
  implementation, visual review, and second diff review.

## Causal chain

1. The main Task hydrate calls `latestAcrossSessions` with a single global
   eighty-message budget. Increasing child activity therefore ejects older
   Orchestrator and child messages from the same payload. Full route tests
   additionally proved that a visible Orchestrator session can be a child of
   the physical Task root, so protecting only `task.session_id` is invalid.
2. `projectConversationAgentView` independently reconstructs every child
   identity from the durable session ledger, so old sessions remain in
   `conversationAgentStore` even when their message parts are absent from
   `cardTreeStore`.
3. `SubagentProgressGrid` reads identity/status from the first store but reads
   progress rows from the second. Missing historical parts therefore produce
   an empty activity array and the misleading waiting copy.
4. `buildSubagentConversationItems` explicitly renders every ordinary message
   card when the child-session records are temporarily absent. Once records
   arrive, the same rows are removed and replaced by the grid. This creates
   the visible scattered intermediate state.
5. The existing tests prove each isolated state with populated fixtures but do
   not execute the cross-session budget plus refresh transition.

## Single-source repair

The conversation-agent projection becomes the complete bounded progress-card
source: identity, lifecycle, input preview, and a small ordered list of
persisted activity facts. The activity facts are projections of real
Text/Tool/Patch/File/error parts, not messages and not a transcript copy.

The Task main transcript retains its existing task-tree semantics, because
full route tests proved that visible Orchestrator messages may live in an
`orchestrator` child execution session rather than the physical Task
`session_id`. Hydration therefore merges one bounded all-session tail with a
separately bounded primary lane for the durable `root` and `orchestrator`
sessions. Both lanes read the same persisted message table and are deduplicated
by message ID; this is one projection with a reserved primary budget, not a
second transcript source. Child volume can no longer evict Orchestrator/user
cards. Older history keeps the existing task-tree scope. Full child content
remains owned by the exact child-session route.

Live message/part observation upserts the canonical session record rather than
waiting for a later lifecycle hydrate. Initial and tail hydration apply the
agent view before writing main transcript cards. `CardNode` retains the
backend-projected `parentSessionID`; encountering a child-owned ordinary card
without its canonical agent record becomes a loud projection error rather than
the retired scattered-card fallback.

## Exhaustive call-site disposition

| Owner / call site                                           | Disposition                                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `transport-protocol` conversation part contract             | Add one shared bounded activity-part projection and limit used by server and Overlay.                                                                                    |
| `MessageStore.latestAcrossSessions`                         | Preserve for consumers that need a global message tail; Task main hydration stops using it for child progress.                                                           |
| New `MessageStore.latestConversationAgentActivityBySession` | Query only the latest supported real parts per session through the existing session/time index.                                                                          |
| `ConversationSessionView` / `TaskConversationSessionView`   | Add required bounded `activity` and optional durable lifecycle error fields.                                                                                             |
| `projectConversationAgentView`                              | Own activity/error attachment for ledger, transcript, task hydrate, standalone hydrate, and tests.                                                                       |
| Task `GET /conversation`                                    | Hydrate the bounded task-tree tail plus a protected root/Orchestrator lane and the all-session bounded activity projection.                                              |
| Task `GET /conversation/history`                            | Preserve task-tree history paging; exact child loading still uses the session route when selected directly.                                                              |
| Task exact child-session route                              | Preserve full transcript behavior unchanged.                                                                                                                             |
| `conversation-agents.ts` hydrate                            | Store activity/error on the canonical record and merge live/hydrated facts by activity `orderKey`.                                                                       |
| `conversation-agents.ts` live message/part/status           | Upsert the session record from canonical event metadata and update its bounded activity/status without waiting for a second event family.                                |
| `conversation.ts` initial hydrate / tail merge              | Apply the agent projection before adding root transcript cards.                                                                                                          |
| `CardNode` / `tree-writer.ts`                               | Preserve the exact backend `parentSessionID` on message cards so projection ownership can be checked without labels or role guessing.                                    |
| `subagent-presentation.ts`                                  | Read progress exclusively from `AgentActivityRecord.activity`; delete the ordinary-card fallback for child-owned rows.                                                   |
| `SubagentProgressGrid.tsx`                                  | Render the record activity directly and reserve waiting copy only for genuinely message-less pending/running sessions.                                                   |
| Agent Rail and Right Dock transcript                        | Preserve exact `sessionID` routing and current parallel `Squad agents` work unchanged.                                                                                   |
| Generated OpenAPI/SDK                                       | Regenerate from the new required activity contract.                                                                                                                      |
| Server/unit/browser tests                                   | Cover cross-session starvation, root-scope pagination, hydrate/live convergence, no scattered fallback, lifecycle-only sessions, and the real visual refresh transition. |

## Verification plan

1. Add failing server tests for a root message followed by more than eighty
   child messages and for bounded per-session activity.
2. Add failing Overlay tests proving that hydrated activity renders without
   child cards in `cardTreeStore`, and that a child-owned ordinary row without
   a canonical record is rejected.
3. Add live message-first/part-first tests proving one stable session record.
4. Run focused server, projection, hydrate, store, and browser suites.
5. Run Overlay and OpenCorvus typechecks, OpenAPI route checks, documentation
   checks, historical links, and document health.
6. Run the isolated Vite fixture through Node, capture the repaired refresh
   state, inspect the screenshot, and repeat after any visual mismatch.
7. Review the complete diff against this Recall, verify parallel diffs remain,
   commit only task-owned hunks, fetch/reconcile `legacy-remote`, and push with normal
   hooks.
