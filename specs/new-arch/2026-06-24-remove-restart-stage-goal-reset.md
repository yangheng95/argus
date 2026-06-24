# Retire restart_from_stage

## Problem

The orchestrator prompt and tool registry still expose `restart_from_stage` as a
valid way to move a workflow task back to requirements, plan, or executor. In a
live ETF task, the executor restart path marked terminal goal attempts with a
restart-specific supersede reason and caused already completed/failed goals to
render as pending. Removing only that reset behavior would leave the same
dangerous backward workflow affordance available to the model.

Workflow tasks must not rewind earlier stages in place. If the active workflow
contract is fundamentally wrong and cannot be repaired by `modify_goal`,
`architect`, or a targeted build inside the same task, the orchestrator must
open a separate inheriting task with `propose_task`, or choose `fail_task` /
`question` when the blocker is terminal or external.

## Call Inventory

| Surface | Current behavior | Change |
| --- | --- | --- |
| `packages/opencorvus/src/orchestrator/tools.ts` | Defines and executes the stage rewind tool, advertises it in tool results, and blocks `propose_task` while the parent task is active. | Delete the rewind tool and helper, route live workflow contract replacement through `propose_task`, and remove restart wording from tool descriptions. |
| `packages/opencorvus/src/orchestrator/scheduler.ts` | Exists only to compute restart-stage plans. | Delete the file after moving the remaining live-run status import to the engine catalog. |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt` | Lists restart as a valid next action and permits rerunning requirements after restart selection. | State that workflow tasks do not go backward in place; use same-task repair tools or `propose_task` for a new inheriting workflow task. |
| `packages/opencorvus/src/prompt/core/fact-check-core.txt` and fact-check schema | Allow fact-check to recommend restart. | Remove restart from the structured action enum and copy. |
| `packages/opencorvus/src/agent/tool-pool-contract.ts` | Exposes the restart tool to orchestrator sessions. | Remove it from the private tool list. |
| Engine describe/writer/comments/tests | Still name restart as a runtime decision path. | Rewrite to the remaining explicit decisions: retry, re-dispatch, `modify_goal`, `architect`, `propose_task`, `fail_task`, or `question`. |

## Acceptance

- `rg -n -F "restart_from_stage" packages/opencorvus/src packages/opencorvus/test`
  has no matches.
- `rg -n "restart_stage|resetTaskGoalsToPending|resetGoalStatuses" packages/opencorvus/src packages/opencorvus/test`
  has no matches.
- The orchestrator prompt explicitly says workflow tasks do not rewind earlier
  stages in place and must create a new inheriting task when the workflow
  contract is fundamentally wrong.
- Orchestrator-visible tools no longer include `restart_from_stage`.
- Focused prompt, engine, and orchestrator tests pass.
