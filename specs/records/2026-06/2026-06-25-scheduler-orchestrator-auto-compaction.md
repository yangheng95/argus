# Scheduler Orchestrator Auto Compaction

Date: 2026-06-25

## Problem

The scheduler is the `orchestrator` session kind. It currently reaches provider
context overflow with the visible error:

`Automatic compaction is disabled for workflow session kind=orchestrator (reason=unsupported_workflow_kind)`.

The existing disabled behavior was correct while only worker `stage-attempt`
runtime continuation was implemented. It is now incomplete because the
orchestrator has its own live runtime contract, `orchestrator-wake`, installed
for every active scheduler wake.

## Recall

- The pre-June compaction continuation rewrite record rejected blind workflow
  auto-compaction because compaction could resume with the wrong tool surface.
- `2026-06-17-all-agent-auto-compaction-coverage.md` kept `orchestrator`
  disabled because it was not a `runAgentSession` worker with a
  `WorkerTurnDescriptor`.
- `packages/opencorvus/src/orchestrator/agent.ts` installs an
  `orchestrator-wake` `SessionRuntimeContract` for the active scheduler wake.
- `packages/opencorvus/src/session/loop.ts` already validates
  `orchestrator-wake` contracts without requiring a worker descriptor.

## Decision

Enable automatic compaction for scheduler/orchestrator sessions only when the
live `orchestrator-wake` runtime contract validates for that same session and
agent. Do not treat orchestrator as a stage worker and do not allow cold
orchestrator sessions to compact automatically.

The single compaction request/execution path remains:

- `AutomaticCompaction.decision()` for policy classification.
- `SessionLoop.automaticCompactionDecision()` for live runtime validation.
- `SessionCompaction.create({ auto: true })` for durable control creation.
- `SessionLoop` control consumption for compaction execution and continuation.

For internal scheduler wakes, if a model turn only queues a compaction request,
the `runOnce` runtime turn must remain pending until the post-compaction
scheduler turn actually runs.

## Acceptance

- `orchestrator` is no longer in disabled automatic compaction metadata.
- `orchestrator` automatic compaction rejects without a live
  `orchestrator-wake` contract.
- `orchestrator` automatic compaction queues `compaction_request` with a live
  `orchestrator-wake` contract.
- Stage workers still reject `orchestrator-wake` contracts.
- `acceptance` remains explicitly disabled.
