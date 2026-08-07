# Project Non-Git Identity Drift Repair

Date: 2026-07-05
Status: Implemented

## Recall

| Item | Details |
| --- | --- |
| User request | Investigate the hidden risk behind the fact that one directory is designed to support multiple tasks, and do not start fixing until the investigation is deep enough to explain the real cause and the correct repair path. |
| Acceptance criteria | The investigation must preserve the product boundary that one directory may hold multiple user-visible tasks while one canonical worktree must not split into multiple backend `project_id` namespaces; identify the concrete cause of the calculator hidden-risk chain; explain why the visible `Session not found` / `Task not found` errors were symptoms rather than the root cause; define a repair that removes the identity drift without fallback, cross-project tolerance, DB reset, process restart, or prompt-only masking; add focused regressions for the repaired code path. |
| Hard constraints | No fallback/compatibility logic; no gate mechanism; no blind patch; no git reset; no DB reset; no process restart/refresh/kill; preserve user-visible “one directory, many tasks” support; keep specs under root `specs/`; every code change must ship with focused tests. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/current/architecture/02-data.md`; `specs/records/2026-07/README.md`; `specs/records/2026-07/2026-07-02-project-alias-identity-convergence.md`; `specs/records/2026-07/2026-07-03-project-exact-worktree-identity-convergence.md`; `specs/records/2026-07/2026-07-03-multi-task-storage-namespace-consensus.md`; `specs/records/2026-07/2026-07-05-expert-squad-catalog-stale-session-scope-repair.md`; `packages/opencorvus/src/project/project.ts`; `packages/opencorvus/src/project/instance.ts`; `packages/opencorvus/src/engine/store.ts`; `packages/opencorvus/src/task-api/index.ts`; `packages/overlay/src/services/expert-squad-scope.ts`; `packages/overlay/src/services/expert-squad.ts`; `packages/overlay/src/services/workspace.ts`; `packages/overlay/src/services/task.ts`; `packages/opencorvus/test/project/project.test.ts`; `packages/opencorvus/test/project/instance-cache.test.ts`; `packages/opencorvus/test/server/project-routes.test.ts`. |
| Whole-repository search evidence | `rg -n "directoryProjectID|findExactWorktreeRow|mergeExactWorktreeRows|identify\\(|sameFilesystemLocation|WorktreeIdentityConflictError|fromDirectory\\(" packages/opencorvus/src packages/opencorvus/test`; `rg -n "class Instance|needsProjectRefresh|Instance\\.provide|refreshes a cached directory project" packages/opencorvus/src packages/opencorvus/test/project`; `rg -n "getGlobalTaskBoard|listGlobalTasks|global/tasks|requireTaskInCurrentProject|assertTaskBelongsToCurrentProject" packages/opencorvus/src packages/overlay/src`; `rg -n "expert-squad/catalog|expertSquadCatalogScope|activeSessionID|rootTaskSessionID" packages/opencorvus/src packages/overlay/src`; read-only SQLite queries and log searches against `C:\\Users\\chuan\\.local\\share\\opencorvus\\opencorvus.db` and `C:\\Users\\chuan\\.local\\share\\opencorvus\\log\\**`. |
| Independent agent feedback | None for this targeted root repair. The investigation is based on code, DB, and runtime log evidence already sufficient to identify a concrete single-source defect. |

## Architecture Boundary

The current architecture already documents the intended boundary:

- one directory may contain multiple user-visible tasks / Missions;
- one canonical project worktree/common Git identity must map to exactly one backend `project_id` namespace;
- the system must not represent “multiple tasks in one directory” by minting multiple backend `project_id` rows.

Therefore the hidden risk is not the multi-task product design itself. The hidden risk is backend identity drift that splits one directory into multiple namespaces and then lets different APIs read different authorities.

## Runtime Evidence

### 1. Live calculator duplicate rows

Read-only DB queries on `C:\\Users\\chuan\\.local\\share\\opencorvus\\opencorvus.db` show:

- `project.id = db172da35b7aa7a37fc531f9d9807e6bad8237d6`, `worktree = C:\\Users\\chuan\\myhexin-local\\demos\\economy\\calculator`, created `2026-07-04T17:02:13.519Z`;
- `project.id = 8f937f95d06f5d19c98747b43d937fb228da0254`, same `worktree`, created `2026-07-05T08:25:38.683Z`.

The current backend `GET /project/current?directory=...calculator` resolves to `8f937...`.

### 2. `8f937...` is the natural local directory ID

Direct SHA-1 reproduction shows:

- `sha1("C:\\Users\\chuan\\myhexin-local\\demos\\economy\\calculator\\.git") = 8f937f95d06f5d19c98747b43d937fb228da0254`.

So `8f937...` is the expected local `directoryProjectID(directory)` for the current calculator path.

### 3. `db172...` is an imported durable namespace, not the calculator path hash

`dev.log` from `2026-06-27` contains a `world-economy` session created under `projectID = db172da35b7aa7a37fc531f9d9807e6bad8237d6`.

That proves `db172...` already existed earlier as another durable namespace and was later reused by `calculator`; it is not the natural current calculator path-derived ID.

### 4. The visible failures were downstream symptoms

On `2026-07-05`, overlay/server logs show:

- `GET /task/tsk_f30b24a96001U8k6V6dbWhSP2A/operator-model-context` returned `404 Task not found`;
- `GET /task/tsk_f30b24a96001U8k6V6dbWhSP2A/events` returned `404 Task not found in current project`;
- `GET /expert-squad/catalog?...&sessionID=ses_0cf4db568ffe904Wqo1QXc3jpq` returned `404 Session not found`;
- later delete breadcrumbs under `calculator/.opencorvus/r/t/**/decision-log.md` confirm these tasks and sessions belonged to `projectID = db172...`.

Meanwhile:

- `listGlobalTasks(directory)` filters by `session.directory`, not by current `project_id`;
- task/session-scoped routes such as `requireTaskInCurrentProject` validate against `Instance.current().project.id`.

This is the observed split:

1. same-directory task rows under the old namespace stay visible to directory-scoped listing;
2. current project-scoped/task-scoped routes bind to the new namespace;
3. the user sees “task exists in the list but detail/session routes 404”.

## Root Cause

The root cause is a concrete branch asymmetry in `Project.fromDirectory()`:

- when `git` binary is unavailable, the code already consults `findExactWorktreeRow(directory, [cached, localID])` before choosing a non-git identity;
- when the `git` binary exists but the directory currently has no local `.git`, the code skips exact-row lookup entirely and returns `directoryProjectID(directory)` directly.

That means:

1. a directory can already own an exact existing project row with a durable non-local id such as `db172...`;
2. if `.git` disappears while `git` is still installed, `fromDirectory()` mints a brand-new local hash id such as `8f937...`;
3. exact duplicate convergence never runs for that path because the non-git/git-binary branch never calls `findExactWorktreeRow()`;
4. the directory now has two backend `project_id` namespaces even though product design only intended multiple tasks.

The cache layer adds a second hazard:

- `Instance.needsProjectRefresh()` only refreshes when a cached non-git directory becomes a git repo;
- it does not refresh when a cached git directory loses `.git`.

So even after the identity branch is repaired, a long-lived cached `Instance` can continue to report stale git state until disposal/restart unless the cache refresh rule is made symmetric.

## Why Other “Fixes” Are Wrong

These are symptom-masking paths and must not be used:

- do not change task/session routes to search globally across namespaces;
- do not tolerate foreign `sessionID` or `taskID` in project-scoped APIs;
- do not special-case overlay 404s with retry/fallback masking;
- do not reset the DB;
- do not invent a second user-level project table for this failure chain.

Those paths would hide the single-source defect instead of removing the extra namespace.

## Repair Direction

1. Unify non-git identity resolution so both `git unavailable` and `git installed but local .git missing` consult the same exact-row logic.
2. Reuse an existing exact worktree row when it is the only exact row.
3. If the exact worktree already has duplicate rows, let the existing exact-row convergence logic decide and merge using the local directory hash as the durable preferred id when available.
4. Make `Instance` refresh on both transitions:
   - non-git -> git;
   - git -> non-git.
5. Add focused regressions:
   - polluted non-local project id survives `.git` removal without minting a second namespace;
   - cached instance refreshes after `.git` removal and updates its `git` state instead of serving stale context.

## Expected Outcome

After the repair:

- “one directory, many tasks” remains valid;
- losing `.git` no longer creates a second backend `project_id` row for the same exact directory;
- current live duplicate rows like `calculator` can re-enter the existing exact-row convergence path instead of remaining permanently split;
- project-scoped routes stop disagreeing with directory-scoped task discovery because the directory returns to one backend namespace.

## Validation

- `bun test packages/opencorvus/test/project/project.test.ts`
- `bun test packages/opencorvus/test/project/instance-cache.test.ts`
- `bun test packages/opencorvus/test/server/project-routes.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
