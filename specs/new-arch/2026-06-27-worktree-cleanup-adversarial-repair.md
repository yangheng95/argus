# 2026-06-27 Worktree Cleanup Adversarial Repair

## Problem

Multiple independent audits found that "automatic worktree cleanup" currently
mixes three different contracts:

- Goal build success intentionally preserves worktrees for context recovery.
- Task terminal cleanup is explicit and depends on durable goal-run workspace
  facts.
- Background WorktreeGC is conservative, but its candidate sources are
  incomplete and its deletion side effects do not converge DB sandbox state.

The observed `world-economy` state proves the gaps:

- OpenCorvus-owned dirty/recent worktrees are preserved by design.
- Git registry-only prunable worktrees are not seen by WorktreeGC.
- `project.sandboxes` retains paths that Git prune and manual deletion no
  longer represent.
- External locked Claude worktrees are listed as removable by the project
  worktree UI/API because the backend exposes every non-primary Git worktree.

## Independent Audit Inputs

Four read-only agents reviewed distinct slices:

| Agent | Scope | Main finding |
| --- | --- | --- |
| Harvey | Lifecycle | 2026-06-25 changed success-build cleanup to preserve worktrees, but `modify_goal` still tries stale-worktree cleanup and can break retry. |
| Kuhn | GC | `WorktreeGC.inspect()` only scans existing directories; registry-only entries and DB sandbox convergence are missing. |
| Hooke | UI/API | `listProjectWorktrees()` exposes all Git worktrees as removable, including external/locked and active rows. |
| Hypatia | DB/disk | Current projects contain dirty live, recent clean, registry-only, sandbox-only, and external locked residual classes; each maps to a different missing cleanup path. |

## Call Point Inventory

| Area | Current source | Repair decision |
| --- | --- | --- |
| Worktree registry parser | `worktree/index.ts::parseWorktreeList` | Extend the single parser to keep `locked` and `prunable` facts; expose a typed registry-list helper for GC/listing instead of re-parsing. |
| Managed root ownership | `Worktree.worktreesRoot(primaryDir)` | All project UI/API and GC cleanup candidates must be under this root; external Git worktrees are not OpenCorvus-owned. |
| Project worktree listing | `Worktree.listProjectWorktrees` | Return primary plus OpenCorvus-owned entries only. `removable` must be `owned && expired && !locked`; active rows are visible but not removable. |
| Project worktree delete route | `Worktree.removeProjectWorktree` via project/experimental routes | Re-check the same owned/expired/removable contract server-side before deleting. |
| Low-level removal | `Worktree.remove` | Keep it as physical Git remover. It must not become the DB sandbox owner. |
| Project-managed removal | New `Worktree.removeManagedProjectWorktree` | Single project cleanup entry for route/GC: `Worktree.remove` then `Project.removeSandbox`; no fallback or silent success. |
| Background GC | `worktree/gc.ts` | Candidate source becomes union of existing managed directories and managed registry entries. Registry-only prunable entries are eligible when branch has no in-transit commits. Apply uses managed removal, so sandbox state converges. |
| Lifecycle modify_goal | `orchestrator/tools.ts::modify_goal` | Remove automatic `cleanupGoalWorkspaceForGoal` on contract change. Retry keeps durable workspace pointer per 2026-06-25 contract. |
| Overlay batch delete | `overlay/src/services/worktree.ts` | Sequentially attempt every target; aggregate failures after all attempts so one locked row does not block later deletes. |

## Required Semantics

1. Build success does not auto-clean goal worktrees.
2. `modify_goal` must not auto-delete a completed worktree or clear its pointer.
3. Active/live goal worktrees are not removable through project worktree API.
4. External Git worktrees outside `.opencorvus/r/w` are not listed/deleted by
   project cleanup UI/API.
5. Background GC sees managed registry-only prunable worktrees.
6. Background GC removes `project.sandboxes` only after physical Git removal
   succeeds.
7. Dirty or in-transit managed worktrees remain preserved.
8. Batch UI deletion attempts all selected expired/removable rows and reports
   aggregate failure.

## Tests

- `packages/opencorvus/test/project/worktree-gc.test.ts`
  - registry-only prunable managed worktree enters GC and removes branch/sandbox.
  - registry-only worktree with in-transit branch commits is preserved.
  - old clean GC removal also clears `project.sandboxes`.
  - dirty tracked modification is preserved.
- `packages/opencorvus/test/server/project-routes.test.ts`
  - external sibling worktree is not listed/removable.
  - OpenCorvus-owned active worktree is visible but not removable and DELETE is rejected.
  - OpenCorvus-owned expired worktree is deletable and clears sandbox.
- `packages/overlay/test/worktree-service.test.ts`
  - bulk deletion continues after a failed row and throws an aggregate error.
- `packages/opencorvus/test/orchestrator/tools.test.ts`
  - `modify_goal` on completed goal preserves workspace pointer and does not report stale cleanup.

## Non-Goals

- Do not delete user worktrees during this repair.
- Do not add a user config fallback or broad cleanup switch.
- Do not kill external locked processes.
