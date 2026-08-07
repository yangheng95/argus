# Conversation Turn Artifact Projection Repair

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Restore the Chat/Mission turn-end Artifact overview systematically. Because the replacement can disturb the existing terminal Task surface, implement it in a new worktree and do not merge it back to the main worktree automatically. |
| Acceptance criteria | A completed Task attaches its exact completion-decision deliverables to the real assistant message that completed it. A Mission child-result Turn attaches that child Task's exact deliverables to the real Mission assistant Turn. Standalone Chat remains truthful: without Task authority it shows only its existing Session file changes and never invents a Task Artifact catalog. Failed and cancelled child Tasks expose their real outcome. Hydration and live idle refresh converge on the same projection. |
| Hard constraints | Work only in `/Users/yangheng/Desktop/opencorvus-conversation-turn-artifacts` on `codex/conversation-turn-artifacts`; do not alter, restart, or refresh the running production Overlay; do not merge into the main worktree; preserve the Task Artifact Catalog and immutable completion decision as the only authorities; add no state machine, fallback, synthetic message, title matching, time-window ownership, or second Artifact index; do not add, modify, or run User Interface automated tests; use Node for browser interaction and personally inspect current screenshots. |
| Sources read | `AGENTS.md`; `specs/current/architecture/02-data.md`; `07-panel-reactivity.md`; `12-overlay-card-system.md`; `15-agent-facts-and-turns.md`; the 2026-07-28 terminal Artifact and deliverable-correction records; the 2026-08-01 conversation Artifact event-routing record; `conversation/view.ts`; `session/message.ts`; `session/lifecycle.ts`; `task-api/index.ts`; `engine/completion-decision.ts`; `artifact-catalog/index.ts`; `plugin/artifact-producer.ts`; `server/routes/session.ts`; `server/routes/orchestrator.ts`; `overlay/services/conversation.ts`; `tree-writer.ts`; `card-tree.ts`; `Conversation.tsx`; `ConversationArtifactSummary.tsx`; and `conversation-artifacts.ts`. |
| Whole-repository grep | Searches covered every `ConversationArtifactSummary`, `conversationDeliverableArtifacts`, `task/:taskID/artifacts`, `completionDecision`, `deliverableArtifactLocators`, `ArtifactProducer`, `producer_session_ids`, `mission.child_task_result`, `wake_reason`, `projectConversationView`, `prepareConversationView`, `commitPreparedConversationView`, `session.idle`, and generated API/doc reference. The exact dispositions are below. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |

## Evidence and root cause

1. The existing component is still mounted once after the entire virtualized
   timeline. It is not owned by a real message Turn.
2. A standalone Session becomes `idle` after every physical Turn, but
   `taskCatalogScope()` still requires `activeTaskID` and
   `board.task.directory`; Mission and standalone Chat therefore never load a
   Task Artifact catalog.
3. Mission terminal child wakes already persist exact
   `extra.wake_reason={source:"mission.child_task_result",taskID,taskStatus}` on
   the real user-role wake. Every assistant segment in that physical Turn
   points back through `parentID`.
4. Task completion decisions already persist the exact Orchestrator message
   identity and exact `deliverable_artifact_locators`.
5. Artifact entries already retain exact producer Session/message/tool-call
   provenance. No timestamp or title inference is needed.
6. The Overlay currently enumerates only the `current` catalog and then matches
   the completion decision's exact locators. A later Engine Artifact revision
   can therefore hide the immutable revision that was actually delivered.

## Call-site disposition

