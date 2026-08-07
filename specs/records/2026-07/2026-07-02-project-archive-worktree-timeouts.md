# Project Archive And Worktree Timeout Extension 2026-07-02

## Recall

- User request: make project download timeout and worktree deletion timeout longer.
- Acceptance criteria:
  - Task and Mission project archive downloads use an explicit long transport timeout instead of the default 15 seconds.
  - Project worktree deletion uses an explicit longer finite transport timeout instead of disabling the transport timeout.
  - The timeout values are single-source constants in the owning overlay service modules.
  - Focused tests pin both timeout values at the transport request boundary.
- Hard constraints:
  - No fallback or compatibility path.
  - No broad git reset, no new worktree, and preserve unrelated dirty files.
  - Inspect existing records and grep call points before edits.
  - Keep worktree lifecycle deletion under the existing backend owner; do not add a second remover or retry policy.
- Disk records read before implementation:
  - `specs/current/architecture/10-worktree-lifecycle.md`
  - `specs/records/2026-06/task-project-archive-export-2026-06-04.md`
  - `specs/records/2026-06/mission-project-archive-export-2026-06-18.md`
  - `specs/records/2026-06/2026-06-30-worktree-cleanup-process-quiescence.md`
  - `packages/overlay/src/services/api.ts`
  - `packages/overlay/src/services/host-transport.ts`
  - `packages/overlay/src/services/project-archive.ts`
  - `packages/overlay/src/services/worktree.ts`
  - `packages/opencorvus/src/worktree/index.ts`
  - `packages/opencorvus/src/util/git.ts`
  - `packages/overlay/test/task-project-archive-download-service.test.ts`
  - `packages/overlay/test/worktree-service.test.ts`
- Whole-repository grep evidence:
  - `downloadProjectArchive` is defined once in `packages/overlay/src/services/project-archive.ts` and is called by task and Mission download helpers.
  - `downloadTaskProjectArchive` is called by `packages/overlay/src/components/TaskList.tsx`; `downloadMissionProjectArchive` is called by `packages/overlay/src/components/Mission.tsx`.
  - Project archive backend routes are `GET /task/:taskID/project-archive` and `GET /mission/:missionID/project-archive`; existing backend tests cover archive shape and route errors.
  - `apiRequest` is the binary request entry point for project archives but did not expose `timeoutMilliseconds` to `HostTransport`.
  - `deleteProjectWorktree` and `deleteProjectWorktrees` are defined in `packages/overlay/src/services/worktree.ts` and called by `packages/overlay/src/components/TaskDirBar.tsx`.
  - `deleteProjectWorktree` currently passes `timeoutMilliseconds: null`.
  - Backend worktree deletion remains `Worktree.removeProjectWorktree` -> `removeManagedProjectWorktreeDirectory` -> `Worktree.remove`; physical directory cleanup already uses `DIRECTORY_REMOVE_MAX_RETRIES` and `DIRECTORY_REMOVE_RETRY_DELAY_MS`.
  - Worktree lifecycle records explicitly forbid adding a second deletion policy or alternate remover.
- Independent agent feedback: no independent agent was spawned for this narrow constants-and-tests change; the call-point grep and existing records were sufficient.

## Decision

Use explicit 15 minute transport timeouts for both user-facing long operations.

Project archives can spend time building ZIP bytes and transferring a binary body, so they must not inherit the 15 second default request timeout. The shared binary helper will pass `timeoutMilliseconds` through `apiRequest`, keeping HostTransport as the single transport source.

Worktree deletion should be finite and visible rather than unbounded. The backend path can legitimately spend several minutes waiting for the project git lock, stopping git helpers, removing a large Windows directory, pruning worktree registry state, and deleting the branch. A 15 minute request timeout covers that expected backend envelope without changing backend lifecycle ownership.

## Call-Point Decisions

| Area | Current behavior | Decision |
| --- | --- | --- |
| `services/api.ts::apiRequest` | Supports binary transport but cannot pass `timeoutMilliseconds`. | Add the same timeout option shape used by `apiJson` and forward it to HostTransport. |
| `services/project-archive.ts` | Uses HostTransport default 15 second timeout. | Define `PROJECT_ARCHIVE_DOWNLOAD_TIMEOUT_MILLISECONDS` and pass it to `apiRequest`. |
| `services/task.ts` / `services/mission.ts` | Delegate to `downloadProjectArchive`. | Leave unchanged; they inherit the shared project archive timeout. |
| `services/worktree.ts::deleteProjectWorktree` | Disables transport timeout with `null`. | Define `PROJECT_WORKTREE_DELETE_TIMEOUT_MILLISECONDS` and pass it to `apiJson`. |
| Backend `Worktree.remove` | Single physical remover with existing filesystem retry policy. | Leave unchanged; this request only lengthens client request lifetime. |

## Required Verification

- `bun test packages/overlay/test/task-project-archive-download-service.test.ts packages/overlay/test/worktree-service.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 60000`
- `bun run --cwd packages/overlay typecheck`
- `git diff --check`

## Verification Results

- `bun test packages/overlay/test/task-project-archive-download-service.test.ts packages/overlay/test/worktree-service.test.ts --timeout 60000`: 11 pass.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 60000`: 19 pass.
- `bun run --cwd packages/overlay typecheck`: passed.
- `git diff --check`: passed.
