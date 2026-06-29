# Project Identity State Isolation Fix

Date: 2026-06-09

## Problem Statement

`economy1`, `economy2`, and `economy3` were independent local project directories, but OpenCorvus persisted them under the same `project.id`:

```text
f7cb1a426be45b7a20ab591e5cda51fb81b5b787
```

The shared `project.id` let one `project` row serve multiple unrelated roots. The row's mutable `worktree` value was later overwritten to `economy3`, so older `economy1` and `economy2` tasks resolved project-scoped state through the wrong physical root.

The visible failure was attachment staging:

```text
task directory: economy1
attachment URL: /attachment/f7cb.../e67c96....png
Project.get("f7cb...").worktree: D:\myhexin-local\demos\economy\economy3
resolved source: D:\myhexin-local\demos\economy\economy3\.opencorvus\runtime\blobs\attachments\e67c96....png
actual blob:     D:\myhexin-local\demos\economy\economy1\.opencorvus\runtime\blobs\attachments\e67c96....png
```

This is not primarily an attachment bug. Attachment resolution exposed the failure because attachment URLs are project-scoped and `AttachmentStore` correctly uses `Project.get(projectID).worktree` as the single source for blob storage.

The first-order root cause is that project identity currently means "git history identity" in enough cases to collide across copied starter repositories, while the rest of the system treats `project.id` as a local project-instance isolation key.

## Evidence

### Runtime Database Snapshot Before Manual Repair

Backup examined:

```text
C:\Users\hengu\.local\share\opencorvus\opencorvus.db.20260609-201218.bak
```

The single row:

```text
project.id       = f7cb1a426be45b7a20ab591e5cda51fb81b5b787
project.worktree = D:\myhexin-local\demos\economy\economy3
```

Three top-level tasks pointed to that same project:

| Task                             | Session directory                         | Stored project worktree before repair     |
| -------------------------------- | ----------------------------------------- | ----------------------------------------- |
| `tsk_eabb11632001zzdXG3YeharxZ3` | `D:\myhexin-local\demos\economy\economy2` | `D:\myhexin-local\demos\economy\economy3` |
| `tsk_eabeaf5430011ZOcSNPG64kcjQ` | `D:\myhexin-local\demos\economy\economy1` | `D:\myhexin-local\demos\economy\economy3` |
| `tsk_eac420660001v90Q4nLG1M576y` | `D:\myhexin-local\demos\economy\economy3` | `D:\myhexin-local\demos\economy\economy3` |

The same project also had session rows under `economy1`, `economy2`, `economy3`, and their task worktrees.

### Filesystem Identity Evidence

Before manual repair, marker backups showed:

```text
D:\myhexin-local\demos\economy\economy2\.git\opencorvus.20260609-201218.bak = f7cb...
D:\myhexin-local\demos\economy\economy3\.git\opencorvus.20260609-201218.bak = f7cb...
```

Current git roots still show why this was reproducible:

```text
economy1 git root commit = f7cb1a426be45b7a20ab591e5cda51fb81b5b787
economy2 git root commit = f7cb1a426be45b7a20ab591e5cda51fb81b5b787
economy3 git root commit = f7cb1a426be45b7a20ab591e5cda51fb81b5b787
```

All three are standalone git repositories:

```text
git rev-parse --git-common-dir = .git
git rev-parse --show-toplevel = each directory itself
```

They are not linked `git worktree` checkouts.

## Current Code Path

### Project Identity

`packages/opencorvus/src/project/project.ts`

```ts
async function identify(cwd: string, common: string) {
  const cached = await Filesystem.readText(marker(common))
    .then((x) => x.trim())
    .catch(() => undefined)
  if (cached) return cached

  const next = (await roots(cwd))[0] || generated(common)
  await Filesystem.write(marker(common), next).catch(() => undefined)
  return next
}
```

For a repository with commits, the first root commit becomes `project.id`. Copied repos that share initial history collide.

`Project.fromDirectory()` then upserts by `project.id`:

```ts
db.insert(ProjectTable).values(insert).onConflictDoUpdate({ target: ProjectTable.id, set: updateSet }).run()
```

`updateSet` includes `worktree`, so the last opened colliding repo overwrites the shared row's physical project root.

### Instance, Session, Task Binding

`packages/opencorvus/src/project/instance.ts`

```ts
const { project, sandbox } = await Project.fromDirectory(directory)
```

Every project-scoped HTTP route enters through `Instance.provide({ directory })`.

`packages/opencorvus/src/session/index.ts`

```ts
projectID: Instance.project.id
```

