# Goal Workflow Button Primitive

Date: 2026-06-19

GWG means Goal Workflow Group. GUI means Graphical User Interface. CSS means
Cascading Style Sheets. DOM means Document Object Model.

## Recall

- `AGENTS.md` requires no fallback logic, no double source, mature UI
  primitives, and tests for every code change.
- `2026-06-18-goal-workflow-header-native-button.md` correctly retired the
  simulated `div role="button"` path for the GWG header, but kept a private
  native button surface with local reset and focus styling.
- `2026-06-19-task-row-children-toggle-button-primitive.md`,
  `2026-06-19-task-progress-button-primitive.md`, and
  `2026-06-19-project-ledger-group-toggle-button-primitive.md` establish the
  current rule for visible overlay controls: render through `Button` and route
  per-surface geometry through `.oc-button[data-ui="..."]` selectors.
- `2026-05-11-goal-worktree-display.md` keeps the per-goal worktree row on
  `GoalWorkflowGroup`; this pass keeps that source, only changing the visible
  button primitive.

## Evidence

| Sweep                                                                     | Result                                                                                                                             | Decision                                                                                   |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `rg -n '<button\\b                                                        | <a\\b                                                                                                                              | role="button"                                                                              | tabIndex=\\{0\\}   | tabindex="0"' packages/overlay/src --glob '\*.tsx'`                                          | `GoalWorkflowGroup.tsx` still rendered two live raw buttons: `.gwg-header` and `.gwg-worktree`.                                                | Migrate both visible clickable GWG controls to `Button`.                   |
| `rg -n "GoalWorkflowGroup                                                 | gwg-header                                                                                                                         | gwg-worktree                                                                               | goal-worktree-open | goal workflow" specs packages/overlay/src packages/overlay/test --glob '\*.{md,ts,tsx,css}'` | The only live GWG button call sites are `GoalWorkflowGroup.tsx`; CSS owner is `surfaces/inspector.css`; tests pin the old raw-button contract. | Update the component, CSS owner, static guards, and browser test together. |
| `packages/overlay/test/browser/goal-workflow-css-residue-browser.test.ts` | Real browser coverage already mounts the right inspector, focuses the GWG header, sends Enter/Space, and screenshots the GWG list. | Reuse this test and assert `.oc-button` primitive ownership.                               |
| `packages/overlay/test/goal-workflow-group-worktree.test.ts`              | Source guard confirms the worktree row remains per-goal and capability gated.                                                      | Keep the same data source and capability gate, but require `Button` for the clickable row. |

## Root Cause

The 2026-06-18 fix solved keyboard semantics by moving from a fake button to a
native button. It did not solve primitive ownership: the header and worktree row
still carried private class selectors that duplicated `Button` reset, hover,
focus, padding, and color behavior beside the shared `.oc-button` contract.

## Fix Plan

1. Import `Button` in `GoalWorkflowGroup.tsx`.
2. Render the header disclosure as `Button variant="ghost" size="mini"
tone="neutral" data-ui="gwg-header"`.
3. Render the clickable worktree row as `Button variant="ghost" size="mini"
tone="neutral" data-ui="goal-worktree-open"`.
4. Keep the non-clickable fallback row as `.gwg-worktree` because it is static
   display, not a control.
5. Move interactive styles from `.gwg-header` / clickable `.gwg-worktree` to
   `.gwg .oc-button[data-ui="..."]`.
6. Update tests to reject the old raw `.gwg-header` button contract and assert
   primitive ownership in both source and browser.

## Acceptance

- `GoalWorkflowGroup.tsx` no longer renders a raw `.gwg-header` button.
- The header and clickable worktree row are `Button` instances with stable
  `data-ui` selectors.
- `surfaces/inspector.css` no longer owns `.gwg-header` reset styling.
- Browser verification proves the focused header is an `.oc-button`, remains a
  real `button`, and still toggles with Enter and Space.
