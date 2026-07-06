---
name: software-test-implementation
description: Use when creating, repairing, running, or debugging executable software-test artifacts.
---

# Software Test Implementation

Before editing, read the test protocol and inventory. Identify the exact runner, command, files, and context contract.

For OpenTest-style work:

- `TEST.md` is the scenario contract.
- `script.ts` is the executable implementation.
- `.opentest/ctx.d.ts` is the stable context Application Programming Interface contract.
- `KNOWLEDGE.md` records durable project testing knowledge.
- Run artifacts prove the result and must be referenced in the final evidence.

Run the exact command that corresponds to the changed test. When the command fails, inspect the failure evidence before editing:

- Stale script: the product behavior is correct, but the test script or selector no longer matches it.
- Missing fixture: the expected setup, data, credential, or service is absent.
- Toolchain failure: the test runner, dependency, browser, or local command path is broken.
- Real product bug: the implementation violates the scenario contract.

Repair stale scripts and local toolchain issues, rerun, and preserve the result. Report real product bugs with the failing step, expected result, actual result, and artifact path.
