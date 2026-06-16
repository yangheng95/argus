# Lifecycle Empty Agent Card Fix

Date: 2026-06-16

## Problem

The overlay can show multiple top-level agent cards containing only the
scoped guidance reply box. These cards are created by lifecycle events before
the agent emits any displayable conversation message.

## Evidence

| Surface | Current behavior | Decision |
| --- | --- | --- |
| `packages/overlay/src/services/tree-writer.ts::handleSessionStatus` | Calls `ensureLifecycleSessionProjection`, which can create a `kind="agent"` card from `session.status` alone. | Lifecycle status updates an existing real message card or stays buffered in `pendingSessionStatus`. |
| `packages/overlay/src/services/tree-writer.ts::handleSessionError` | Same lifecycle-only materialization path for `session.error`. | Buffer the error until a real message card exists; do not create a blank card. |
| `packages/overlay/src/components/Card.tsx` | Shows `AgentSessionReplyBox` for every targetable session card. | No renderer hiding rule; the writer must not create a targetable empty card. |
| `specs/new-arch/07-panel-reactivity.md` | Says `session.status` is buffered when the session is not materialized and drained by the first message. | Restore this documented contract. |
| `specs/new-arch/2026-06-10-agent-rail-identity-empty-card-fix.md` | Says lifecycle events remain in events but message-less sessions are not display sessions. | Apply the same rule to the live tree-writer path. |

## Call Point Grep

- `ensureLifecycleSessionProjection`: only called from `handleSessionStatus` and `handleSessionError`.
- `pendingSessionStatus`: reset, status/error buffering, and drain after `message.updated`.
- lifecycle-only tests: `tree-writer-hierarchy.test.ts` and `conversation-hydrate-replay.test.ts`.
- backend conversation view tests already assert lifecycle-only sessions stay out of display sessions.

## Acceptance

- A `session.status` or `session.error` with channel metadata and no message does not create a top-level card.
- The lifecycle status is still retained in `pendingSessionStatus`.
- When the first real message for that session arrives, the pending lifecycle status applies to the real message card.
- Empty message shell cards remain hidden until a displayable part arrives.
- Hydrating/paging lifecycle-only events does not materialize blank agent cards.
