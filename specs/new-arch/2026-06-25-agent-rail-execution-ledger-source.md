# Agent Rail Execution Ledger Source

Date: 2026-06-25
Status: Implemented

## Acronyms

- SSE: Server-Sent Events, the live selected task/session update stream.
- UI: User Interface, the visible overlay surface.

## Correction

The agent rail is an execution timeline, not a message-output timeline. A real
agent execution must be represented when the system has a durable session
ledger row, even if that agent never produced a displayable message.
Messages and parts may attach or refine a scroll target, but they are not the
source of truth for whether an agent ran.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no double source, inspect disk plans before editing, test every change, visual-check UI changes, do not restart the user's live overlay process. |
| `2026-05-13-conversation-agent-workflow-rail.md` | Rail is the Conversation-owned execution/navigation strip. It must not synthesize hidden message cards. |
| `2026-06-10-agent-rail-identity-empty-card-fix.md` | Lifecycle-only sessions must not become blank message cards. This does not mean they cannot be rail execution records. |
| `2026-06-24-agent-rail-live-message-stream.md` | Direct message updates can refine rail records in real time, but they must not be the existence source. |
| `2026-06-25-agent-rail-converted-message-stream.md` | Previous fix closed missing live message projection edges, but kept the wrong model by treating message/part output as rail existence evidence. |
| `07-panel-reactivity.md` | `session.status` is the single session lifecycle signal. It carries card spinner/terminal state and is durable through `protocol_event`. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts` | `bridgeSessionLifecycle()` persists `session.status`; `enrichLifecycleProperties()` stamps `channel`, `resolvedRole`, `parentSessionID`, and `goalID`. | Keep this as the live/status update signal. It is not the hydrate existence source. |
| `packages/opencorvus/src/orchestrator/task-event.ts` | Task hydrate can already resolve a task root session through `engine_task.session_id`; session parentage is stored in `session.parent_id`; durable `session.status` rows are persisted in `protocol_event`. | Add a reusable session-tree ledger query that includes each session's latest durable status. This is the durable hydrate source for rail execution records and their status. |
| `packages/opencorvus/src/conversation/view.ts` | `projectConversationView()` currently ignores `lifecycleEvents` and comments that lifecycle-only rows are not display sessions. | Keep display `view` message-backed, but add an explicit agent-view projection seeded by the session ledger. Lifecycle events only update existing ledger sessions. |
| `packages/opencorvus/src/server/routes/orchestrator.ts` | Full task hydrate builds both `view` and `agentView` from `projectConversationView()`. Session/history endpoints only return display `view`. | Use the session-ledger projection for full/tail `agentView`; do not change display `view` or history page view. |
| `packages/opencorvus/src/engine/model.ts` | `TaskConversationSessionView` only has message time names. | Add optional lifecycle time/status fields or reuse existing fields with execution semantics only if tests prove schema consumers remain explicit. |
| `packages/overlay/src/store/conversation-agents.ts` | Hydrate currently builds records from messages plus goal-phase sessions; top-level lifecycle-only sessions are filtered out. Live `session.status` updates existing record only. | Hydrate and live `session.status` must create/update execution records. Message/part projection must only attach/refine targets and display timing. |
| `packages/overlay/src/components/ConversationAgentRail.tsx` | It renders `conversationAgentStore.records` and warns when `renderedCardID` is missing. | Keep component unchanged except tests/visual review; missing target is acceptable for execution records with no display card. |
| `packages/overlay/src/services/events.ts` | Selected stream already routes `session.status` through tree-writer and `applyLiveConversationAgentSessionStatus()`. | Let this path create records from lifecycle events; keep message helpers as retarget/refine only. |
| `packages/overlay/test/selected-task-recovery.test.ts` | Test currently asserts lifecycle-only status does not create rail record. | Reverse this assertion: lifecycle-only status creates a rail execution record but not a card. |
| `packages/opencorvus/test/server/conversation-view.test.ts` | Test currently asserts lifecycle-only events stay out of sessions. | Split display and agent view expectations: default display view excludes lifecycle-only rows; agent-view mode includes them. |

## Root Cause

The previous fixes conflated two facts:

- Execution fact: a durable session row exists in the task session tree.
- Display fact: a session produced a message/part card that can be scrolled to.

The rail needs the first fact. The second fact is only a navigation target.
Filtering top-level lifecycle-only sessions out of `agentView`, and live
`session.status` updating only existing records, made the rail disappear for
agents that executed but failed before a message, produced no visible message,
or had message projection delayed.

## Codex Review Feedback

An adversarial read-only review on 2026-06-25 found three remaining defects in
the first implementation:

1. Standalone session hydrate seeded `agentView` from only the requested
   session, so executed child sessions in the same session tree were missing.
2. Task hydrate derived rail status from the bounded event replay page, so a
   latest terminal/running status outside the 500-event replay window could
   hydrate as `pending`.
3. Terminal `aborted` was mapped to `completed`, which made cancelled agent
   execution look successful.

The revised source contract is stricter: rail existence and hydrate status both
come from the durable session tree ledger. The bounded replay page remains only
for conversation event replay, not for rail status.

A second three-agent cross-review found the next observable mismatch:

1. Live `message.updated` / displayable `message.part.updated` can arrive before
   the corresponding rail execution record. The card tree is written first, but
   rail target projection returned early and permanently dropped the target.
2. A later message/part can also fail to attach when `session.status` has already
   advanced `lastObservedAt`; target attachment was gated by lifecycle recency
   instead of target presence.
3. Older task history and session-history materialization hydrate cards but do
   not attach the newly materialized message targets to existing rail records.
4. Standalone session hydrate used a recursive rail ledger but only loaded root
   session messages, so child rail icons could exist without the child cards that
   would be their target.

Consensus repair boundary: message/part events remain non-authoritative for rail
execution existence. They may only create scoped pending targets keyed by
`sourceKey + sessionID` and attach those targets when a ledger/status-created
rail record exists. No component-level card-tree scan or message-created rail
record is allowed.

## Fix Plan

1. Add an explicit `projectConversationAgentView()` backend projection that
   seeds rail sessions from the durable session ledger.
2. Keep `projectConversationView()` as display/message projection so no blank
   conversation cards are created.
3. Extend `ConversationSessionView` / schema with optional lifecycle status
   fields required by rail records.
4. In task hydrate, return display `view` from message projection and
   session-ledger `agentView` from the full relevant transcript plus latest
   durable session status per ledger session.
5. In overlay `conversation-agents.ts`, build rail records from sessions first,
   regardless of message target. Messages only attach `renderedCardID`,
   `targetMessageID`, and later observation times.
6. Change live `session.status` projection to create records from route-stamped
   lifecycle events; message/part paths update target data on existing records.
7. Update backend and overlay tests to assert lifecycle execution records exist
   while no blank message card is materialized.
8. Run focused backend/overlay tests, typecheck, isolated browser rail QA,
   inspect screenshots, self-review, commit, and push.
9. Make standalone session hydrate use the same session-tree ledger source as
   task hydrate, scoped to the requested project session tree.
10. Map terminal `aborted` to the existing non-success rail status `skipped`
    rather than `completed`.
11. Preserve live message/part targets that arrive before the rail record and
    merge them when ledger/status creates the record.
12. Let history and session-history materialization attach message targets to
    existing rail records without creating rail existence.
13. Load standalone session conversation messages from the same session tree used
    for standalone rail ledger records.

## Acceptance

- Full task hydrate `agentView` includes a top-level agent execution session
  from the task session ledger even when it has no message and no status event.
- Full task hydrate `agentView` uses each ledger session's latest durable
  `session.status`, independent of bounded replay page size.
- Standalone session hydrate `agentView` includes executed child sessions from
  the requested session tree, even when those children have no messages.
- Default display `view` still excludes lifecycle-only sessions from message
  card projection.
- Terminal `aborted` rail status is non-success (`skipped`), not `completed`.
- If live message/part arrives before `session.status`, the later rail record
  still receives the target; no execution record is created by message/part.
- If live message/part arrives after a newer status timestamp, it still fills an
  empty rail target without overwriting an existing target.
- Loading older history/session history materializes cards and attaches targets
  to existing rail records.
- Standalone session hydrate child rail records have corresponding child
  transcript/card data when child messages exist.
- Live selected `session.status` creates a rail execution record immediately
  when it carries a non-user agent channel.
- Live selected `session.status` does not create any blank card in
  `cardTreeStore`.
- Later `message.updated` / displayable `message.part.updated` for the same
  session attaches or updates `renderedCardID` and `targetMessageID` without
  duplicating the rail record.
- `ConversationAgentRail` still uses `conversationAgentStore.records` only; no
  component card-tree scan is introduced.
- User/main and filtered lifecycle events do not create rail records.
- Focused tests, typecheck, and isolated browser visual QA pass.
