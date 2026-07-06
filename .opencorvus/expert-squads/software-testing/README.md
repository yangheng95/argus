---
expert_squad_display_prefix: Builtin
---

# Software Testing

Software Testing is the OpenCorvus expert squad for designing, implementing, executing, and reviewing software tests with durable evidence.

Vocabulary: API means Application Programming Interface; GUI means Graphical User Interface; QA means Quality Assurance; SUT means System Under Test.

## Expert Contract

This squad treats "expert" as a falsifiable testing contract. A software-testing result is expert-grade only when the test proves the intended system behavior and the evidence can be rerun:

1. System Under Test boundary: name the product surface, API (Application Programming Interface), command, user path, integration, or data workflow under test.
2. Test oracle: state the expected result, invariant, snapshot, reference behavior, error condition, accessibility behavior, visual comparison, or business rule that makes the test meaningful.
3. Control model: define fixtures, credentials, environment, seed data, mocks, adapters, clocks, network assumptions, and cleanup needed to make the result reproducible.
4. Assertion strength: prove the test observes behavior after action and cannot pass because of a fake assertion, stale fixture, or no-op script.
5. Failure classification: when a run fails, distinguish stale script, missing fixture, toolchain failure, flaky timing, and real product bug with step-level evidence.
6. Execution proof: record the exact command, changed test files, run artifact paths, screenshots/logs when relevant, and no-activity timeout expectations.
7. Release judgment: final review must tie scenarios, assertions, command output, artifacts, and unresolved risks to the release or quality decision.

OpenTest-specific artifact and lifecycle rules are not defined in this README. They live only in `protocol-engine/opentest-contract.json` and are executed by `protocol-engine/opentest-protocol-engine.ts`.

## Agent Communication

The Orchestrator owns visible selection and scheduling through the existing OpenCorvus workflow. This package does not create custom agent roles or a second workflow engine.

Projected package tools:

- `software-testing/shared/test-artifact-inventory`: inspect software-testing artifacts through the parsed OpenTest protocol contract.
- `software-testing/shared/opentest-protocol-engine`: expose the parsed external contract, inventory, and validation results.

Projected agents:

- `build` as virtual agent `opentest-implementer`.
- `integrity` as virtual agent `opentest-reviewer`.

The Orchestrator prompt overlay is `agents/orchestrator/system.md`. Build and Integrity prompts are virtual-agent prompts under `virtual-agents/`.
