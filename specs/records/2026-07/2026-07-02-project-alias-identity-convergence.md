# Project Alias Identity Convergence

Date: 2026-07-02
Status: Implemented

## Recall

| Item | Details |
| --- | --- |
| User request | Fix the task 404 where `Economy Heatmap` still exists but opening it from `/workspace/markets-world-economy` returns `Task not found`. The user clarified `/workspace/markets-world-economy` is a short linked directory for `/root/.local/share/opencorvus/markets-world-economy`. |
| Acceptance criteria | Linked-path and physical-path spellings of the same real project must converge to one project identity; existing corrupted marker rows for the same filesystem location must not strand old tasks behind a different current `project_id`; project-scoped task reads must no longer 404 for a task whose project row and current directory are the same real location; real linked git worktrees must still share the primary project and remain sandboxes; no fallback file lookup, no cross-project attachment tolerance, and no process restart. |
| Hard constraints | No fallback/compatibility path; no gate mechanism; no blind patch; no git reset; preserve existing dirty `packages/opencorvus/src/provider/models-snapshot.ts`; do not restart, refresh, kill, or otherwise disturb OpenCorvus/overlay; every code change needs focused tests; specs stay under root `specs/`; update the monthly README; after passing tests, perform a second review. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/records/2026-06/2026-06-27-project-path-reference-task-delete-root-repair.md`; `specs/records/2026-06/2026-06-09-project-identity-state-isolation-fix.md`; `packages/opencorvus/src/project/project.ts`; `packages/opencorvus/src/project/project.sql.ts`; `packages/opencorvus/src/project/instance.ts`; `packages/opencorvus/src/server/server.ts`; `packages/opencorvus/src/server/routes/orchestrator.ts`; `packages/opencorvus/src/task-api/index.ts`; `packages/opencorvus/test/project/project.test.ts`; `packages/opencorvus/test/server/project-routes.test.ts`; task debug info at `C:\Users\chuan\.codex\attachments\32e7d892-19ac-4dda-bd96-73fc82a64fb9\pasted-text.txt`. |
| Runtime evidence | `GET /global/tasks?directory=/workspace/markets-world-economy` returned task `tsk_f21b68da1001SyombE1xLMsLxM` under `projectID=8b9e90b619b338df46427dd0b67857fce27b0cb1`; `GET /project/current?directory=/workspace/markets-world-economy` returned `project.id=b40cf4e3dbd6353198a773656fb29db8de8374a1`; `GET /task/tsk_f21b68da1001SyombE1xLMsLxM?directory=/workspace/markets-world-economy` returned 404; `sha1('/workspace/markets-world-economy/.git')` equals `8b9e90b619b338df46427dd0b67857fce27b0cb1`; `sha1('/root/.local/share/opencorvus/markets-world-economy/.git')` equals `b40cf4e3dbd6353198a773656fb29db8de8374a1`. |
| Whole-repository search evidence | `rg -n "Project\\.fromDirectory|fromDirectory\\(|directoryProjectID|sameFilesystemLocation|identify\\(|WorktreeIdentityConflictError|ProjectTable\\.worktree|project_id|Task not found:|routeRequiresProjectDirectory|x-opencorvus-directory|/global/tasks|listGlobalTasks|listProjectTasks|listTaskRows" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 specs/records/2026-06 -g "*.ts" -g "*.md"`; `rg -n "symlink|junction|same real|same filesystem|alias|realpath|legacy marker|copied" packages/opencorvus/test/project/project.test.ts packages/opencorvus/test/server/project-routes.test.ts specs/records/2026-06/2026-06-27-project-path-reference-task-delete-root-repair.md`. |
| Independent agent feedback | None. The user asked for a direct fix in the current worktree; no separate subagent was required to understand the single code boundary. |

## Diagnosis

The existing June 27 repair handles a clean alias path by preserving the visible
selected directory and rewriting an equivalent project row. This incident is a
dirty-state variant: the same real Git directory already has two durable project
IDs, one from the visible link path and one from the physical path. The current
`identify(common, worktree)` function returns the marker ID when the marker's row
matches the current physical worktree, even if another existing project row
already matches the selected visible worktree. That lets the current request bind
to the physical-path project while old tasks remain under the visible-path
project.

The correct single source is filesystem identity of the selected project root.
When multiple project rows point at the same real directory, `Project.fromDirectory`
must converge to the row whose worktree matches the caller-selected path spelling,
rewrite the active `.git/opencorvus` marker to that ID, and update that row as
usual. It must not search for missing task files or allow cross-project task
reads.

## Repair Plan

1. Add a focused `Project.fromDirectory` regression that seeds two project rows
   for one real directory, leaves the marker pointing at the physical-path row,
   opens through the visible alias, and expects convergence to the visible-path
   row.
2. Implement project-row lookup by same filesystem location and selected path
   spelling before accepting a conflicting marker row.
3. Keep copied standalone repository behavior unchanged: copied repos with the
   same marker but different real directories still get local IDs.
4. Run targeted project tests and required spec/document checks.

## Implemented Fix

- `packages/opencorvus/src/project/project.ts`
  - `identify()` now checks for an existing project row whose `worktree`
    exactly matches the caller-selected root path before accepting a stale
    marker value.
  - When that selected-root row exists and the marker points elsewhere,
    `Project.fromDirectory()` rewrites `.git/opencorvus` to the selected-root
    project ID and returns that project.
  - The same selected-root convergence is applied when the `git` binary is
    unavailable.
- `packages/opencorvus/test/project/project.test.ts`
  - Added dirty-state regressions for polluted same-directory markers with and
    without the `git` binary available.
  - Existing copied-standalone and linked-worktree tests remain passing.
- `packages/opencorvus/test/server/project-routes.test.ts`
  - Added an HTTP regression proving `GET /task/:taskID?directory=<linked path>`
    returns 200 when the task belongs to the selected-root project and the
    marker was polluted by the physical-path project ID.
  - Released test `Instance` state before deleting temporary Windows
    junctions, fixing the verification harness's `Invalid handle` cleanup
    failure.

## Verification

Commands run:

```powershell
bun test packages/opencorvus/test/project/project.test.ts -t "converges polluted same-directory marker"
bun test packages/opencorvus/test/project/project.test.ts -t "rewrites a copied standalone marker"
bun test packages/opencorvus/test/server/project-routes.test.ts -t "GET /task/:taskID converges polluted linked-directory project identity"
bun test packages/opencorvus/test/project/project.test.ts
bun test packages/opencorvus/test/server/project-routes.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun run --cwd packages/opencorvus typecheck
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
```

Results:

- Project identity suite: 29 pass.
- Project route suite: 19 pass.
- Historical docs links: 19 pass.
- `packages/opencorvus` typecheck: pass.
- Document health: 46 pass.
- Product docs single source: 4 pass.
