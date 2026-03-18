# Spec -> Goal Graph -> Workflow -> QA Refactor Plan

## Summary

This refactor will move the orchestrator to four authoritative stages:

1. `Spec formulation`
2. `Goal decomposition`
3. `Plan workflow`
4. `Execute + QA`

The migration will be implemented in small, verifiable slices. Each slice must pass typecheck before the next slice starts. Runtime cutovers only happen after the required contracts and persistence are already in place.

## Compass

### North Star

- `Spec` is the source of truth for user intent and requirements only.
- `GoalSnapshot` is the source of truth for executable workload decomposition.
- `Plan` is the source of truth for workflow order only.
- `QA` is the only authority that can mark a goal or the full task as accepted.
- No stage may silently redefine the contract owned by an upstream stage.

### Do Not Regress

- Do not reintroduce `spec_items => goals` as the authoritative execution path.
- Do not let planner invent, merge, or rewrite goals.
- Do not let `spec_check` fail a bootstrap goal because unrelated requirements remain unfinished.
- Do not couple goal dependency truth back to plan waves.
- Do not cut runtime behavior until contracts, persistence, and views already exist for the next source of truth.

### Verification Rule

- Each slice must be shippable on its own.
- Each slice must record its acceptance command and known external blockers.
- Repository-wide `bunx tsc --noEmit` is currently noisy because of existing `src/acp/agent.ts` and `src/cli/cmd/tui/context/sync.tsx` errors, so slice validation must also confirm that no new errors are introduced in touched files.

## Progress Snapshot

### Completed

- Phase 1 is done.
- Phase 2 is done.
- Phase 3 is done.
- Landed shared contracts for `Requirement`, `GoalSnapshot`, `GoalQaProfile`, and enriched goal metadata.
- Added persistence scaffolding for `orchestrator_requirement` and `orchestrator_goal_snapshot`.
- Added routing / checks scaffolding for `goal` stage and `goal_check`.
- Added store and board-level exposure needed for later cutovers.
- Cut spec generation over to formulation-first `requirements[]` while keeping temporary legacy `spec_items[]` and goal projections alive for runtime compatibility.
- Removed spec-service goal derivation and execution-tranche trimming.
- Moved spec-stage quality gating away from execution-sized slicing and toward formulation coverage, acceptance clarity, and evidence grounding.
- Persisted first-class requirements on spec snapshot writes and reloads.
- Added a strict no-fallback `GoalService` that compiles `GoalSnapshot` from spec requirements and rejects orphan coverage, cycles, and umbrella goals.
- Split spec snapshot persistence from goal snapshot persistence.
- Bound active plan metadata to `goal_snapshot_id` and made runtime / export / board consume goals through the active plan instead of raw spec linkage.
- Switched plan-node dependency projection to use persisted goal-contract dependencies instead of wave order.
- Enriched goal execution prompts with `objective`, `owned_paths`, and `done_definition`.

### Files Landed In Phase 1

- `src/id/id.ts`
- `src/orchestrator/model.ts`
- `src/orchestrator/orchestrator.sql.ts`
- `src/storage/ddl.ts`
- `src/storage/schema.ts`
- `src/orchestrator/store.ts`
- `src/orchestrator/checks.ts`
- `src/workbench/board.ts`

### Files Landed In Phase 2

- `src/spec/agent.ts`
- `src/spec/service.ts`
- `src/orchestrator/persist.ts`
- `src/orchestrator/service.ts`
- `src/planner/service.ts`

### Files Landed In Phase 3

- `src/goal/service.ts`
- `src/goal/runner.ts`
- `src/orchestrator/persist.ts`
- `src/orchestrator/runtime.ts`
- `src/orchestrator/service.ts`
- `src/orchestrator/spec-goal-service.ts`
- `src/orchestrator/store.ts`
- `src/orchestrator/agent-stream.ts`
- `src/orchestrator/model.ts`
- `src/server/routes/export.ts`
- `src/workbench/board.ts`

### Current Safe State

- Spec is now formulation-first and persists `requirements[]` as primary data.
- Goal decomposition is now a first-class stage and active plans carry `goal_snapshot_id`.
- Planner consumes goal-stage output instead of spec-derived goal projection.
- Runtime / export / board now read goals through the active plan-bound goal snapshot.
- QA pipeline cutover is still pending.

### Immediate Next Slice

- Phase 5: QA pipeline cutover.
- Add built-in `goal_check` and scoped `spec_check` execution order.
- Separate goal acceptance from final full-spec acceptance.
- After that, revisit goal decomposition quality for scaffolded benchmark workspaces so structural requirements are not emitted as misleading first-run no-op goals.

## Phase 1: Shared Contracts And Persistence Scaffolding

- Add first-class `Requirement`, `GoalSnapshot`, `GoalContract`, and `GoalQaProfile` schemas.
- Add `goal` routing, `goal_check`, and scoped `spec_check` config.
- Add persistence scaffolding for `orchestrator_requirement` and `orchestrator_goal_snapshot`.
- Expose new requirement / goal-snapshot views in the store layer.
- Do not cut over runtime behavior in this phase.

