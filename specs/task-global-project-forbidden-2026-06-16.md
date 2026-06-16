# Task Global Project Forbidden - 2026-06-16

## Problem

Task `tsk_ecefdca56001FewJ8LlB0AozSE` failed immediately on G1 retry because the
task row and its visual evidence were persisted under `project_id="global"` while
the active directory had already resolved to the real Git project
`15ac4076a1e5bf1ea4eccd7fe36d5d8187fe12ce`.

The observed failure was correct:

`AttachmentStore.stageToWorktree: attachment url-www_tradingview_com-1781589242317.png belongs to project global, expected 15ac4076a1e5bf1ea4eccd7fe36d5d8187fe12ce`

The attachment layer must stay strict. A task whose project is `global` is not a
recoverable task state in the task/workflow model.

## Design Record

Existing design sources:

| Source | Evidence | Decision |
| --- | --- | --- |
| `specs/new-arch/2026-04-30-instance-bootstrap-darwin-cascade.md` | Task creation in a non-Git directory throws `WorktreeNotGitError`; no hidden `git init`. | Task creation must require a concrete Git project. |
| `specs/new-arch/2026-06-12-overlay-init-git-412-retry.md` | Overlay handles `412 WorktreeNotGitError`, calls `POST /project/current/init-git`, and retries once. | Recovery is explicit before task persistence, not after task corruption. |
| `packages/opencorvus/src/task-api/index.ts::prepareProject` | Rejects non-Git task creation before creating task rows. | Keep this precondition. |
| `packages/opencorvus/src/engine/pipeline.ts::persistQueuedTask` | Lower-level persistence accepts arbitrary `projectID`. | Add the missing task persistence invariant here. |
| `packages/opencorvus/src/storage/attachment-store.ts::stageToWorktree` | Rejects attachment/project mismatch. | Keep strict validation. |

`Project.fromDirectory` may still return the historical `global` project for
non-task project discovery in a non-Git directory. That does not permit
`engine_task.project_id`, task root sessions, task attachments, workflow tasks,
or build tasks to be persisted under `global`.

## Fix

- Reject `persistQueuedTask({ projectID: "global" })` before inserting any
  `engine_task` row.
- Reject `createTask` before root session creation if the active task project
  is still `global` after the Git repository precondition has passed.
- Reject existing `engine_task.project_id="global"` at task message and inject
  boundaries with `TaskGlobalProjectBindingError`.
- Do not copy, rehome, or rewrite existing `global` attachment URLs. Existing
  rows in this shape are corrupt data and must surface as corrupt data.
- Keep `AttachmentStore` and worktree staging strict.

## Acceptance

- A direct call to `persistQueuedTask` with `projectID="global"` throws and
  inserts no task row.
- `EngineService.handleTaskMessage` refuses a legacy global task before writing
  follow-up attachments or session messages.
- `EngineService.injectMessage` refuses the same legacy global task before
  appending an injected message.
- Non-Git task creation still throws `WorktreeNotGitError` before persistence.
