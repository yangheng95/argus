# Current-Project Uncommitted Goal Attribution

Date: 2026-07-21
Status: Implemented; final repository-health verification and delivery pending

## Recall

| Item | Details |
| --- | --- |
| User request | Diagnose and fix Task `tsk_f84698520001BGTT0xNRhvBL8t`, where real world-economy files existed but goal attempts repeatedly persisted `no_project_diff(actual_changed_files_empty)` and delayed downstream dispatch. |
| Acceptance criteria | A goal-scoped `current_project` Build must attribute files created, modified, or deleted during that exact attempt even when the task forbids Git commits; staged and untracked files must be included; unchanged files from earlier attempts must not be re-attributed; the user Git index must remain untouched; managed-worktree commit attribution must remain unchanged; focused tests, typecheck, document health, review, commit, and `legacy-remote` push must pass. |
| Hard constraints | No fallback, compatibility path, host workflow gate, status machine, keyword classifier, Git reset, new worktree, or OpenCorvus/Overlay restart. Reuse the existing snapshot tree toolchain and keep Orchestrator as lifecycle decision-maker. Preserve unrelated dirty Overlay/spec work. |
| Runtime evidence | Both goal 1 and goal 2 wrote non-empty files but persisted `diff_base_ref=diff_head_ref=5f5b5f62e51d` and `actual_changed_files=[]`. Goal 2 still produced 19 staged files and 1745 insertions. Source investigation then incurred repeated three-minute provider idle retries before Orchestrator manually completed the goal. |
| Sources read | `AGENTS.md`; `specs/current/architecture/99-principles.md`; `specs/records/2026-07/2026-07-06-current-project-goal-diff-and-graph-repair.md`; `specs/records/2026-07/2026-07-08-evidence-delivery-and-architect-reentry-systemic-repair.md`; `packages/opencorvus/src/orchestrator/build-tool.ts`; `packages/opencorvus/src/build/agent.ts`; `packages/opencorvus/src/snapshot/index.ts`; focused Build and Snapshot tests. |
| Full-repository grep | `rg -n "collectGoalDiffs|collectGoalContributionDiffs|resolveGoalContributionRefs|current_project|callerOwnedGoalBaseRef|actualChangedFiles|no_project_diff" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07`; `rg -n "Snapshot\\.track\\(|Snapshot\\.diffFull|Config.*snapshot|owned_paths" packages/opencorvus/src packages/opencorvus/test specs/current`. |
| Independent agent feedback | None requested. The applicable repository rule permits sub-agents only when the user explicitly requests independent or parallel agents. |

## Proven Causal Chain

1. The task-level checkpoint committed the pre-task dirty worktree as `5f5b5f62e51d`.
2. A goal-scoped `current_project` attempt captured only `git rev-parse HEAD` before running.
3. The Build worker correctly obeyed the task contract forbidding Git commits and wrote untracked/staged files.
4. `collectGoalContributionDiffs` resolved `HEAD` again and returned early when `HEAD === baseRef`; it therefore ignored the real worktree and index delta.
5. `finalizeBuildAttempt` received no `actualChangedFiles` and persisted `completed/no_project_diff`, while lifecycle completion still appeared as `passed`.
6. Re-running `git add` could not repair attribution because staging does not change `HEAD`.

## Call-Point Disposition

