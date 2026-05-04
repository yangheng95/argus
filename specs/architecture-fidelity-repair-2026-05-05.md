# Architecture Fidelity Repair Plan (2026-05-05)

## Problem Statement

Current multi-stage execution optimizes for local goal contracts, not for integrated delivery fidelity.

Observed failure modes:

- Architect proves `REQ-N -> goal` traceability but does not prove source-code coverage.
- Reference-driven tasks may carry visual specs downstream, but no stage before build proves that every reference surface has an owner.
- Verification owns only test paths, so no stage owns final assembly of shared UI, routing, layout, or cross-goal visual closure.
- Orchestrator dispatches build from goal contracts alone; it does not hard-fail when architect output is missing source/reference/assembly coverage.

This produces locally coherent goals that assemble into low-fidelity output.

## Root Cause

The system compresses the original task truth into `requirements`, `acceptance_specs`, `owned_paths`, and cross-goal contracts too early.

Missing contracts:

1. `source_coverage`: which existing files / modules / surfaces are reused, modified, or intentionally left unchanged
2. `reference_coverage`: which authoritative reference regions / interactions / assets are owned by which goal
3. `assembly_ownership`: which goal owns integration and final user-visible stitching for each shared surface

Without those contracts, build agents optimize their local subset and nobody is accountable for whole-product fidelity.

## Target State

Architect output becomes a real delivery contract, not only a decomposition artifact.

Required properties:

1. Every requirement still maps to one or more goals.
2. Every relevant existing source surface maps to one or more goals with an explicit action.
3. Every authoritative reference surface maps to one or more goals with explicit ownership.
4. Every shared user-visible assembly surface has exactly one owning goal.
5. Orchestrator refuses to dispatch per-goal build until all four coverage dimensions validate.

## Phase Plan

### Phase 1: Schema + Validation Hardening

Add architect-owned structured coverage records and make them validator-enforced:

- `register_source_coverage`
- `register_reference_coverage`
- `register_assembly_owner`

Collector validation must reject:

- missing source coverage on modification tasks
- missing reference coverage on reference-driven tasks
- missing assembly ownership for multi-goal tasks
- coverage rows pointing at unknown goals
- duplicate assembly ownership for the same surface

Implementation files:

- `packages/opencorvus/src/architect/types.ts`
- `packages/opencorvus/src/architect/output-tools.ts`
- `packages/opencorvus/src/architect/agent.ts`
- `packages/opencorvus/src/prompt/core/architect-core.txt`

### Phase 2: Persistence + Dispatch Gate

Persist the new coverage contract into goal metadata and surface task-wide coverage in build context.

Orchestrator must validate the persisted goal graph before dispatch:

- hard-stop build dispatch when architect coverage is incomplete
- emit actionable failure text naming the missing dimension
- pass task-wide coverage context into build prompts so executors know what source/reference surface they are responsible for preserving

Implementation files:

- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/build/agent.ts`

### Phase 3: Prompt Realignment

Architect prompt must stop treating visual constraints as merely advisory when the task is reference-driven.

Build prompt must receive:

- goal-local contract
- task-wide source/reference/assembly coverage rows
- explicit instruction to preserve source surfaces that belong to the goal and not redesign authoritative reference surfaces

Implementation files:

- `packages/opencorvus/src/prompt/core/architect-core.txt`
- `packages/opencorvus/src/build/agent.ts`

### Phase 4: Regression Tests

Add tests that prove:

1. architect submit rejects incomplete coverage
2. multi-goal reference-driven decomposition requires assembly ownership
3. orchestrator build dispatch refuses incomplete coverage
4. build prompt includes the new coverage contract

Implementation files:

- `packages/opencorvus/test/architect/output-tools.test.ts`
- `packages/opencorvus/test/build-agent/prompt-context.test.ts`
- new orchestrator coverage-gate test file if needed

## Non-Goals For This Batch

These are real problems, but not part of the first hardening batch:

- replacing the dedicated verification goal model entirely
- redesigning delivery verdict synthesis
- changing database schema for new top-level task tables

Those can be handled after the coverage contract exists and dispatch is gated on it.

## Acceptance Criteria

This batch is complete only when all of the following are true:

1. Architect cannot finalize a decomposition that lacks required source/reference/assembly coverage.
2. Orchestrator cannot dispatch `build` for a goal graph with incomplete fidelity coverage.
3. Build prompt receives task-wide fidelity coverage context.
4. Targeted tests cover all new gate behavior.
