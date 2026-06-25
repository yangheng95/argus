# Orchestrator Under-One-Hour Cancel Boundary

Date: 2026-06-25

## Problem

The orchestrator inferred "8+ minutes without terminal signal" as stale build
evidence, then used `cancel_subagent` to abort goal workers. The codebase has no
goal-level eight-minute stale threshold. Treating a short elapsed duration as
stale evidence lets the scheduler self-authorize cancellation of still-running
agents.

## Recall

- `2026-06-22-orchestrator-live-build-park-prompt.md`: a healthy live build is
  internal engine state; the scheduler should park the wake and wait for
  terminal goal refill facts, not poll or escalate.
- `2026-06-24-a2a-agent-lifecycle-coordination.md`: immediate intervention into
  active workers requires an explicit target-scoped lifecycle action, not free
  text inference or bulk aborts.
- `2026-06-24-scheduler-compact-read-context.md`: normal scheduling decisions
  should use explicit goal-scope facts, not broad stale snapshots.

## Callpoint Sweep

Command basis:

```powershell
rg -n "cancel_subagent|recover_stale|stale|live build|terminal refill|no live ownership|ghost|orphan|running for" packages/opencorvus/src/prompt/core/orchestrator-core.txt packages/opencorvus/test/agent/orchestrator-stale-recovery-prompt.test.ts packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts specs/new-arch/2026-06-22-orchestrator-live-build-park-prompt.md specs/new-arch/2026-06-24-a2a-agent-lifecycle-coordination.md specs/new-arch/2026-06-24-scheduler-compact-read-context.md
```

| Surface | Decision |
| --- | --- |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt` | Add the one-hour self-cancel boundary in the existing lifecycle/control tool paragraph. |
| `packages/opencorvus/test/agent/orchestrator-stale-recovery-prompt.test.ts` | Pin the prompt text so future edits cannot reintroduce short-duration stale cancellation. |
| `packages/opencorvus/src/orchestrator/tools.ts` | No host gate; this is a scheduler prompt correction per prompt-over-host rules. |

## Decision

The orchestrator must not self-initiate `cancel_subagent` or `recover_stale` for
a child that has been running for less than 60 minutes based on its own
stale/ghost inference. Under that boundary, cancellation needs explicit
target-scoped operator instruction or a pending worker coordination request that
asks for cancellation. Otherwise the scheduler parks the wake and waits for real
terminal/refill/coordination evidence.

## Acceptance

- The orchestrator prompt forbids self-initiated cancellation/recovery for
  child agents running under 60 minutes.
- The prompt does not turn elapsed time into stale evidence.
- Tests pin the new prompt contract.
