# Current-Project Goal Diff and Graph Repair

Date: 2026-07-06
Status: Implemented

## Recall

| Item | Details |
| --- | --- |
| User request | After investigating task `tsk_f32aa8772001IK2NVPMGChbZf5`, explain and fix the design issue where a frontend-replica workflow produced `no_project_diff(actual_changed_files_empty)` for a real current-project commit, then the scheduler removed a dependency and called Architect again. |
| Acceptance criteria | Goal-scoped `build({ goalID, worktreeUsage: "current_project" })` must persist host-truth `diff_base_ref`, `diff_head_ref`, `actual_changed_files`, and a delivered outcome when the current project actually changed. A visible producer with `no_project_diff` must remain a non-delivered dependency and must not be bypassed by deleting `depends_on`. Graph/contract blockers must tell the scheduler to repair the concrete inconsistency or propose/fail when the active workflow is invalid, not generically ask it to rerun Architect. Focused regression tests must cover these behaviors. |
| Hard constraints | No fallback or compatibility branch; no host-side gate that teaches the scheduler workflow; no git reset; no new worktree; no OpenCorvus/overlay restart without operator approval; preserve unrelated dirty workspace changes; update specs under `specs/`; code changes require tests. |
| Disk records read | `AGENTS.md`, `specs/README.md`, `specs/records/2026-07/README.md`, `specs/current/architecture/04-extensions.md`, `specs/current/architecture/18-webpage-replica-agent-workflow.md`, `specs/current/architecture/99-principles.md`, `specs/records/2026-07/2026-07-02-direct-build-current-worktree.md`, `specs/records/2026-07/2026-07-02-optional-build-worktree-schema.md`, `specs/records/2026-07/2026-07-03-no-diff-source-row-goal-repair.md`, and the OpenCorvus expert-squad creator skill/checklist. |
| Full-repo grep | `rg -n "current_project|worktreeUsage|callerOwnedBuildWorkDir|taskLevelBuildSessionContext|collectBuildHostFactsForOutcome|resolveGoalContributionRefs|collectGoalContributionDiffs|actualChangedFiles|diffBaseRef|diffHeadRef|finalizeBuildAttempt" packages/opencorvus/src/orchestrator/tools.ts packages/opencorvus/src/build/agent.ts packages/opencorvus/src/engine/persist.ts packages/opencorvus/test/orchestrator/tools.test.ts packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts`; `rg -n "Re-run architect|graph or dependency-contract|architect re-entry|contract graph has blocker|modify_goal.*depends_on|no_project_diff|actual_changed_files_empty|frontend-replica|convenience rerun" packages/opencorvus/src/orchestrator packages/opencorvus/src/prompt packages/opencorvus/test/orchestrator packages/opencorvus/test/agent .opencorvus/expert-squads/frontend-replica specs/current specs/records/2026-07`; `rg -n 'from "@/git"|runGit|gitCeilingEnvForWorktree|collectGoalDiffs|FileDiff' packages/opencorvus/src/orchestrator/tools.ts packages/opencorvus/src/build/agent.ts`. |
| Runtime evidence | The heatmap goal outcomes had commit refs but empty `actual_changed_files`; the target repo commits `5730022`, `e8afbfc`, and `fb808fc` modified project files. The later trend goal was first blocked by `no_project_diff(actual_changed_files_empty)`, then `modify_goal` removed the dependency, then Build rejected the graph because `contract_heatmap_component` was no longer in the dependency ancestry and told the scheduler to rerun Architect. |
| Independent agent feedback | The read-only independent agent agreed that the direct root is goal-scoped `current_project` output lacking `diffBaseRef`/`diffHeadRef`/`actualChangedFiles`, and that graph repair should not delete a no-diff producer dependency or use generic Architect re-entry. |

## Causal Chain