| Call point | Disposition |
| --- | --- |
| `orchestrator/build-tool.ts` goal-scoped `current_project` preparation | Add a required snapshot tree captured before the worker starts. Keep the resolved Git head only as commit metadata. |
| `orchestrator/build-tool.ts::collectBuildHostFactsForOutcome` | For a current-project goal, capture the after tree and compute `Snapshot.diffFull(before, after)`. For managed worktrees and task-level direct builds, retain the existing commit-ref path. |
| `orchestrator/build-tool.ts` successful result enrichment | Use the attempt snapshot facts whenever the worker did not already return host facts; do not rely on staging or a new commit. |
| `build/agent.ts::collectGoalContributionDiffs` | Preserve as the single managed-worktree/commit contribution implementation; it is correct for committed contribution and merge-parent attribution. |
| `snapshot/index.ts::track` | Extract the existing unconditional tree capture into `trackRequired`; retain `track` as the configuration-controlled conversation/undo caller. This is one implementation, not a fallback. |
| `snapshot/index.ts::diffFull` | Reuse unchanged as the authoritative before/after tree diff including untracked content captured by the snapshot index. |
| Current-project focused orchestrator test | Remove the artificial commit; seed an earlier dirty file, write an untracked goal file without staging or committing, and assert only the exact attempt file is delivered. |
| Snapshot focused tests | Prove required capture works when ordinary snapshot configuration is disabled and does not modify the user's index. |
| `build-dispatch-fidelity-order.test.ts` | Update the source-order regression to read the real `orchestrator/build-tool.ts` owner after the historical module split; the stale `tools.ts` path did not inspect production Build dispatch. |

## Verification

1. Focused Snapshot required-capture tests.
2. Focused current-project goal dispatch test with an unchanged `HEAD`, an earlier dirty file, and a new untracked goal file.
3. Existing commit-diff tests to protect managed-worktree merge attribution.
4. `bun run --cwd packages/opencorvus typecheck`.
5. Historical links and document-health tests.
6. `git diff --check` and a second code review against this Recall.
7. Commit with the `dsw-33987` prefix and push branch `v0.0.13beta` to `legacy-remote` without bypassing hooks.

## Implemented Repair

1. `Snapshot.trackRequired()` now exposes the existing temporary-index tree capture as an explicit execution-contract primitive. Ordinary `Snapshot.track()` retains its configuration and client checks, then delegates to this single implementation.
2. A goal-scoped `current_project` Build captures a required baseline tree before dispatching the worker.
3. If the worker returns without host diff facts, Build captures one terminal tree and uses `Snapshot.diffFull(baseline, terminal)` for exact-attempt `diffs`, `diff_base_ref`, `diff_head_ref`, and `actual_changed_files`.
4. Commit metadata remains the current Git head, while diff metadata names the actual before/after snapshot trees. The user index and branch history are not mutated.
5. Managed-worktree and task-level commit attribution still use `resolveGoalContributionRefs` and `collectGoalContributionDiffs` unchanged.

## Codex Review Feedback

The secondary code review rejected the tempting `git diff HEAD` repair because every uncommitted current-project goal would then inherit all earlier goals' dirty files. The final implementation instead binds evidence to an exact before/after attempt pair. Review also checked that:

- required capture bypasses only the optional UI undo setting, not Git integrity checks;
- the existing snapshot implementation continues to own excludes, temporary-index isolation, concurrent initialization, tree storage, and full file content reconstruction;
- no fallback chooses between snapshot and commit evidence for one current-project goal: current-project goal attribution is snapshot-owned, while managed worktree attribution remains commit-owned;
- repeated host-fact reads reuse one terminal snapshot promise;
- unchanged pre-attempt untracked files are absent from the persisted goal outcome;
- an in-attempt staged modification and an untracked addition are both captured without Snapshot changing index state.
- the adjacent source-order regression was stale after Build moved out of `orchestrator/tools.ts`; review corrected it to inspect the real owner instead of accepting a non-executing assertion.

## Verification Results

- Required tracking with ordinary snapshots disabled: `1 pass`, including staged and untracked content plus unchanged index evidence.
- Goal current-project Build with unchanged `HEAD`: `1 pass`, `22` assertions; persisted outcome is delivered, names only `src/index.ts`, excludes an earlier untracked file, and uses distinct before/after tree refs.
- Existing managed-worktree commit diff suite: `9 pass`.
- OpenCorvus TypeScript typecheck: passed.
- Historical docs links: `21 pass`.
- Focused `git diff --check`: passed.
- The first document-health run reached the real checker and found only concurrently authored, not-yet-tracked spec links plus this new record. It must be rerun after the shared index settles and this record is staged; this is not counted as passed yet.
