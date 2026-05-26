# Shell Process Supervisor, 2026-05-25

## Rule Compliance

This plan follows the project rules for a bugfix plan:

- Root cause first: the bug is a missing process lifetime owner, not a weak
  cleanup command.
- Single source: Windows shell execution must move to one supervisor owner; no
  `taskkill` fallback remains in shell cleanup.
- No host-wide killing: the plan forbids process-name, command-line, and
  parent-snapshot cleanup.
- Full-repo grep: call sites and adjacent spawns are enumerated below before
  implementation.
- Tests required: every changed behavior has a targeted test or an explicitly
  gated Windows integration test.
- Review required: independent-agent review feedback is recorded below.

## Problem

OpenCorvus shell tool execution can leave many Node.js runtimes behind on
Windows after a shell command finishes, times out, is aborted, or backgrounds a
descendant. The first user-visible symptom can be overlay stutter even when CPU
and memory are not saturated, because leaked runtimes keep handles, watchers,
IPC pipes, and event-loop work alive.

Overlay virtualization can reduce DOM pressure, but it cannot release leaked OS
processes. It is not the root fix for runtime accumulation.

## Evidence

Documentation evidence:

- Node.js `child_process` documents `detached` plus `unref()` as a way for a
  child process to live independently of its parent. That is useful for true
  background processes, but it is the wrong containment primitive for shell
  tools that must own an entire process tree.
- Microsoft `taskkill /T` ends the specified PID (Process Identifier) and child
  processes started by it. This is a command against the currently observable
  parent-child relation, not a lifetime container.
