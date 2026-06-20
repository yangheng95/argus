# Runtime Isolation First Repair

Date: 2026-06-20

## Problem

Multiple same-project tasks can still derive mutable runtime paths from the
ambient session directory. A build session runs inside a managed worktree, so
ambient directory/worktree values are not always the primary project runtime
root.

## Recalled Constraints

- `specs/new-arch/2026-05-23-task-session-runtime-isolation.md`: mutable runtime
  paths must be task/session scoped and derived from `ProjectRuntimePaths`; a
  build session must resolve task runtime under the primary project directory,
  not under the goal worktree.
- `specs/new-arch/2026-06-15-opencorvus-short-runtime-layout.md`: the only
  mutable runtime root is `.opencorvus/r`; no legacy readers or dual layouts.
- `specs/new-arch/2026-06-19-g1-g2-orchestrator-runtime-single-source-repair.md`:
  do not repair runtime drift by reading both primary and worktree runtimes.
- `specs/task-global-project-forbidden-2026-06-16.md`: task project binding is
  strict corrupt-data handling, not recoverable cross-project lookup.

## Call-Point Audit

Commands run before editing:

```powershell
rg -n "ProjectRuntimePaths\.(projectGitLock|toolOutputDir|taskAbsolute|taskRoot|sessionRoot|browserPreview|eventLogPath|tracePath|worktreeDir|directBuildWorktreeDir|ownershipPaths)" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test -S
rg -n "withGitLock|projectGitLock|acquireDiskLock|toolOutputDir\(|browserPreviewTaskEvidenceRoot|findReadableBrowserPreviewEvidence|resolveBrowserPreviewTarget\(|taskBrowserPreviewTarget\(|verifyBrowserPreview\(|compareBrowserPreviewRegions\(" packages/opencorvus/src packages/opencorvus/test -S
rg -n "routeRequiresProjectDirectory|directoryContext|requireTask\(|getTask\(|taskID|taskId" packages/opencorvus/src/server packages/overlay/src/services packages/overlay/src/components packages/sdk/js/src/gen -S
```

Relevant first-batch decisions:

| Surface | Existing call point | Decision |
| --- | --- | --- |
| Project git lock | `packages/opencorvus/src/worktree/index.ts::withGitLock` | Use `Instance.project.worktree` as the lock root. This is the registered primary project root even when the active directory is a managed worktree. |
| Tool output | `packages/opencorvus/src/tool/truncation.ts::Truncate.output` | Resolve `taskID -> task.project_id -> Project.get(...).worktree` and write tool output under that primary runtime session root. |
| Browser preview evidence root | `packages/opencorvus/src/browser-preview/task-evidence-root.ts` and all server/tool callers | Resolve evidence root from the task row's project. When the active `Instance.project.id` does not match the task project, fail explicitly instead of using the ambient directory or trying another root. |
| Browser preview old path spelling | `verification-core.ts` still writes `browser-preview/<captureID>` while newer code uses `bp/<job>` | Leave for a later pass because it is a separate browser-preview writer layout issue and needs its own tests. Do not add a read candidate. |

## Tests

- Add a worktree lifecycle regression proving `Worktree.withGitLock` uses the
  primary project lock while invoked from a managed worktree.
- Add a truncation regression proving full tool output from a worktree session
  is written under the task project's primary runtime, not under the worktree.
- Add browser preview route regressions proving a mismatched request directory
  cannot read another project's target/evidence.

## Acceptance

- No first-batch fix reads both primary and worktree runtime locations.
- Same-project managed worktree sessions write runtime material to the primary
  project `.opencorvus/r`.
- Cross-project browser preview requests fail at the task/project boundary.
