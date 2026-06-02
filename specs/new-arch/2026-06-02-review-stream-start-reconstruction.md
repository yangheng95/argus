# Review Stream Start Reconstruction

Date: 2026-06-02
Status: implemented
Owner: Codex

## Symptom

The overlay throws:

`review.stream.chunk arrived before started (taskID=..., reviewID=integrity:ses_...)`

The reported event has a valid integrity review id derived from an integrity session id, but the overlay's in-memory `runningReviews` index has no matching `review.stream.started` row.

## Evidence

Call-site sweep:

| Surface | Evidence | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/review/stream.ts` | `reviewIDForIntegrity(sessionID)` is the single backend naming rule: `integrity:${sessionID}`. | Reuse this identity. Do not add a second id map. |
| `packages/opencorvus/src/integrity/team-agent.ts` | Supervisor and each reviewer emit `review.stream.started`; reviewer streams use their own review id. | Backend shape is already correct for normal live order. |
| `packages/overlay/src/services/tree-writer.ts` | `handleReviewStreamChunk` and `handleReviewStreamProgress` require a prior `runningReviews` entry. | Reconstruct the entry from the review id when the id is an integrity session id. |
| `packages/overlay/src/services/conversation.ts` | Hydrate and paged event replay can load only the visible tail before selected-task SSE resumes. | A selected task can see a later chunk without the earlier started event in memory. |
| `packages/opencorvus/src/server/routes/orchestrator.ts` | `/task/:id/conversation/events` pages protocol events by sequence. | The event log remains the source; no synthetic UI-only message is introduced. |

## Root Cause

The frontend modeled running review cards as an in-memory lifecycle object keyed by `reviewID`, but the visible conversation can be hydrated from a partial task tail and then resume the selected-task stream from a later sequence. In that situation a valid `review.stream.chunk` can be the first event the current overlay process sees for that review id.

That is a protocol projection bug. It is not a CSS/card-body rendering bug and not something to fix by ignoring chunks.

## Fix

Use the existing backend identity rule as the single reconstruction source:

1. Parse `reviewID=integrity:<sessionID>`.
2. Materialize the same `integrity:session:<sessionID>` card that `review.stream.started` would have materialized.
3. Register the reconstructed `runningReviews` payload before applying `progress` or `chunk`.

This keeps one card identity and one review part id:

`review:integrity:<sessionID>:reasoning:<attempt>`

## Non-Goals

- Do not silently accept non-integrity review ids.
- Do not swallow malformed `kind`, `phase`, or empty identity errors.
- Do not add a second card store or an unknown-review fallback card.
- Do not change backend event ordering or persist synthetic started events.

## Tests

- Add overlay writer coverage for a valid integrity chunk arriving before `started`.
- Add overlay writer coverage for progress arriving before `started`.
- Keep malformed/non-integrity review ids loud.
