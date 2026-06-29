# Build Terminal Finalizer Continuation

Date: 2026-06-22

## Problem

An OpenCorvus build session can finish useful work and end the assistant turn
with prose instead of the required `report_build_result` terminal tool. The
runner correctly raises `TerminalToolMissingError`; accepting prose as the
result would create a second source of truth and hide the missing terminal
contract.

The current build path converts that miss directly to
`BuildAgentContractError("missing_terminal_report")`. Historical audit
`2026-06-21-dispatch-algorithm-agent-audit.md` recorded this as `AGENT-007`:
generic stage continuation intentionally excluded build because goal-run and
worktree ownership semantics needed a build-specific decision.

## Call-Site Recall

- `packages/opencorvus/src/build/agent.ts`
  - registers `report_build_result` and `merge_back`;
  - calls `runAgentSession({ kind: "build", existingSessionID, runtimeContract,
terminalTool })`;
  - converts `TerminalToolMissingError` to `BuildAgentContractError`.
- `packages/opencorvus/src/agent/runner.ts`
  - already supports explicit same-session continuation via
    `AgentSessionContinuation`;
  - appends a visible recovery user message and requires the same finalizer.
- `packages/opencorvus/src/engine/stage-continuation.ts`
  - persists continuation requests as `stage_continuation_request` artifacts;
  - validates stage names through `StageContinuationStage`.
- `packages/opencorvus/src/orchestrator/tools.ts`
  - creates continuation artifacts for non-build stages after finalizer misses;
  - currently treats build misses as retry evidence through
    `BuildAgentContractError`.

## Decision

Build gets a single first-class same-session continuation inside
`BuildAgent.run`:

1. If the OpenCorvus build attempt throws `TerminalToolMissingError` for
   `report_build_result`, create a `stage_continuation_request` with
   `stage="build"`.
2. Re-enter `runAgentSession` with the same build session id, same worktree,
   same goal-run runtime contract, same tool kit, and that continuation
   artifact.
3. Do not parse prose, synthesize a BuildResult, or mark the run successful.
4. If the continuation also misses the terminal tool, surface the existing
   `BuildAgentContractError("missing_terminal_report")`.

This makes the recovery observable and bounded while preserving the single
source of truth: only `report_build_result` can populate `BuildResult`.

## Acceptance

- A build finalizer miss creates a build-scoped continuation artifact.
- The continuation reuses the same session and finalizer contract.
- `stage_continuation_request` accepts `stage="build"` and can be claimed by
  the runner.
- Existing `BuildAgentContractError` behavior remains for repeated misses and
  non-terminal errors.
