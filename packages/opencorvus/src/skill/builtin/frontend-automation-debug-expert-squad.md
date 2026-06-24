---
name: frontend-automation-debug-expert-squad
description: Orchestrator skill for frontend automation debugging. Use when a task concerns browser automation failures, Playwright checks, preview wiring, visual regression, flaky frontend tests, rendered UI diagnostics, or failures where screenshots, selectors, runtime state, and reproducible commands decide acceptance.
agents:
  - orchestrator
mounted_agents:
  - orchestrator
required_tools:
  - select_expert_squad
priority: 85
---

# Frontend Automation Debug Expert Squad

Use this skill when the task is about frontend automation, browser-runtime debugging, visual regression, Playwright evidence, preview diagnostics, or flaky UI checks.

## First action

Call `select_expert_squad` with `profile_id: "frontend-automation-debug"` unless the current task root session is already using that profile.

The reason must cite concrete evidence: failing test name, browser trace, screenshot mismatch, selector failure, preview target failure, console/runtime error, or visual acceptance defect.

## Debug discipline

- Reproduce the visible failure before changing product code when the failure path is not already proven.
- If the automation harness, preview target, screenshot capture, or diagnostic command is broken, repair that tool path first.
- Use Node-launched browser automation on Windows; do not use Bun to launch Playwright on Windows.
- Prefer the task-scoped backend preview target and recorded evidence as the source of truth for frontend preview work.
- Do not treat a clean typecheck, build, DOM text check, or console log as visual acceptance for UI work.

## Repair scope

Keep repairs tied to the narrowest visible failure: selector, timing, fixture, state setup, rendering surface, preview target, component behavior, or layout regression.

When evidence proves the product is wrong, dispatch implementation repair. When evidence proves the automation is wrong, dispatch test or harness repair. When both are wrong, preserve both findings and fix them in that order only when the same task owns both surfaces.

## Completion evidence

Before final acceptance, require rerunnable commands and visible proof: test output, screenshot or browser evidence, affected selectors/states, and residual risk if a failure could not be fully reproduced.
