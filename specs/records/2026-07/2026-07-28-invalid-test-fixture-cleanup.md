# Invalid Test and Fixture Cleanup

## Recall

### User request

- Clean up invalid tests after the Architect re-entry and cancellation-attribution repair.
- Preserve real product-contract coverage and remove only assertions that no longer verify observable behavior.

### Acceptance criteria

- Mission route tests create canonical Task root Sessions instead of inserting structurally invalid Task rows.
- Goal Build retry tests explicitly judge the prior immutable Goal attempt before redispatch.
- Overlay tests no longer fail because of missing shared timeline-order helpers.
- Obsolete source/CSS string snapshots that duplicate browser-owned UI acceptance are removed.
- Session deletion refuses to orphan a bound Task when `deleteTasks` is omitted or false.
- Session-deletion TaskArtifact tests model one canonical root-bound Task instead of binding Tasks to child Sessions.
- The affected full test files, documentation health checks, and workspace typecheck pass.

### Hard constraints

- Preserve all parallel work; no stash, reset, broad restore, or new worktree.
- Do not weaken the unresolved-Goal-attempt product invariant.
- Do not restart or interfere with a running OpenCorvus/Overlay process.
- Use Node for any Playwright execution.
- Commit with the `dsw-33987` prefix and push through normal hooks to `myhexin`.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-28-architect-selection-cancellation-attribution-repair.md`
- `packages/opencorvus/src/engine/persist.ts`
- `packages/opencorvus/src/engine/store.ts`
- `packages/opencorvus/src/orchestrator/build-tool.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/server/error-handler.ts`
- `packages/opencorvus/src/server/routes/session.ts`
- `packages/opencorvus/test/server/mission-routes.test.ts`
- `packages/opencorvus/test/server/session-routes.test.ts`
- `packages/opencorvus/test/orchestrator/tools.test.ts`
- `packages/opencorvus/test/task-api/delete-task-artifacts.test.ts`
- `packages/opencorvus/test/task-api/delete-running-task-settle.test.ts`
- `packages/opencorvus/test/fixture/goal-attempt.ts`
- `packages/overlay/test/project-delete-button.test.ts`
- `packages/overlay/test/work-ledger-consolidation.test.ts`
- `packages/overlay/test/task-debug-info.test.ts`
- `packages/overlay/test/runtime-directory-actions.test.ts`
- `packages/overlay/test/task-selection-dead-task.test.ts`
- `packages/overlay/test/panel-message-new-task-directory.test.ts`
- `packages/overlay/test/initial-workspace-restore-directory-sync.test.ts`
- `packages/overlay/test/fixtures/timeline-order.ts`

### Whole-repository search evidence

- `EngineTaskTable` plus `session_id` search showed that the two failing Mission fixtures were the only list/status fixtures in `mission-routes.test.ts` inserting Mission child Tasks without a root Session; later cancellation fixtures already use canonical root Sessions.
- `beginBuildAttempt`, `recordBuildHostObservation`, `startNewAttempt`, and `seedTerminalFailedBuildRun` search found eight retry tests that mislabeled an unresolved Host observation as a terminal Goal attempt.
- `testTaskOrderKey` search found a single missing import in `runtime-directory-actions.test.ts`; all sibling Overlay fixtures import the shared helper from `test/fixtures/timeline-order.ts`.
- Overlay source-string search found hundreds of direct implementation-text assertions. This cleanup is intentionally limited to the eight currently stale Work Ledger/project/status blocks whose observable UI ownership is already covered by browser tests; it does not delete passing contract tests wholesale.
- Session-deletion call-site search found the API route, right-sidebar conversation deletion, Mission deletion, and TaskArtifact tests. Only a Task root Session can own a Task; ordinary conversation and Mission Sessions remain deletable without `deleteTasks`.
- `createTerminalTaskBatch` search proved its second Task was bound to an orchestrator child Session, violating the canonical parentless root invariant. Three useful `deleteSession` cases are rewritten around one Task; the impossible multi-Task cleanup-continuation case is deleted.
- Overlay module-mock search found three files replacing the entire conversation module; two also replaced Server-Sent Events helpers, and `panel-message-new-task-directory.test.ts` replaced the whole i18n module. Scoped spies retain the real directory authority and restore after each file, while the targetless Panel test now uses the real locale fixture.

### Call-site disposition

| Surface                                           | Call sites                                                                            | Disposition                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Mission Task fixture insertion                    | Two local `insertTask` helpers in `mission-routes.test.ts`                            | Create one root Session per Task and persist `session_id`; retain assertions.                              |
| Terminal failed Build fixture                     | `seedTerminalFailedBuildRun` plus six callers                                         | Rename to rejected-attempt semantics and persist exact `rejectGoalAttempt` evidence.                       |
| Completed no-workspace retry                      | One direct `beginBuildAttempt` sequence                                               | Persist `completeGoal` for the exact prior attempt before redispatch.                                      |
| Rejected missing-workspace retry                  | One direct `beginBuildAttempt` sequence                                               | Persist `rejectGoalAttempt` for the exact Host observation and rename the test.                            |
| Overlay timeline order                            | Five uses in `runtime-directory-actions.test.ts`                                      | Import the existing shared helper.                                                                         |
| Stale Work Ledger/project/status source snapshots | Eight failing test blocks                                                             | Delete; browser/runtime tests remain authoritative for rendered structure and interaction.                 |
| Overlay module mocks                              | Three conversation mocks, two Server-Sent Events mocks, and one unnecessary i18n mock | Replace full-module mocks with scoped, restored function spies and the real locale fixture.                |
| Session deletion without Task deletion            | API route and `EngineService.deleteSession`                                           | Reject with `TaskBoundSessionDeletionError` before cancellation or row mutation.                           |
| Session TaskArtifact fixtures                     | Four invalid batch tests                                                              | Rewrite three around one canonical root-bound Task; delete the impossible multi-Task cleanup continuation. |
| Ownerless Session status assertion                | One physical Task deletion test                                                       | Expect canonical `idle` after the Session row and process-local status are released.                       |
| Panel wake-work test                              | `packages/opencorvus/test/tool/panel.test.ts`                                         | Keep unchanged; isolated full-file run passes 26/26.                                                       |

### Independent agent feedback

- Orchestrator review reproduced 99 passing and eight failing tests in isolation and traced all eight to the correct `reject-unresolved-goal-attempt` invariant added after the fixtures were authored.
- Mission/cancellation review identified two missing-root Mission fixtures, four invalid multi-Task Session fixtures, one stale status assertion, two invalid Session-route fixtures, and the real orphaned-Task defect.
- Overlay review classified eight stale source snapshots, three missing-helper failures, two module-mock pollution failures, and an unrelated nondeterministic Git bootstrap observation; Panel `wake_work` passed in isolation and remains unchanged.

## Causal classification

1. Mission and Goal Build failures are invalid fixture state, not invalid behavior coverage.
2. The missing Overlay order-key import is a mechanical fixture defect.
3. The stale UI failures compare source text and exact CSS layout syntax rather than rendered behavior. Keeping them would duplicate and contradict the browser acceptance layer.
4. The earlier Panel failure is process-global test interference: the same full file passes in isolation, so deleting the behavioral test would reduce coverage without removing a deterministic defect.
5. Deleting a Task-owned root Session without deleting the Task is a real product defect, not a test defect. Rejection must happen before any cancellation or database mutation.

## Implementation

- Repair fixture identity at the producer boundary.
- Preserve explicit Goal-attempt judgment; never infer failure from a Host observation.
- Remove only the eight stale implementation-text blocks and one impossible multi-Task Session cleanup case.
- Keep all runtime, API, cancellation, pagination, and browser-oriented behavior tests.
- Replace leaking module mocks with scoped spies and preserve canonical directory resolution.
- Enforce atomic Task/root-Session ownership with a named 409 conflict.

## Verification

- `bun test packages/opencorvus/test/server/mission-routes.test.ts`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts`
- `bun test packages/opencorvus/test/tool/panel.test.ts`
- `bun test packages/opencorvus/test/server/session-routes.test.ts`
- `bun test packages/opencorvus/test/task-api/delete-task-artifacts.test.ts`
- `bun test packages/opencorvus/test/task-api/delete-running-task-settle.test.ts`
- `bun test packages/overlay/test/project-delete-button.test.ts packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/task-debug-info.test.ts packages/overlay/test/runtime-directory-actions.test.ts packages/overlay/test/tree-writer-event-coverage.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
- `bun run typecheck`
