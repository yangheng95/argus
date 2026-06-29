# Retire Criteria DOM CSS Residue

Date: 2026-06-18

## Problem

The old Criteria/Evaluation panel DOM was removed from the Overlay shell, but
imperative DOM refs and criteria CSS selectors still treated it as live UI.
Those refs pointed at absent ids and the CSS rules were only kept alive by
tests.

## Recall

| Source                                           | Existing decision                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-17-agent-card-css-retirement.md`        | Dead runtime CSS should be removed when no component or HTML creates the class contract.                                      |
| `2026-06-18-retire-prompt-editor-css-residue.md` | Tests must not keep retired selectors alive after the production surface moves to a new source.                               |
| `Board.tsx` current source                       | Current evaluation/check content is rendered through card payloads and Solid section state, not `#criteriaSection` shell DOM. |

## Impact Sweep

| Sweep                   | Result        |
| ----------------------- | ------------- | -------------- | ---------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `rg -n "criteriaSection | criteriaBadge | criteriaList   | #criteriaSection | #criteriaBadge                                             | #criteriaList" packages/overlay/src packages/overlay/test`                                            | Only `dom.ts` and `section.ts` referenced the old criteria ids; current HTML/TSX does not create them. |
| `rg -n "criteria-group  | criteria-grid | criteria-check | criteria-result  | goal-criteria" packages/overlay/src packages/overlay/test` | Production TS/TSX/HTML does not generate these classes; CSS/tests were the remaining live references. |

## Fix

- Remove criteria DOM refs from `DomRefs` and `getDomRefs()`.
- Remove the `phaseSections()` mapping from `evaluation` to the absent
  `dom.criteriaSection`.
- Remove retired criteria CSS selectors from inspector and message surfaces.
- Update tests to assert the retired criteria selectors and ids remain absent.

## Acceptance

- No production DOM accessor queries `#criteriaSection`, `#criteriaBadge`, or
  `#criteriaList`.
- No production stylesheet keeps `.criteria-group`, `.criteria-grid`,
  `.criteria-check`, `.criteria-result`, or `.goal-criteria` rules.
- Business evaluation text, notifications, and card payload rendering remain
  untouched.
