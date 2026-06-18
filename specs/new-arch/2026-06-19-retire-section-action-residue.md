# Retire Section Action Residue

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Problem

`inspector.css` still defined `.section-head-action` and `.section-actions`
toolbar selectors. Current right-panel sections render through the shared
`Section` primitive and `Board`'s `SectionFrame`: the header contract is
icon, title, optional badge, and native disclosure caret. There is no header
action slot, and no component emits `.section-actions`.

Tests still carried a positive `.section-head-action` assertion and an explicit
rename-guard exception, so the suite protected stale CSS instead of the live
`.oc-section__*` contract.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-19-retire-section-icon-button-residue.md` | `Section.tsx` has no header action slot; stale section header action styling should not be preserved once no owner exists. |
| `2026-06-19-retire-dialog-section-actions-residue.md` | Dialog section action residue was already retired from dialog CSS; this pass targets the inspector-surface selectors with similar names. |
| `Section.tsx` | Renders `.oc-section`, `.oc-section__head`, `.oc-section__icon`, `.oc-section__title`, `.oc-section__badge`, and `.oc-section__body` only. |
| `Board.tsx` | `SectionFrame` passes only id, body id, title, icon, badge, phase state, and children into `Section`. |

## Evidence Sweep

| Command | Result | Decision |
| --- | --- | --- |
| `rg -n "section-head-action|sectionHeadAction|section_head_action|SectionHeadAction|section-actions|sectionActions|section_actions|SectionActions|section action|head action" packages/overlay/src packages/overlay/test specs/new-arch docs --glob "*.*"` | Production hits were only `inspector.css`. Test/spec hits were positive protection or historical notes. | Delete the CSS selectors and convert tests to absence guards. |
| `Section.tsx` inspection | The primitive has no `actions` prop, no `local.actions`, and no header action render point. | Do not add compatibility markup or a placeholder action slot. |
| `Board.tsx` inspection | `SectionFrame` renders live sections with title, icon, badge, and children only. | Browser validation should target live right-panel sections after deletion. |
| `2026-06-19-retire-dialog-section-actions-residue.md` recall | `.session-actions` in dialog CSS was a different retired selector; `.session-list-panel` remains live inspector CSS. | Do not delete `.session-list-panel` or session list styles in this pass. |

## Fix

- Remove `.section-head-action` from the section header rail area.
- Remove `.section-actions`, `.section-actions .oc-button`, and
  `.section-actions.compact` from the inspector misc cluster.
- Convert architecture and primitive tests from allowing/protecting those
  selectors to rejecting them.
- Keep `.oc-section__head`, `.oc-section__icon`, `.oc-section__title`,
  `.oc-section__badge`, `.oc-section__body`, and `.session-list-panel`.

## Acceptance

- Production source and CSS no longer contain `.section-head-action` or
  `.section-actions`.
- Live section selectors remain covered by static tests.
- Browser screenshots of right-panel workflow and acceptance sections still
  show header icon/title/badge/caret and readable section body content.
