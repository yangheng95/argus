# Integrity Adversarial Investigation Discipline

Date: 2026-06-08

## Problem

Integrity review currently has enough severity discipline, but its investigation stance can be too passive. A reviewer can pass by restating executor summaries, goal reports, or acceptance prose without first deriving likely failure modes and inspecting disconfirming evidence.

This is not a request to make every concern blocking. The root issue is earlier: reviewers must actively try to falsify the deliverable before consensus, then only pass when the scoped evidence actually survives that attempt.

## Repository Survey

Relevant call sites and surfaces:

| Surface                                | File                                                                                 | Decision                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Core reviewer role and evidence policy | `packages/opencorvus/src/prompt/core/integrity-team-core.txt`                        | Strengthen investigation stance.                                                            |
| Single-session integrity prompt        | `packages/opencorvus/src/integrity/team-agent.ts::buildSingleSessionIntegrityPrompt` | Require reviewer perspectives to carry falsification hypotheses and drilldowns before pass. |
| Independent reviewer prompt            | `packages/opencorvus/src/integrity/team-agent.ts::buildReviewerPrompt`               | Same discipline for legacy/multi-stage reviewer prompts.                                    |
| Supervisor consensus prompt            | `packages/opencorvus/src/integrity/team-agent.ts::buildSupervisorConsensusPrompt`    | Consensus must treat missing investigation as uncovered risk, not as a pass narrative.      |
| Prompt regression tests                | `packages/opencorvus/test/integrity/team-agent.test.ts`                              | Add assertions for investigation discipline wording.                                        |

Existing schema already rejects `pass` with blocking findings, required repairs, or unresolved disagreements. Adding a host gate would hide the problem and violate the prompt-over-host invariant. The fix is prompt-level discipline plus tests.

## Intended Behavior

Integrity reviewers must:

- Start from concrete failure hypotheses derived from the original request, requirements, goals, acceptance specs, changed directories, prior findings, and runtime/visual evidence.
- Inspect at least one disconfirming evidence source for each pass claim in their scope when tools are available.
- Treat executor reports, goal reports, decision-log prose, build success, and grep/listing output as leads rather than proof.
- Record the work in `investigationPlan`, `drilldowns`, `coverage`, and evidence fields. A pass report without real investigation is an incomplete review.
- Use `uninspectedRisks` when a high-risk surface was not checked, instead of turning that gap into praise.

Severity remains governed by the existing blocking/advisory bar.