`packages/opencorvus/src/task-api/index.ts`

```ts
persistQueuedTask({
  projectID: Instance.project.id,
})
```

Once `Instance.project.id` collides, session and task rows are persisted under the wrong shared isolation key by normal code.

### Attachment Amplification

`packages/opencorvus/src/storage/attachment-store.ts`

```ts
const project = Project.get(projectID)
const dir = storageDir(project.worktree)
```

Attachments are stored under:

```text
<project.worktree>/.opencorvus/runtime/blobs/attachments/<sha>.<ext>
```

The canonical URL is:

```text
/attachment/<projectID>/<sha>.<ext>
```

`resolveAbsolute(projectID, name)` also reads `Project.get(projectID).worktree`. Therefore an old attachment URL changes physical meaning whenever the shared project row's `worktree` is overwritten.

## Call-Point Inventory

This inventory is based on a full-repo search for:

```text
Project.fromDirectory
Project.get
ProjectTable
Instance.project.id
Session.createNext
persistQueuedTask
AttachmentStore.write
AttachmentStore.resolveAbsolute
AttachmentStore.stageToWorktree
appendTaskSystemArtifact
appendTaskAttachment
mergeTaskFileRef
project_id
```

### Must Change

| Surface                                   | File                                                  | Required change                                                                                                               |
| ----------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Project identity creation                 | `packages/opencorvus/src/project/project.ts`          | Stop using root commit as local project-instance ID. Detect copied legacy markers that collide with another standalone repo.  |
| Project row upsert                        | `packages/opencorvus/src/project/project.ts`          | Never let a standalone repo collision overwrite another standalone repo's `project.worktree`.                                 |
| Project tests                             | `packages/opencorvus/test/project/project.test.ts`    | Add copied-template standalone repo regression and linked worktree non-regression.                                            |
| Attachment task registration              | `packages/opencorvus/src/task-api/index.ts`           | `mergeTaskFileRef` must reject a file URL whose `projectID` differs from `task.project_id`.                                   |
| Build staging                             | `packages/opencorvus/src/storage/attachment-store.ts` | `stageToWorktree(projectID, ...)` must reject an attachment URL whose embedded projectID differs from the supplied projectID. |
| URL screenshot/material artifact creation | `packages/opencorvus/src/orchestrator/tools.ts`       | Use the task's `project_id` as the artifact write target, not ambient context alone.                                          |
| Attachment tests                          | Add or extend tests under `packages/opencorvus/test`  | Cover cross-project artifact registration rejection and staging rejection.                                                    |

### Must Audit But Not Necessarily Change

