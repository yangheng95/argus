# Terminal Refill Wake And No-Decision Contract Repair

Date: 2026-06-25

## Task

Repair the failed TradingView Screener task run where the root task failed
after three `OrchestratorNoDecisionStopError` wakes while child goal builds
continued and later passed.

## Recalled Evidence

- Task `tsk_efea03e47001KSBTaoTmewSnTp` failed at
  `2026-06-25T12:58:01Z` with `Stream-error fuse tripped after 3 consecutive
  failures`.
- Trace rows at `12:57:31Z`, `12:57:50Z`, and `12:58:00Z` were no-decision
  contract failures, not provider stream failures.
- Goal runs #3, #4, #5, and #6 later reported successful child work. Goals #7
  and #8 never received root scheduling because the parent task was already
  terminal.
- `packages/opencorvus/src/engine/runtime.ts::syncTerminalGoalRefills`
  dispatches `dispatchTaskLoop` before writing `goal_refill_notification`.
  `dispatchTaskLoop` starts the root loop fire-and-forget, so the next
  orchestrator turn can read task context before the refill fact exists.
- `packages/opencorvus/src/orchestrator/agent.ts::recordOrchestratorSessionErrorEnvelope`
  records `OrchestratorNoDecisionStopError` through
  `recordOrchestratorStreamError` and then counts it in
  `maybeTripOrchestratorStreamErrorFuse`.

## Prior Decisions Reviewed

- `specs/orchestrator-no-decision-stop-2026-06-18.md` introduced strict
  no-decision rejection and reused stream-error artifacts and fuse for repeated
  no-decision. This incident shows the reuse was the wrong persistence and
  fuse boundary.
- `specs/new-arch/2026-06-22-orchestrator-live-build-park-prompt.md` keeps the
  no-decision classifier strict but relies on terminal refill facts as the
  next source of scheduling evidence.
- `specs/new-arch/2026-06-21-dispatch-algorithm-agent-audit.md` keeps
  `dispatchTaskLoop` as the canonical root wake path and queues behind live
  tool ownership.

## Callpoint Inventory

| Surface | Current role | Required action |
| --- | --- | --- |
| `engine/runtime.ts::syncTerminalGoalRefills` | Finds terminal goal runs, dispatches root wake, then writes refill facts. | Make the refill fact durable before any accepted root loop can observe context. |
| `engine/runtime.ts::recordTerminalGoalRefillWakeFact` | Writes `goal_refill_notification` with dispatch metadata. | Keep a single durable fact source and preserve final dispatch result. |
| `engine/queue.ts::dispatchTaskLoop` | Starts or queues root wakes. | Keep as the single wake path. If a caller needs pre-launch durable facts, expose a pre-start hook instead of duplicating launch logic. |
| `orchestrator/agent.ts::recordOrchestratorSessionErrorEnvelope` | Records no-decision as stream error and evaluates stream-error fuse. | Keep no-decision self-wake, but stop counting it as stream error. |
| `engine/persist.ts::recordOrchestratorStreamError` | Records provider/session stream failures. | Do not write no-decision contract failures here. |
| `engine/store.ts::listOrchestratorStreamErrorArtifacts` | Reads provider/session stream failures for describe and fuse. | Add a separate no-decision contract failure reader. |
| `engine/describe.ts::recent_stream_failures` | Renders provider/session stream failures. | Add a separate recent no-decision section. |
| `test/engine/runtime-goal-run-convergence.test.ts` | Covers refill wake facts. | Add ordering regression: facts exist when the launched loop reads context. |
| `test/orchestrator/no-decision-stop-process.test.ts` | Covers no-decision self-wake and old stream-error fuse reuse. | Assert no-decision writes the separate artifact and does not trip stream-error fuse. |

## Decision

1. Terminal refill facts must be persisted before an accepted root wake can
   start. The scheduler still decides only by reading model-visible facts; this
   is ordering repair, not a fallback path.
2. `OrchestratorNoDecisionStopError` remains a typed decision-contract
   failure. The host still refuses to treat a no-tool stop as a successful
   workflow decision.
3. No-decision contract failures are not provider/session stream failures.
   They must not increment or trip `maybeTripOrchestratorStreamErrorFuse`.
4. No-decision self-wake remains visible and natural: it writes a durable
   contract-failure artifact, then re-enters `dispatchTaskLoop` so the
   orchestrator reads current task state and decides.

## Acceptance

- A terminal goal refill writes `goal_refill_notification` before the root
  task loop starts reading context.
- Refill dedupe still prevents repeated facts for the same terminal goal-run
  fingerprint.
- `OrchestratorNoDecisionStopError` writes a separate durable artifact and is
  rendered separately from recent stream failures.
- Repeated no-decision history does not trip the stream-error fuse or mark the
  task failed as a stream error.
- Actual provider/session stream failures still write `orchestrator-stream-error`
  and still trip the stream-error fuse after the existing threshold.
- Targeted runtime, describe, and no-decision process tests pass.
