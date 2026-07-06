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
4. Assertion strength: prove the test observes behavior after action, includes relevant negative or edge paths, and cannot pass because of a fake assertion, stale fixture, or no-op script.
5. Failure classification: when a run fails, distinguish stale script, missing fixture, toolchain failure, flaky timing, and real product bug with step-level evidence.
6. Execution proof: record the exact command, changed test files, run artifact paths, screenshots/logs when relevant, and no-activity timeout expectations.
7. Release judgment: final review must tie scenarios, assertions, command output, artifacts, and unresolved risks to the release or quality decision.

Do not call a testing task expert-grade when tests were not run, assertions do not observe the product behavior, fixture state is uncontrolled, failure is reclassified without evidence, or the reported pass cannot be tied to changed artifacts and run output.

## Agent Communication

The Orchestrator owns visible selection and scheduling through the existing OpenCorvus workflow. This package does not create custom agent roles or a second workflow engine.

Context input protocol:

- User testing objective and explicit release or quality risk.
- System Under Test (SUT) entry points, runtime setup, credentials, fixtures, and environment constraints.
- Existing test inventory: test directories, executable scripts, commands, reports, and known flaky areas.
- Available context contract for executable tests, such as `.opentest/ctx.d.ts`, browser/API adapters, shell commands, and project-specific helpers.
- Evidence from exploration, requirements, architecture, build/test runs, Visual QA, Integrity, and fact checks.

Context output protocol:

- Test scope contract: surfaces, risks, priorities, and out-of-scope items.
- Test case contract: scenario name, preconditions, steps, expected result, severity, and test points.
- Execution contract: command, environment, generated or updated test files, and no-activity timeout expectations.
- Result contract: pass/fail status, first failing step or test point, run artifact path, screenshots/logs when relevant, and stale-script versus real-bug classification.
- Review contract: release impact, blocking defects, non-blocking observations, and follow-up tests.

Workflow order:

1. `analyze_intent`: classify whether the request is new coverage, failing test triage, regression hardening, or test infrastructure repair.
2. `deep_research`: gather SUT facts, existing test commands, documentation, adapter contracts, and live behavior when needed.
3. `requirements`: define test requirements, scenario inventory, severity, test points, and acceptance criteria.
4. `architect`: decompose work into implementation goals and map each goal to test artifacts and verification commands.
5. `workload_analysis`: review whether each test goal is independently executable and has enough fixtures, adapters, and evidence.
6. `build`: create or repair tests, run the exact command, iterate on stale scripts, and report real bugs without hiding them.
7. `visual_qa`: inspect GUI or visual testing evidence when the SUT has a visual surface.
8. `integrity`: review the evidence chain and decide whether the test deliverable is reliable.
9. `fact_check`: verify version/API/runtime claims when the result depends on external facts.

Projected package tools:

- `software-testing/shared/test-artifact-inventory`: inspect current test artifacts, context files, run results, and test scripts.
- `software-testing/shared/test-protocol-contract`: materialize the testing context protocol for the current SUT and scope.

Package prompt overlays:

- orchestrator: agents/orchestrator/system.md
- intent-analysis: agents/intent-analysis/system.md
- requirements: agents/requirements/system.md
- architect: agents/architect/system.md
- goal-workload-analyst: agents/goal-workload-analyst/system.md
- build: agents/build/system.md
- visual-qa: agents/visual-qa/system.md
- integrity: agents/integrity/system.md
- deep-research: agents/deep-research/system.md
- fact-check: agents/fact-check/system.md
- general: agents/general/system.md
