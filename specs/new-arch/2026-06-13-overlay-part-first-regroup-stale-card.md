# Overlay Part-First Regroup Stale Card

Date: 2026-06-13
Status: Implemented

## Symptom

Runtime error:

`appendSessionPart: card <stage>:session:<sessionID>:message:<messageID> missing parts array`

Observed with a live `message.part.updated` `step-finish` payload for an
`orchestrator` channel message.

## Root Cause

`message.part.updated` can arrive before `message.updated`. For displayable
parts, `ensurePartProjection()` correctly materializes the deterministic turn
card and records `session.messageCardIDs.set(messageID, cardID)`.

If later `message.updated` events for other messages in the same session trigger
`regroupTimelineSegments()` before the original message metadata arrives, the
regrouper builds its target set from the `messages` map only. The part-first
message is absent from `messages`, so its card is treated as an old owned card
and deleted by `removeCardReferences()`. The `messageCardIDs` entry remains.

A later part for that original message then resolves the stale card id from
`messageCardIDs` and `appendSessionPart()` reads no card/parts array.

## Call-Site Sweep

Relevant surfaces:

| Surface | Decision |
| --- | --- |
| `ensurePartProjection()` | Keep materializing displayable part-before-message cards. This is the durable reconstruction path required by the projection audit. |
| `ensureMessageTurnProjection()` | Keep as the sole owner of `messageCardIDs.set()`. Do not add a second ownership source. |
| `regroupTimelineSegments()` | Must not delete part-first cards whose message metadata has not entered `messages` yet. If it removes a card, it must not leave an ownership mapping pointing at a deleted card. |
| `removeCardReferences()` | Keep as card-tree deletion only; do not make it scan session indexes implicitly because callers need explicit ownership decisions. |
| `appendSessionPart()` | Keep loud. Do not fallback-create `parts: []`; that would hide ownership/index corruption. |

## Acceptance

- A part-first displayable message can survive regrouping caused by later
  `message.updated` rows in the same session.
- A later `step-finish` for that part-first message does not throw and lands on
  the same deterministic card.
- Once the original `message.updated` arrives, regroup keeps a single visible
  card for the session segment and preserves the earlier parts.
- Existing loud failures for non-reconstructable deltas/removals remain loud.