| Owner / call site | Decision |
| --- | --- |
| `engine/completion-decision.ts` | Preserve as the sole Task delivery-selection authority. |
| `artifact-catalog/index.ts` | Add one read-only exact-locator metadata projection that resolves historical Engine Artifact revisions and immutable Task Artifact snapshots through the existing stores. It is not a new index. |
| `conversation/view.ts` | Preserve real message/Session identity; do not manufacture an Artifact message. |
| Task conversation route | Project the current completion decision onto its exact `orchestratorMessageID`. |
| Session conversation route | For each real Mission child-result wake, project the exact child Task outcome and completion deliverables onto the Turn's final visible assistant message. |
| Session `idle` | Rehydrate the same read-only Turn projection after the physical Turn settles; do not add an Artifact event family. |
| `tree-writer.ts` / `card-tree.ts` | Carry validated Turn summary metadata onto the existing real assistant card. |
| `ConversationArtifactSummary.tsx` / `Conversation.tsx` global mount | Preserve the standalone Session file-change summary only; remove its Task Artifact catalog responsibility. |
| `ConversationTurnArtifactSummary.tsx` / `CardParts.tsx` | Render each Task delivery summary after the exact owning message segment, including aggregated same-Session cards. |
| `conversation-artifacts.ts` | Delete client catalog pagination and exact-locator matching after the server owns the projection. |
| `GET /task/:taskID/artifacts` | Delete the overview-only route and generated contract after all UI consumers move to conversation hydration. Agent Artifact discovery remains on the canonical Catalog tools and panel query path. |
| `SessionSummary.diff` / Files workbench | Preserve as the separate file-change authority. Do not label file diffs as Task Artifacts. |

## Implementation plan

1. Define a strict transport schema for compact Turn Artifact summaries and one
   server projection service that resolves exact completion-decision locators.
2. Add Task and Mission projection assembly to their existing conversation
   hydration routes, keyed by real assistant message ID.
3. Carry summaries through the one tree writer onto existing assistant cards
   and render each summary after its owning message segment in `CardParts`.
4. Remove the global summary loader, overview route, obsolete generated API
   surface, and unused localization/styles.
5. Add positive non-User-Interface tests for exact historical revision
   resolution, Task message ownership, and Mission child-result Turn
   ownership. Regenerate owned contracts.
6. Run focused checks, full relevant type/build/docs checks, then exercise and
   inspect Task/Mission/Chat states on an isolated real page with screenshots.
7. Perform a second source/diff review, commit with `dsw-33987`, and push only
   `codex/conversation-turn-artifacts`. Do not merge the main worktree.

## Progress

- [x] Prove the missing Session ownership and exact persisted identities.
- [x] Create and push the isolated worktree baseline.
- [x] Implement the server Turn projection.
- [x] Attach the projection to real message cards.
- [x] Delete the superseded global Task Artifact path.
- [x] Complete non-UI and real-page verification.
- [x] Commit and push only the isolated branch without merging.

## Implementation and acceptance evidence

1. `conversation/turn-artifacts.ts` is the single server projection owner. It
   enumerates the canonical all-version Artifact Catalog and resolves the
   completion decision's exact locators, so a later revision cannot replace the
   revision actually delivered.
2. Task hydration projects its completion decision onto the persisted
   `orchestratorMessageID`. Mission hydration follows the persisted
   `mission.child_task_result` wake and the real parent-message chain to the
   final visible assistant message. Failed children expose their real terminal
   outcome and error without inventing deliverables.
3. The Overlay attaches summaries to real cards by message identity. Because
   multiple assistant messages from one Session may be aggregated into one
   physical card, `CardParts` renders each summary after its exact message run.
   Task tail merges reapply the same transport projection after rebuilding the
   card tree, preventing a correct hydration from being erased by a subsequent
   live message update.
4. The obsolete client catalog paginator and overview-only
   `GET /task/:taskID/artifacts` route are deleted. The existing global footer
   now owns file changes only; it is no longer a second Task Artifact surface.
5. The positive non-User-Interface contract tests pass for immutable historical
   revision resolution and Mission child-result ownership. Full typecheck,
   Overlay production build, route generation check, documentation check, and
   historical document-link checks pass.
6. Visual acceptance used an isolated server on port `41999` with a SQLite
   backup of the real project database. The real Mission conversation displayed
   six summaries at their corresponding assistant Turn boundaries (including
   two truthful failed outcomes). The real terminal Task displayed one summary
   directly after `manage_task action=complete_task`, with two delivered
   Artifacts and ten resources for each. Both screenshots were personally
   inspected; no production process or database was changed.
