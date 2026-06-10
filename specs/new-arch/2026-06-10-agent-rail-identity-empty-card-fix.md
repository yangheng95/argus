# Agent Rail Identity And Empty Card Fix

## Problem

Sending one user message can render multiple top-level agent cards that contain only the steer box. The bottom rail can also show unstable agent icons because display identity is inferred from mutable labels instead of a canonical session role.

## Evidence

| Surface | Current behavior | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/conversation/view.ts` | `session.status` / `session.error` events can create `ConversationSessionView` rows with `messageIDs: []`. | Lifecycle events remain in `events`, but message-less sessions are not display sessions. |
| `packages/opencorvus/src/server/routes/orchestrator.ts` | Task and session hydrate responses pass lifecycle events into `projectConversationView`. | Keep event replay; let tree-writer attach lifecycle status only after a real card exists. |
| `packages/overlay/src/services/tree-writer.ts` | Live path already says `ensureSessionProjection` never creates display cards; only message turns create cards. | Preserve this live contract as the hydrate contract too. |
| `packages/overlay/src/store/conversation-agents.ts` | Hydrated lifecycle-only sessions synthesize `renderedCardID: <stage>:session:<sid>`. | Do not create rail records without a display message or goal-phase target. |
| `packages/overlay/src/components/ConversationAgentRail.tsx` | Icon/accent uses `avatarRole(record().agentName)`. | Icon/accent uses canonical `record.stage`; label can remain `agentName`. |
| `packages/overlay/src/utils/agent-workflow-records.ts` | Merge lets live card projection overwrite hydrated backend identity. | Merge render/status fields without overwriting canonical identity from hydrated session records. |

## Call Point Grep

- `projectConversationView(`: server task hydrate, task session hydrate, task history hydrate, standalone session hydrate.
- `hydrateConversationAgentView(`: initial conversation hydrate and latest tail merge.
- `mergeAgentRecords(`: rail projection only.
- `Avatar role=` in rail: `ConversationAgentRail.tsx`; chat bubbles already compute normalized role independently.

## Tests

- Update backend `conversation-view` and task conversation route tests so lifecycle-only events stay in `events` but do not create `view.sessions`.
- Update overlay `conversation-agent-rail-records` so message-less top-level sessions are ignored, while goal-phase sessions with phase metadata still target the goal phase card.
- Add/adjust merge test proving hydrated canonical stage wins over live card label for icon identity.
