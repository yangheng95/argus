# OpenCorvus Short Runtime Layout

Date: 2026-06-15

## Problem

The current runtime path layout already shortens full identifiers (IDs) to
`prefix_` plus 12 timestamp/counter hex characters, but it still preserves a
human-readable hierarchy:

```text
.opencorvus/runtime/tasks/<task>/goals/<goal>/runs/<run>/worktree
.opencorvus/runtime/tasks/<task>/sessions/<session>/worktree
.opencorvus/runtime/tasks/<task>/frontend-design/...
```

That hierarchy keeps adding path depth on Windows and can push generated
workspaces past the Windows path length limit. The fix is to shorten both the
runtime root and the nested task/session/run directories.

## Decision

Use `.opencorvus/r` as the only mutable runtime root and replace readable
identifier path segments with deterministic 8-character directory keys derived
from the full ID. Store those keys with a git-style fanout (`ab/cdef12`) instead
of a single flat directory. The key is a SHA-256 hash encoded as base62, not the
legacy 8-character timestamp prefix. The legacy timestamp prefix collided for
IDs created in the same millisecond and must not be reused.

Review update (2026-06-15): the 8-character key maps the full SHA-256 digest
into the complete `62^8` key space. Runtime key lookup is project-scoped, so
unrelated projects cannot make a local `.opencorvus/r` key ambiguous.

New writer layout:

```text
.opencorvus/r/t/<task2>/<task6>/intent/request.md
.opencorvus/r/t/<task2>/<task6>/fd/web-clone-source/...
.opencorvus/r/t/<task2>/<task6>/fr/<session2>/<session6>/research-bundle.md
.opencorvus/r/t/<task2>/<task6>/dr/<session2>/<session6>/research-bundle.md
.opencorvus/r/s/<task-session2>/<task-session6>/trace.jsonl
.opencorvus/r/w/<goal-run2>/<goal-run6>/worktree
.opencorvus/r/w/<task-session2>/<task-session6>/worktree
.opencorvus/r/t/<task2>/<task6>/a/screenshots
.opencorvus/r/t/<task2>/<task6>/bp/<job2>/<job6>/...
.opencorvus/r/b/a/<sha>.<ext>
.opencorvus/r/c/snap/<project>
.opencorvus/r/c/sdiff/<project>/<session8>.json
.opencorvus/r/o/...
.opencorvus/r/l/project-git.lock
```

The database remains the source of truth for full IDs. Runtime paths sacrifice
human readability only; API payloads, database rows, event payloads, and model
visible IDs remain full IDs unless a user-facing prompt is explicitly showing a
filesystem path.

## No Legacy Reader

This project forbids fallback and compatibility logic. New code must not read
old `.opencorvus/runtime/...`, legacy 8-body directories, or full-ID runtime
directories as alternate candidates. Existing local runtime state is disposable;
if it conflicts with the new layout, reset the local runtime/DB rather than
keeping dual-source path readers.

## Rule 35 Grep Evidence

Scope was identified with:

```text
rg -n "ProjectRuntimePaths|runtime-paths|shortPath|runtime/tasks|runtime\\\\tasks|\\.opencorvus/runtime/tasks|\\.opencorvus\\\\runtime\\\\tasks" packages/opencorvus/test packages/opencorvus/src -S
rg -n "tracePathReadCandidatesFromRuntimeRoot|taskRootReadCandidatesFromRuntimeRoot|taskAbsoluteReadCandidatesFromRuntimeRoot|sessionRootReadCandidatesFromRuntimeRoot|sessionDiffPathReadCandidates|RuntimePathIDLookup|legacyShortPath|LEGACY_SHORT_PATH" packages/opencorvus/src packages/opencorvus/test -S
rg -n "\\.opencorvus/runtime|\\.opencorvus\\\\runtime|runtime/tasks|runtime\\\\tasks|runtime/acceptance|runtime\\\\acceptance|runtime/blobs|runtime\\\\blobs|runtime/cache|runtime\\\\cache|runtime/worktrees|runtime\\\\worktrees|runtime/ownership|runtime\\\\ownership" packages/opencorvus/src packages/opencorvus/test packages/opencorvus/script specs -S
```

