# Architect Functional Acceptance Discipline

## Request

Architect acceptance specs must be meaningful functional acceptance. Syntax checks,
typecheck, lint, build success, and project startup are routine executor hygiene and
must not be treated as the acceptance contract itself.

## Call-Point Inventory

Full-repo targeted search covered:

- `packages/opencorvus/src/prompt/core/architect-core.txt`
  - Active Architect prompt and the single instruction source for
    `register_goal.acceptance_specs`.
- `packages/opencorvus/src/pipeline/goal-contract.schema.ts`
  - Tool schema requires at least one typed `AcceptanceSpec`; it should stay shape-only
    and must not grow a host-side quality gate.
- `packages/opencorvus/src/acceptance/types.ts`
  - Canonical scorer schema. Toolchain shell scorers are legal as evidence shape, but
    not sufficient as the meaning of acceptance.
- `packages/opencorvus/src/architect/output-tools.ts`
  - Validates graph integrity, requirement ids, contract graph, and fidelity concerns.
    No new blocker should be added here because prompt-level discipline is the
    correct fix path for model behavior.
- `packages/opencorvus/test/architect/grep-only-as-rejection.test.ts`
  - Existing prompt regression suite for false-green acceptance. Extend it with
    toolchain-only acceptance discipline.
- `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`
  - Broad prompt invariants already include Architect acceptance prompt checks; no
    separate broad test is necessary for this focused rule.

## Decision

Update Architect prompt only:

- Acceptance specs must name user-visible behavior, data semantics, workflow behavior,
  integration contract behavior, rendered interface fidelity, or persisted artifact
  semantics.
- A shell scorer can run a feature test, integration test, browser evidence runner, or
  targeted script that proves the feature behavior.
- Toolchain checks such as syntax/typecheck/lint/build/startup may appear only as
  auxiliary evidence inside a broader functional spec; they cannot be the sole scorer,
  title, or success criterion.
- If Requirements only says "typecheck passes" or "app starts", Architect must surface
  the requirement as under-specified instead of inventing a toolchain-only acceptance
  spec.

## Verification

- `bun test packages/opencorvus/test/architect/grep-only-as-rejection.test.ts`
