# Remove Global Project Sentinel - 2026-06-16

## Problem

`Project.fromDirectory` encoded "this directory is not a Git repository" as a
real project row with `id="global"`, `worktree="/"`, and `sandbox="/"`.
That was inherited from the upstream project model, but OpenCorvus task,
session, attachment, and worktree state now all use `project_id` as a durable
ownership key. A shared pseudo-project turns "no project here" into a concrete
project identity and lets unrelated directories collide.

Observed downstream repairs prove the abstraction is wrong:

- `specs/records/2026-06/instance-stale-global-worktree-refresh-2026-06-16.md` patched cached
  `global` contexts because real Git tasks were still seeing `worktree="/"`.
- `specs/records/2026-06/task-global-project-forbidden-2026-06-16.md` patched task persistence
  because `engine_task.project_id="global"` is not recoverable task state.
- `specs/records/2026-06/task-execution-terminalization-2026-06-16.md` had to special-case
  corrupt `global` active tasks during shutdown/startup convergence.

These are symptoms of the same root cause: project discovery must never invent
a shared project identity for non-Git directories.

## Call-Site Audit

Command:

```powershell
rg -n -F 'global' packages/opencorvus/src/project packages/opencorvus/src/task-api packages/opencorvus/src/engine packages/opencorvus/test/engine packages/opencorvus/test/server -g '*.ts'
rg -n 'Project\.fromDirectory|Instance\.provide|Project\.isGitRepo|WorktreeNotGitError' packages/opencorvus/src packages/opencorvus/test -g '*.ts'
```

Relevant findings:

| Area                | Evidence                                                                                                       | Decision                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Project discovery   | `project.ts::fromDirectory` returns `id="global"` for non-Git directories.                                     | Replace with a deterministic directory-scoped id and directory worktree/sandbox.                         |
| Task creation       | `task-api/index.ts::prepareProject` already throws `WorktreeNotGitError` when `Instance.directory` is not Git. | Keep task creation strict; no task persistence in non-Git directory projects.                            |
| Instance cache      | `instance.ts::needsProjectRefresh` only exists because `global` cached `/` after the directory became Git.     | Delete the global-specific refresh; a non-Git directory id can refresh normally when Git is initialized. |
| Worktree operations | `worktree/index.ts` checks `Project.isGitRepo(Instance.directory)` before Git worktree operations.             | Keep strict checks; no alternate cwd guessing.                                                           |
| Legacy rows         | Existing DBs may contain `project_id="global"` rows.                                                           | Treat as corrupt legacy data at task boundaries; do not create new rows in this shape.                   |

Independent review correction:

- The initial audit missed `packages/opencorvus/test/project/*.test.ts`, which
  still fixed the old `id="global"`, `worktree="/"` contract. Those tests are
  now part of the acceptance surface.
- Non-Git directory identity must use the same future identity as `git init`
  will use. `directoryProjectID(directory)` is therefore derived from
  `<directory>/.git`, not from the directory path itself.
- A stale `.git/opencorvus` marker containing `global` is corrupt legacy data.
  `Project.fromDirectory` rewrites it to the local `.git` identity before
  inserting any project row.
- Channel binding conflicts must be detected before root session / intent /
  attachment side effects. Same-binding task creation is serialized by the
  task creation lock, and cross-project bindings are explicit 409 conflicts.
- Shutdown/startup convergence must terminalize corrupt legacy active tasks
  instead of skipping them; skipping is the direct path to active tasks hanging
  forever.

## Fix

- Remove `Project.fromDirectory` returns with `id="global"`.
- For a non-Git directory, return a deterministic directory project:
  - `id = generated(<directory>/.git)`
  - `worktree = directory`
  - `sandbox = directory`
- Do not auto-run `git init`.
- Keep `EngineService.createTask` rejecting non-Git directories with
  `WorktreeNotGitError` before task/session/attachment persistence.
- Keep legacy `project_id="global"` task guards only as corrupt-data handling.
- Rewrite legacy `.git/opencorvus` marker value `global` to the concrete local
  project identity.
- Remove the `worktree="/"` project-boundary sentinel from file/config/
  snapshot/archive code paths.
- Remove channel-binding post-facto recovery. A binding that already points to
  another concrete project is a structured conflict, not a fallback.

## Acceptance

- Opening a non-Git directory through `Instance.provide` yields a project id
  that is not `global`, with `worktree` and `sandbox` equal to that directory.
- Initializing that directory with Git preserves the same project id.
- No new project row with `id="global"` is created by `Project.fromDirectory`.
- Creating a task in a non-Git directory still throws `WorktreeNotGitError`
  and does not create `.git`, task rows, channel bindings, sessions, messages,
  or progress rows.
- A legacy marker file containing `global` is rewritten and does not create a
  `ProjectTable` row with id `global`.
- Existing `project_id="global"` task rows are rejected by ordinary task
  mutation APIs and terminalized by process convergence, never skipped.
- Existing cross-project `/global/*` control routes are unaffected; they are
  route names, not project identities.