- Microsoft Windows Job Object is the native unit for managing a process group.
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` terminates associated processes when the
  final job handle is closed, and `TerminateJobObject` terminates every process
  associated with the job.

Repository evidence:

- `packages/overlay/src-tauri/src/main.rs` already uses Windows Job Object plus
  `KILL_ON_JOB_CLOSE` for the overlay-launched OpenCorvus sidecar.
- `packages/opencorvus/src/shell/shell.ts` still uses JavaScript
  `child_process.spawn` plus `taskkill /pid ... /f /t` for Windows shell tree
  cleanup.
- `packages/opencorvus/src/shell/shell.ts` directly spawns shell commands in
  `Shell.run` and `Shell.launch`; `Shell.launch` also unrefs the process for a
  true background launch.
- `packages/opencorvus/src/tool/bash.ts`,
  `packages/opencorvus/src/session/shell-exec.ts`, and
  `packages/opencorvus/src/orchestrator/tools.ts` directly spawn shell commands
  and call `Shell.killTree`.
- `packages/opencorvus/src/tool/bash.ts` background mode calls `proc.unref?.()`
  and relies on a later `Shell.killTree(... allowExitedRoot: true)` lease
  timeout. On Windows that lease is still only a PID-tree cleanup attempt.

References:

- https://nodejs.org/api/child_process.html
- https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill
- https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects
- https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject

## Root Cause

The root cause is that OpenCorvus shell execution is owned by JavaScript process
handles and cleanup commands, not by an OS-level lifetime container on Windows.

`taskkill /T` can only act on a PID tree visible at cleanup time. If the root
shell exits first, or a child has already detached/reparented, the cleanup
authority is gone. A second sweep with PowerShell, CIM, WMI, or command-line
matching changes timing but not ownership, and can kill unrelated user
processes.

Therefore the fix is not to scan harder. The fix is to create the correct owner
at spawn time.

## Full-Repo Grep

Commands used for this plan:

- `rg -n 'Shell\.run|Shell\.launch|Shell\.killTree' packages/opencorvus/src packages/opencorvus/test -g '*.ts'`
- `rg -n 'from "@/shell/shell"|from "../shell/shell"|from "../../src/shell/shell"' packages/opencorvus/src packages/opencorvus/test -g '*.ts'`
- `rg -n 'Process\.run|Process\.spawn|Bun\.spawn|Bun\.spawnSync|child_process|spawn\(|taskkill|Stop-Process|pkill|killall|Shell\.run|Shell\.launch|Shell\.killTree|proc\.unref|unref\?\(\)' packages/opencorvus/src -g '*.ts'`
- `rg -n 'Process\.run|Process\.spawn|Bun\.spawn|Bun\.spawnSync|child_process|node:child_process|spawn\(|exec\(|execSync\(|taskkill|Stop-Process|pkill|killall|fuser -k|Shell\.run|Shell\.launch|Shell\.killTree|import\("@/shell/shell"\)|proc\.unref|unref\?\(\)|\.unref\(' -g '*.ts' -g '*.tsx' -g '*.js' -g '*.mjs' -g '*.cjs' -g '*.rs' -g '*.sh' -g '*.ps1' -g '*.md'`
- `rg -n 'spawn\(|exec\(|taskkill|pkill|killall|Stop-Process|fuser -k' packages/opencorvus/script github packages -g '*.ts' -g '*.tsx' -g '*.js' -g '*.rs'`
- `rg -n 'taskkill|Stop-Process|pkill|killall|xargs kill|fuser -k|process-killing|Shell\.run|Shell\.launch|Shell\.killTree|shell/shell' -g '*.txt' -g '*.ts' packages/opencorvus/src packages/opencorvus/test script`
- `rg -n 'shell/shell|Shell\.run|Shell\.launch|Shell\.killTree' packages/opencorvus/test -g '*.ts'`

Shell-execution replacement table:

| File | Current usage | Disposition |
| --- | --- | --- |
| `packages/opencorvus/src/shell/shell.ts` | Defines `Shell.run`, `Shell.launch`, `Shell.killTree`; Windows cleanup uses `taskkill`. | Replace internals with supervisor. Delete Windows `taskkill` shell cleanup in the same change that routes Windows shell execution to Job Object supervision. |
| `packages/opencorvus/src/tool/bash.ts` | Direct shell `spawn`; foreground timeout/abort and background lease call `Shell.killTree`; background uses `proc.unref?.()`. | Replace direct `spawn` with supervisor. Background mode becomes a supervisor lease. |
| `packages/opencorvus/src/session/shell-exec.ts` | Direct shell `spawn`; abort and post-close cleanup call `Shell.killTree`. | Replace direct `spawn` with supervisor. |
| `packages/opencorvus/src/orchestrator/tools.ts` | Restricted orchestrator bash repair tool direct `spawn`; timeout/abort call `Shell.killTree`. | Replace direct `spawn` with supervisor because it is still shell execution. |
| `packages/opencorvus/src/delivery/tools.ts` | `run_command` uses `Shell.run` and text instructs later `taskkill /F /T /PID`. | Behavior is covered through `Shell.run`; user-facing cleanup text must stop recommending `taskkill`. |
| `packages/opencorvus/src/metrics/executor.ts` | Shell evaluator uses `Shell.run`. | Covered through `Shell.run`; add regression coverage if evaluator timeout semantics change. |
| `packages/opencorvus/src/worktree/index.ts` | Imports `Shell`; grep did not show `Shell.run` / `killTree` usage in this plan's scope. | No process-supervision change. |
| `packages/opencorvus/src/session/system.ts` | Imports `Shell` for prompt/system shell information. | No process-supervision change. |
| `packages/opencorvus/src/platform/capability.ts` | Dynamically imports `@/shell/shell` for shell capability metadata. | No process-supervision change; uses shell selection/capability only. |
| `packages/opencorvus/test/shell.test.ts` | Directly imports `Shell` and tests shell helper behavior. | Update or extend with supervisor assertions as part of the atomic shell migration. |
| `packages/opencorvus/test/tool/bash.test.ts` | Imports `Shell` and tests BashTool foreground/background shell behavior. | Update existing tests to supervisor semantics and add lease/root-exit cleanup assertions. |
| `packages/opencorvus/test/metrics/executor.test.ts` | Mentions `Shell.run` shell behavior in test assumptions. | Review during metrics executor test update; no production process owner. |
| `packages/opencorvus/test/util/process.test.ts` | Tests generic `Process.run` timeout and output behavior. | Generic process utility test, not shell supervisor owner. Keep unless generic `Process` behavior is intentionally changed. |
| `packages/opencorvus/test/util/debug-trace-session-context.test.ts` | Uses `Bun.spawnSync` for debug trace context test setup. | Test harness spawn, not shell supervisor owner. |
| `packages/opencorvus/test/lsp/client.test.ts` | Uses `child_process.spawn` for a fake LSP server. | LSP test harness, not shell supervisor owner. |
| `packages/opencorvus/test/orchestrator/no-host-side-integrity-loop-counter.test.ts` | Uses `Bun.spawn` for orchestrator test isolation. | Test harness spawn, not shell supervisor owner. |

Full spawn inventory outside the shell-execution replacement:

| Area | Reason |
| --- | --- |
| `packages/opencorvus/src/util/process.ts` | Generic argv process wrapper. Keep for non-shell subprocesses in this plan. Do not silently route all `Process.spawn` through the shell supervisor because it would change JSON-RPC, git, rg, formatter, clipboard, and auth semantics in one patch. |
| `packages/opencorvus/src/executor/external-process.ts` | Uses `Process.spawn` for external streaming CLIs and already has early-break teardown. Separate audit item, not shell tool ownership. |
| `packages/opencorvus/src/executor/protocol/json-rpc.ts` | Uses `Process.spawn` for JSON-RPC transports. Separate lifecycle owner; do not mix with shell command supervision. |
| `packages/opencorvus/src/executor/discovery.ts` | Uses `Process.run([...command, "--version"])` for executor version discovery. Version probe, not shell tool ownership; keep out of this shell-supervisor patch. |
| `packages/opencorvus/src/delivery/checks/runtime-readiness.ts` | Direct `node:child_process.spawn` for runtime readiness checks. Separate delivery checker process, not shell tool execution; record as follow-up audit. |
| `packages/opencorvus/src/delivery/checks/project-gate.ts` | Direct `node:child_process.spawn` for project-gate checks and git HEAD. Separate delivery checker process, not shell tool execution; record as follow-up audit. |
| `packages/opencorvus/src/system-terminal/index.ts` | `Bun.spawn` opens a user-visible terminal and intentionally `unref`s after launch. This is user-owned terminal lifecycle, not tool-owned shell cleanup. |
| `packages/opencorvus/src/tui/index.ts` and `packages/opencorvus/src/tui/runtime.ts` | TUI runtime process management with explicit handles. Separate owner; not part of shell tool leak fix. |
| `packages/opencorvus/src/lsp/index.ts`, `packages/opencorvus/src/lsp/server.ts`, `packages/opencorvus/src/lsp/shared.ts` | Long-lived Language Server Protocol servers and installers. Large separate lifecycle surface; not part of this shell-tool repair. |
| `packages/opencorvus/src/cli/cmd/serve.ts` | Existing port-contention cleanup uses `fuser -k` and Windows `taskkill /PID`. This is not shell process ownership. It is a known separate risk and must not be silently changed in this plan. |
| `packages/opencorvus/src/tool/bash.txt` | Tool prompt forbids process-name kills but still documents port cleanup with `xargs kill` / `fuser -k`. Prompt boundary, not shell cleanup owner. Update only if supervisor PID/lease guidance changes user-facing teardown semantics. |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt` | Prompt forbids process-killing patterns including `taskkill`, `Stop-Process`, `killall`, `pkill`, `xargs kill`. Prompt policy boundary; keep aligned with orchestrator restricted bash tests. |
| `packages/opencorvus/src/tool/memory.ts`, `packages/opencorvus/src/permission/arity.ts`, `packages/opencorvus/src/engine/git.ts` | Text/config references to process-killing commands, not shell process owners. No supervision change. |
| `packages/opencorvus/src/cli/cmd/db.ts`, `session.ts`, `auth.ts`, `github.ts`, `pr.ts`, TUI clipboard/editor helpers | CLI integration or interactive helpers. Keep out of this patch unless a direct shell-tool ownership path is proven. |
| `packages/opencorvus/src/ide/index.ts` | Installs IDE extension via `Bun.spawn`. IDE helper lifecycle, not shell tool process ownership. |
| `packages/opencorvus/src/bun/*`, `format/*`, `file/ripgrep.ts`, `tool/grep.ts`, `snapshot/index.ts`, `skill/manager.ts`, `util/git.ts`, `engine/codebase-tools.ts`, `server/routes/app.ts`, `runtime/shims.ts` | Generic tool subprocesses, package queries, formatting, rg, git, app opener, or runtime shims. Separate audit items; not shell tool process ownership. |
| `script/stats.ts` | Root maintenance script runs `bunx prettier`. Repo script lifecycle, not shell tool process ownership. |
| `packages/opencorvus/script/benchmark/overlay-web-benchmark.ts` | Benchmark uses `pkill -9 -f`, Git spawns, and benchmark shell spawn. Benchmark process cleanup is a separate high-risk surface; register as follow-up and do not modify silently in this shell-tool plan. |
| `packages/opencorvus/script/benchmark/image2code-benchmark.ts` | Benchmark wrapper spawns `bun run`. Separate benchmark runner lifecycle, not shell tool execution. |
| `packages/opencorvus/script/benchmark/audit-calculator.ts` | Benchmark/audit helper uses `spawn(..., { shell: true })` and preview server spawn. Separate benchmark runner lifecycle; follow-up audit, not this fix. |
| `packages/opencorvus/script/check/routes.ts`, benchmark quality-gate scripts | Regex/check scripts surfaced by broad grep but not process owners for shell tool runtime leaks. No change. |
| `github/index.ts` | GitHub Action/service helper spawns `opencorvus serve`. Sidecar/server lifecycle, not shell tool execution. No change in this plan. |
| `packages/vscode-extension/src/sidecar/manager.ts`, `packages/vscode-extension/script/*` | VSCode extension sidecar and packaging/e2e scripts spawn OpenCorvus or VSCode helpers. Separate product surface; no change in this shell-tool plan. |
| `packages/sdk/js/src/server.ts` | SDK server helper spawns OpenCorvus command and checks version. Separate SDK lifecycle; no change in this plan. |
| `packages/channel-runtime/src/stt/providers/local-cli.ts` | Channel runtime local speech-to-text provider spawns local binaries and removes temp output. Separate channel runtime lifecycle; no change in this plan. |
| `packages/overlay/src-tauri/src/main.rs` | Overlay sidecar already uses Job Object/Unix process-group ownership. It is evidence for the selected model, not an OpenCorvus shell-tool call site. |
| `packages/overlay/test/*`, `packages/opencorvus/test/cli/*`, root `test/*` | Test harness spawns are not shell-tool production ownership. Keep tests scoped unless they directly assert supervisor behavior. |

