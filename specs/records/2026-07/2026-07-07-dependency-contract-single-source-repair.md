# Dependency Contract Single Source Repair

Date: 2026-07-07
Status: Implemented

## Recall

| Item | Details |
| --- | --- |
| User request | Diagnose how task `tsk_f3b4a4dc5001Y2S8GaSKHRw4ZH` failed, then fix the root cause and review the result. |
| Acceptance criteria | `manage_task action=modify_goal` and `manage_task action=add_goal` must not be able to write executable `engine_goal.depends_on` edges that are not represented by the active `architect_contract_graph.dependency_contracts`. The failed Futures workflow pattern must become impossible: replacing a producer cannot leave component goals depending on a new producer while the persisted contract graph still names the old producer. Focused tests must cover the dependency split and existing build-side contract graph validation must remain strict. |
| Hard constraints | No fallback or compatibility path; no hidden host-side auto-repair of the graph; no dependency deletion to bypass an undelivered producer; no git reset; no new worktree; do not disturb unrelated dirty workspace changes; specs stay under `specs/`; code changes require tests. |
| Disk records read | `specs/artifacts/长程编排测试.md`, `specs/records/2026-06/2026-06-25-architect-contract-graph-persist-integrity.md`, `specs/records/2026-07/2026-07-06-current-project-goal-diff-and-graph-repair.md`, `specs/current/architecture/01-agents.md`, `specs/current/architecture/13-agent-communication-matrix.md`, `specs/README.md`, `specs/records/2026-07/README.md`. |
| Full-repo grep | `rg -n "architect_contract_graph|dependency contract|register_dependency_contract|modify_goal|contract graph|contract_producer_not_ancestor|dependency_edge_missing_reason" specs/current specs/records specs/artifacts packages/opencorvus/src packages/opencorvus/test -S`; `rg -n "appendGoalToActiveGraph|updateGoal|modify_goal|depends_on" packages/opencorvus/src/engine packages/opencorvus/src/orchestrator packages/opencorvus/src/architect -S`; `rg -n "runManageTaskTool|createOrchestratorTools|modify_goal|add_goal|architect contract graph has blocker|dependency_edge_missing_reason" packages/opencorvus/test/orchestrator/tools.test.ts -S`. |
| Runtime evidence | The failed task first produced an old foundation goal with `no_project_diff(actual_changed_files_empty)`, then a replacement foundation goal with delivered commit `421c2afde052`. Orchestrator rewired component goal `depends_on` to the replacement producer, but build dispatch rejected every component because the latest `architect_contract_graph` still registered contracts and dependency reasons against the old producer. The terminal cancellation was an external abort after Architect re-entry started; it was not the implementation failure. |
| Independent agent feedback | Not spawned: current tool rules prohibit sub-agent spawning unless the user explicitly requests subagents. This record therefore relies on direct DB/tool evidence and a required main-agent second review after implementation. |

## Causal Chain

1. Architect's `register_dependency_contract` is designed as the single semantic dependency writer: it records the dependency reason in `architect_contract_graph.dependency_contracts` and materializes the executable edge into the dependent goal's `depends_on`.
2. Orchestrator's `manage_task action=modify_goal` currently accepts arbitrary goal contract field updates, including `depends_on`, and writes them directly to `engine_goal`.
3. Orchestrator's `manage_task action=add_goal` can also append a goal with a non-empty `depends_on` list directly through `appendGoalToActiveGraph`.
4. Neither Orchestrator path writes matching `dependency_contracts` or re-registers producer/consumer contracts in the latest `architect_contract_graph`.
5. Build correctly validates the persisted graph before dispatch and refuses to run when `engine_goal.depends_on` and `architect_contract_graph` disagree.

## Repair Design

1. Keep build-side validation strict; it is the safety check that exposed the corrupted persisted graph.
2. Add a shared Orchestrator guard that detects when the current task already has an `architect_contract_graph` artifact.
3. Reject `modify_goal` when it would change `depends_on` under an existing architect graph. The returned message must direct the scheduler to use Architect `register_dependency_contract` / `submit_architect`, not a hidden host repair.
4. Reject `add_goal` with non-empty `depends_on` under an existing architect graph for the same reason. A dependency-bearing new goal in a graph-owned workflow must go through Architect so the goal row, contracts, and dependency reasons land together.
5. Preserve no-op behavior: submitting the same `depends_on` value should remain a no-op rather than a false blocker.

## Test Plan

- Add an Orchestrator tool regression proving `modify_goal` cannot replace a goal dependency after an architect graph exists; assert DB `depends_on` and graph artifact remain unchanged.
- Add an Orchestrator tool regression proving `add_goal` cannot append a dependency-bearing goal after an architect graph exists.
- Run the focused Orchestrator tests for these new cases.
- Run historical docs link validation after adding this spec record.

## Implemented Fix

1. `packages/opencorvus/src/orchestrator/tools.ts`
   - Added a shared dependency-graph mutation guard that detects the current task's latest `architect_contract_graph` artifact.
   - `manage_task action=modify_goal` now rejects real `depends_on` changes when an Architect graph exists. No-op resubmissions of the same `depends_on` value still remain no-ops.
   - `manage_task action=add_goal` now rejects dependency-bearing new goals when an Architect graph exists. Dependency-free additions remain supported.
2. `packages/opencorvus/test/orchestrator/tools.test.ts`
   - Added the replacement-producer regression that attempts to rewrite a consumer goal from the old producer to a replacement producer and verifies the mutation is refused.
   - Added the dependency-bearing `add_goal` regression and adjusted the existing append-goal test so it no longer treats an unregistered dependency edge as valid under an Architect graph.
3. `specs/records/2026-07/README.md`
   - Indexed this repair record.

## Verification

Commands run:

```powershell
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "modify_goal refuses depends_on rewrites|add_goal refuses dependency-bearing goals|add_goal appends a new operator instruction goal" --timeout 120000
bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000
bun run --cwd packages/opencorvus typecheck
```

Results:

- Orchestrator dependency graph guard regressions: passed, 3 tests.
- Historical docs links: passed, 20 tests.
- Package typecheck: passed.

## Second Review

- The build-side graph validation remains strict; the repair does not add a fallback path that would let Build consume an inconsistent graph.
- The guard is intentionally placed at Orchestrator write boundaries, before DB mutation, so rejected calls leave both `engine_goal` rows and `architect_contract_graph` artifacts unchanged.
- `delete_goal` remains a related lifecycle risk for graph-owned workflows because deleting graph-referenced goals can also invalidate persisted contracts. It is outside this dependency-edge repair and should be handled as a separate lifecycle-boundary change through Architect `remove_goal`.
