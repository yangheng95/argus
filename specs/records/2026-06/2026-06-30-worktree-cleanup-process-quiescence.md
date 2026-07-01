# Worktree Cleanup Process Quiescence

Date: 2026-06-30

DB means Database. LSP means Language Server Protocol. PID means Process
Identifier.

## Recall

- User request: deeply investigate the worktree cleanup failure mode that made
  a passed goal appear failed, explain why cleanup failed, and prevent similar
  follow-up failures.
- Acceptance criteria:
  - A completed build goal remains passed if later workspace cleanup fails.
  - The cleanup path must reduce the actual Windows `EBUSY` risk by terminating
    OpenCorvus-owned live processes whose current working directory is inside
    the completed goal worktree before physical removal.
  - The cleanup path must keep one source of truth:
    `engine/writer.ts::cleanupGoalWorkspaceForGoal` ->
    `goal/runner.ts::cleanupGoalWorkspace` -> `Worktree.remove` / `fs.rm`.
  - External or untracked locks must remain visible cleanup failures and must
    preserve the workspace pointer for diagnosis.
  - No retry loop, delayed fallback remover, alternate worktree switch, hidden
    status rewrite, or route gate may be added.
  - Targeted tests must prove live supervised processes under the worktree are
    disposed before removal and unrelated processes are not touched.
- Hard constraints:
  - Do not restart, kill, refresh, or otherwise disturb the user's running
    OpenCorvus or overlay process.
  - Do not use git reset or broad file restoration.
  - Do not create extra git worktrees.
  - Use `apply_patch` for code edits and keep changes scoped.
- Disk records read before implementation:
  - `specs/current/architecture/10-worktree-lifecycle.md`
  - `specs/records/2026-06/2026-06-25-windows-supervisor-worktree-lock.md`
  - `specs/records/2026-06/2026-06-30-completed-worktree-immediate-reclaim.md`
  - `specs/records/2026-06/2026-06-30-completed-worktree-cleanup-status-boundary.md`
  - `packages/opencorvus/src/goal/runner.ts`
  - `packages/opencorvus/src/worktree/index.ts`
  - `packages/opencorvus/src/shell/process-supervisor.ts`
  - `packages/opencorvus/src/shell/shell.ts`
  - `packages/opencorvus/src/tool/bash.ts`
  - `packages/opencorvus/src/session/shell-exec.ts`
  - `packages/opencorvus/src/lsp/index.ts`
  - `packages/opencorvus/src/lsp/client.ts`
  - `packages/opencorvus/src/lsp/server.ts`
  - `packages/opencorvus/test/shell.test.ts`
  - `packages/opencorvus/test/engine/writer.test.ts`
- Runtime evidence:
  - Read-only DB query found one persisted cleanup error:
    `task_id=tsk_f175ee0cc001ZEV3S05eVFSVGi`,
    `goal_run_id=984e2c10`, `kind=goal_run_attempt`,
    `label=attempt-failed`, error
    `completed worktree cleanup failed: WorktreeRemoveFailedError: EBUSY...`.
  - No other runtime `engine_artifact` row matched
    `WorktreeRemoveFailedError`, `cleanupGoalWorkspace`, or
    `completed worktree cleanup failed`.
  - `decision_log` contains `build_retry_previous_984e2c10`, confirming the
    cleanup error polluted retry context after the status-modeling bug.
- Whole-repository grep evidence:
  - `cleanupGoalWorkspaceForGoal` is the single completed-goal cleanup owner in
    `packages/opencorvus/src/engine/writer.ts`.
  - `cleanupGoalWorkspace` disposes the instance, then calls `Worktree.remove`
    or `fs.rm`, then clears project sandbox and ownership markers.
  - `ProcessSupervisor.spawnShell` call sites are:
    `shell/shell.ts`, `tool/bash.ts`, `session/shell-exec.ts`,
    `orchestrator/tools.ts`, and `lsp/server.ts::spawnSupervisedStdio`.
  - `tool/bash.ts` with `background: true` returns while the supervised process
    continues until its lease expires; that handle is not tied to
    `Instance.dispose`.
  - `shell/shell.ts::launch` also returns a long-running supervised process.
  - LSP clients are instance-scoped: `Instance.dispose` waits for inflight LSP
    spawns and shuts down known clients, so LSP is a separate dispose contract.
  - `lsp/server.ts::spawnStdio` still uses raw child processes for many LSPs;
    this can be investigated separately if future evidence points there. This
    repair targets already-supervised OpenCorvus-owned shell processes.
