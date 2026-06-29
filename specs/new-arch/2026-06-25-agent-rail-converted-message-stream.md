# Agent Rail Converted Message Stream

Date: 2026-06-25
Status: Superseded by `2026-06-27-message-card-orderkey-convergence.md`

## Supersession Notice

This file is retained as historical context only. Its original implementation
target converted executor `run.progress` / `run.output` events into synthetic
conversation `message.*` events in the overlay. That design is now forbidden.

Active contract as of 2026-06-27:

- overlay consumes executor `run.*` events only as protocol/cursor/status
  events;
- overlay does not synthesize visible conversation message cards from
  `run.progress` or `run.output`;
- executor content that should appear in conversation must be persisted by the
  backend as durable message rows and emitted as real `message.*` events;
- rail targets come from tree-writer/cardTreeStore projection, not from a
  converted executor-message side path.

## Acronyms

- SSE: Server-Sent Events, the selected task/session live-update stream.
- UI: User Interface, visible controls and layout surfaces.

## Task Definition

Fix the regression where the Conversation agent rail can miss already executed
agents and does not refresh in real time even though the corresponding message
cards are visible. Preserve the current single-source rail design:
`ConversationAgentRail` renders only `conversationAgentStore.records`, and all
message-backed rail records are projected through `conversation-agents.ts`.

## Recall

| Source                                                   | Constraint carried forward                                                                                                                                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                              | No fallback, no double source, no blind patching, inspect disk plans before edits, test every change, visually verify UI-related delivery, do not restart or refresh the live overlay process without explicit confirmation. |
| `2026-05-13-conversation-agent-workflow-rail.md`         | The rail is a Conversation-owned bottom strip and must not synthesize hidden message cards.                                                                                                                                  |
| `2026-06-10-agent-rail-identity-empty-card-fix.md`       | Lifecycle-only sessions must not create blank top-level cards or rail records.                                                                                                                                               |
| `2026-06-23-overlay-conversation-render-backpressure.md` | Do not restore component-level card-tree workflow scans; the mounted rail reads `conversationAgentStore.records`.                                                                                                            |
| `2026-06-23-agent-rail-visibility-regression.md`         | Tail hydrate updates `conversationAgentStore`; visibility fixes must preserve `conversation-agents.ts` as the only rail store owner.                                                                                         |
| `2026-06-24-agent-rail-live-message-stream.md`           | Direct selected `message.updated` events must update the rail store immediately after tree-writer accepts the message.                                                                                                       |
| `2026-06-24-overlay-task-deep-link.md`                   | Task selection and directory ownership still flow through the canonical selected task source; URLs must not introduce a second task ownership source.                                                                        |

## Call Point Inventory

