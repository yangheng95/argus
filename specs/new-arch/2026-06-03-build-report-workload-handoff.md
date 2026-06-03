# Build Report Workload Handoff

## Problem

Weak build models can understate task complexity at the end of a run even when the prompt includes `Goal Workload Brief`. The final `report_build_result` payload currently has no explicit place to restate the detailed request/goal contract or to warn later agents that the work surface needs deeper workload digging.

## Grep Coverage

| Surface | Evidence | Decision |
| --- | --- | --- |
| `BuildResultSchema` | `rg report_build_result BuildResultSchema packages/opencorvus/src packages/opencorvus/test` | Add optional typed report fields in the single BuildResult schema. |
| `report_build_result` | `build/agent.ts` uses `inputSchema: BuildResultSchema` | Update tool description only; no parallel schema. |
| External executors | `makeExternalPassedBuildResult` / `makeExternalFailedBuildResult` | Populate the new optional fields from the same external factories. |
| Trace report | `buildBuildAgentReport` | Render the new fields so following agents see them in report evidence. |
| Prompt | `buildUserPrompt` goal/request paths | Add terminal-report instructions near the final contract, where weak models are least likely to drop them. |
| Goal report | `goal_report` schema | Add the same optional follow-up warning field for goal executor reports, without changing extraction flow. |

## Implementation

1. Add `contract_restatement` and `followup_workload_guidance` to `BuildResultBase`.
2. Mention both fields in `report_build_result` description and the goal/request build prompt tail.
3. Render both fields in `buildBuildAgentReport`.
4. Add optional `followup_workload_guidance` to `GoalReport.Report` and render it in `buildGoalReport`.
5. Update focused tests for schema acceptance, prompt wording, report rendering, and external executor prompt coverage.

## Non-Goals

- No host-side gate or rejection when a model omits these fields.
- No duplicate report schema for OpenCorvus versus external executors.
- No state-machine routing based on the workload warning text.
