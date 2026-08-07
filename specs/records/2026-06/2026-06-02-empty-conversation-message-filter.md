# Empty Conversation Message Filter

## Problem

The task conversation hydrate endpoint can return assistant message envelopes
with no displayable parts. Overlay hydration turns goal-phase message envelopes
into boundary rows, so an empty build message renders as a `BUILD` label plus
timestamp and no content.

Live evidence from task `tsk_e872005bd0019ZcZXSTjGDfVWu` showed the old G3 build
session `ses_178ba4dc8ffezhwHJ4cJhMdXYf` had many assistant messages where
`parts=[]` and token counts were zero.

## Call-Point Audit

- `packages/opencorvus/src/conversation/view.ts` already has display-part
  classification, but it only affects `lastDisplayMessageID`.
- `packages/opencorvus/src/server/routes/orchestrator.ts` returns raw task
  transcript through task hydrate, session transcript, and history endpoints.
- `packages/opencorvus/src/server/routes/session.ts` returns raw single-session
  transcript through session hydrate.
- `packages/overlay/src/services/tree-writer.ts` hydrates every transcript
  message and inserts phase boundary parts for goal-scope messages.
- `packages/overlay/src/components/CardParts.tsx` renders boundary role and
  timestamp even when no following display part exists.

## Decision

Filter non-displayable conversation messages at the server conversation
boundary. A displayable message has at least one displayable part. Do not rely
on overlay-only hiding.

This keeps transcript, history pagination, session hydrate, and overlay view on
one source of truth.

Overlay live replay must still index bare `message.updated` events because that
metadata owns delta routing, status, interactions, and timeline grouping. It
must defer phase boundary rows until a displayable `message.part.updated`
arrives, so an empty build envelope cannot render as a timestamp-only row.

External executors must not finish a build turn with zero visible parts. When
the provider stream produces no materialized tool/text parts, the build agent
writes one real control text part summarizing the executor result.
