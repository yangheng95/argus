# Goal Workflow Header Native Button

Date: 2026-06-18

GWG means Goal Workflow Group. CSS means Cascading Style Sheets. DOM means
Document Object Model.

## Problem

`GoalWorkflowGroup.tsx` renders `.gwg-header` as a `div` with `role="button"`,
`tabindex="0"`, and a custom `onKeyDown` handler that manually maps Enter and
Space to the card toggle.

The header is a disclosure control. Keeping a simulated button creates a second
keyboard interaction implementation beside native button behavior and the
shared card-fold store.

## Recall

| Source                                          | Relevant constraint                                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-card-header-nested-interactions.md` | Disclosure state belongs on a native button; layout shells should not carry fake button semantics.                         |
| `2026-06-18-retire-goal-item-css-residue.md`    | `GoalWorkflowGroup.tsx` and `.gwg-*` are the live right-panel goal contract; do not revive retired `.goal-item` selectors. |
| `AGENTS.md` rule 28 / 36                        | Every code modification needs regression coverage and visual verification when UI is affected.                             |

## Impact Sweep

| Sweep                                                                                                                                                                                               | Result                                                                                                                                                                                         | Decision                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `rg -n -e 'role="button"' -e 'tabindex="0"' -e 'gwg-header' -e 'GoalWorkflowGroup' -e 'cardExpanded' -e 'setCardExpanded' -e 'onKeyDown' packages/overlay/src packages/overlay/test specs/new-arch` | Runtime hit for the target defect is isolated to `GoalWorkflowGroup.tsx` lines creating `.gwg-header`. Other matches are unrelated controls, old visual HTML fixtures, or existing docs/tests. | Fix `GoalWorkflowGroup.tsx` directly; do not introduce a shared wrapper for this one remaining GWG disclosure.                                       |
| `rg -n "\.gwg-header                                                                                                                                                                                | gwg-header" packages/overlay/src/styles packages/overlay/test`                                                                                                                                 | `.gwg-header` styling is owned by `packages/overlay/src/styles/surfaces/inspector.css`, with architecture tests already asserting that single owner. | Keep the selector and add native button reset declarations in the same CSS rule.                                              |
| `rg -n "keyboard\.press                                                                                                                                                                             | page\.keyboard                                                                                                                                                                                 | press\(" packages/overlay/test/browser packages/overlay/test -g "\*.ts"`                                                                             | Browser tests already use `page.keyboard.press`, so GWG keyboard behavior can be verified through the Node Playwright runner. | Extend the existing GWG browser test with focus and Enter/Space assertions. |

## Fix Plan

- Change `.gwg-header` from a simulated `div` button to a native
  `button type="button"`.
- Keep `aria-expanded` and the existing `onClick={toggleExpanded}` store write.
- Remove `role`, `tabindex`, and custom `onKeyDown`; native button semantics own
  keyboard activation.
- Add CSS reset declarations to `.gwg-header` in `surfaces/inspector.css` so the
  visual contract remains unchanged: `appearance`, border, width, font, and
  text alignment are owned by the existing GWG style source.
- Extend source and browser tests to reject the simulated button path and prove
  focus plus Enter/Space toggling in the real overlay.

## Acceptance

- `GoalWorkflowGroup.tsx` contains a native `.gwg-header` button with
  `type="button"` and `aria-expanded`.
- `GoalWorkflowGroup.tsx` no longer contains `role="button"`,
  `tabindex="0"`, or header-level custom `onKeyDown`.
- `.gwg-header` visual styling stays owned by
  `packages/overlay/src/styles/surfaces/inspector.css`.
- Browser screenshot confirms the right-panel GWG list remains visually
  coherent after the semantic change.