## Decision

Introduce a single OpenCorvus process supervisor for shell execution. Windows
uses Job Object. Unix uses process groups. The shell tool and session shell must
spawn through this supervisor instead of owning `ChildProcess` directly.

No fallback cleanup path remains in shell supervision. If the Windows helper
cannot create or assign a Job Object, shell execution fails with an explicit
error rather than silently running without process ownership.

## Design

Create a supervisor module owned by OpenCorvus shell execution:

```ts
interface ProcessSupervisor {
  pid: number
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  exited: Promise<number>
  terminate(exitCode?: number): Promise<void>
  dispose(): Promise<void>
}
```

Supervisor contract:

- Spawn failure, Job Object creation failure, kill-on-close configuration
  failure, or `AssignProcessToJobObject` failure is a command failure. It must
  return a diagnostic error and must not continue unmanaged.
- `terminate()` is idempotent.
- `dispose()` is idempotent and drains/settles stdout, stderr, and exit status
  before the caller returns.
- Windows `dispose()` does not depend on the root PID still existing.
- Exit-code and signal mapping stays centralized in the supervisor, not in each
  caller.
- Background leases hold a supervisor instance, not a raw PID.

Windows implementation:

- A native helper starts the requested command under a Windows Job Object.
- The helper creates the job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
- The helper assigns the shell root process to the job before reporting
  readiness to JavaScript.
