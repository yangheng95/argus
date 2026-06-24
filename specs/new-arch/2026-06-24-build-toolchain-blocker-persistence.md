# Build Toolchain Blocker Persistence

Date: 2026-06-24

## Problem

Build sessions currently render `assistant.auto_iteration=false` as a bounded
single repair pass. That wording gives the Build agent a clean exit path after
a package-manager, dependency-layout, test-runner, browser-runner, port, script,
or worktree-merge preflight failure, even though the static Build core already
says pre-checker failures are toolchain blockers that must be repaired before
rerunning the exact required command.

The result is misleading: `report_build_result(status="failed")` becomes a
normal endpoint for repo-local repairable toolchain failures, and a later retry
can pass after the environment has been partially repaired or stabilized.

## Call-Site Recall

`rg -n -F "auto_iteration" specs packages/opencorvus/src packages/opencorvus/test`

- `packages/opencorvus/src/build/agent.ts::renderBuildAutoIterationMode`
  renders the dynamic Build-session auto-iteration paragraph.
- `packages/opencorvus/src/prompt/core/build-core.txt` owns the static Build
  terminal and toolchain-blocker contract.
- `packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts` asserts
  Build prompt discipline and the dynamic auto-iteration text.
- `packages/opencorvus/src/orchestrator/agent.ts` already tells Orchestrator to
  route toolchain blockers to the same-task owner; no host-side flow gate is
  needed.

## Decision

Tighten the prompt contract instead of adding host-side gates:

1. `assistant.auto_iteration=false` remains a host-side retry-loop setting for
   product/implementation repair waves.
2. Repo-local pre-checker/toolchain blockers are outside that bound. Build must
   keep repairing them while concrete local repair actions remain.
3. Build may report failed only when the remaining blocker is external,
   destructive, unowned by the current task, or repeated with no new repair
   action/evidence available.

This keeps `report_build_result(status="failed")` as the honest terminal
contract for real blockers, but removes it as an escape hatch for incomplete
local toolchain repair.

## Acceptance

- Build prompt explicitly says `auto_iteration=false` does not permit stopping
  on repo-local toolchain/pre-checker blockers.
- Dynamic auto-iteration text distinguishes product/implementation repair bounds
  from toolchain persistence.
- Tests assert the above wording.
