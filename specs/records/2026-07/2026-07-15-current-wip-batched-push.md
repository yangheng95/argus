# Current WIP batched push

## Recall

### User requirement

- Push every current local change, explicitly including work in progress (WIP).
- Split the delivery into traceable batches instead of one undifferentiated commit.

### Acceptance criteria

- The existing unpushed Mirror Watch checkpoint, every tracked modification visible at the
  delivery snapshot, and any untracked file that appears before the final snapshot are committed.
- Commits are separated by the existing functional ownership boundaries: checkpoint payload,
  Multica/runtime contract, and Overlay Agent-card presentation.
- Every new or safely amendable unpushed commit subject begins with `dsw-33987`.
- Each batch is pushed to `legacy-remote/v0.0.5beta` without bypassing hooks, and the final remote SHA
  equals local `HEAD`.
- The final Git index and worktree are empty for the captured snapshot. If an active parallel Agent
  writes after a batch, its later bytes are included in a subsequent batch rather than overwritten.

### Hard constraints

- No reset, stash, rebase, worktree creation, content restore, history rewrite of pushed commits,
  hook bypass, or deletion of WIP.
- Do not reinterpret or polish WIP beyond changes required to make repository tooling itself work;
  the user's instruction is to preserve and publish the current bytes.
- Existing topic records remain the design sources for Multica repair and Agent-card styling.
- Frontend changes require their existing Node-started browser checker and screenshot review.

### Sources read

- `AGENTS.md` and `specs/current/architecture/99-principles.md`.
- `specs/records/2026-07/2026-07-15-multica-agent-source-repair.md`.
- `specs/records/2026-07/2026-07-15-agent-message-card-reference-surface.md`.
- Root and July spec indexes, current status, full diff/stat, untracked inventory, local/remote
  divergence, and the unpushed checkpoint contents.

### Whole-repository inventory evidence

- Initial inventory found one unpushed checkpoint commit containing the Mirror Watch package,
  runtime/expert-squad work, tests, records, and retired dashboard artifacts. It is the first batch.
- The initial dirty tree contained 15 tracked files and no untracked files. While the inventory was
  running, active parallel work converged several Multica files and added two Overlay regression
  updates; therefore every batch uses a fresh status/diff snapshot instead of a stale path list.
- The remaining ownership groups are the Multica Agent-owned source-repair Skill/runtime tests and
  the Overlay Agent-card/chat-bubble styles, fixture, static tests, architecture guard, and browser
  regressions. No path belongs to both groups.

### Independent-agent feedback

- No new sub-Agent was started. The user asked to publish the work of already-running Agents; the
  primary Agent owns snapshotting, batching, verification, and remote reconciliation.

## Batch plan

1. Safely amend only the unpushed checkpoint subject to add `dsw-33987`, verify the tree object is
   unchanged, and push it as the WIP checkpoint batch.
2. Snapshot and commit the remaining Multica/runtime-owned files with their existing focused tests,
   then push the batch.
3. Snapshot the Overlay Agent-card-owned files plus this delivery record/index updates, run static
   tests, typecheck, the Node browser fixture, and screenshot review, then push the batch.
4. Re-scan for changes created during the batches. Commit and push any late-arriving bytes as an
   explicit final WIP batch, then verify empty index/worktree and local/remote SHA equality.

## Delivery evidence

- Pending.
