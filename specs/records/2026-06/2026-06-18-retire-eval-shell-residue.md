# Retire Eval Shell Residue

Date: 2026-06-18

## Problem

The old right-panel evaluation shell was removed from the rendered Overlay
sections, but its imperative DOM ref, phase branch, and CSS selectors still
treated `#evalBody` / `.eval-*` as live UI. Tests also kept those selectors
alive even though current evaluation prose renders through goal workflow cards.

## Recall

| Source                                           | Existing decision                                                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `2026-06-17-agent-card-css-retirement.md`        | Dead runtime CSS should be removed when no component or HTML creates the class contract.                              |
| `2026-06-18-retire-prompt-editor-css-residue.md` | Tests must reject retired selectors instead of preserving them as live surface ownership.                             |
| `2026-06-18-retire-criteria-dom-css-residue.md`  | Criteria/evaluation shell DOM ids were retired; business evaluation payloads remain live.                             |
| `Board.tsx` current source                       | Right-panel phase highlighting is driven by Solid `phaseState` props for workflow sections, not an `#evalBody` shell. |

## Impact Sweep

| Sweep                                                                                                     | Result                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n "evalBody                                                                                          | #evalBody" packages/overlay/src packages/overlay/test`                                                                                                                              | Only `dom.ts`, generic CSS baselines, and tests referenced the old id; no component or HTML creates it.  |
| `rg -n "eval-error                                                                                        | eval-summary" packages/overlay/src packages/overlay/test`                                                                                                                           | Production TS/TSX creates no `.eval-error*` or `.eval-summary`; CSS/tests were the remaining references. |
| `git grep -n "EvaluationCriteriaPanel\|criteria-list" HEAD -- packages/overlay/src packages/overlay/test` | `HEAD` still kept a `Show when={false}` criteria/evaluation block, the dead `EvaluationCriteriaPanel`, and `utils/criteria.ts`; those must be removed with the selector retirement. |
| `rg -n "gwg-eval-summary" packages/overlay/src packages/overlay/test`                                     | `StepPayloadBody.tsx` still creates `gwg-eval-summary`; those rules stay live.                                                                                                      |
| `rg -n "syncSectionPhases                                                                                 | phaseSections                                                                                                                                                                       | agentRoleToSectionPhase                                                                                  | evaluation" packages/overlay/src packages/overlay/test` | `syncSectionPhases` still has non-evaluation callers/targets, so this pass removes only orphan `evaluation` phase branches and routes evaluator agents to the live acceptance section. |

## Fix

- Remove `evalBody` from `DomRefs` and `getDomRefs()`.
- Remove orphan `evaluation` phase branches from `utils/section.ts`.
- Route evaluator / visual-QA agent roles to the existing `acceptance` section
  phase instead of the retired `evaluation` phase.
- Remove the unreachable `Show when={false}` criteria/evaluation/interactions
  block from `Board.tsx`, delete `EvaluationCriteriaPanel.tsx`, and delete its
  private `utils/criteria.ts` helper.
- Remove `.eval-error*`, `.eval-summary`, `#evalBody`, and remaining
  `.criteria-list` baseline selectors from production styles.
- Update architecture and acceptance-panel tests so retired eval shell
  selectors stay absent while `gwg-eval-summary` remains covered.

## Acceptance

- No production DOM accessor queries `#evalBody`.
- No production stylesheet keeps `.eval-error*`, `.eval-summary`, or
  `#evalBody` selectors.
- `utils/section.ts` no longer pushes or relates an `evaluation` phase to
  absent DOM.
- `agentRoleToSectionPhase()` no longer returns the retired `evaluation`
  phase for evaluator agents.
- `Board.tsx` no longer imports or references `EvaluationCriteriaPanel`,
  `criteriaResults`, or `evaluationCriteriaSection`; the retired component and
  helper files stay absent.
- `gwg-eval-summary` and business evaluation text/notification semantics remain
  untouched.
