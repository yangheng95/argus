# Deliver start visible delivery card

Date: 2026-05-19

## Problem

User observed: the orchestrator called `deliver`, but no delivery card appeared.

## Recall

- `CLAUDE.md` forbids fallback/compatibility patches and requires checking persisted plans before code changes.
- `artifacts/2026-05-19-overlay-agent-rail-and-file-open.md` removed the expanded agent rail but explicitly did not alter agent card generation.
- `specs/new-arch/2026-05-16-overlay-message-turn-agent-cards.md` says real child agent cards come from real `message.updated` rows. DeliveryAgent only creates such a session after host delivery gates pass.
- `packages/overlay/src/components/Board.tsx` already has a single in-flight delivery projection: `deliveryPanelDelivery(board)` shows a pending DeliveryPanel when `hasActiveDeliveryRun(board)` is true.

## Root Cause

`deliver` starts by emitting `workflow.step.updated(status="running")`, but it does not update the active run's `phase` to `deliver`. The overlay can show the in-flight DeliveryPanel from workflow event replay, but that makes the visible card depend on transient event refresh timing. The durable run row still says the previous phase, so `hasActiveDeliveryRun(board)` has no durable run-phase signal to read.

## Fix

At `deliver` start, immediately update the active run to:

- `phase: "deliver"`
- `status: "running"`
- `blocking_reason: null`
- `error: null`

This is not a fallback. It records the real current run phase in the existing run artifact stream, which the Board already treats as a source for delivery in-flight visibility.

## Acceptance

- Calling `deliver` moves the active run to `phase="deliver"` before delivery verification continues.
- The existing DeliveryPanel in-flight projection can show from `run.phase` even if the workflow event path is delayed.
- DeliveryAgent session card behavior is unchanged: the real agent card still appears only after DeliveryAgent starts and emits message events.
- Add/adjust tests covering the run phase after `deliver`.
