# 2026-06-25 Visual Evidence No Hard Gate Root Repair

## Goal

Root-cause and remove OpenCorvus host-side visual hard gates. Visual and
reference-comparison evidence remains required work evidence for frontend agents
to inspect, repair against, and cite, but the host must not reject delivery,
rewrite `report_build_result(status="passed")`, withhold Visual QA completion,
or block Integrity consensus only because reference-comparison artifacts are
missing, unreadable, incomplete, or not perfectly region-covered.

Updated user objective also requires:

- run `bun run build:overlay` after the repair;
- open/use the OpenCorvus task publishing path with model `gpt-5.5`;
- create the requested task in
  `C:\Users\chuan\myhexin-local\demos\economy\economy_2` from
  `C:\Users\chuan\myhexin-local\opecorvus\specs\tv2ainvest.md`.

## Superseded Design

This record supersedes the host-gating parts of
`specs/new-arch/2026-06-20-reference-comparison-evidence-chain-root-repair.md`.
That older record correctly identified that screenshot-only prose can be weak
evidence, but it installed the wrong control mechanism:

- Build terminal report validation rejects `passed` without task-scoped
  reference-comparison evidence.
- Visual QA terminal submission rejects accepted reports when host-side parity
  evidence checks fail.
- Integrity consensus rejects `verdict=pass` when host-side visual bundle
  validation fails.
- Workflow projection keeps Visual QA pending or failed from reference evidence
  shape alone.

Those are gates. They turn visual evidence from feedback into a host-side
delivery veto, which conflicts with the current rule: try to repair, keep visual
evidence visible, and if no further optimization is possible, let the agent
explicitly report the remaining failure instead of having the host silently
rewrite or reject terminal state.

## Required Semantics

1. Zod schema and database integrity checks remain valid data-shape constraints.
2. Visual evidence checks may produce visible advisory text.
3. Visual evidence checks must not return terminal-tool `BLOCKERS` solely from
   missing or imperfect reference-comparison evidence.
4. Build must record the model's terminal status as submitted after schema
   validation. It must not downgrade `passed` to `failed` because reference
   comparison refs are missing.
5. Visual QA must record one schema-valid report. The report's own
   `accepted`, `production_blockers`, and findings describe success or failure.
   The host may warn about weak evidence but must not reject the report.
6. Integrity must record one schema-valid consensus. The report's own `verdict`
   describes success or failure. The host may warn about weak visual evidence
   but must not reject the consensus.
7. Workflow projection must not treat reference-comparison evidence shape as a
   hard completion gate. It should project Visual QA from the submitted report's
   own accepted/blocker fields.
8. Prompts should still tell agents to inspect real screenshots and reference
   comparisons, repair visible mismatches, and be honest about remaining gaps.
   Prompt text must not describe a host-side mandatory evidence gate.

## Callpoint Inventory

| Area                              | File(s)                                                                                                                                                | Current problem                                                                                                                                    | Repair                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build terminal report             | `packages/opencorvus/src/build/agent.ts`                                                                                                               | `validateBuildReferenceComparisonEvidenceReport()` rejects `passed`; external executor path calls `makeReferenceComparisonEvidenceFailedResult()`. | Delete the validator/downgrade path. Keep terminal schema parsing and record the submitted status.                                                                        |
| Build prompt overlay              | `packages/opencorvus/src/build/prompt-context.ts`                                                                                                      | Renders `build-reference-comparison-evidence` as a terminal pass contract.                                                                         | Remove pass-contract overlay. Keep visual evidence as repair feedback.                                                                                                    |
| Build report type docs            | `packages/opencorvus/src/build/types.ts`                                                                                                               | Field description says refs are required for passed builds.                                                                                        | Reword as optional supporting evidence.                                                                                                                                   |
| Orchestrator build context        | `packages/opencorvus/src/orchestrator/tools.ts`                                                                                                        | Derives and passes `referenceParity` into Build only to activate the terminal gate.                                                                | Stop passing Build reference parity gate context. Visual QA/Integrity may still receive visual evidence context as advisory/review input.                                 |
| Build prompt core                 | `packages/opencorvus/src/prompt/core/build-core.txt`                                                                                                   | Describes reference evidence as something required before reporting success.                                                                       | Reword to require honest inspection/repair and explicit gap reporting, not host-gated success.                                                                            |
| Visual QA terminal tool           | `packages/opencorvus/src/visual-qa/output-tools.ts`                                                                                                    | Rejects accepted reports without host-verified reference-comparison evidence and other host-derived blockers.                                      | Record schema-valid reports; return advisory warnings in the tool output.                                                                                                 |
| Visual QA prompts/context         | `packages/opencorvus/src/visual-qa/agent.ts`, `packages/opencorvus/src/visual-qa/context.ts`, `packages/opencorvus/src/prompt/core/visual-qa-core.txt` | Says accepted reports require reference-comparison evidence.                                                                                       | Reword as evidence/repair expectations and explicit self-reported blocker/gap semantics.                                                                                  |
| Integrity terminal tool           | `packages/opencorvus/src/integrity/team-agent.ts`                                                                                                      | Rejects `pass` consensus when host-side visual bundle validation fails.                                                                            | Record schema-valid consensus and return visual advisory warnings without blocking.                                                                                       |
| Integrity inspect evidence        | `packages/opencorvus/src/integrity/acceptance-tools.ts`                                                                                                | Shows invalid visual bundle status.                                                                                                                | Keep as read-only evidence feedback because it does not reject terminal state.                                                                                            |
| Workflow projection               | `packages/opencorvus/src/engine/workflow.ts`                                                                                                           | Recomputes reference parity and withholds/marks completion from evidence refs.                                                                     | Project Visual QA from the report's own accepted/blocker fields after schema parsing.                                                                                     |
| Architect final visual acceptance | `packages/opencorvus/src/architect/output-tools.ts`                                                                                                    | May still use "fidelity gate" language and blocker severity for visual evidence planning.                                                          | Inspect after core repair; remove host-side visual gate semantics if submit-time blockers remain. Planning may require visual review goals, but not a hard evidence veto. |
| Regression tests                  | build-agent, visual-qa, integrity, workflow tests                                                                                                      | Pin old gate behavior.                                                                                                                             | Replace with no-hard-gate assertions and keep schema/data integrity tests.                                                                                                |

## Verification Plan

Run targeted tests for the changed surfaces, then run the requested overlay
build:

```bash
bun test packages/opencorvus/test/build-agent/reference-comparison-report.test.ts
bun test packages/opencorvus/test/visual-qa/output-tools.test.ts
bun test packages/opencorvus/test/integrity/team-agent.test.ts
bun test packages/opencorvus/test/integrity/browser-preview-tool.test.ts
bun test packages/opencorvus/test/engine/workflow-integrity-step.test.ts
bun test packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts
bun run build:overlay
```

After build verification, publish the `tv2ainvest.md` task through the real
OpenCorvus task creation API (`POST /task`) against the specified project
directory using model `gpt-5.5`. If the user-facing overlay/server is not
reachable, do not mutate the database directly; report the exact connection
blocker and the verified API request that would be sent.