- `terminate()` calls `TerminateJobObject`.
- `dispose()` closes the job handle; kill-on-close handles descendants even when
  the original shell root has exited.
- The helper proxies stdout, stderr, and exit code so existing callers can keep
  streaming behavior.
- No command-line scans, image-name kills, parent-PID tree walks, WMI/CIM
  cleanup, or global Node/Bun cleanup.

Unix implementation:

- Move current process-group logic behind the same interface.
- Spawn shell roots as process-group leaders.
- `terminate()` and `dispose()` signal `-pid`.

Implementation vehicle:

- Prefer a small Rust helper derived from the existing overlay Job Object code.
  This keeps the Windows API use in Rust where the repo already has a working
  pattern. The shell helper must be stricter than overlay's current sidecar
  behavior: overlay logs and continues if Job Object setup is unavailable; shell
  execution must fail closed.
- Avoid a Node native addon unless the helper binary proves impossible to ship;
  addon build friction is not needed for the first implementation.

## Semantics

- Foreground shell command: supervisor is disposed on completion, timeout,
  abort, or thrown error.
- Background shell command: command receives an explicit lease owned by the
  supervisor. Lease expiry terminates the job/process group.
- Shell root exits before descendants: descendants are still cleaned because
  the job, not the root PID, is the authority.
