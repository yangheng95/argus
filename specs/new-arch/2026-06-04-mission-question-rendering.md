# Mission question rendering

## Problem

Mission sessions can emit the raw `question.asked` event from `Question.ask`.
`packages/overlay/src/services/tree-writer.ts` only recognizes normalized
`interaction.requested` events and therefore throws:

`tree-writer: unhandled event type "question.asked"`

That aborts the card projection path and the Mission conversation stops
rendering.

## Evidence

Repository-wide search for `question.asked` shows:

| Location | Role |
| --- | --- |
| `packages/opencorvus/src/question/index.ts` | Raw question lifecycle events: `question.asked`, `question.replied`, `question.rejected`. |
| `packages/opencorvus/src/engine/interaction.ts` | Engine tasks normalize raw questions into `interaction.requested/resolved` when the session belongs to an engine task or run. |
| `packages/overlay/src/services/tree-writer.ts` | Handles `interaction.requested/resolved`, but not `question.*`. |
| `packages/overlay/src/components/InteractionCard.tsx` | Existing single user interface for pending permission and question interactions. |
| `packages/overlay/src/services/interaction-reply.ts` | Sends all question answers to `interaction/:id/...`, which is wrong for raw Mission questions. |
| `packages/opencorvus/src/server/routes/question.ts` | Correct reply endpoints for raw questions: `/question/:requestID/reply` and `/question/:requestID/reject`. |

## Decision

Keep `interaction.requested/resolved` as the canonical engine-task source.
For selected standalone session conversations, project raw `question.*` events
into the same interaction-card pipeline, with an explicit reply endpoint of
`question`.

This avoids a second question user interface, preserves the tree-writer
unknown-event invariant, and prevents task-session duplicate cards because
task questions continue to render from normalized engine interactions.

## Implementation Plan

1. Add a `standaloneQuestionInteractions` map in `tree-writer`.
2. Handle `question.asked`, `question.replied`, and `question.rejected`.
3. Include standalone question interactions in `rebuildInteractionCards`.
4. Extend `InteractionCard` and `interaction-reply` so raw questions post to
   the existing `/question` route while engine interactions keep using
   `/interaction`.
5. Add overlay tests for Mission projection and route selection.
