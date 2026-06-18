# Retire Section Icon Button Residue

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Problem

`inspector.css` still defined `.oc-section__icon-btn` as a small section header
button, and `overlay-architecture-guards.test.ts` required that selector to
exist. The current `Section` primitive has no header action slot and no
component emits `.oc-section__icon-btn`.

The live section header contract is `.oc-section__head`, `.oc-section__icon`,
`.oc-section__title`, and `.oc-section__badge`. Keeping a phantom header button
selector made the test suite protect a UI state that cannot render.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `Section.tsx` | Renders native `<details>/<summary>` with icon, title, badge, and body only. |
| `primitives-panel-section.test.ts` | Pins the Section primitive contract and confirms no legacy bare `.section-*` JSX remains. |
| `overlay-architecture-guards.test.ts` | Section rail ownership lives in the primitive plus inspector surface overrides. |
| `AGENTS.md` | Tests must not preserve dead UI contracts once no production owner remains. |

## Evidence Sweep

| Command | Result | Decision |
| --- | --- | --- |
| `rg -n "oc-section__icon-btn|section-head-action|section-actions|oc-section__head|oc-section__icon|oc-section__title|oc-section__badge|oc-section__body|SectionFrame|<Section" packages/overlay/src packages/overlay/test specs/new-arch docs --glob "*.*"` | `.oc-section__icon-btn` appeared only in `inspector.css` and a test assertion. `Section.tsx` emits `.oc-section__head`, `.oc-section__icon`, `.oc-section__title`, `.oc-section__badge`, and `.oc-section__body`. | Delete the phantom icon-button selector and convert tests to negative guards. |
| `Section.tsx` inspection | No `actions` prop or header action slot exists. | Do not keep styling for a nonexistent extension point. |
| `rg -n "section-head-action|section-actions" packages/overlay/src packages/overlay/test specs/new-arch --glob "*.*"` | These are separate surface classes and are not the phantom `.oc-section__icon-btn` owner. | Leave them unchanged. |

## Fix

- Remove `.oc-section__icon-btn`, hover/focus, and disabled rules from
  `inspector.css`.
- Convert the architecture guard from requiring `.oc-section__icon-btn` to
  rejecting it in both cascade and inspector surface CSS.
- Extend the Section primitive test to assert the primitive does not expose a
  phantom header action slot.

## Acceptance

- Production source and CSS no longer contain `.oc-section__icon-btn`.
- Live section head/icon/title/badge/body selectors remain covered.
- Static section and architecture tests pass.
- Browser validation confirms right-panel workflow sections still render
  header icon/title/badge/caret after deletion.