- Returned PID is diagnostic only on Windows. It must not be described as the
  cleanup handle.
- `Shell.killTree` should disappear from shell execution call sites after the
  migration. Keeping both `supervisor.dispose()` and `Shell.killTree` would be a
  double-source cleanup design.
- The step that routes a Windows shell path to Job Object supervision must also
  delete the Windows `taskkill` shell cleanup implementation. There is no
  transition period where both are shell cleanup authorities.

## Rejected Approaches

- PowerShell `Get-CimInstance Win32_Process` tree walk plus `Stop-Process`.
- WMI/CIM parent snapshot cleanup.
- Repeated `taskkill /T`.
- Matching command lines such as `orphan-child.js` or `node.exe`.
- Global `taskkill /IM node.exe`, `taskkill /IM bun.exe`, `pkill`, `killall`, or
  similar.
- Overlay-only virtualization or dynamic message destruction as a process leak
  fix.

## Implementation Plan

1. Add `packages/opencorvus/src/shell/process-supervisor.ts` with the interface,
   Unix process-group implementation, and a Windows helper launcher contract.
2. Add a Rust helper under the existing build/release path that can spawn a
   command inside a Windows Job Object and proxy stdio/exit.
3. Make one atomic shell-execution migration change:
   `Shell.run`, `Shell.launch`, `BashTool`, `SessionShell.shell`, orchestrator
   restricted bash, and delivery `run_command` text all switch to supervisor
   semantics together; the Windows `taskkill` shell cleanup implementation and
   shell-call-site `Shell.killTree` usage are deleted in that same change.
4. Delete any now-dead `Shell.killTree` compatibility surface. Do not keep it as
   fallback.

## Tests

Required unit tests:

- `Shell.run` normal completion disposes supervisor exactly once.
- `Shell.run` hard timeout calls `terminate()` and disposes exactly once.
- `Shell.run` idle timeout calls `terminate()` and disposes exactly once.
- `Shell.run` abort calls `terminate()` and disposes exactly once.
- `Shell.launch` uses supervisor ownership and its returned PID is diagnostic,
  not a cleanup authority.
- `BashTool` foreground command uses supervisor and returns existing metadata
  shape.
- `BashTool` foreground normal completion still disposes descendants if the root
  shell exits before a child.
- `BashTool` background command creates a lease and lease expiry terminates the
  supervisor.
- `BashTool` timeout and `ctx.abort` terminate the supervisor.
- `SessionShell.shell` abort and completion paths dispose the supervisor.
- Orchestrator restricted bash timeout/abort uses supervisor, while existing
  command-shape restrictions still reject host-killing patterns.