1. `worktreeUsage: "current_project"` sets `callerOwnedBuildWorkDir` and passes `workDir` to `BuildAgent.run`.
2. `BuildAgent.run` intentionally treats `workDir` as caller-owned and therefore does not set `ownsWorktree`.
3. Diff collection inside `BuildAgent.run` currently runs only when `ownsWorktree && worktreeDir && baseRef && parsed.success`.
4. For goal-scoped current-project builds, the Build result can carry a real `commit_ref` while `diffs`, `diffBaseRef`, `diffHeadRef`, and `actualChangedFiles` stay empty.
5. `finalizeBuildAttempt` receives a commit ref but no acceptance diffs, so it records `completed/no_project_diff` with `actual_changed_files_empty`.
6. Dependency dispatch correctly treats that producer as non-delivered, but the scheduler then tried to remove the dependency instead of repairing the producer.
7. That edit violated the persisted contract graph, and the Build blocker text plus generic recovery prompt made Architect re-entry look like the next action despite frontend-replica workflow discipline forbidding convenience replanning after valid artifacts.

## Repair Design

1. Capture a caller-owned goal base ref before invoking `BuildAgent.run` whenever `worktreeUsage: "current_project"` is selected.
2. Reuse the existing host git diff primitives, `resolveGoalContributionRefs` and `collectGoalContributionDiffs`, to synthesize missing host facts for caller-owned goal runs after `BuildAgent.run` returns and before `finalizeBuildAttempt`.
3. Populate only missing host-truth fields from this collection: `worktreeDir`, `worktreeBaseRef`, `worktreeHead`, `contributionCommitRef`, `diffBaseRef`, `diffHeadRef`, `diffs`, and `actualChangedFiles`.
4. Keep managed worktree behavior unchanged; managed worktrees already own their base ref and merge-back diff collection inside `BuildAgent.run`.
5. Replace generic "Re-run architect" graph blocker wording with a concrete repair instruction: restore or correct the inconsistent dependency/contract edge from evidence, and use Architect only when the persisted architect artifact itself is proven invalid and named.
6. Tighten recovery prompt wording so no-diff dependency blockers route to producer Build repair or terminal fail/propose paths, not dependency deletion.

## Test Plan

- Extend the existing current-project goal build test so the mock writes and commits a real file in the current project while returning no host diff facts. Assert the persisted build attempt is `delivered`, has `diff_base_ref`, `diff_head_ref`, and lists the actual file.
- Add prompt/tool text assertions that graph blockers no longer contain generic `Re-run architect` and that recovery guidance forbids deleting a `no_project_diff` producer dependency as a bypass.
- Run focused tests:
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "goal build can run in current project without persisting a managed workspace" --timeout 120000`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "goal build treats dependency no-project-diff outcome as unfinished" --timeout 120000`
  - `bun test packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts --timeout 120000`
  - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`

## Implemented Fix

1. `packages/opencorvus/src/orchestrator/tools.ts`
   - Captures the current git `HEAD` before goal-scoped `current_project` Build runs.
   - Reuses `resolveGoalContributionRefs` and `collectGoalContributionDiffs` after the Build result returns to populate missing host facts before `finalizeBuildAttempt`.
   - Keeps managed-worktree behavior unchanged.
   - Replaces graph-blocker messages that told the scheduler to rerun Architect with concrete contract-graph recovery wording.
2. `packages/opencorvus/src/orchestrator/agent.ts` and `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
   - Route `no_project_diff` producer blockers to Build repair or terminal task decisions.
   - Forbid deleting dependency edges to bypass a non-delivered producer.
   - Restrict Architect to cases where the persisted architect artifact itself is proven invalid and named.
3. `packages/opencorvus/test/orchestrator/tools.test.ts`
   - The current-project goal test now makes a real commit while the mocked BuildAgent omits diff facts; the persisted outcome must be `delivered` with non-empty host file facts.
   - The no-diff dependency test still proves `completed/no_project_diff` does not satisfy downstream Build dispatch.
   - The local helper now writes `ProjectTable.sandboxes` as `[]`, matching the json-array column contract and fixing the verification blocker where `Project.fromDirectory` received a string.
4. `packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts`
   - Pins the recovery guidance against generic `Re-run architect` text and no-diff dependency bypass.

## Verification

Commands run:

```powershell
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "goal build can run in current project without persisting a managed workspace" --timeout 120000
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "goal build treats dependency no-project-diff outcome as unfinished" --timeout 120000
bun test packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts --timeout 120000
bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000
bun run --cwd packages/opencorvus typecheck
```

Results:

- Current-project goal diff regression: passed.
- No-diff dependency blocking regression: passed.
- Orchestrator prompt/tool text regressions: 22 pass.
- Historical docs links: 19 pass.
- Typecheck: passed.