Checks:

- `bunx tsc --noEmit`

## Phase 2: Spec Formulation Cutover

- Change spec output from execution-oriented `spec_items[]` to formulation-oriented `requirements[]`.
- Remove spec-stage goal derivation.
- Rewrite spec quality gating to validate formulation quality only.
- Persist requirements instead of spec items for new runs.

Implementation notes:

- Update `src/spec/agent.ts` output schema and prompt so the agent speaks in requirements, not execution slices.
- Update `src/spec/service.ts` to stop deriving goals from spec output.
- Update orchestrator persistence to write `requirements` as first-class records.
- Keep a temporary mapper from `requirements[]` to legacy `spec_items[]` until goal stage cutover is done.
- Rewrite spec quality validation so it checks formulation coverage, evidence, constraints, and acceptance clarity instead of item breadth.

Checks:

- `bunx tsc --noEmit`
- spec-stage focused tests
- touched-file error scan for `src/spec/*`, `src/orchestrator/persist.ts`, and any updated store/model files

Stop condition:

- A new spec can be generated and persisted with `requirements[]` as the primary representation.
- Broad requirements no longer fail the spec stage by themselves.
- Legacy planner/runtime can still consume the compatibility projection.

## Phase 3: Goal Stage Introduction

- Add a dedicated goal compiler service that consumes spec + requirements.
- Produce goal DAG snapshots with coverage, dependency, and breadth validation.
- Persist goal contracts independently from spec snapshots.
- Keep planner consuming legacy goals until phase 4 cutover is complete.

Implementation notes:

- Add a dedicated `GoalService` instead of extending planner to invent goals.
- Goal quality gate lives here, not in the spec stage.
- Persist both the snapshot row and normalized goal contracts, including requirement coverage and dependency edges.
- Replan support must be able to recompile only unresolved goals and their downstream dependents.

Checks:

- `bunx tsc --noEmit`
- goal-stage unit tests for coverage, DAG validity, and anti-umbrella gating
- touched-file error scan for goal-stage files

Stop condition:

- Every blocking requirement is covered by at least one blocking goal.
- Goal DAG validity and anti-umbrella rejection are enforced before planner runs.

Status:

- Done.
- Validation used `bunx tsc --noEmit`; repository-wide failures remain limited to pre-existing `src/acp/agent.ts` and `src/cli/cmd/tui/context/sync.tsx`.

## Phase 4: Planner / Runtime Cutover

- Make planner consume goal snapshots instead of spec-derived goals.
- Treat plan nodes as workflow projections only.
- Make runtime scheduling depend on goal DAG readiness rather than spec linkage.
- Keep execution strictly single-goal / single-workspace.

Implementation notes:

- Planner input must treat goals as immutable contracts.
- Plan nodes become workflow projections derived from goal graph readiness.
- Runtime scheduling must use goal dependencies from goal contracts, not from spec ancestry.
- Keep one ready goal at a time in the shared workspace model.

Checks:

- `bunx tsc --noEmit`
- planner + runtime integration tests
- touched-file error scan for planner/runtime files

Stop condition:

- Planner can no longer create or mutate goal semantics.
- Runtime dispatches the first ready goal from the goal graph and nothing else.

Status:

- Active runtime goal lookup is now plan-aware and plan-node dependencies are sourced from goal contracts.
- QA acceptance still uses the old grouping model.

## Phase 5: QA Pipeline Cutover

- Add built-in `goal_check`.
- Make `spec_check` support `mapped_requirements` and `full_spec`.
- Run QA in fixed order: rule checks -> goal_check -> scoped spec_check.
- Add final full-spec acceptance after all blocking goals pass.

Implementation notes:

- `goal_check` and `spec_check` must remain distinct outputs.
- Scoped spec acceptance should evaluate only the mapped requirement set for the current goal.
- Final acceptance should run only once all blocking goals pass.
- Rule-check strict failures must short-circuit later QA groups.

Checks:

- `bunx tsc --noEmit`
- evaluator tests
- integration tests for scoped and final acceptance
- touched-file error scan for evaluator files

Stop condition:

- Goal pass/fail is determined solely by QA group results.
- Final task acceptance requires the terminal full-spec check.

## Phase 6: Export / Workbench / Benchmark

- Export and display `requirements`, `goalSnapshot`, and QA grouping.
- Remove legacy spec-item-driven UI assumptions.
- Re-run `overlay-web` full benchmark with `alibaba-cn/kimi-k2.5`.

Checks:

- `bunx tsc --noEmit`
- `bun test`
- full benchmark

Stop condition:

- Export and board surfaces show requirements and goal snapshots explicitly.
- `overlay-web` full benchmark reaches execution + QA instead of dying in spec quality gate.

## Resume Protocol

If work is interrupted, resume in this order:

1. Read this file and confirm the last completed phase.
2. Check whether runtime cutover already happened; if not, preserve compatibility bridges.
3. Validate the current slice against its stop condition before opening the next one.
4. Update `Progress Snapshot` immediately after each completed slice.
