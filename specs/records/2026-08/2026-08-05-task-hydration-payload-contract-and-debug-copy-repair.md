# Task hydration payload contract and debug-copy repair

## Recall

### User requirement

- Explain why interrupting the visible Task makes its conversation fail to render.
- Explain and repair why copying the Task diagnostic information fails on the same error surface.
- Use the supplied screenshot and the exact running Task rather than treating `cancelled` or `HTTP 500` as the root cause.

### Acceptance criteria

- Restore one explicit persistence boundary for the current immutable `dispatch_lineage` payload contract; a database created before the required payload shape must fail closed as `SCHEMA_RESET_REQUIRED` instead of opening successfully and failing later in Task hydration.
- Keep `SCHEMA_DDL` as the only physical database structure source and preserve the existing database, write-ahead log (WAL), and shared-memory (SHM) files unchanged.
- Do not add a compatibility reader, payload patch, migration, fallback value, automatic reset, or second dispatch-lineage source.
- A selected Task whose hydrate failed can still produce a copyable diagnostic blob from the exact selection failure without requiring another failing board request.
- Focused non-User Interface contracts, typecheck, documentation health, and whitespace checks pass.
- Any User Interface acceptance uses a real page and manually inspected screenshot; no User Interface automated test, fixture, or screenshot baseline is created, modified, or run.
- The completed change is reviewed, committed with the `dsw-33987` prefix, and pushed to `legacy-remote/v0.0.30beta` without disturbing unrelated worktree files.

### Hard constraints

- Do not mutate, reset, delete, rename, migrate, or repair the current on-disk database or any immutable Artifact row without explicit user authorization.
- Preserve Task, Session, workflow, immutable dispatch lineage, and exact adapter-input authority.
- No gate, state machine, compatibility path, negative test, hidden message, synthetic diagnostic message, or User Interface automated test.
- Preserve all unrelated untracked files, including the existing Overlay/browser-preview work and current August records.
- Do not restart, stop, or replace the user's running OpenCorvus or Overlay processes during implementation and isolated verification.

### Evidence read before implementation

- `AGENTS.md`, especially rules 3.1, 6.1, 7, 8, 15, 18, 24, 28, 28.1, 28b, 32, and 33.
- The supplied error screenshot.
- `specs/current/architecture/15-agent-facts-and-turns.md` current Task ingress and continuation addendum.
- `specs/records/2026-08/2026-08-03-current-schema-fresh-database-baseline.md`.
- `specs/records/2026-08/2026-08-05-mirror-watch-workflow-provenance-and-prism-convergence.md`.
- `packages/opencorvus/src/engine/dispatch-lineage.ts`, `engine/describe.ts`, `conversation/turn-artifacts.ts`, `server/routes/orchestrator.ts`, and storage DDL/open-path code.
- `packages/overlay/src/services/task.ts`, `store/board.ts`, `main.tsx`, `components/Conversation.tsx`, and `utils/debug-info.ts`.

### Runtime and repository evidence

- The exact request `GET /task/tsk_fcf8e075a001Wcj6zJYnUkqMaV/conversation?tail_limit=8` returns `HTTP 500` with `Invalid dispatch_lineage artifact art_fcf8f6add001F8v1H00o2lCk0u`: required `adapter_input` is absent.
- The same Task's `/board?sync=1` request fails with the same artifact parser error, while the lean `/task/:taskID` record route remains readable.
- Read-only SQLite inspection shows all 155 persisted `dispatch_lineage` rows lack `adapter_input`; the affected Task owns five such rows. No row was rewritten.
- The affected artifact was created at 2026-08-05 09:35:10 +08:00. The current Overlay and sidecar processes started at 10:25 and 10:27 after the repository/runtime convergence, so interruption only exposed a persisted-payload contract mismatch during re-hydration.
- Commit `4c54e42028` made `adapter_input` required by `DispatchLineagePayloadSchema` and by continuation authority, but the durable database DDL did not receive a structural breakpoint. The exact-schema open path therefore accepted the old database and deferred failure to business readers.
- `copyActiveConversationDebug()` forces `loadBoard({ sync: true, requireFresh: true })` before building the Task blob. On this surface that request repeats the same `HTTP 500`, so `writeDebugClipboard()` is never reached.
- The selected Task failure is already retained as one typed `boardStore.taskSelectionError` containing Task identity, directory, title, and formatted server error details; it is the exact diagnostic source while board hydration is unavailable.
- The branch is synchronized with `legacy-remote/v0.0.30beta`; unrelated untracked files were present before this work and remain outside the repair.

