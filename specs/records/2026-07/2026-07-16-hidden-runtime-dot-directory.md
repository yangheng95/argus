# Hidden Runtime Dot Directory

Date: 2026-07-16

## Recall

### User request

Rename the project-local OpenCorvus runtime directory from
`.opencorvus/r/` to `.opencorvus/.r/`. The runtime directory is host-owned,
untracked state and should be hidden by default. This is a repository-wide
contract change with a high risk of missed call sites.

### Acceptance criteria

1. `ProjectRuntimePaths` emits `.opencorvus/.r` as the only runtime root.
2. Production code has no reader, writer, path detector, Git exclusion, prompt,
   or archive rule that still treats `.opencorvus/r` as active runtime state.
3. No compatibility reader, migration, alias, fallback, or dual-write is added.
   Existing disposable `.opencorvus/r` state is not adopted.
4. `.opencorvus/.r/` is ignored and excluded from checkpoints, exports,
   archives, package imports, source enumeration, and durable `owned_paths`.
5. Runtime worktree detection and `GIT_CEILING_DIRECTORIES` recognize the dot
   directory on Windows and POSIX paths.
6. Current prompts, fixtures, generated source data, and current architecture
   documentation use `.opencorvus/.r`.
7. A tracked repository contract test rejects any future active
   `.opencorvus/r` occurrence outside immutable historical records and the
   migration record's explicit old-path statements.
8. Targeted runtime, Git, worktree, export/archive, prompt, acceptance, and
   Overlay tests pass; typecheck and document-health checks pass.
9. Benchmark success is followed by a manual diff and grep review.

### Hard constraints

- No fallback, compatibility path, migration, dual source, or state-machine
  gate.
- The physical runtime state is disposable; the new writer replaces the old
  writer directly.
- Preserve unrelated dirty-worktree changes and never use `git reset`.
- Historical records remain truthful evidence of the path that existed when
  they were written. They are not active contracts and must not be rewritten.
- Do not restart or otherwise disturb a running OpenCorvus/Overlay process.
- Commits on the beta delivery line use the `dsw-33987` subject prefix and push
  to the `legacy-remote` remote.

### Read from disk before implementation

- `AGENTS.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-06/2026-06-15-opencorvus-short-runtime-layout.md`
- `specs/records/2026-07/2026-07-01-build-staged-reference-single-source.md`
- `specs/records/2026-07/2026-07-03-multi-task-storage-namespace-consensus.md`
- `packages/opencorvus/src/project/runtime-paths.ts`
- `packages/opencorvus/src/engine/git.ts`
- `packages/opencorvus/src/engine/workspace-export.ts`
- `packages/opencorvus/src/worktree/git-ceiling.ts`
- `packages/opencorvus/src/goal/runner.ts`
- `packages/opencorvus/test/project/runtime-paths.test.ts`
- root and package `.gitignore` files

The 2026-06 short-layout decision establishes `ProjectRuntimePaths` as the only
runtime-path authority and explicitly forbids legacy readers. The current data
architecture identifies the attachment byte pool under that runtime root.

### Full-repository grep evidence

The pre-change inventory used all of the following searches, excluding only
`.git`, dependencies, generated build output, and scratch artifacts:

```text
rg -n --hidden "\\.opencorvus[/\\\\]r(?:[/\\\\]|\\b)"
rg -n --hidden "path\\.(?:posix\\.)?join\\([^\\r\\n]*['\"]\\.opencorvus['\"][^\\r\\n]*['\"]r['\"]"
rg -n --hidden "projectConfigRoot\\([^\\r\\n]*\\), *['\"]r['\"]"
rg -n --hidden "^\\.opencorvus/r/?$|^\\.opencorvus/r/"
rg -n --hidden "\\.opencorvus/(?:runtime|worktrees)|\\.opencorvus-worktrees"
```

Active call sites were found in these surfaces. Every listed file is replaced
or retained for an explicit reason; there is no sample-based inference.

| Surface | Exhaustive pre-change files | Disposition |
| --- | --- | --- |
| Path authority and path recognition | `project/runtime-paths.ts`, `worktree/git-ceiling.ts`, `goal/runner.ts`, `expert-squad/registry.ts`, `web-clone/source-skeleton.ts` | Replace `r` with `.r`; keep one canonical root and exact dot-directory recognition. |
| Git, archive, package, and source filtering | root `.gitignore`, package/test `.gitignore` files, `engine/git.ts`, `engine/workspace-export.ts`, `tool/ls.ts`, `acceptance/surface-detector.ts`, `acceptance/specialists/test-integration.ts`, `project/isolated-check-workspace.ts` | Replace active short-root rules. Existing explicitly rejected historical long roots remain rejection inputs, not readers. |
| Runtime producers/consumers and comments | `worktree/index.ts`, `worktree/gc.ts`, `build/agent.ts`, `build/prompt-context.ts`, `engine/describe.ts`, `engine/persist.ts`, `engine/ownership.ts`, `engine/model.ts`, `orchestrator/goal-diagnostics-tool.ts`, `decision-log/index.ts`, `decision-log/bundle.ts`, `intent/request-prompt.ts`, `intent/bundle.ts`, `frontend-design/agent.ts`, `frontend-design/handoff.ts`, `frontend-design/tools/output-dir.ts`, `mission/schema.ts`, `tool/mission-state.ts`, `trace/index.ts`, `storage/attachment-store.ts` | Replace all path templates, diagnostics, and documentation with `.opencorvus/.r`. Runtime calculations continue to flow through `ProjectRuntimePaths`. |
| Model-visible contracts | `prompt/core/architect-core.txt`, `prompt/core/build-core.txt`, `prompt/core/mission-core.txt`, `session/prompt/system.txt`, `architect/output-tools.ts` | Replace the active read-only/never-commit contract, with no alternate old-root instruction. |
| Tests and fixtures | `test/project/**` runtime/worktree suites; `test/engine/**` Git/export/describe/goal suites; `test/acceptance/**`; `test/architect/**`; `test/build-agent/**`; `test/browser-preview/**`; `test/frontend-design/**`; `test/agent/context-packet.test.ts`; `test/visual-qa/**`; `test/tool/**`; `test/orchestrator/tools.test.ts`; `test/server/task-project-archive.test.ts`; `test/expert-squad/package-manager.test.ts`; Overlay worktree and task-dirbar tests; `script/benchmark/mission-benchmark.ts` | Replace fixtures and assertions. Add a negative assertion that `.opencorvus/r` is not treated as the current runtime root. Preserve explicit long-layout rejection fixtures only where the test proves filtering of unsupported host state. |
| Current docs and tracked generated/example source | `specs/current/architecture/02-data.md`, `packages/ainvest-amd-replica/src/assets/sourceEvidencePolicy.ts`, `packages/ainvest-amd-replica/src/data/amdReplicaData.ts` | Update current contracts and live example evidence refs. Historical `specs/records/**` remain unchanged except this migration record and indexes. |

