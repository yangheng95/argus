---
name: software-testing-workflow
description: Use when coordinating a software-testing expert squad task through the existing OpenCorvus workflow and package tools.
---

# Software Testing Workflow

Use this skill after the `software-testing` expert squad is active.

## Context Protocol

Inputs:

- User objective and release or quality risk.
- System under test entry points, runtime setup, credentials, fixtures, and environment constraints.
- Existing test inventory and runner commands.
- Context contract such as `.opentest/ctx.d.ts`, browser adapters, Application Programming Interface adapters, or shell helpers.
- Evidence from exploration, requirements, architecture, build runs, Visual QA, Integrity, and fact checks.

Outputs:

- Test scope contract with surfaces, priorities, and out-of-scope items.
- Test case contract with preconditions, steps, expected result, severity, and test points.
- Execution contract with command, environment, edited files, and no-activity timeout expectation.
- Result contract with status, failing step or point, artifact paths, screenshots/logs, and stale-script versus real-bug classification.
- Review contract with release impact, defects, observations, and follow-up tests.

## Workflow Position

1. Use `analyze_intent` for testing intent classification.
2. Use `deep_research` to gather local and external facts when the test contract depends on multi-source evidence.
3. Use `requirements` to define scenarios and test points.
4. Use `architect` to map scenarios to executable artifacts.
5. Use `workload_analysis` to check executability.
6. Use `build` to implement, run, debug, and rerun tests.
7. Use `visual_qa` for browser or visual surfaces.
8. Use `integrity` for evidence review and failure classification.
9. Use `fact_check` when external facts affect the result.

Use the package tools for inventory and protocol materialization. Do not create a second dispatcher, hidden message path, or custom testing role.