- Independent agent feedback: no sub-agent was spawned because the user did
  not request parallel agents and the local DB/code evidence is sufficient for
  this scoped repair.

## Failure Pattern

The physical failure is not that `fs.rm` needs more retries. On Windows, deleting
the worktree root can fail with `EBUSY` if any process still has its current
working directory or an open file handle inside that tree. Retrying the same
removal without closing the owner process only stretches the failure window and
can leave a partially deleted directory without `.git` linkage.

The already-fixed status bug was downstream of that: the build had already
persisted completed and delivered artifacts, but the cleanup catch wrote a later
failed goal-run fact. That status write has been removed; this record addresses
the remaining physical cleanup risk.

The remaining process-lifecycle gap is that `ProcessSupervisor` owns useful
handles for bash/background/preview processes, but those handles are only known
to the original tool call. Once a background tool returns, goal cleanup cannot
ask the supervisor, "which OpenCorvus-owned processes still have cwd under this
worktree?" As a result, `Instance.dispose` can succeed and `Worktree.remove` can
still hit a supervised process that is waiting for its lease.

## Decision

Add a cwd-indexed live handle registry inside `ProcessSupervisor`.

`ProcessSupervisor.spawnShell` will register handles that are spawned with a
cwd. The registry entry is removed when the process exits or when its dispose
completes. It is not a second owner; it is the supervisor's own live-process
index.

`goal/runner.ts::cleanupGoalWorkspace` will call the new supervisor cleanup step
after `Instance.dispose` and before `Worktree.remove` / `fs.rm`. This preserves
the current lifecycle order:

1. Dispose instance-scoped state such as LSP clients.
2. Dispose still-live supervised shell processes whose cwd is inside the target
   worktree.
3. Physically remove the worktree through the existing remover.
4. Clear sandbox and ownership markers only after physical cleanup succeeds.

If supervisor disposal fails, cleanup fails visibly before physical removal. If
an external process or raw untracked child still holds a lock, physical removal
continues to fail visibly and the workspace pointer remains available for
diagnosis.

## Call Point Decisions

| Area | Current behavior | Decision |
| --- | --- | --- |
| `shell/process-supervisor.ts::spawnShell` | Returns a handle but does not expose live handles by cwd. | Register cwd-scoped handles and unregister on exit or successful dispose. |
| `shell/process-supervisor.ts` tests | Prove run/launch and Windows helper contracts. | Add a cwd cleanup test that disposes matching handles only. |
| `goal/runner.ts::cleanupGoalWorkspace` | `Instance.dispose` then `Worktree.remove` / `fs.rm`. | Insert `ProcessSupervisor.disposeLiveProcessesUnder(directory)` between those steps. |
| `engine/writer.ts::cleanupGoalWorkspaceForGoal` | Single goal cleanup owner. | Leave unchanged. |
| `tool/bash.ts` background mode | Long-running process survives tool return until lease. | No separate registry here; it flows through `ProcessSupervisor.spawnShell`. |
| `shell/shell.ts::launch` | Long-running process survives launch return. | No separate registry here; it flows through `ProcessSupervisor.spawnShell`. |
| `lsp/index.ts` / `lsp/client.ts` | Instance dispose owns LSP shutdown. | Leave unchanged for this repair. |
| `lsp/server.ts::spawnStdio` | Raw child process helper for many LSPs. | Do not expand scope without new evidence; avoid mixing raw LSP supervision with this background-process fix. |
| `Worktree.remove` | Canonical physical remover and zombie cleanup path. | Leave unchanged; do not add retries or alternate deletion. |

## Required Verification

- `bun test packages/opencorvus/test/shell.test.ts --test-name-pattern "live supervised handles"`
- `bun test packages/opencorvus/test/engine/writer.test.ts --test-name-pattern "disposes live supervised processes before removing a completed goal worktree"`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "goal build success records completed workspace cleanup refusal"`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`
