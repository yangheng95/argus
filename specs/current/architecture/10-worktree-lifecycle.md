# 10 — Dispatch Worktree Lifecycle

> Current owners: Build/runtime dispatch, Worktree services, Session cleanup,
> and immutable dispatch/execution evidence.

A worktree is a physical execution resource for one dispatch. It is not owned
by a Goal/Delivery Slice and does not participate in business lifecycle.

## Ownership

| Concern | Sole owner |
| --- | --- |
| Whether isolation is required | Orchestrator dispatch decision based on real write ownership |
| Worktree creation and path validation | Worktree service used by the dispatch adapter |
| Exact package/model/tool identity | immutable worker descriptor and dispatch lineage |
| Physical execution outcome | Session, final assistant message, or terminal error/tool event |
| Cleanup | runtime/worktree service after physical ownership is settled |
| Business completion | Task completion decision citing accepted current Slice revisions |

Delivery Slice revisions may declare `owned_paths`; this describes the delivery
contract and helps the Orchestrator reason about safe concurrent dispatches. A
Slice does not store `workspace_dir`, branch, base ref, retry counter, attempt,
or cleanup state.

## Dispatch contract

A dispatch that uses a managed worktree records its exact physical identity in
dispatch/execution evidence. The natural worker input may include current Slice
revision references and earlier evidence, but the worktree path is not copied
into the Slice contract. A later corrective dispatch is a new physical
execution with its own lineage. It does not reopen or retry a Goal lifecycle.

Current-project execution is allowed only when the Orchestrator has real
evidence that concurrent writers cannot collide. Managed isolation does not
legalize overlapping ownership: shared write surfaces still require one owner
or an explicit Task-level assembly dispatch.

## Terminal and cleanup contract

Physical terminality is linked to the real final assistant message or terminal
error/tool event. Cleanup waits for actual process and Session ownership to
settle; Task cancellation must not be inferred from Goal activity, review
association, or acceptance facts. Cleanup
facts do not produce accepted/rejected business outcomes and cannot complete a
Task.

Unexpected worktree absence, branch mismatch, or cleanup failure is a typed
physical execution error. There is no fallback to a guessed path, a prior Goal
workspace, or current-project execution.

## Recovery

After restart, OpenCorvus reconstructs physical execution from durable Session,
worker descriptor, dispatch lineage, final message/error, and worktree facts.
Delivery Slice rows remain pure versioned contracts. The Goal panel derives
activity and evidence from those recovered facts and never restores a stored
Goal execution status.

## Acceptance

- concurrent write-capable dispatches use explicit, validated physical
  isolation;
- each worktree is attributable to one exact dispatch lineage;
- terminal result transport exposes the real message/error locator;
- cleanup failure remains visible physical evidence;
- no Delivery Slice table, transport, or tool owns retry/workspace lifecycle.
