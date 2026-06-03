# Task/Session Runtime Isolation for `.opencorvus`

Date: 2026-05-23

Status: design consensus; Agent A/B/C approved after re-review

## Problem

The current project-local `.opencorvus` layout is not safe for parallel tasks.
Several runtime materials are written to project-level fixed paths, so concurrent
tasks and sessions can overwrite each other:

- `.opencorvus/intent/request.md`
- `.opencorvus/frontend-design/frontend-template.md`
- `.opencorvus/frontend-design/evidence-source-manifest.md`
- `.opencorvus/decision-log.md`
- `.opencorvus/worktrees/<name>`
- `.opencorvus/ownership/*`
- `.opencorvus/trace/*`
- acceptance screenshots and check workspaces

SQLite is not the root cause. The database is already the control-plane source
of truth for tasks, sessions, protocol events, and artifacts. The bug is that
disk projections and runtime workspaces do not carry the same task/session/goal
identity.

## Agent Review Consensus

Three independent agents reviewed the codebase from different angles.

### Agent A: Data Model and Migration

Finding: Keep one SQLite control-plane source. Do not split the database per
task or per session because the existing schema already models `project_id`,
`task_id`, and `session_id`, and overlay/task queries rely on cross-session
joins.

Required change: all mutable disk projections must move under a task/session
namespace. No legacy runtime fallback.

### Agent B: Concurrency and Runtime

Finding: file paths are only half of the isolation problem. Worktree directory
names, git branch names, ownership markers, external executor runtime paths,
and cross-process git locking also need task/session identity. The existing
`Worktree.withGitLock` is an in-process map and does not protect two sidecars
or CLI processes.

Required change: worktree roots and branch names must include task/goal/run
identity, and git/worktree mutation needs an on-disk lock.

### Agent C: API, Overlay, and Config Surface

Finding: `.opencorvus` currently mixes user-authored project configuration and
internal runtime state. This makes prompts and tooling ambiguous.

Required change: separate the namespaces sharply. Runtime state must live only
under `.opencorvus/runtime`. Existing project config and extension directories
may stay at the `.opencorvus` top level as the static project control surface,
but prompts must stop describing the entire `.opencorvus` tree as runtime. The
invisible internal tree is `.opencorvus/runtime`.

## Debate Rulings

### Do not use one DB per task/session

Rejected. It would fragment task lists, overlay trees, parent/child sessions,
protocol events, queue state, and garbage collection. It also would not fix the
actual overwrite sites, which are fixed disk paths and git branch/worktree
names.

### Do not solve this with write locks only

Rejected. Locks can prevent corrupt partial writes, but they cannot prevent
task A from later reading task B's freshly written `.opencorvus/intent/request.md`.
Identity must be encoded in the path.

### Do not keep legacy runtime path fallback

Rejected. Old and new runtime paths would create two sources and make stale
material indistinguishable from current material. This project is unreleased;
the correct cut is incompatible for runtime data.

### Keep static project config in `.opencorvus`, isolate runtime below `runtime/`

Accepted. Moving all config out of `.opencorvus` is broader than the parallel
runtime problem and would invalidate existing project customization surfaces.
The design instead makes `.opencorvus/runtime` the only internal mutable
runtime namespace. Static config remains user-authored control-plane input.

## Target Layout

```text
<project>/.opencorvus/
  opencorvus.jsonc
  opencorvus.json
  agent/
  agents/
  command/
  commands/
  plugin/
  skill/
  tools/
  themes/

  runtime/
    locks/
      project-git.lock/

    blobs/
      attachments/
        <sha>.<ext>

    cache/
      snapshot/
        <projectID>/

    tasks/
      <taskID>/
        intent/
          request.md
        decision-log.md
        frontend-design/
          frontend-template.md
          evidence-source-manifest.md
        docs/
          prds/
          plans/
          goals/
          evaluations/
        acceptance/
          screenshots/
            <captureID>/
          check-workspaces/
            <checkID>/
        logs/
          events.ndjson
        goals/
          <goalID>/
            runs/
              <goalRunID>/
                reports/
                refs.json
                worktree/
        sessions/
          <sessionID>/
            trace.jsonl
            tool-output/
            executor/
              <provider>.json
            mcp/

    ownership/
      worktrees/
        <taskID>/
          <sessionID>-<goalRunID>.json
      processes/
        <taskID>/
          <sessionID>-<pid>.json
```

## Source-of-Truth Rules

1. The database remains the authority for task/session/event/artifact facts.
2. Files under `.opencorvus/runtime/tasks/<taskID>` are projections or runtime
   material for that task only.
3. Host code must not read markdown/jsonl projections as authority when the
   database has the canonical row.
4. Runtime paths are derived from one module, `ProjectRuntimePaths`.
5. Business modules must not hand-roll
   `path.join(projectDir, ".opencorvus", ...)` for runtime paths.
6. For in-process OpenCorvus tools, task-scoped relative paths are resolved
   against the primary project directory, not the build worktree. This preserves
   the current `read` tool contract where `.opencorvus/...` means
   `<primary>/.opencorvus/...` even when the session directory is a goal
   worktree.
