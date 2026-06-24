# Build Toolchain Blocker Persistence

Date: 2026-06-24

Superseded by `2026-06-24-retire-auto-iteration.md` for the configuration
decision. The toolchain/publish-blocker responsibility below remains the
incident lesson, but it no longer depends on an `assistant.auto_iteration`
mode.

## Problem

Build sessions previously rendered a bounded repair-pass mode. That wording
gave the Build agent a clean exit path after a package-manager,
dependency-layout, test-runner, browser-runner, port, script, or worktree-merge
preflight failure, even though the static Build core already says pre-checker
failures are toolchain blockers that must be repaired before rerunning the exact
required command.

The result is misleading: `report_build_result(status="failed")` becomes a
normal endpoint for repo-local repairable toolchain failures, and a later retry
can pass after the environment has been partially repaired or stabilized.

A second failure mode appeared in the same evidence: a Build agent can commit
and `merge_back` a partially verified implementation, then report
`status="failed"` because project typecheck/build/browser preview never
actually ran. That publishes code to the primary worktree while the goal-run
correctly remains failed and has no acceptance artifact.

## Call-Site Recall

`rg -n "toolchain|merge_back|report_build_result" packages/opencorvus/src packages/opencorvus/test specs`

- `packages/opencorvus/src/build/agent.ts::renderBuildRepairDiscipline`
  renders the static Build-session repair paragraph.
- `packages/opencorvus/src/prompt/core/build-core.txt` owns the static Build
  terminal and toolchain-blocker contract.
- `packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts` asserts
  Build prompt discipline and the dynamic auto-iteration text.
- `packages/opencorvus/src/orchestrator/agent.ts` already tells Orchestrator to
  route toolchain blockers to the same-task owner; no host-side flow gate is
  needed.

## Decision

Tighten the prompt contract instead of adding host-side gates:

1. Repo-local pre-checker/toolchain blockers are Build-owned. Build must
   keep repairing them while concrete local repair actions remain.
2. Repo-local pre-checker/toolchain blockers are publish blockers too. Build may
   commit local work to preserve progress, but must not call `merge_back` until
   the required checker has actually started, completed, and produced green
   evidence.
3. Build may report failed only when the remaining blocker is external,
   destructive, unowned by the current task, or repeated with no new repair
   action/evidence available.

This keeps `report_build_result(status="failed")` as the honest terminal
contract for real blockers, but removes it as an escape hatch for incomplete
local toolchain repair.

## Acceptance

- Build prompt explicitly says repo-local toolchain/pre-checker blockers remain
  Build-owned while concrete local repair actions exist.
- Build repair discipline is static, not controlled by a retry-loop setting.
- Build prompt forbids `merge_back` while required verification is blocked by
  repo-local dependency/script/port/runner/preview/worktree pre-checker failure.
- Tests assert the above wording.
