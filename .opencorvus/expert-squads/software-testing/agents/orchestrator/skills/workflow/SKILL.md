---
name: software-testing-workflow
description: Use when coordinating a WuJiang/OpenTest expert squad task through the existing OpenCorvus workflow and package tools.
---

# WuJiang/OpenTest Workflow

Use this skill after the `software-testing` expert squad is active.

The OpenTest protocol is external to this skill. Read it by calling `software-testing/shared/opentest-protocol-engine` in `contract` mode. Validate test cases through the same tool in `validate` mode. Use `software-testing/shared/test-artifact-inventory` for discovery.

Do not duplicate OpenTest artifact fields, lifecycle rules, or mark-point rules here. The parsed contract output is the only protocol source for planning, implementation, and review.
