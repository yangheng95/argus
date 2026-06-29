# Windows Supervisor Worktree Lock

## Evidence

- Task `tsk_efa61b2fc001dTzVY6jtyMyKmK` failed after reusing
  `demos/economy/economy_1/.opencorvus/r/w/qM/EY6NMw/worktree`.
- The directory still existed but had no `.git` linkage and was not listed by
  `git worktree list --porcelain`.
- Cleanup of that directory failed while an OpenCorvus-owned process tree still
  had its current working directory inside the broken worktree:
  `opencorvus-process-supervisor.exe -> bash -> bun -> node typescript-language-server -> tsserver`.
- The branch `opencorvus/w/qMEY6NMw` still existed at commit `67e017867353`, so
  the work result was not lost. The broken on-disk directory was a stale runtime
  ownership problem, not a missing branch problem.

## Decision

Do not switch to a fresh worktree merely because the recorded worktree is locked
or broken. That would create a second source of truth for one goal and hide the
original corruption.

Keep one cleanup path:

1. `cleanupGoalWorkspace(directory)`
2. `Instance.dispose()` for that exact directory
3. Language Server Protocol client disposal
4. `ProcessSupervisor.dispose()`
5. `Worktree.remove()`

The fix belongs at the process supervision boundary. On Windows, the helper
reports the child shell PID in `pid.txt`, but the JavaScript handle currently
terminates only the helper process. The public handle must terminate the
reported child PID tree before disposing the helper and deleting the request
directory.

External locks must still surface as cleanup failures. Only OpenCorvus-owned
supervised children are released automatically.

## Call Point Sweep

| Area                                        | Current behavior                                                | Decision                                                        |
| ------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| `goal/runner.ts::cleanupGoalWorkspace`      | Calls `Instance.dispose()` before `Worktree.remove()`.          | Leave as the single cleanup entry.                              |
| `lsp/index.ts` and `lsp/client.ts`          | Shutdown uses the server dispose hook when present.             | Leave; it already delegates to the supervisor.                  |
| `lsp/server.ts::spawnSupervisedStdio`       | Returns a dispose hook backed by `ProcessSupervisor.dispose()`. | Leave; supervisor handle semantics must be corrected.           |
| `shell/process-supervisor.ts::spawnWindows` | Returns the child PID but disposes the helper handle.           | Terminate the reported child PID tree, then dispose the helper. |
| `Worktree.isValid` / `recoverRecorded`      | Rejects non-empty directories missing `.git` linkage.           | Leave; this prevents automatic reuse of corrupted directories.  |
| Orchestrator retry/recover paths            | May see an unrecoverable recorded worktree.                     | Do not add automatic worktree switching.                        |

## Tests

- Add a Windows supervisor test with a fake helper that writes a child PID to
  `pid.txt` and keeps both helper and child alive.
- Assert `ProcessSupervisor.spawnShell()` exposes the child PID and
  `dispose()` terminates that child tree.
- Keep the existing shell test that forbids old `Shell.killTree` style cleanup;
  process-tree cleanup remains centralized in `ProcessSupervisor`.
