# Retire GWG Integrity Selector Residue

Date: 2026-06-18

GWG means Goal Workflow Group. CSS means Cascading Style Sheets.

## Problem

`GoalWorkflowGroup.tsx` now renders a compact goal-scoped panel: header,
objective, acceptance, and optional worktree row. Step-by-step executor rows,
changed-file summaries, open-session actions, and edit/delete buttons were
removed from that panel, but `inspector.css` and architecture/typography tests
still kept their selectors live.

`IntegrityCard.tsx` also moved from the old dimension/diff/missing-objective
shape to reviewer, finding, repair, and disagreement lists. The retired
dimension selectors were still styled and tested as if components created them.

## Recall

| Source                                    | Existing decision                                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `2026-06-17-agent-card-css-retirement.md` | Dead runtime CSS should be removed when no component or HTML creates the class contract.                        |
| `2026-06-18-retire-eval-shell-residue.md` | Tests must reject retired evaluation shell selectors while preserving live payload selectors.                   |
| `GoalWorkflowGroup.tsx` current source    | Step-by-step executor detail belongs in the conversation timeline, not duplicated in the right-side goal panel. |
| `IntegrityCard.tsx` current source        | Current integrity surface renders reviewers, findings, required repairs, disagreements, and manifest metadata.  |

## Impact Sweep

| Sweep                          | Result               |
| ------------------------------ | -------------------- | ----------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `rg -n "gwg-step               | gwg-action           | gwg-changed             | gwg-diff                                           | gwg-open-session" packages/overlay/src/components packages/overlay/test`          | No production component creates those selectors; `inspector.css` and tests were the remaining owners. |
| `rg -n "gwg-plan               | gwg-check            | gwg-verdict             | gwg-eval-summary" packages/overlay/src/components` | `StepPayloadBody.tsx` still creates plan/eval/check payload selectors; keep them. |
| `rg -n "integrity\_\_dimension | integrity\_\_goal-id | integrity\_\_diff       | integrity\_\_missing-objective                     | integrity\_\_chips                                                                | integrity\_\_chip" packages/overlay/src/components packages/overlay/test`                             | No production component creates those retired integrity selectors. |
| `rg -n "integrity\_\_reviewer  | integrity\_\_issue   | integrity\_\_correction | integrity\_\_missing                               | integrity\_\_manifest-meta" packages/overlay/src/components`                      | Current integrity card still creates those selectors; keep them.                                      |

## Fix

- Remove retired GWG action, step-row, diff, changed-file, open-session, and
  step-message CSS rules.
- Remove retired integrity dimension, goal-id, definition-list diff,
  missing-objective, chip-strip, and tag data-action CSS rules.
- Update architecture and typography tests so they lock the current live
  selectors and reject retired selector families.

## Acceptance

- Production CSS no longer contains retired GWG step/action/diff/open-session
  selectors.
- Production CSS no longer contains retired integrity dimension/diff/goal-id
  selectors.
- `gwg-plan-*`, `gwg-verdict`, `gwg-eval-summary`, `gwg-check*`, and current
  integrity reviewer/finding/repair/disagreement selectors remain covered.
