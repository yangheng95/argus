# Short Path Segments

Date: 2026-05-24

## Decision

OpenCorvus runtime filesystem paths derive task, goal, run, and session path
segments from the full identifier with `Identifier.shortPath(id)`, producing
`prefix_` plus the first 12 body characters. The database (DB) remains the
source of truth and continues storing complete IDs in every schema column and
event payload.

Revision, 2026-05-24: the original 8-body segment kept only the high timestamp
bytes. Multiple goals created in one planning burst shared the same 8-body
prefix, so distinct goal IDs collapsed onto one runtime path and branch. The
12-body form keeps the full hex timestamp/counter prefix and is unique for the
ID generator's same-millisecond counter range.

Writers must only create the short runtime path layout:

```text
.opencorvus/runtime/tasks/<short-task>/goals/<short-goal>/runs/<short-run>/...
.opencorvus/runtime/tasks/<short-task>/sessions/<short-session>/...
```

ID generation is unchanged. `Identifier.create()` still produces full IDs.

## Rule 35 Grep Evidence

The implementation scope was identified with:

```text
rg -n "\.opencorvus[\\/]runtime|\.opencorvus[\\/]tasks|runtime[\\/]tasks|tasks[\\/]$|tasks[\\/].*goals|goals[\\/].*runs" packages/opencorvus/src
rg -n "joinPath|path\.join.*taskId|path\.join.*goalId|path\.join.*runId|path\.join.*task\.id|path\.join.*goal\.id|path\.join.*run\.id" packages/opencorvus/src
rg -n "path\.join.*(taskID|taskId|goalID|goalId|runID|runId|sessionID|sessionId|task\.id|goal\.id|run\.id|session\.id)|safeSegment\((taskID|goalID|runID|sessionID|projectID|goalRunID)\)|\$\{(taskID|goalID|runID|sessionID|task\.id|goal\.id|run\.id|session\.id)\}" packages/opencorvus/src
rg -n "runtimeRoot|taskRoot|traceDir\(\)|worktreesRoot|ownershipRoot|taskRootFromRuntimeRoot|path\.relative\([^\n]*(runtime|opencorvus|worktree)|\.opencorvus.*split|split\(.*\.opencorvus|split\(.*tasks|basename\([^\n]*(task|goal|run|session|worktree)" packages/opencorvus/src
```

The single write-side path source is `packages/opencorvus/src/project/runtime-paths.ts`.
Direct callers route through `ProjectRuntimePaths`, with one extra delivery
patch filename under `engine/publisher.ts` that already uses
`ProjectRuntimePaths.deliveryPaths(...)`.

## Legacy Reader

Existing tasks may already have full-ID runtime directories or the legacy
8-body short directories. New writers must not write those legacy segments, but
readers may recognize them as grandfathered legacy data. This is a temporary
multi-reader only, not a multi-source of truth: the full ID remains in DB rows,
and short path segments are derived from that ID.

Exit strategy: after all grandfathered tasks have completed, been cancelled,
or the local DB has been reset by the operator, remove the legacy long-segment
reader in a dedicated cleanup change.

## Non-Goals

- No DB schema changes.
- No ID generator changes.
- No migration or renaming of existing runtime directories.
- No API, engine, or event payload shortening.
