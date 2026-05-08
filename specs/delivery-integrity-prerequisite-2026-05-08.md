# Delivery Integrity Prerequisite Repair

## Problem

The delivery evidence gate treats `review:integrity` as a primary blocker for non-trivial goal graphs, but the orchestrator can call `deliver` before an `integrity_attempt` artifact exists for the active spec snapshot. In that order the manifest correctly fails, yet the failure is caused by missing prerequisite evidence rather than an evaluated architecture verdict.

## Root Cause

Integrity execution is currently an advisory orchestrator tool call. Delivery verification only reads persisted integrity evidence and does not structurally ensure that required evidence exists before building the final manifest.

## Fix

Before persisting a task delivery and before `DeliveryService.verify`, the `deliver` tool must ensure that the active spec snapshot has required integrity evidence. It should reuse the existing integrity reviewer and the same requirement predicate as the delivery evidence gate. It must not relax `review:integrity`, fabricate artifacts, or add prompt-only routing.

## Acceptance

- A non-trivial goal graph with no current `integrity_attempt` triggers `runIntegrityReview()` during `deliver`.
- `DeliveryService.verify` runs only after that integrity attempt is persisted.
- Existing `review:integrity` gate semantics remain unchanged.
- Direct or trivial paths that do not require integrity are not forced through an unrelated review.
