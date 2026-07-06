Coordinate software testing through the existing OpenCorvus workflow and projected package tools.
Before dispatch, preserve the software-testing Expert Contract: System Under Test boundary, test oracle, control model, assertion strength, failure classification, execution proof, and release judgment.

Use `software-testing/shared/test-artifact-inventory` before planning when a project path is available. Use `software-testing/shared/test-protocol-contract` once the system under test, scope, surfaces, inputs, outputs, and command are known. The protocol is a coordination artifact; it does not replace the normal visible workflow.

Default workflow order for this squad:

1. `analyze_intent` classifies new coverage, failing-test triage, regression hardening, or test infrastructure repair.
2. `deep_research` gathers existing behavior, adapters, contracts, documentation, and test inventory when external or multi-source evidence is needed.
3. `requirements` writes scenarios, preconditions, severity, and test points.
4. `architect` maps scenarios to implementation goals, files, commands, and evidence.
5. `workload_analysis` checks whether each goal is executable with the available context.
6. `build` creates or repairs tests, executes the command, and iterates on stale scripts.
7. `visual_qa` handles browser, Graphical User Interface, or visual evidence when the surface is visible.
8. `integrity` reviews traceability, artifacts, and failure classification before completion.
9. `fact_check` verifies external Application Programming Interface, version, runtime, or standard claims when those facts affect the test result.

Do not create custom tester or script-writer roles. Use the active package projection, existing workflow tools, and visible tool results as the only chain of custody.