7. External executors receive absolute paths and explicit runtime context.
8. Content-addressed blobs may be shared, but every task reference to a blob is
   task-scoped in the database. Runtime files are projections, not a second
   authority.
9. Runtime writes use same-directory temporary files plus atomic rename where a
   complete file projection is expected.
10. Git worktree and branch mutation is protected by an on-disk project lock.

## Required Implementation

### Runtime Path Module

Add `packages/opencorvus/src/project/runtime-paths.ts` with at least:

- `projectRuntimeRoot(projectDir)`
- `taskRoot(projectDir, taskID)`
- `taskRelative(taskID, ...parts)`
- `taskAbsolute(projectDir, taskID, ...parts)`
- `sessionRoot(projectDir, taskID, sessionID)`
- `tracePath(projectDir, taskID, sessionID)`
- `toolOutputDir(projectDir, taskID, sessionID)`
- `intentPaths(projectDir, taskID)`
- `decisionLogPaths(projectDir, taskID)`
- `frontendDesignPaths(projectDir, taskID)`
- `acceptancePaths(projectDir, taskID)`
- `docsPaths(projectDir, taskID)`
- `eventLogPath(projectDir, taskID)`
- `attachmentBlobRoot(projectDir)`
- `snapshotCacheRoot(projectDir, projectID)`
- `worktreesRoot(projectDir)`
- `worktreeDir(projectDir, taskID, goalID, runID)`
- `directBuildWorktreeDir(projectDir, taskID, sessionID)`
- `worktreeBranch(input)`
- `ownershipPaths(projectDir, taskID, sessionID, goalRunID?)`
- `projectGitLock(projectDir)`

This module is the only source for runtime paths.

### Materialized Task Projections

Change these projections to task-scoped paths:

- `IntentBundle`: `.opencorvus/runtime/tasks/<taskID>/intent/request.md`
- `DecisionLogBundle`: `.opencorvus/runtime/tasks/<taskID>/decision-log.md`
- `frontendDesignArtifactPaths`: `.opencorvus/runtime/tasks/<taskID>/frontend-design/*`
- `engine/docs`: `.opencorvus/runtime/tasks/<taskID>/docs/*`
- `engine/event-log`: `.opencorvus/runtime/tasks/<taskID>/logs/events.ndjson`
- `AgentTrace`: session trace goes under
  `.opencorvus/runtime/tasks/<taskID>/sessions/<sessionID>/trace.jsonl`

All prompt references must come from these modules. No literal
`.opencorvus/intent/request.md`, `.opencorvus/frontend-design`, or
`.opencorvus/decision-log.md` should remain in business code.

### Relative and Absolute Path Contract

There are two valid path forms:

- In-process OpenCorvus agents use task-scoped relative paths such as
  `.opencorvus/runtime/tasks/<taskID>/intent/request.md`. These are resolved
  against the primary project directory by OpenCorvus tools, not against the
  build session's worktree cwd.
- External executors use absolute paths because their native file tools resolve
  relative paths against the goal worktree cwd.

No caller may infer this rule ad hoc. `IntentBundle.reference`,
`DecisionLogBundle.reference`, and `renderFrontendDesignHandoffReference` select
the path mode at the boundary.

### Worktrees and Branches

Change worktree identity from display names such as `build-${targetLabel}` to
task/goal/run identity.

Recommended worktree directory:

```text
.opencorvus/runtime/tasks/<taskID>/goals/<goalID>/runs/<goalRunID>/worktree
```

Recommended branch:

```text
opencorvus/task/<shortTaskID>/goal/<shortGoalID>/run/<shortGoalRunID>
```

Direct build tasks without a goal must still include task/session/run identity:

```text
.opencorvus/runtime/tasks/<taskID>/sessions/<sessionID>/worktree
opencorvus/task/<shortTaskID>/session/<shortSessionID>
```

`reuseIfValid` may only reuse the same recorded task/goal/run worktree. It must
not reuse a directory solely because a human-readable target label matches.

### Cross-Process Git Lock

Add a filesystem lock under:

```text
.opencorvus/runtime/locks/project-git.lock/
```

All operations that mutate worktree registration, branches, or primary merge
state must hold this lock. The existing in-memory lock may remain as a fast
in-process queue, but it is not the isolation boundary.

The lock must have crash recovery semantics. If implemented as a lock
directory, the directory contains owner metadata with at least PID, hostname,
created-at timestamp, and last heartbeat timestamp. A contender may break the
lock only when the owner PID is not alive on the same host or the heartbeat is
older than the configured stale threshold. If implemented with an OS-bound lock,
the implementation must document that the OS releases it on process death.

Tests must cover a process dying while holding the lock and the next worktree
operation recovering without manual deletion.

### External Executor Context

Codex and Claude Code executor launch must receive:

- `taskID`
- `sessionID`
- `runtimeDir`
- `worktreeDir`

Expose them both as MCP arguments where applicable and environment variables:

- `OPENCORVUS_TASK_ID`
- `OPENCORVUS_SESSION_ID`
- `OPENCORVUS_RUNTIME_DIR`

