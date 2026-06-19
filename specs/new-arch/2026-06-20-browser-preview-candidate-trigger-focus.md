# Browser Preview Candidate Trigger Focus

Date: 2026-06-20

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `AGENTS.md` | Frontend fixes require real browser visual evidence and must not hide focus states. |
| `2026-06-17-browser-preview-select-style-single-source.md` | Browser Preview candidate Select keeps local layout hooks but shared `.oc-select-*` owns popup style. |
| `2026-06-18-select-control-shell-single-source.md` | `SelectControl` is the only Kobalte Select shell; consumers keep domain classes for layout. |
| `2026-06-18-select-control-static-coverage-alignment.md` | Consumers should not duplicate shared select shell classes or popup colors. |

## Problem

Independent GUI review found the Browser Preview target candidate trigger uses
`SelectControl`, but its visible focus chrome is incomplete:

- `BrowserPreviewPanel.tsx` passes
  `triggerClass="browser-preview-candidate-trigger"`.
- `inspector.css` sets `.browser-preview-candidate-trigger { outline: 0; }`.
- The only current focus rule is
  `.browser-preview-candidate-select:focus-within`, which changes the parent
  border color but does not give the focused Kobalte trigger a visible
  `:focus-visible` ring.

Keyboard Tab focus lands on the actual trigger button, so the focused control
must expose its own visible focus affordance. This is a Browser Preview surface
gap, not a reason to fork `SelectControl` or reintroduce caller-owned Select
shell logic.

## Evidence Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "browser-preview-candidate-trigger|browser-preview-candidate-select|focus-visible|outline: 0" packages/overlay/src packages/overlay/test specs/new-arch -S` | The trigger focus issue is isolated to Browser Preview `inspector.css` and tests. | Add a trigger-level focus-visible rule here. |
| `SelectControl.tsx` review | Shared Select shell prepends `.oc-select-trigger` but intentionally accepts local trigger classes. | Do not change SelectControl behavior for all consumers. |
| Browser Preview browser tests review | `browser-preview-evidence.test.ts` opens the real Browser Preview panel with multiple candidates; its failed-selection assertion still waited for the retired `browser-preview-target-error` selector while the component and static test use `browser-preview-selection-failed`. | Extend that fixture to keyboard-focus the trigger, screenshot it, and align the failed-selection assertion to the current single error surface. |

## Fix Plan

1. Add `.browser-preview-candidate-trigger:focus-visible` in
   `inspector.css` with tokenized outline and offset.
2. Update static Browser Preview coverage to require that rule and reject
   hidden focus without a replacement.
3. Extend the real browser preview evidence fixture to Tab to
   `[data-ui="browser-preview-candidate-trigger"]`, assert it is active and
   `:focus-visible`, assert outline is visible, and save screenshot evidence.
4. Replace the stale failed-selection test selector with the existing
   `browser-preview-selection-failed` surface so the browser test validates the
   component's real DOM instead of a retired selector.
5. Leave target selection, candidate popup style, SelectControl ownership,
   backend preview APIs, and evidence behavior unchanged.

## Acceptance

- Keyboard focus on Browser Preview candidate trigger is visibly tokenized.
- Browser Preview candidate popup remains shared `.oc-select-*` based.
- Static and browser tests prevent the trigger from regressing to hidden focus.
- Failed target selection remains visible through the current
  `browser-preview-selection-failed` error surface.