### Whole-repository search evidence

- `dispatch_lineage` has one production writer through `recordDispatchLineage()` and one strict payload parser; current continuation reads `payload.adapter_input` from that immutable lineage.
- `SCHEMA_DDL` is generated from Drizzle declarations plus `STORAGE_EXTENSION_DDL`; the database open path compares tables, columns, indexes, triggers, and virtual tables and reports typed `SCHEMA_RESET_REQUIRED` on drift.
- Task debug copying has one active entry point in `main.tsx`; the existing blob builder requires a hydrated board and has no failure-snapshot builder.
- Existing User Interface tests discovered in unrelated overlay paths were not run or modified. No new User Interface test will be added.

### Independent agent feedback

No sub-agent was commissioned because the user did not request delegation. The primary agent owns implementation and the required second review.

## Causal chain

1. The old runtime persisted immutable `dispatch_lineage` payloads without `adapter_input`.
2. The new runtime made that field mandatory for exact continuation authority but did not change the physical DDL, so the non-empty old database passed exact-schema startup validation.
3. A later Task hydration/board compilation traversed workflow execution and strictly parsed the old Artifact, producing `HTTP 500`.
4. Interrupting the conversation changed visible activity and caused selection/hydration to run again; it exposed the mismatch but did not create it.
5. Diagnostic copying synchronously required a fresh board from the same failing reader, so the copy action aborted before accessing the clipboard.

## Implementation plan

1. Add a current-DDL integrity trigger for the required immutable `dispatch_lineage.adapter_input` object. This is both the current writer constraint and the structural database breakpoint that makes pre-contract databases fail closed at open time.
2. Document the rule that a breaking durable JSON payload contract must change the canonical DDL in the same commit so exact-schema startup owns the break rather than an arbitrary business reader.
3. Add a pure Task-selection-failure diagnostic blob and make the existing copy action select that exact source before any network refresh; healthy Tasks continue to use a freshly loaded board snapshot.
4. Add only positive non-User Interface contract coverage for the current DDL/payload and diagnostic blob result. Do not add or run User Interface automation.
5. Run focused contracts and typechecks, perform isolated real-page interaction plus screenshot inspection for the copy feedback surface if the local application harness can render it without touching the running product, review the final diff, update this record, commit, and push.

## Current on-disk data disposition

The current database remains intentionally unchanged. Because its immutable rows predate the required payload contract, using them under the new continuation model would require either a forbidden compatibility reader or an explicit destructive database reset. The implementation can make this condition fail early and make its diagnostics copyable, but it cannot truthfully convert those rows into current lineage authority.

## Validation record

- `bun test packages/opencorvus/test/storage/db-path.test.ts`: 40 passed, 0 failed, 147 expectations.
- `bun run script/run-unit-tests.ts test/debug-info.test.ts` from `packages/overlay`: 1 passed, 0 failed, 7 expectations.
- `bun run typecheck` from both `packages/opencorvus` and `packages/overlay`: passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`: 62 passed, 0 failed, 1,136 expectations.
- Node-launched `vite build --config vite.config.ts` from `packages/overlay`: passed; existing large-chunk warnings remain informational.
- `bun run check:i18n` from `packages/overlay`: passed with panel hash `d0a34c94f99923db`.
- A real isolated Overlay page connected to the running backend and exposed the exact affected Mission, Task, and `adapter_input` failure. The standalone cross-project Task selection remained on `Loading task`, so the changed double-click copy feedback could not be remounted and visually accepted in that harness. The supplied screenshot is the current exact error presentation, but post-change User Interface interaction acceptance remains explicitly unachieved; no automated User Interface test or synthetic page was used to conceal that limitation.
- The final targeted diff and staged patch were reviewed independently by the primary agent. Unrelated worktree changes and untracked files remained outside this repair.