Only passing cwd is insufficient; cwd identifies the goal worktree, not the
task/session runtime namespace.

### Attachments and Snapshots

Attachments may remain a shared content-addressed blob store if all references
stay in task-scoped database columns. Recommended path:

```text
.opencorvus/runtime/blobs/attachments/<sha>.<ext>
```

Snapshots may remain a shared project object/cache store because existing code
already uses per-call temporary indexes. Recommended path:

```text
.opencorvus/runtime/cache/snapshot/<projectID>
```

Deleting a task must delete only `.opencorvus/runtime/tasks/<taskID>` and then
run blob garbage collection. It must not delete shared blobs still referenced by
other tasks.

### Config and Prompt Semantics

Project config remains user-authored input:

- `.opencorvus/opencorvus.jsonc`
- `.opencorvus/opencorvus.json`
- `.opencorvus/agent`
- `.opencorvus/agents`
- `.opencorvus/command`
- `.opencorvus/commands`
- `.opencorvus/plugin`
- `.opencorvus/skill`
- `.opencorvus/tools`
- `.opencorvus/themes`

This list is descriptive, not a second source. The authoritative static config
surface is the existing config/plugin/theme loaders. Implementation must update
the loader-facing docs and tests rather than inventing a parallel list.

System prompts and file tools must describe only `.opencorvus/runtime` as
internal runtime state. The current blanket statement that `.opencorvus/` is
internal state is too broad after this split.

## Required Call-Point Audit

Before implementation, grep these symbols and update every call site:

- `.opencorvus/intent/request.md`
- `.opencorvus/frontend-design`
- `.opencorvus/decision-log.md`
- `.opencorvus/worktrees`
- `.opencorvus/ownership`
- `.opencorvus/trace`
- `IntentBundle.RELATIVE_PATH`
- `DecisionLogBundle.RELATIVE_PATH`
- `frontendDesignArtifactPaths`
- `Worktree.worktreesRoot`
- `gitCeilingEnvForWorktree`
- `Ownership.Worktree.record`
- `Ownership.Process.record`
- `acceptance-screenshots`
- `acceptance-check-workspaces`
- `AgentTrace.getTraceDir`
- `MCPServe.command`
- `opencorvusMcpServers`
- `.opencorvus/attachments`
- `.opencorvus/logs`
- `.opencorvus/specs`
- `USER_REQUEST_BUNDLE_PATH`
- `AttachmentStore.storageDir`
- `engine/event-log`
- `acceptance/checks/discovery`
- `tool/truncation`
- `Snapshot.gitdir`
- `Global.Path.data, "snapshot"`
- `Global.Path.data, "storage", "session_diff"`
- `engine/git.ts`
- `session/prompt/system.txt`

## Reset and Garbage Collection

`Database.reset(projectDir)` and `/global/db/reset` must delete:

- SQLite database, WAL, and SHM files
- `.opencorvus/runtime`

They must preserve static project config. There is no compatibility cleanup
that migrates old runtime material. If stale legacy runtime directories are
detected after the cut, the reset path removes them as obsolete scratch:

- `.opencorvus/intent`
- `.opencorvus/frontend-design`
- `.opencorvus/decision-log.md`
- `.opencorvus/worktrees`
- `.opencorvus/ownership`
- `.opencorvus/trace`

Outside reset, startup and project bootstrap must hard-fail when those legacy
runtime paths are present. The error must tell the operator to run the reset
path. It must not silently ignore, migrate, or read from the legacy locations.

## Tests

Required focused tests:

1. Two concurrent `createTask()` calls write separate intent bundles under
   different task roots.
2. Two concurrent frontend-design runs write separate frontend template and manifest
   files.
3. Two tasks materialize decision logs concurrently without overwriting.
4. Two direct builds with the same target label produce different worktree
   directories and branches.
5. `reuseIfValid` reuses only the same task/goal/run worktree.
6. Two separate processes invoking `Worktree.create()` serialize through the
   on-disk git lock.
7. A process dying while holding the project git lock does not permanently
   block future worktree operations.
8. External executor config includes taskID/sessionID/runtimeDir and writes
   trace/tool output under the correct session directory.
9. From a build session whose cwd is a goal worktree, the in-process `read`
   tool opens `.opencorvus/runtime/tasks/<taskID>/...` from the primary project
   directory, not from inside the goal worktree.
10. DB reset deletes `.opencorvus/runtime` and preserves static config.
11. Deleting one task removes only its runtime tree and does not remove shared
    blobs referenced by another task.
12. Overlay/API tests confirm no broad internal absolute runtime paths leak
    through SDK responses.
13. `rg` confirms old fixed runtime paths no longer appear in business code.
14. Through the public task/API path, two `queue=false` same-project tasks run
    concurrently and produce isolated runtime roots, worktree dirs, branch
    names, trace files, and executor scratch directories.

## Acceptance

This redesign is accepted when `queue=false` parallel tasks in the same project
can run without sharing mutable runtime files, worktree directories, git branch
names, trace files, or executor scratch paths. Shared stores are allowed only
when they are content-addressed or object-cache style and every live reference
is task-scoped.