Primary implementation surface:

| Surface | Decision |
| --- | --- |
| `packages/opencorvus/src/project/runtime-paths.ts` | Single runtime path source; update all writer paths to `.opencorvus/r`. |
| `packages/opencorvus/src/id/id.ts` | Add deterministic 8-character directory key helper; keep full ID generation unchanged. |
| `packages/opencorvus/src/project/runtime-id-lookup.ts` | Resolve path keys through DB enumeration plus hash comparison; remove legacy prefix matching. |
| Trace/session diff readers | Return only the single new path; no legacy read candidates. |
| Prompt/path templates | Replace hardcoded `.opencorvus/runtime/tasks/...` user-facing templates with `ProjectRuntimePaths`-derived `.opencorvus/r/...` strings where code can compute the task key. |
| Tests | Assert path length reduction, same-millisecond uniqueness, and absence of old runtime writers/readers. |

## Review Iteration Fixes

Codex sub-agent review on 2026-06-15 found several short-layout hazards. The
implemented fixes are:

- Worktree GC enumerates `.opencorvus/r/w/<2>/<6>/worktree` leaves and never
  treats first-level fanout buckets as zombie worktrees.
- Runtime ID lookup is project-scoped, resolves fanout keys, resolves logical
  `run_id` values instead of append-only artifact row IDs, and handles
  `task-session` / `goal-run` composite keys.
- Tool-output cleanup scans the new session fanout layout under `.opencorvus/r/s`.
- Benchmark local verification receives `OPENCORVUS_TASK_ID` and
  `OPENCORVUS_PROJECT_DIR`; `html-skeleton-workflow-check` rejects ambiguous
  `.opencorvus/r/t` fanout parents instead of guessing the newest task by mtime.
- Trace override rejects `.opencorvus/runtime` paths and benchmark trace output
  defaults under `.opencorvus/r`.
- Browser-preview evidence writes to `bp/<job2>/<job6>`, stores only
  runtime-relative artifact refs in DB payloads, strips path refs from JSON API
  responses, serves images only through task-scoped binary routes, and rejects
  artifact paths outside `.opencorvus/r`.
- Worktree runtime evidence copies were removed. Frontend-design evidence remains
  canonical under the primary project `.opencorvus/r/t/<task-key>/fd`; build
  prompts receive the canonical primary-project path instead of relying on a
  duplicate `.opencorvus/r` tree inside each managed worktree.
- Legacy `.opencorvus/runtime` worktree fencing and cleanup matching were
  removed from production code. Legacy runtime strings remain only where they
  are explicit reject/filter/reset inputs or tests for those filters.

Residual risk noted by review: there is no persistent write-before collision
registry for 8-character directory keys. Current code derives keys from the full
SHA-256 digest across the complete `62^8` space, has regression coverage for
same-millisecond IDs, and runtime lookup rejects ambiguous DB rows. A physical
write-time guard would require adding a project-scoped directory-key registry or
marker protocol across every runtime writer. That is not implemented in this
iteration and must not be represented as complete.

## Acceptance

- New runtime writers never create `.opencorvus/runtime`.
- Goal and direct build worktree paths are flat under `.opencorvus/r/w`.
- Task-scoped artifacts use `.opencorvus/r/t/<task2>/<task6>`.
- Browser-preview evidence uses `.opencorvus/r/t/<task2>/<task6>/bp/<job2>/<job6>`
  and does not expose filesystem paths in JSON API responses.
- Session trace/tool output uses `.opencorvus/r/s/<task-session2>/<task-session6>`.
- The 8-character key is stable, exactly 8 base62 characters, and does not
  collide for same-millisecond IDs in regression tests.
- Runtime ID lookup resolves full IDs and new 8-character keys, and rejects the
  old 8-character timestamp prefix instead of treating it as a fallback.
- Runtime file filters reject both `.opencorvus/r` itself and every child path.
- Archive/export tests force-add both new `.opencorvus/r/...` and legacy runtime
  files and assert neither leaks into user-facing artifacts.
- Targeted tests for `id`, `project`, `session`, `intent`, `frontend-design`,
  `build-agent` prompt paths, runtime filtering, and git ignore behavior pass.
