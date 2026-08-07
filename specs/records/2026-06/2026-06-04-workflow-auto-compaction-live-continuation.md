# 2026-06-04: Workflow Auto Compaction Live Continuation

## Trigger

Task `tsk_e8eb14f48001URBtR8yO13K77n` and its build / integrity descendants repeatedly passed their goal requirements, then failed during review or integrity because automatic workflow compaction had been disabled for `build`, `frontend-design`, and `integrity` sessions. The failure mode was no longer the 2026-05-29 tool-surface inheritance bug; it was context growth with no usable automatic continuation path.

The previous stopgap was introduced because automatic compaction could write a summary checkpoint and then continue a workflow turn with the wrong lifecycle/tool surface. The recorded incident was a build continuation that resumed with only `StructuredOutput` while the worker still needed `bash`.

## Independent Review

Three read-only sub-agent reviews agreed on the current shape:

- `auto-compaction.ts` is the single policy source, but it currently disables too much.
- The continuation safety evidence already exists in the source user's `extra.workerTurnDescriptor` reference plus the live `SessionRuntimeContract`.
- The fix must not synthesize a continuation user message or copy the original prompt contract.
- `build`, `frontend-design`, and `integrity` can auto-compact only when the live runtime continuation validates.
- Other workflow kinds remain disabled until they have the same evidence.

## Call-Point Audit

Command:

`rg -n "SessionCompaction\.create|SessionCompaction\.process|SessionCompaction\.isOverflow|AutomaticCompaction|DISABLED_WORKFLOW_SESSION_KINDS|disablesAutomaticCompaction|compaction_request|manual_summarize|SessionControl\.Kind|SessionControl\.pending|SessionControl\.create|SessionControl\.consume|SessionControl\.fail|session_control_record|WorkerTurnDescriptor|workerTurnDescriptor|result_mode|maintenanceSummaryFailureMessage|selectPromptFinalMessageFromNewest|flushPromptFinalMessage|collectLoopState" packages/opencorvus/src packages/opencorvus/test specs -S`

| Surface                                                                | Decision                                                                                                                                       |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/session/auto-compaction.ts`                   | Replace the hard denylist-only helper with a typed decision helper.                                                                            |
| `packages/opencorvus/src/session/loop.ts::disablesAutomaticCompaction` | Replace with a helper that validates runtime continuation for runtime-gated workflow kinds.                                                    |
| `SessionLoop` predictive branch                                        | Queue automatic compaction for runtime-ready `build` / `frontend-design` / `integrity`; otherwise emit the existing visible budget error.      |
| `SessionLoop` reactive provider-overflow branch                        | Same policy as predictive; do not hide provider overflow behind an unsupported workflow compaction.                                            |
| `SessionLoop` pending `compaction_request` handling                    | Fail queued automatic workflow compaction if runtime validation is no longer live.                                                             |
| `SessionLoop` legacy compaction-part handling                          | Use the compaction marker's owning user message as the source; remove orphaned markers.                                                        |
| `SessionLoop` previous-turn overflow branch                            | Same policy as predictive before creating a new automatic request.                                                                             |
| `SessionCompaction.create`                                             | Validate the source user message's worker descriptor reference against the live runtime contract before queuing automatic workflow compaction. |
| `SessionCompaction.process`                                            | Keep the current summary checkpoint behavior and continue the same loop; no synthetic user-message continuation.                               |
| `WorkerTurnDescriptor`                                                 | Keep as the persisted identity for model/tool/result-mode validation. No schema change.                                                        |
| `SessionControl.Kind`                                                  | No new control kind. The existing `compaction_request` remains the durable queued action.                                                      |
| `compaction-continue-inherit.test.ts`                                  | Replace hard workflow rejection expectations with runtime-ready allow and missing-runtime reject cases.                                        |
| `extra-tools.test.ts`                                                  | Strengthen continuation validation coverage for result mode, tool drift, and satisfied terminal collectors.                                    |

## Decision

Automatic compaction is enabled in three groups:

1. Non-workflow sessions, unchanged.
2. `build`, `frontend-design`, and `integrity` only when runtime continuation has already been validated by `SessionLoop.validateSessionRuntimeContractForContinuation` using the source user's own `extra.workerTurnDescriptor` `{ id, hash }` and a `stage-attempt` runtime contract.
3. Manual summarize, unchanged, because it stops after the maintenance summary.

All other currently disabled workflow kinds stay disabled. This is intentionally narrower than deleting the denylist. It re-enables the sessions that have durable descriptor evidence and a live runtime contract while keeping orchestrator / planning / research variants on the visible failure path until they have equivalent continuation evidence.

The runtime contract is still process-local because it closes over live tool functions and collectors. Therefore this patch fixes active long-running workflow turns and queued controls while the owning runner is live; it does not claim crash recovery after process restart.

## Acceptance

- `SessionCompaction.create({ auto: true })` queues `compaction_request` for `build`, `frontend-design`, and `integrity` when the matching live `stage-attempt` runtime contract and the source user's worker descriptor `{ id, hash }` validate.
- The same call rejects those workflow kinds when runtime continuation is missing or invalid.
- The same call rejects those workflow kinds when the live contract is `orchestrator-wake` or when the source user lacks `extra.workerTurnDescriptor`.
- Predictive and reactive context overflow paths use the same policy.
- Existing prompt flushing stays unchanged: automatic compaction summaries are maintenance messages and the continued worker turn must produce the final reply.
- Tests cover the policy matrix and continuation validation drift cases.
