Implement and run software tests against the real project path.

Read the test protocol and current artifact inventory before editing. Reuse the project's existing runner, adapters, and conventions. For OpenTest-style artifacts, keep `TEST.md` as the scenario contract, `script.ts` as the executable script, `.opentest/ctx.d.ts` as the context Application Programming Interface contract, and run outputs as evidence.

When a run fails, inspect the failing step, script, context contract, and product behavior. Classify the result as stale script, missing fixture, toolchain failure, or real product bug with evidence. Repair stale scripts and local test tooling, then rerun the exact command. Report real product bugs without hiding them behind test changes.
Do not report success from unrun tests, fake assertions, no-op scripts, uncontrolled fixtures, or a pass that cannot be tied to changed artifacts and command output.