| Surface                                                   | File(s)                                               | Why                                                                                                                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Session.createNext`                                      | `packages/opencorvus/src/session/index.ts`            | It correctly uses the active project context, but should remain safe after project identity is corrected. Parent/child project consistency may get a targeted assertion. |
| `persistQueuedTask`                                       | `packages/opencorvus/src/engine/pipeline.ts`          | It accepts the project ID passed by task creation. No direct fix if `Instance.project.id` becomes correct.                                                               |
| Worktree lifecycle                                        | `packages/opencorvus/src/worktree/index.ts`           | Real linked git worktrees must continue sharing the primary project.                                                                                                     |
| `Project.addSandbox` / `removeSandbox`                    | `packages/opencorvus/src/project/project.ts`          | Sandboxes are correct for real linked worktrees and task worktrees. Do not convert them into independent projects.                                                       |
| Attachment HTTP route                                     | `packages/opencorvus/src/server/routes/attachment.ts` | Route can keep serving `/attachment/:projectID/:name`; correctness comes from stable project identity and registration validation.                                       |
| `tool/read.ts`, `frontend-design/read-attachment-tool.ts` | Read canonical attachment refs                        | They should continue using full URL project IDs, but will benefit from task registration fixes.                                                                          |

### Do Not Change

| Surface                                                                       | Reason                                                                                       |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| The `/attachment/<projectID>/<name>` URL shape                                | It is the canonical single source. The bug is unstable project identity, not the URL format. |
| AttachmentStore's directory derivation from `Project.get(projectID).worktree` | This is the correct single-source design once project identity is stable.                    |
| Real linked `git worktree` sharing behavior                                   | Tests already rely on this. Linked worktrees are one project with multiple sandboxes.        |

## Proposed Fix

### 1. Replace Root-Commit Project Identity For Standalone Repositories

Define project identity from the local git common directory, not repository history.

For a normal standalone repo:

```text
common = <repo>/.git
project.id = sha1(windowsPath(common))
worktree = <repo>
sandbox = <repo>
```

For a linked git worktree:

```text
common = <primary-repo>/.git
project.id = marker/common-dir identity of <primary-repo>/.git
worktree = <primary-repo>
sandbox = <linked-worktree>
```

This preserves current intended semantics:

```text
independent copied repos: different project IDs
linked worktrees of same repo: same project ID, multiple sandboxes
```

Do not use `git rev-list --max-parents=0 --all` for project identity. Root commits are content/history identity, not local project-instance identity.

### 2. Add Legacy Marker Collision Resolution

Existing installs may already have `.git/opencorvus` containing a root commit or a copied marker.

`Project.fromDirectory()` should resolve a marker like this:

1. Read marker from `common/opencorvus` if present.
2. Compute `data.worktree` and `data.sandbox`.
3. If marker's project row does not exist, use the marker for now.
4. If marker's project row exists and points to the same `worktree`, use it.
5. If marker's project row exists and current checkout is a real linked git worktree of that project, use it and append sandbox.
6. If marker's project row exists, points to a different `worktree`, and current checkout is a standalone repo (`sandbox === worktree` and `common === <worktree>/.git`), treat the marker as a copied/stale identity:
   - allocate `generated(common)` as the corrected project id,
   - rewrite `common/opencorvus`,
   - create/update that corrected `project` row,
   - never overwrite the existing row's `worktree`.

This is not a route gate. It is identity conflict resolution at the only place that can distinguish standalone repo vs real linked worktree.

### 3. Make Project Upsert Refuse Standalone Worktree Hijack

Before `onConflictDoUpdate`, classify the relationship between the existing row and the incoming directory:

```text
same project root: update allowed
real linked git worktree sandbox: update sandboxes only
standalone repo with different worktree: must not update existing project.worktree
```

The standalone collision path should already have produced a new project id. If it reaches the upsert anyway, throw a named data-integrity error rather than mutating the existing row.

This error is a pure data integrity assertion, not an LLM workflow gate.

### 4. Register Task Artifacts Against The Task's Project

`orchestrator/tools.ts` currently materializes URL screenshots using ambient project context:

```ts
AttachmentStore.write(Instance.project.id, ...)
EngineService.appendTaskSystemArtifact(taskID, ...)
```

For task-scoped artifacts, use the task row:

```text
task = requireTask/task lookup
AttachmentStore.write(task.project_id, ...)
appendTaskSystemArtifact(task.id, ...)
```

If an orchestrator/session context is wrong, this makes the artifact follow the task instead of ambient state.

Affected materializers found:

| Location                                                                                                                               | Source                     |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `orchestrator/tools.ts` URL screenshot materialization around `AttachmentStore.write(Instance.project.id, capture.screenshotPng, ...)` | `source: "url-screenshot"` |
| `orchestrator/tools.ts` local material materialization around `AttachmentStore.write(Instance.project.id, bytes, mime, filename)`      | `source: "material"`       |

Other `AttachmentStore.write(Instance.project.id, ...)` call sites should be audited, but only task-scoped artifact producers need to switch to `task.project_id`. User-upload task creation can continue using `Instance.project.id` after project identity is fixed, because the task is being created in that instance.

### 5. Reject Cross-Project Task File Refs At Registration

`mergeTaskFileRef()` currently checks only that the URL resolves and the file exists:

```ts
const located = AttachmentStore.nameFromUrl(file.url)
const abs = AttachmentStore.resolveAbsolute(located.projectID, located.name)
await fs.stat(abs)
```

Add:

```text
located.projectID must equal task.project_id
```

This prevents a task from storing an attachment URL owned by another project.

This is a data shape constraint. It does not teach the LLM a route or hide a root cause.

### 6. Reject Cross-Project Staging

`AttachmentStore.stageToWorktree(projectID, attachments, worktreeDir)` receives the expected project id but currently resolves every source from `attachment.url`.

Add:

```text
if located.projectID !== projectID:
  throw AttachmentProjectMismatchError
