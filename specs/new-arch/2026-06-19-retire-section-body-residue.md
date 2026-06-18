# Retire Section Body Residue

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Problem

The shared `Section` primitive renders section content as `.oc-section__body`.
Older right-panel CSS still targets `.section-body`, and several tests still
protect that legacy selector. The width-normalization rule has a live owner in
`.oc-section__body > *`, but the old direct empty-state selector no longer has a
production owner: right-panel empty cards are rendered inside panel components
with the explicit `.empty-hint--card` modifier.

This is not a `.config-section-body` issue. That selector is still emitted by
`ConfigDialogHost` for settings dialog panels and must remain intact.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-19-retire-section-icon-button-residue.md` | The live `Section` contract is the `.oc-section__*` primitive family; phantom section header selectors must be retired instead of preserved. |
| `2026-06-19-retire-section-action-residue.md` | `Section.tsx` renders icon, title, badge, body, and children only; stale legacy section selectors should not survive without a production owner. |
| `Section.tsx` | Emits `.oc-section__body` for section content and contains no `.section-body` string. |
| Independent agent report | `.section-body` has no production JSX owner, while `empty-state.css`, `conversation.css`, and tests still refer to it. |

## Evidence Sweep

| Command | Result | Decision |
| --- | --- | --- |
| `rg -n -F "section-body" packages specs AGENTS.md` | Production CSS hits are old `.section-body` in `empty-state.css` and `conversation.css`; live `.config-section-body` hits remain separate and owned by config dialog code. | Replace the live width-normalization selector with `.oc-section__body`; delete the direct empty-state selector because right-panel empty cards use `.empty-hint--card`. |
| `rg -n -F "oc-section__body" packages specs` | `Section.tsx`, primitive CSS, inspector CSS, field CSS, and primitive tests already use `.oc-section__body`. | Keep only selectors with a live owner: `.oc-section__body > *` for child width and `.empty-hint--card` for right-panel empty card chrome. |
| `Section.tsx` inspection | The component renders `<div class="oc-section__body">` and no legacy body class. | Do not add compatibility markup or dual classes. |
| `empty-hint` production sweep | `ArchitectPanel`, `RequirementsPanel`, `FrontendResearchPanel`, and `IntegrityCard` render `.empty-hint empty-hint--card` inside panel wrappers; no production component emits `.oc-section__body > .empty-hint`. | Do not create a new dead `.oc-section__body > .empty-hint` selector. |

## Fix Plan

- Delete `.section-body > .empty-hint` from `empty-state.css`; the live
  right-panel empty-state owner is `.empty-hint--card`.
- Update the generic child width rule in `conversation.css` from
  `.section-body > *` to `.oc-section__body > *`.
- Update browser density/border assertions and static architecture tests to
  stop targeting a nonexistent direct empty-state selector.
- Add negative guards so plain `.section-body` cannot re-enter overlay CSS or
  tests, while `.config-section-body` remains allowed.

## Acceptance

- `rg -n -F ".section-body" packages/overlay/src packages/overlay/test` has no
  live hits after this pass.
- `rg -n -F ".oc-section__body > .empty-hint" packages/overlay/src packages/overlay/test`
  has no hits; right-panel card empty states use `.empty-hint--card`.
- `rg -n -F ".config-section-body" packages/overlay/src packages/overlay/test`
  still shows the config dialog owner and tests.
- Static tests covering section primitives, architecture guards, empty states,
  and right-panel browser density pass.
- Browser validation captures a live right-panel section empty state and checks
  it is inside `.oc-section__body` with `.empty-hint--card`, while no legacy
  `.section-body` nodes exist.
