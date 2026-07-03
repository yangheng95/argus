# 10 — Worktree Lifecycle

This chapter is the current worktree lifecycle contract. The deleted pre-June
implementation notes are not retained as spec files; current behavior is defined
by this chapter plus the implementation sources named below.

## Current Sources

| Surface | Source |
| --- | --- |
| Attempt workspace payload | `packages/opencorvus/src/engine/persist.ts` |
| Worktree cleanup owner | `packages/opencorvus/src/engine/writer.ts` |
| Physical worktree remove | `packages/opencorvus/src/goal/runner.ts` |
| Retry feedback assembly | `packages/opencorvus/src/orchestrator/tools.ts` |
| Worktree ownership records | `packages/opencorvus/src/engine/ownership.ts` |

`engine_goal` does not own workspace columns. Workspace identity lives on the
latest `engine_artifact` row with kind `goal_run_attempt`, where the payload
records `workspace_dir`, `workspace_branch`, and `workspace_base_ref`.

## Lifecycle Contract

OpenCorvus preserves a goal worktree while that worktree can still contain
useful repair evidence.

The same goal lineage reuses the latest recorded workspace on retry. A retry
agent edits the existing files in place unless the visible evidence requires a
structural rewrite. It must not start from an empty workspace merely because the
previous attempt failed.

Worktree deletion is allowed only through the owning cleanup path after the
latest relevant attempt has completed and the successful result has been merged
or otherwise recorded. These events do not imply deletion:

- failed build or verification
- aborted execution
- task cancellation
- restart from a later stage
- stale process discovery
- worktree path probe failure

Those conditions are evidence for the orchestrator. They are not automatic
cleanup decisions.

## Cleanup Boundary

Cleanup code must satisfy all of these properties:

1. Read the latest workspace pointer from the current attempt artifact.
2. Confirm the cleanup owner before deleting files or branches.
3. Propagate filesystem and git errors visibly.
4. Avoid restoring or rewriting history with `git reset`.
5. Avoid a second deletion policy in recovery, overlay, or tests.

If the worktree directory is missing, callers must surface the missing workspace
as an error or visible fact. They must not silently create a replacement
worktree as a compatibility path.

## Retry Feedback

Retry feedback is a factual prompt section assembled from decision log and
attempt evidence. It tells the next agent what failed, which files were touched,
and that prior work is still present when a workspace is reused.

The retry prompt is not a hidden state source. The persisted attempt artifact
and decision log remain the authority; the prompt section is only the readable
projection used by the next agent.

## Build Input Evidence And Retry

Build input evidence is session-scoped. The single durable owner is the
`build_session_contract` artifact for the Build session, specifically
`payload.input_evidence`. Board and compaction projections carry contract ids,
source artifact ids, and digests only; they do not summarize or recompute input
ownership from current task attachments.

Fresh Build dispatch must run in the task's project namespace before evidence
materialization. If the active project differs from `task.project_id`, fresh
dispatch fails before creating a Build child session, staging evidence, or
calling a provider. Existing-session retry is different: it must reuse the
original session's contract manifest and may repair persisted staged file parts
only from the recorded manifest owner.

For managed worktrees, `AttachmentStore.stageToWorktree` receives the task
project from the validated manifest/task, not ambient `Instance.project.id`.
For provider-bound bytes, `SessionPrompt` receives the Build/session project
owner explicitly so MCP blobs, `data:` file parts, and `file://` parts are
written under the same owner.

## Validation

Required coverage for worktree lifecycle changes:

- failed attempts keep the workspace available for retry
- retry dispatch reads the previous workspace pointer from the latest attempt
  artifact
- successful completion deletes through the single cleanup owner
- task cancellation and abort do not delete workspace contents
- cleanup failures propagate to tests and logs
- no source or current architecture document uses destructive history reset as a
  lifecycle mechanism
- fresh Build project mismatch fails before Build child session, staging, or
  provider dispatch
- same-session Build retry reuses the original
  `build_session_contract.input_evidence`