No independent agent was used because the active execution policy forbids
delegation unless the user explicitly requests it. The exhaustive grep and
second review remain the primary agent's responsibility.

## Root cause and design

`r` was chosen in the earlier short-layout change solely to save path length.
It is host-owned runtime state but lacks the filesystem-level hidden marker used
by the surrounding `.opencorvus` configuration namespace. The single-source
repair changes the final segment owned by `ProjectRuntimePaths` from `r` to
`.r`, then updates the few callers that incorrectly recognize the runtime root
with string inspection instead of consuming the authority.

The change intentionally does not move existing data. Reading or moving the old
directory would create compatibility behavior and make two physical roots
meaningful. A fresh process writes only the new root; stale local runtime state
may be removed separately only by an explicitly authorized reset.

## Benchmark

### Task and I/O

- Input: the tracked repository plus the canonical runtime-root constant.
- Expected output: all active runtime contracts resolve to `.opencorvus/.r`,
  while unsupported `.opencorvus/r` is neither read nor emitted.
- Environment: Windows host workspace at the repository root; Bun/Node runtimes
  from the checked-in toolchain and existing workspace dependencies. No running
  OpenCorvus/Overlay process is required or modified.

### Timeout

Each benchmark command is observed for stdout/stderr activity. A command is
failed only after 180 seconds without new output; elapsed wall-clock time from
process start is not itself a timeout condition.

### Executable checks

1. Add a tracked `runtime-dot-directory-contract` test that scans current
   production, test, prompt, fixture, current-doc, and example-source files and
   rejects active `.opencorvus/r` literals or split path joins.
2. Run targeted Bun tests for `project/runtime-paths`, worktree Git ceiling and
   lifecycle, engine Git ignore/export, task archive, package import filtering,
   build/frontend/visual prompt paths, and acceptance runtime filtering.
3. Run package typecheck and the required historical-docs-links/document-health
   tests.
4. Run the same full-repository grep after implementation. Any unexplained
   non-historical match fails the benchmark.

## Implementation status

- [x] Recall and exhaustive pre-change inventory.
- [x] Canonical path and direct-recognition replacement.
- [x] Git/export/archive/filter replacement for the active `.r` root.
- [x] Prompt/runtime/example/current-doc replacement.
- [x] Regression benchmark implementation, including escaped-regex and Windows-literal detection.
- [x] Targeted verification and iterative repair for the `.r` contract.
- [x] Manual second review.
- [x] Isolated commit and legacy remote push without unrelated worktree changes.

## Dead or obsolete code

The implementation audit confirmed that `.opencorvus/runtime` is the retired
pre-2026-06-15 long layout. It has no current writer. Remaining production
references are tombstone protections: Trace rejects the old root; Git ignore,
archive/export, source enumeration, and `owned_paths` filters prevent stale
files from leaking; prompts describe it as forbidden. The user was asked whether
to delete this retired compatibility surface as required by rule 17; the answer
is pending. No `.opencorvus/r` reader or compatibility path remains.

## Verification evidence

- Runtime contract, canonical paths, and Git ceiling: 15/15 passed.
- Git ignore/export, acceptance filtering, task archive, worktree lifecycle,
  and Overlay worktree service: 29/30 initially passed; the one failure exposed
  an invalid expert-squad fixture. After replacing it with the canonical valid
  package fixture and disabling the test's fixed 5-second timeout in favor of
  the inactivity runner, `git-ignore.test.ts` passed 5/5 once. Two final reruns
  reached 4/5 because the Windows process supervisor exited before publishing
  readiness for an expected-fast-exit Git command; the failing assertion body
  was not entered. A proposed native ready-marker ordering change was compiled
  into an isolated release helper and failed to change the result, so that
  unproven tool patch was removed rather than retained.
- Expert-squad runtime-source rejection/export and managed Build runtime-copy
  checks: 3/3 passed.
- Research/Mission/runtime core group: 65/67 passed. Both failures were Windows
  process-supervisor readiness exits in Git fixtures; all path-contract tests
  passed. A separate frontend prompt regression exposed and then verified the
  escaped regex hardcode in `research/schema.ts`.
- Full workspace typecheck: passed across 10 typechecked packages.
- `historical-docs-links` plus `document-health`: 74/74 passed.
- Broader frontend suites reported unrelated pre-existing failures in removed
  Build exports, changed handoff wording, and Browser Node sidecar output. They
  are not counted as `.r` acceptance evidence.
