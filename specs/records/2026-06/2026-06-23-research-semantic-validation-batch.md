# Research Semantic Validation Batch

Date: 2026-06-23

## Problem

The `tsk_ef3d14bc0001Q7vgzoeDtiC7Of` frontend-research session called `submit_research_brief` seven times. Six submits failed because `subpage_research_task.evidence_ids` referenced `fr_*` fidelity-risk ids instead of registered evidence ids. The validator returned only the first semantic error each time, so the model had to fix one subpage task and resubmit repeatedly.

## Callpoints

- `packages/opencorvus/src/research/schema.ts`: `validateResearchBriefSemantics` and `ensureWebpageContractRefs` currently return the first error.
- `packages/opencorvus/src/research/output-tools.ts`: `submit_research_brief` reports that single semantic error and keeps the collector open.
- `packages/opencorvus/test/research/output-tools.test.ts`: covers finalizer semantic failures.

## Design

Keep one validator and one finalizer. Do not add retry logic, auto-submit, or host-side correction.

Change semantic validation to collect every duplicate-id and unknown-reference error into one message. The finalizer still fails, but the model sees the full repair set in one tool result and can update all bad fragments before the next submit.

## Acceptance

- A brief with multiple bad `subpage_research_task.evidence_ids` reports all bad task ids and all missing ids in one `submit_research_brief` result.
- Existing valid briefs still finalize.
- Existing semantic validation callers still receive `undefined` for valid input and a string for invalid input.
