# Retire Goal Item CSS Residue

Date: 2026-06-18

CSS means Cascading Style Sheets. GWG means Goal Workflow Group.

## Problem

The right-side goal panel is rendered by `GoalWorkflowGroup.tsx` with the
`.gwg-*` and `.gwg-list` selector families. The older `.goals-list`,
`details.goal-item`, `.goal-status-icon`, `.goal-priority`, `.goal-actions`,
and related `.goal-*` selectors remain only in CSS and tests.

Keeping those selectors creates a second, test-preserved goal panel contract
beside the live GWG implementation.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-18-retire-gwg-integrity-selector-residue.md` | `GoalWorkflowGroup.tsx` is the current compact goal-scoped panel; retired GWG/detail selectors should be removed when no component creates them. |
| `2026-06-18-retire-conversation-goal-strip-residue.md` | Goal progress in the conversation is `TaskProgressBar`, not the retired static goal strip. |
| `GoalWorkflowGroup.tsx` current source | Live right-panel goal rows render `.gwg`, `.gwg-header`, `.gwg-status-icon`, `.gwg-body`, and `.gwg-list`; no `.goal-item` family is emitted. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "goal-item|goals-list|goal-status-icon|goal-priority|goal-actions|goal-title-brief|goal-desc-inline|goal-item-id|goal-item-body|\\.goal-desc\\b|plan-version" packages/overlay/src packages/overlay/test specs/new-arch` | Runtime hits are CSS-only. Production component hits are limited to `Card.tsx` `.card__goal-desc` and `GoalWorkflowGroup.tsx` `.gwg-*`, which are separate live contracts. | Remove retired `.goal-item` / `.goals-list` / non-card `.goal-desc` CSS and update tests to reject them. |
| `rg -n "GoalWorkflowList|gwg-list|gwg-status-icon" packages/overlay/src/components packages/overlay/src/styles packages/overlay/test` | `GoalWorkflowList` renders `.gwg-list`; `GoalWorkflowGroup` renders `.gwg-status-icon`. Existing tests already cover live GWG selectors. | Keep `.gwg-*` and `.gwg-list`; do not rename live selectors. |
| `rg -n "goal-item|goals-list" packages/overlay/src/components packages/overlay/src/index.html` | No component or static HTML creates those selectors. | Treat remaining CSS/test references as residue. |

## Fix Plan

- Delete `.goals-list`, `details.goal-item`, `.goal-item-*`,
  `.goal-status-icon`, `.goal-priority`, `.goal-actions`, and non-card
  `.goal-desc` rules from overlay surface CSS.
- Remove `.goal-item` / `.goal-desc` from generic overflow and list-row
  selector groups.
- Update owner and architecture tests to assert retired selectors remain absent
  while keeping `.gwg-*`, `.gwg-list`, and `.card__goal-desc` coverage.

## Acceptance

- No production CSS keeps the retired `.goal-item` / `.goals-list` family.
- Live `GoalWorkflowGroup` selectors remain covered.
- Targeted tests, typecheck, diff check, and final review pass.