| Surface                                                           | Evidence                                                                                                                                                       | Decision                                                                                                                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConversationAgentRail.tsx`                                       | Reads `conversationAgentRecordsForSource(boardStore.selectedSource)` and has no `buildAgentWorkflow()` dependency.                                             | Keep unchanged unless visual layout evidence requires a UI fix; do not add a component fallback scan.                                                       |
| `conversation-agents.ts`                                          | Exports `applyLiveConversationAgentMessageUpdated(sourceKey, event)` for standard `message.updated` payloads.                                                  | Reuse this projection only for real backend `message.*` events.                                                                                              |
| `events.ts::routeSSEEvent` direct `message.updated` branch        | Writes to tree-writer, then calls `applyLiveConversationAgentMessageUpdated`.                                                                                  | Keep this path and factor the common projection so converted messages use the same code.                                                                    |
| `events.ts::routeSSEEvent` `run.progress` / `run.output` branches | Historical overlay conversion created synthetic message cards.                                                                                                 | Removed. These events update protocol/cursor state only; visible content must arrive as durable backend `message.*` rows.                                    |
| `events.ts::routeSSEEvent` `message.part.updated` branch          | Tree-writer can materialize a deterministic message card before `message.updated`, but the rail store was not updated.                                         | After tree-writer accepts a displayable route-stamped part, project the same message-backed record into `conversationAgentStore`.                           |
| `events.ts::routeSSEEvent` `session.status` branch                | Tree-writer updates the active card status, but existing rail records can remain running until a later message/hydrate.                                        | Update only existing rail records by session id; lifecycle-only status still must not create records.                                                       |
| `sse.ts::startSSE` selected stream callbacks                      | Closed handles can still call their captured `onEvent` in tests/bridges; routeSSEEvent then writes against the current mounted card tree.                      | Ignore `onOpen` / `onEvent` when the callback handle is no longer the current selected stream handle.                                                       |
| `events.ts::replayTaskEventToTree`                                | Hydration replay previously converted persisted `run.progress` / `run.output` events into message cards.                                                       | Removed. Authoritative hydrate remains backend transcript/view/agentView; executor protocol events are not a message source.                                |
| `conversation.ts` full hydrate / tail merge                       | Reads `agentView` from the backend conversation response.                                                                                                      | Require explicit `agentView`; do not fall back to `view`, because that hides backend contract drift and creates a second rail source.                       |
| `selected-task-recovery.test.ts`                                  | Covers direct selected `message.updated`, DB-backed `task.messages.changed`, and executor `run.*` consumption.                                                  | Assert `run.output` / `run.progress` do not synthesize message cards.                                                                                        |
| `conversation-agent-rail-records.test.ts`                         | Covers direct live message projection, goal-phase records, ignored user/filtered messages, and source scoping.                                                 | Add or reuse coverage proving executor channel records target their rendered message card and remain source-scoped.                                         |
| `conversation-agent-rail-scroll-browser.test.ts`                  | Isolated real-browser rail visual QA already captures bottom-strip screenshots.                                                                                | Run after the fix and inspect screenshots; do not touch the user's live overlay process.                                                                    |

## Root Cause

The 2026-06-24 fix connected direct selected `message.updated` events to the
rail store. The original version of this 2026-06-25 spec then attempted to
extend that path to executor `run.progress` and `run.output` conversion. That
extension was a double source: executor protocol events are not durable
conversation messages.

The active root cause fixed by the 2026-06-27 convergence is narrower:

- real backend `message.updated` / `message.part.updated` events update the
  rendered card projection and then the rail target projection;
- executor `run.*` events must not produce visible conversation cards in the
  overlay;
- visible executor content must come from backend-persisted message rows.
- `message.part.updated` can arrive before `message.updated` and tree-writer
  legitimately materializes the deterministic message card from the route
  metadata. The rail had no corresponding part-first projection.
- `session.status` is the card status source, but rail status stayed stale for
  already materialized sessions.
- A closed selected-task stream handle could still deliver a late event after a
  task switch, writing the old task's card into the new mounted card tree.

The rail therefore remains behind until a later `task.messages.changed` tail
merge or full hydrate replaces `agentView`, and some already executed agents
can be absent from the rail.

This is not a Solid rendering issue and not a need for a rail component
fallback. It is a projection contract issue: only backend message rows are the
message stream.

## Fix Plan

1. Factor a small helper in `events.ts` that writes a standard message event to
   tree-writer and projects accepted `message.updated` /
   `message.part.updated` events into the selected conversation source rail
   store.
2. Use that helper in the direct selected message branch and the part-first
   branch only.
3. Update existing rail records from `session.status`, but never create a rail
   record from lifecycle-only status.
4. Ignore selected-stream `onOpen` / `onEvent` callbacks from handles that are
   no longer current.
5. Keep `replayTaskEventToTree()` unchanged for rail state unless tests prove
   a selected-source live replay path requires projection; hydrate and tail
   merge remain the authoritative replay owners through `agentView`.
6. Add focused tests proving selected `run.output` / `run.progress` do not
   create synthetic message cards, plus part-first `message.part.updated`,
   `session.status`, and closed-handle late events.
7. Remove the `agentView ?? view` hydrate fallback and add a negative test for
   missing `agentView`.
8. Run focused tests, typecheck, isolated browser rail visual QA, inspect
   screenshots, self-review, commit, and push.

## Acceptance

- A selected task `run.output` event does not create a message card or rail
  record.
- A selected task `run.progress` event does not create a message card or rail
  record.
- A selected task displayable part-first `message.part.updated` creates both
  the message card and a rail record immediately; the later `message.updated`
  refines the same record and does not duplicate it.
- `session.status` updates an existing rail record's status/completion time,
  but lifecycle-only status does not create a rail record.
- Closed selected-stream handles cannot write late events into the current
  card tree or rail store after a task switch.
- The direct selected `message.updated` behavior from 2026-06-24 still works.
- User and filtered messages still do not create rail records.
- Missing `agentView` in full conversation hydrate or tail merge fails loudly;
  `view` is never used as the rail data fallback.
- `ConversationAgentRail.tsx` still has no card-tree scan,
  `buildAgentWorkflow()` dependency, alternate store, hidden card, or UI
  fallback.
- Focused tests, typecheck, and isolated browser visual QA pass; screenshots
  show the bottom strip visible and not clipped.
