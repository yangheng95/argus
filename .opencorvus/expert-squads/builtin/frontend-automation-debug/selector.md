# Frontend Automation Debug Expert Squad

Use this skill when the task is about frontend automation, browser-runtime debugging, visual regression, Playwright evidence, preview diagnostics, or flaky user-interface checks.

## First action

Call `select_expert_squad` with `profile_id: "frontend-automation-debug"` unless the current task root session is already using that profile.

The reason must cite concrete evidence: failing test name, browser trace, screenshot mismatch, selector failure, preview target failure, console/runtime error, network failure, or visual acceptance defect.

Selecting this squad means the Orchestrator must hold the task to the Expert Debug Contract below.

## Expert Debug Contract

An expert frontend debug result must include a causal debug model, not just a fix attempt:

1. Evidence anchor: exact command, page, interaction, selector, fixture/state, screenshot, trace, console or runtime error, network failure, preview target, or visual acceptance defect.
2. Reproduction: rerun the failure before repair when the path is not already proven, or cite durable evidence that proves the same path.
3. Layered ownership: separate automation harness, browser runner, preview target, fixture/state, selector/assertion, component/service/style, runtime environment, and acceptance evidence.
4. Hypothesis discipline: list plausible causes and the evidence that supports or rejects each one.
5. Causal chain: observable symptom -> direct trigger -> owning code or tool path -> deeper design or data-flow cause -> why prior or superficial fixes did not root-cause it.
6. Root repair: change the proven owner without fallback, broad sleeps, selector churn, route gates, compatibility aliases, or unrelated cleanup.
7. Proof and review: rerun the original path, add or update targeted regression evidence, include browser or screenshot proof for visible behavior, and perform a second review for false-green risk.

If the available evidence cannot support this chain, say what is unknown and collect the missing evidence before implementation.

## Debug discipline

- Reproduce the visible failure before changing product code when the failure path is not already proven.
- If the automation harness, preview target, screenshot capture, or diagnostic command is broken, repair that tool path first.
- Use Node-launched browser automation on Windows; do not use Bun to launch Playwright on Windows.
- Prefer the task-scoped backend preview target and recorded evidence as the source of truth for frontend preview work.
- Do not treat a clean typecheck, build, Document Object Model text check, or console log as visual acceptance for user-interface work.
- Do not infer root cause from a task title, filename, selector label, or the last terminal status without tool, artifact, runtime, or code-path evidence.

## Repair scope

Keep repairs tied to the narrowest visible failure: selector, timing, fixture, state setup, rendering surface, preview target, component behavior, or layout regression.

When evidence proves the product is wrong, dispatch implementation repair. When evidence proves the automation is wrong, dispatch test or harness repair. When both are wrong, preserve both findings and fix them in that order only when the same task owns both surfaces.

## Completion evidence

Before final acceptance, require rerunnable commands and visible proof: test output, screenshot or browser evidence, affected selectors/states, and residual risk if a failure could not be fully reproduced.
