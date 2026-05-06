# OpenCorvus Unattended Iteration Change Record - 2026-05-06

## Scope

This record covers the current thread's scheduler, collaboration closure, and overlay benchmark repair work. The goal was to simplify orchestration, remove misleading duplicate lanes, and make Build, Architect, and Integrity agents collaborate from the same active architectural context.

## Change Checklist

- [x] `a616ba4e1 fix: cascade architecture rework to dependents`
  - Propagated architecture rework context into dependent work so downstream Build agents receive the shared collaboration protocol instead of fragmented local instructions.
- [x] `613173175 fix: create goal runs after build slot acquisition`
  - Moved goal-run creation behind build-slot acquisition so resume and scheduling bind to the actual runnable session.
- [x] `6fe0f3a95 fix: enforce bootstrap collaboration closure`
  - Required bootstrap work to close the shared collaboration loop before later Build execution.
- [x] `47c9d48c6 fix: keep requirements at acceptance granularity`
  - Reduced requirement over-fragmentation so agents receive meaningful acceptance criteria instead of noisy micro-requirements.
- [x] `56d6d1021 fix: remove architect metric challenge lanes`
  - Deleted the metric/challenge architecture side lanes that duplicated the Architect contract and inflated tool/context complexity.
- [x] `90bc53e53 fix: clarify build shell semantics`
  - Corrected Build shell guidance so Windows sessions are not told to use Bash semantics when the active shell is PowerShell.
- [x] `8b86b13f9 fix: preserve requirements across architect specs`
  - Ensured active Architect specs retain requirement rows, preventing Integrity from falsely reporting missing requirements after spec supersession.
- [x] `9ff2587a8 fix: exempt bootstrap deps from import validation`
  - Removed the validator contradiction where every goal had to depend on bootstrap while every dependency also required imports.

## Root Causes Fixed

- Build work could be created before the runnable slot existed, which made resume and session binding fragile.
- Requirements were split too finely, consuming context without improving acceptance clarity.
- Architect had duplicate metric/challenge pathways, creating a second source of architectural truth.
- Build prompts carried platform-mismatched shell wording.
- Active Architect specs could supersede earlier specs without copying requirement rows, making Integrity review operate on an incomplete source of truth.
- Dependency validation treated bootstrap dependencies as ordinary import dependencies, forcing impossible fake imports.

## Verification

- `bun test packages/opencorvus/test/architect/output-tools.test.ts`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts`
- `bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`
- `bun run typecheck`
- Pre-push hooks passed on the pushed commits: SDK import check, AI runtime check, typecheck, API routes check, docs check, overlay i18n check, and secret scan.

## Benchmark Evidence

- `overlay-benchmark-20260506-075036`: Requirement count was reduced from 50 to 25, but Architect still exposed old metric/challenge tools. This led to deleting those duplicate lanes.
- `overlay-benchmark-20260506-080821`: Architect finalized and bootstrap Build passed, but Integrity reported missing requirement rows because the active spec did not preserve them. This led to requirement-row preservation.
- `overlay-benchmark-20260506-083246`: Active requirement rows were confirmed before Architect execution, then Architect hit the bootstrap/import validator contradiction. This led to the bootstrap dependency exemption.
- `overlay-benchmark-20260506-084508`: A rerun was started after the validator fix, but the user interrupted before completion. Full end-to-end overlay delivery after the last validator fix is therefore not yet proven.

## Current State

- The source fixes listed above are committed and pushed.
- The final overlay benchmark run after `9ff2587a8` was interrupted before completion.
- Existing untracked benchmark artifacts remain in the working tree and were intentionally not included in this record commit.
