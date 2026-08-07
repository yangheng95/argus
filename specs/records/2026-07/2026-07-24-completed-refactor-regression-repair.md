# Completed Refactor Regression Repair

Date: 2026-07-24

Status: Implemented and validated.

## Recall

| Item | Requirement or evidence |
| --- | --- |
| User requirement | Inspect the completed refactors from the last 12 hours for disconnects, functional breakage, or infrastructure collapse, ignore work still in progress, and repair the confirmed problems. |
| Acceptance | The retired Task Run and task-loop modules have no executable benchmark or route-policy consumers; attachment deduplication preserves the current caller's filename while validating canonical content metadata; archive/delete tests use physical prompt ownership rather than `SessionStatus` as execution proof; targeted tests, builds, generated-source checks, and documentation health pass from the committed candidate. |
| Protected worktree | Preserve every unrelated tracked and untracked parallel change. Do not stash, reset, restore, create another worktree, restart OpenCorvus/Overlay, or broadly stage files. |
| Architecture read | `specs/records/2026-07/2026-07-23-retire-execution-liveness-and-task-run.md` defines Task Run as deleted and `SessionPromptState` as the only physical execution owner. The current `engine/writer.ts`, cancellation scope, route handlers, attachment store, benchmark scripts, transport route policy, and associated tests were inspected. |
| Completed-commit evidence | Clean `HEAD` and `myhexin/v0.0.17beta` both resolved to `42e21354f4ff2d545a15fa1864eedb519610ce88`. A clean archive reproduced one benchmark compile failure, two removed-route benchmark requests, stale route-policy recognition, attachment filename drift, and tests still synthesizing execution from `SessionStatus`. |
| Whole-repository grep | Task Run/task-loop searches found executable residuals in `mission-benchmark.ts`, `overlay-web-benchmark.ts`, transport route policy, its generated JavaScript Software Development Kit (SDK) copy, and the orchestrator abort-funnel test, plus stale production descriptions in Orchestrator and Panel capability text. `AttachmentStore.write` callers consume the returned reference as the current materialization, while `readReference` is the canonical sidecar read. |
| Independent agent feedback | Read-only reviewer `/root/refactor_regression_review` returned `ACCEPT`. It confirmed the retired benchmark/route residuals are absent, attachment dedupe separates current display metadata from canonical sidecar integrity, cancellation tests use exact physical ownership, and partial staging excludes the concurrent acceptance refactor. |

## Root Causes

1. The execution-liveness refactor deleted `task-loop-control.ts`, `Orchestrator.abort`, and `/task/:id/runs`, but two benchmark scripts, the directory-bypass route catalog, one abort-funnel test, and production descriptions were not included in the deletion slice.
2. Attachment deduplication correctly validated an existing canonical sidecar, but returned that historical sidecar instead of the newly constructed per-call reference. Content identity and caller display metadata were conflated.
3. Archive/delete regression tests continued to use `SessionStatus` activity monitors as if they were physical execution owners. The production code correctly stopped accepting that projection after the liveness retirement, so the tests no longer exercised their claimed cancellation-incomplete path.

## Repair

1. Replace Mission benchmark cleanup with the existing process-owned `SessionPromptState` termination primitive and remove all task-loop imports/calls.
2. Delete Task Run fetches and `runCount` from the Overlay benchmark report. Do not add a replacement execution container.
3. Remove `/runs` from the canonical transport route policy, regenerate the JavaScript SDK, and assert that the deleted path is no longer a directory-bypass record route.
4. Keep canonical attachment integrity validation, but return the current call's reference. Preserve the first sidecar filename for canonical reads.
5. Replace status-only cancellation fixtures with exact prompt controllers deliberately registered under a mismatched persisted directory, which produces immediate, physical ownership evidence for the typed conflict. Delete the obsolete ownerless-status convergence assertion.
6. Drive the abort-funnel test with the exact `AbortSignal` accepted by `Orchestrator.processTask`, and remove retired task-loop/Task Run language from active production descriptions.

## Verification

- Transport and benchmark contract suites: 84 tests passed.
- Focused attachment, task-message, directory-route, Chat-route, and physical abort-funnel regressions: 9 tests passed.
- JavaScript SDK build passed in an isolated clean `HEAD` archive with the repair files overlaid; the generated route-policy output was byte-identical to the staged file and the generated OpenAPI/SDK contained no Task Run route.
- Mission benchmark bundled normally. Overlay benchmark bundled after externalizing its unchanged, undeclared `puppeteer-core` import, which predates this repair; the retired route changes introduced no compile error.
- OpenCorvus TypeScript check passed from the isolated candidate.
- Overlay Vite production build passed: 4,951 modules transformed.
- Historical-document links: 21 tests passed.
- Relevant document-health guards for retired runtime contracts, benchmark terminology, and tracked monthly records: 3 tests passed.
- The full current-worktree document-health suite remains temporarily non-green only where parallel in-progress changes have removed an expected Overlay browser fixture and replaced the compaction API before their matching test updates. Those files are outside this repair and are not staged here.