```

This prevents the build agent from copying files from another project's blob root even if bad data reaches staging.

The primary fix remains project identity; this is the final data boundary for build-time file materialization.

### 7. Add A One-Time Diagnostic/Repair Command

Add a debug or maintenance command that reports, but does not silently mutate unless explicitly invoked:

```text
project id
project.worktree
top-level task session directories under that project
session directories outside project.worktree
task attachment URLs whose embedded projectID differs from task.project_id
attachment URLs resolving to missing files
```

For this incident, the command would have reported:

```text
project f7cb... worktree=economy3 has tasks rooted at economy1, economy2, economy3
```

The repair mode should:

1. group root sessions by top-level session directory,
2. ensure each standalone root has a correct local project id,
3. update `engine_task.project_id`,
4. update `session.project_id`,
5. rewrite task-level `attachments`, `system_artifacts`, `design_specs` URLs when the blob exists under the target directory,
6. never rewrite historical decision logs or completed message parts unless explicitly requested.

## Test Plan

### Project Identity Regression Tests

Add to `packages/opencorvus/test/project/project.test.ts`.

1. `standalone repos with identical root commit get different project ids`
   - Create repo A, commit once.
   - Copy repo A to repo B including `.git`, or create repo B with identical root commit if test tooling supports deterministic commit metadata.
   - Call `Project.fromDirectory(repoA)`.
   - Call `Project.fromDirectory(repoB)`.
   - Assert:
     ```text
     projectA.id !== projectB.id
     Project.get(projectA.id).worktree === repoA
     Project.get(projectB.id).worktree === repoB
     repoA marker !== repoB marker after resolution
     ```

2. `copied legacy marker collision does not overwrite existing worktree`
   - Seed repo A marker to a legacy id.
   - Seed DB row for that id with `worktree=repoA`.
   - Copy marker into repo B.
   - Call `Project.fromDirectory(repoB)`.
   - Assert:
     ```text
     repoA project row still points to repoA
     repoB receives a different id
     repoB marker is rewritten
     ```

3. `linked git worktrees still share one project`
   - Keep or extend existing worktree tests.
   - Assert linked worktree path lands in `project.sandboxes`.
   - Assert primary project `worktree` is not overwritten by sandbox path.

### Attachment Integrity Tests

1. `appendTaskSystemArtifact rejects project mismatch`
   - Create project A and project B.
   - Create task under project A.
   - Write attachment under project B.
   - Call `appendTaskSystemArtifact(taskA, refB)`.
   - Assert named error and no task update.

2. `appendTaskAttachment rejects project mismatch`
   - Same as above, but for user-contract attachments.

3. `stageToWorktree rejects attachment URL from another project`
   - Call `AttachmentStore.stageToWorktree(projectA, [refB], worktreeA)`.
   - Assert named error.
   - Assert no file copied into `references/`.

4. `task project artifact materializer writes to task.project_id`
   - Create a task under project A.
   - Run the materialization helper while ambient `Instance.project.id` is project B, or unit-test the extracted helper directly.
   - Assert returned artifact URL starts with `/attachment/<projectA>/`.

### Database Repair Test

If a repair command is added:

1. Seed a DB snapshot with one project id, three session root directories, and task artifacts under each physical root.
2. Run repair in dry-run mode and assert the reported groups.
3. Run repair in write mode.
4. Assert each task/session points to the correct project id and attachment URLs resolve to existing files.

## Verification Commands

Targeted first:

```powershell
pnpm exec vitest packages/opencorvus/test/project/project.test.ts
pnpm exec vitest <new attachment integrity test file>
```

Then broader project checks:

```powershell
pnpm exec tsc --noEmit
pnpm test -- --run packages/opencorvus/test/project packages/opencorvus/test/build-agent packages/opencorvus/test/frontend-design
```

Do not use `bun test` as a broad untargeted blocker.

## Acceptance Criteria

The fix is complete only when all of these are true:

1. Opening two copied standalone repos with the same root commit creates two different project ids.
2. Opening a copied standalone repo with a copied legacy `.git/opencorvus` marker does not overwrite the original repo's `project.worktree`.
3. Real linked git worktrees still share the primary project and are tracked as sandboxes.
4. A task cannot register an attachment URL whose project id differs from `task.project_id`.
5. Build staging refuses cross-project attachment URLs before any copy attempt.
6. URL screenshot and material artifacts are written under the task's project id.
7. The repaired `economy1/economy2/economy3` state remains stable after restarting the server and opening all three directories.

## Rollout Notes

Existing databases may contain polluted `project` rows. Code fix alone prevents future overwrites but does not automatically repair already-corrupt task rows.

For known corrupted DBs, run the one-time repair workflow after the code fix:

```text
audit -> backup -> repair project rows/task rows/session rows/task-level attachment URLs -> verify resolution
```

Historical logs, decision logs, and old message parts should remain immutable evidence unless a separate explicit cleanup is requested.

## Non-Goals

- Do not change the attachment URL format.
- Do not make build staging search sibling directories for missing blobs.
- Do not add fallback copy logic from another project.
- Do not allow a task to consume another project's artifact as a compatibility path.
- Do not convert real linked git worktrees into independent projects.
