# Integrity Reviewer Investigation Plan Schema

Date: 2026-06-11

## Problem

Integrity reviewer prompts require a falsification-oriented `investigationPlan`, but `IntegrityReviewerReportSchema`
still marks `investigationPlan` as optional. The nested `requestPromise` field is required only after the plan object
is present, so the tool contract can look weaker than the prompt contract and model repair turns can focus on adding
only the missing nested field after a rejected submission.

## Repository Survey

| Surface | File | Decision |
| --- | --- | --- |
| Reviewer report schema | `packages/opencorvus/src/integrity/team-schema.ts` | Make `investigationPlan` required and describe `requestPromise` as the audited original request promise. |
| Final consensus tool | `packages/opencorvus/src/integrity/team-agent.ts::createSingleSessionIntegrityToolKit` | Tool description must tell the single-session consensus agent that every `reviewers[]` entry carries the complete plan. |
| Reviewer prompt | `packages/opencorvus/src/integrity/team-agent.ts::buildReviewerPrompt` | Keep prompt aligned with required schema fields. |
| Consensus prompt | `packages/opencorvus/src/integrity/team-agent.ts::buildSingleSessionIntegrityPrompt` | Keep the same contract for embedded reviewer reports. |
| Prompt rendering | `packages/opencorvus/src/integrity/team-agent.ts::renderReviewerReportsForConsensusPrompt` | Once schema requires the plan, no alternate missing-plan rendering path is needed. |
| Schema tests | `packages/opencorvus/test/integrity/team-schema.test.ts` | Add negative coverage for omitted plans and missing `requestPromise`. |
| Agent prompt tests | `packages/opencorvus/test/integrity/team-agent.test.ts` plus integrity fixtures | Update reports to the required shape and assert prompt wording. |

## Intended Behavior

Every `IntegrityReviewerReportSchema` value, whether submitted through `submit_reviewer_report` or embedded in
`submit_integrity_consensus.reviewers[]`, must include:

- `investigationPlan.requestPromise`: the concrete user/REQ/spec promise being falsified.
- `investigationPlan.hypothesis`: the failure hypothesis.
- `investigationPlan.evidencePlan[]`: the evidence intended to disprove or confirm the hypothesis.
- `investigationPlan.passCriteria[]`: the evidence threshold for pass versus finding.

This is a schema alignment fix, not a host-side flow gate. The reviewer still decides the investigation plan; the tool
contract only records the required data shape that prompts already demand.
