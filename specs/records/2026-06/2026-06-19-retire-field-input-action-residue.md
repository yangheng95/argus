# Retire Field Input Action Residue

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Problem

`field.css` still carried the old `.field-input-actions`, `.field-input-icon`,
and `.field-row` selector family, plus matching `.sections ...` density
overrides. Current production source no longer emits those classes.

The live field owners are different:

- Plain controls use `.field-input`.
- Grouped controls use `.field-input-group`.
- Search controls use `.search-field`, `.search-field-icon`,
  `.search-field-input`, and Button primitive clear actions.

Keeping the old action/icon/row family made it look like there was still a
second input-action primitive beside the current search/Button primitives.

## Recall

| Source                                               | Relevant constraint                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `2026-06-19-memory-search-field-primitive.md`        | Search rows should use the shared `.search-field*` primitive and Button clear actions.      |
| `2026-06-19-retire-settings-continuation-residue.md` | CSS-only field/config selector families should be retired once no production owner remains. |
| `theme-form-control-coverage.test.ts`                | `.field-input` remains the canonical plain form-control chrome and must not be deleted.     |
| `SkillMarketPanel.tsx`                               | `.field-input-group` remains live for inline value plus browse action layout.               |

## Evidence Sweep

| Command                     | Result                                                                                                                    | Decision                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `rg -n "field-input-actions | field-input-icon                                                                                                          | field-row" packages/overlay/src/components packages/overlay/src/services packages/overlay/src/main.tsx packages/overlay/src/index.html --glob "_.tsx" --glob "_.ts" --glob "\*.html"` | No production DOM owner exists. | Delete the old selector family.                                                       |
| `rg -n "field-input-actions | field-input-icon                                                                                                          | field-row                                                                                                                                                                             | field-input-group               | search-field" specs/new-arch packages/overlay/test packages/overlay/src --glob "_._"` | Before the fix, the target selector family only appeared in `field.css`. Live `.field-input-group` and `.search-field*` owners remained in components/tests. | Keep the live primitive families and guard against exact retired class tokens only. |
| Independent explorer audit  | Confirmed high-confidence deletion and highlighted false-positive risk around `config-field-row` and `search-field-icon`. | Use exact class-token guards that do not match those live siblings.                                                                                                                   |

## Fix

- Remove `.field-input-actions`, `.field-input-icon`, `.field-row`, and the
  `.sections` overrides for those classes from `field.css`.
- Keep `.field-input`, `.field-input-group`, `.search-field`,
  `.search-field-icon`, and `.search-field-input`.
- Add architecture coverage that rejects the retired class family in CSS and
  production source with exact boundaries.

## Acceptance

- Production source and CSS no longer contain the retired field action/icon/row
  class family.
- Existing plain inputs, grouped inputs, and shared search fields remain covered.
- Static architecture and form-control/search-field tests pass.
- Browser validation confirms live `.field-input-group` and `.search-field*`
  surfaces still render after deletion.
