# Windows WMIC Process Cleanup Retirement

Date: 2026-07-07
Status: Implemented and validated
Owner: Codex

## Recall

### User Request

The user asked to review where the `wmic.exe` dependency came from, remove the `wmic.exe` dependency from the Windows cleanup path, and then check compatibility and breakage risk on other platforms.

### Acceptance Criteria

- Explain the origin of the `wmic.exe` dependency from landed records and current source.
- Remove `wmic.exe` from the shared Windows process cleanup path.
- Do not replace it with another external cleanup command such as `taskkill.exe` or PowerShell.
- Preserve single-source process cleanup ownership through `ProcessSupervisor`.
- Keep POSIX process-group and process-tree cleanup behavior unchanged.
- Add focused tests that fail if `wmic.exe` returns to the shared cleanup path.
- Validate TypeScript and relevant process cleanup tests.

### Hard Constraints

- Preserve the dirty worktree and unrelated user changes.
- Do not use git reset or broad revert commands.
- Do not create a new worktree.
- Do not restart, refresh, kill, or otherwise affect running OpenCorvus / overlay processes.
- No fallback or compatibility alias path.
- No UI work or running-process visual validation is required for this backend process cleanup repair.

### Sources Read

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-06-gui-quality-bug-hunt-iteration.md`
- `packages/opencorvus/src/shell/process-supervisor.ts`
- `packages/opencorvus/native/process-supervisor/src/main.rs`
- `packages/opencorvus/native/process-supervisor/Cargo.toml`
- `packages/opencorvus/test/util/process.test.ts`
- `packages/opencorvus/test/runtime/promise-boundaries.test.ts`
- `packages/opencorvus/test/shell.test.ts`

### Repository Search Evidence

- `rg -n "wmic|process-supervisor|ProcessSupervisor|terminateWindowsProcessTree|windowsChildPids|taskkill|JobObject|KILL_ON_JOB_CLOSE|disposeLiveProcessesUnder|terminateProcessTree|terminateProcessGroup" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 AGENTS.md -g "*.ts" -g "*.rs" -g "*.md"`
  - Finding: shared cleanup ownership is `ProcessSupervisor`; Windows shell spawning already requires `opencorvus-process-supervisor.exe`; POSIX cleanup uses detached process groups and `pgrep` for process-tree cleanup.
- `rg -n wmic packages/opencorvus/src/shell/process-supervisor.ts packages/opencorvus/test packages/opencorvus/native/process-supervisor specs/records/2026-07/2026-07-06-gui-quality-bug-hunt-iteration.md`
  - Finding: current runtime `wmic.exe` use is only in `packages/opencorvus/src/shell/process-supervisor.ts`; history records show it came from the July 6 cleanup iteration that removed `taskkill.exe` and used parent-PID traversal for root-exited descendant cleanup.

### Independent Agent Feedback

No subagents were used for this focused repair. The relevant prior independent-agent feedback is already recorded in `2026-07-06-gui-quality-bug-hunt-iteration.md`: LIFE-65/LIFE-66 required one shared Windows cleanup implementation and removal of raw `taskkill.exe` cleanup paths. This task continues that repair by removing the remaining external `wmic.exe` dependency.

## Diagnosis

The current `wmic.exe` dependency is not an original design primitive. It was introduced as the second-stage repair after raw `taskkill.exe` proved unstable. The intent was correct: enumerate descendants by parent process ID so root-exited descendants are still owned by cleanup. The implementation still delegated that enumeration to an external synchronous Windows command:

```text
spawnSync("wmic.exe", ["process", "where", `ParentProcessId=${pid}`, "get", "ProcessId", "/value"])
```

The MirrorTest task failure showed this cleanup primitive can itself time out:

```text
WorktreeCreateFailedError: spawnSync wmic.exe ETIMEDOUT
```

That means the cleanup path still depends on a fragile external command. The correct repair is not another command fallback. The existing Windows native process supervisor already exists and is mandatory for Windows shell process-tree ownership, so process-tree termination should be implemented there using Windows APIs.

## Design

- Extend `opencorvus-process-supervisor.exe` with a `--kill-tree <pid>` mode.
- Implement Windows process snapshot enumeration in Rust using Tool Help APIs, then terminate descendants before the root process with `TerminateProcess`.
- Keep TypeScript `ProcessSupervisor.terminateWindowsProcessTree()` as the single exported cleanup entry, but make it invoke the native helper instead of `wmic.exe`.
- Keep POSIX paths unchanged:
  - `terminateProcessGroup()` remains process-group based.
  - `terminatePosixProcessTree()` remains `pgrep -P` plus direct signals.
- Fail loudly if the Windows native helper is missing. Do not downgrade to root-only cleanup.

## Validation Plan

- `bun test packages/opencorvus/test/util/process.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/shell.test.ts packages/opencorvus/test/runtime/promise-boundaries.test.ts --timeout 30000`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

## Implementation Summary

- Added `opencorvus-process-supervisor.exe --kill-tree <pid>`.
- Implemented Windows process enumeration with `CreateToolhelp32Snapshot`, `Process32FirstW`, and `Process32NextW`.
- Implemented Windows tree termination with `OpenProcess`, `TerminateProcess`, and bounded `WaitForSingleObject`.
- Replaced TypeScript `wmic.exe` parent-PID traversal with a single call to the native helper.
- Changed local helper resolution so development tests prefer the freshly built debug helper over stale source-tree release helpers.
- Updated process and shell tests so Windows cleanup rejects `wmic.exe` / raw `taskkill.exe` and verifies the native helper owns the tree cleanup contract.

## Compatibility Review

- Windows: cleanup still uses `ProcessSupervisor.terminateProcessTree()` as the single exported API. The implementation no longer depends on deprecated `wmic.exe` or raw `taskkill.exe`; it requires the existing native helper that Windows shell supervision already requires.
- POSIX: `terminateProcessGroup()` remains unchanged and still uses detached process groups. `terminatePosixProcessTree()` remains unchanged and still uses `pgrep -P` for explicit process-tree cleanup.
- Test harnesses and runtime callers that already route through `ProcessSupervisor` do not need call-site changes.

## Validation Results

- `cargo check --manifest-path packages/opencorvus/native/process-supervisor/Cargo.toml` passed.
- `cargo build --manifest-path packages/opencorvus/native/process-supervisor/Cargo.toml` passed.
- `cargo build --release --manifest-path packages/opencorvus/native/process-supervisor/Cargo.toml` passed.
- `bun test packages/opencorvus/test/util/process.test.ts --timeout 30000` passed.
- `bun test packages/opencorvus/test/shell.test.ts --timeout 30000` passed.
- `bun test packages/opencorvus/test/runtime/promise-boundaries.test.ts --timeout 30000` passed.
- `bun test packages/opencorvus/test/acceptance/inactivity-timeout-process.test.ts packages/opencorvus/test/mcp/browser-node-launcher.test.ts packages/opencorvus/test/harness/isolated-bun-runner.test.ts --timeout 60000` passed.
- `bun test packages/opencorvus/test/mcp/host-connection-lifecycle.test.ts packages/opencorvus/test/server/pty-routes.test.ts --timeout 60000 --test-name-pattern "host MCP lifecycle|Node PTY bridge"` passed.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 30000` passed.
- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 60000` passed.
- `bun run docs:check` passed.
- `git diff --check` passed with existing CRLF warnings only.
- `rg -n "wmic|wmic\\.exe|spawnSync\\(\"wmic|windowsChildPids|windowsDescendantPids" packages/opencorvus/src packages/opencorvus/native packages/opencorvus/test -g "*.ts" -g "*.rs"` returned no runtime/test/native matches.
