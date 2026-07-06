---
name: software-test-review
description: Use when reviewing whether software-testing artifacts and evidence satisfy the requested quality goal.
---

# Software Test Review

Review testing work from requirements to artifacts to run evidence.

Check:

- The requested system under test and surfaces are covered.
- Each scenario has preconditions, steps, expected result, severity, and test points.
- Edited tests assert behavior after action, including negative paths when relevant.
- The exact command was run after edits.
- Evidence includes logs, reports, screenshots, videos, or result files required by the surface.
- Failures are classified as stale script, missing fixture, toolchain failure, or real product bug with supporting evidence.
- Package tools were active only through the `software-testing` projection.

If a required command or visual inspection was not run, mark the deliverable incomplete with the missing evidence and impact.
