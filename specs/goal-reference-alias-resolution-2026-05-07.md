# Goal Reference Alias Resolution

**Date**: 2026-05-07
**Status**: Implementing
**Trigger**: Task `tsk_e02269ead001patId3AzGsYnQz` re-ran Architect after the orchestrator called `build({ goalID: "G12" })`. The build tool treated `G12` as a missing database id and returned a misleading "register via architect first" error, causing unnecessary goal re-registration.

## Facts

- `engine_goal.id` is the durable goal identity.
- UI/debug output also exposes ordinal labels such as `#12` / `G12`.
- The active plan already orders goals via `engine_goal.order_index`.
- The observed task had one active plan and stable goal ids. Repeated Architect calls only updated existing goal rows; they did not create a new goal set.

## Root Cause

The orchestrator tool contract accepted a string named `goalID`, but did not resolve display aliases. When the model used `G12`, the tool reported the goal as missing and suggested Architect registration. That error text conflated two cases:

- a display alias that can be resolved from the active plan;
- a genuinely unknown durable goal id.

## Single Source

No new alias table is introduced. Display aliases are derived from the active plan order:

- `G12`, `#12`, and `12` resolve to the 12th row from `listGoalsForPlan(findActivePlanForTask(taskID))`.
- After resolution, all downstream runtime records continue to use the durable `engine_goal.id`.

## Implementation

- Add a build-tool-local resolver for goal references.
- Resolve explicit `goalID` and inherited session `goalID` before every build preflight.
- If an ordinal is out of range, return a direct error naming valid durable ids and display numbers.
- Remove the misleading "register via architect first" response from build preflight. Missing durable ids now instruct the orchestrator to re-read the active goal graph instead of re-running Architect.

## Acceptance

- `build({ goalID: "G12" })` dispatches the 12th active-plan goal.
- `build({ goalID: "#12" })` and `build({ goalID: "12" })` use the same mapping.
- `build({ goalID: "G99" })` does not tell the model to register goals or call Architect.
- No schema migration and no second goal-id source.