- Delivery `run_command` no longer emits `taskkill` cleanup guidance.
- Windows supervisor helper creation/configuration/assignment failures fail
  closed with a diagnostic error.
- Static or unit assertion proves `packages/opencorvus/src/shell/shell.ts` no
  longer invokes `taskkill` for shell cleanup.
- Static or unit assertion proves `packages/opencorvus/src/tool/bash.ts`,
  `packages/opencorvus/src/session/shell-exec.ts`, and
  `packages/opencorvus/src/orchestrator/tools.ts` no longer reference
  `Shell.killTree`.
- Static or unit assertion proves delivery `run_command` text no longer emits
  `taskkill` cleanup guidance.

Required integration test:

- Windows-only, explicitly marked, not broad CI by default: spawn a shell
  command that starts a Node.js child which outlives the shell root. Verify via
  the helper's job status or a helper-owned child marker that supervisor dispose
  empties the job. The test must not kill by image name, command-line fragment,
  or global PID sweep.

Existing tests to keep:

- Bash host-killing command rejection tests.
- Current background lease tests, adapted to supervisor semantics.
- Overlay Tauri sidecar Job Object behavior remains separate.

## Acceptance Criteria

- No shell execution path on Windows relies on `taskkill` for process tree
  cleanup.
- Shell foreground, background, timeout, abort, launch, orchestrator restricted
  bash, and session shell paths all use one supervisor abstraction.
- If Windows Job Object creation or assignment fails, shell execution fails
  loudly instead of running unmanaged.
- Targeted tests pass.
- The Windows integration test proves descendants are cleaned after the shell
  root exits without using global process kill.
- No existing user edits are reverted.

## Independent Review

Independent read-only review result: initial plan did not pass. Required fixes
were:

- Add full grep inventory and classify non-shell process owners.
- Remove rollout wording that allowed temporary `taskkill` and Job Object dual
  cleanup.
- Make Windows Job Object setup fail closed.
- Add repo evidence for direct spawn, `taskkill`, `unref`, and background lease
  behavior.
- Expand tests to cover all shell execution entrances and deletion of old
  cleanup.
- Register existing non-shell dangerous cleanup such as `cli/cmd/serve.ts`
  without silently changing it.
- Specify idempotent supervisor semantics and stdio/exit drain behavior.

Second independent read-only review result: revision still did not pass.
Required fixes were:

- Run and record a true full-repo grep, including benchmark scripts, GitHub
  helper, VSCode extension, SDK, channel runtime, overlay, and tests.
- Change implementation ordering to one atomic shell-execution migration so
  `Shell.killTree` / `taskkill` and supervisor are not both live authorities and
  there is no broken middle state.
- Extend old-cleanup deletion tests to `BashTool`, `SessionShell.shell`,
  orchestrator restricted bash, and delivery text.
- Register dynamic `import("@/shell/shell")` in `platform/capability.ts`.

Third independent read-only review result: revision still did not pass.
Required fixes were:

- Include `.txt` prompt files in grep and inventory, especially `bash.txt` and
  `orchestrator-core.txt`.
- Register `packages/opencorvus/src/ide/index.ts` and root `script/stats.ts`.
- Register shell-related tests `packages/opencorvus/test/shell.test.ts` and
  `packages/opencorvus/test/tool/bash.test.ts`.

This revision incorporates first-, second-, and third-round findings.
Fourth independent read-only review result: revision still did not pass.
Required fixes were:

- Register `packages/opencorvus/src/executor/discovery.ts`.
- Register process-related test harness files:
  `packages/opencorvus/test/util/process.test.ts`,
  `packages/opencorvus/test/util/debug-trace-session-context.test.ts`,
  `packages/opencorvus/test/lsp/client.test.ts`, and
  `packages/opencorvus/test/orchestrator/no-host-side-integrity-loop-counter.test.ts`.

This revision incorporates first-, second-, third-, and fourth-round findings.

Fifth independent read-only review result: accepted. Implementation started only
after this acceptance and follows the atomic migration plan above.
