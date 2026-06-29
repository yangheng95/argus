# Provider Search Field Single Source

Date: 2026-06-20

CSS means Cascading Style Sheets. UI means User Interface.

## Problem

`ProvidersPanel` still keeps a private provider search shell:
`provider-search-field`, `provider-search-icon`, and
`field-input provider-search-input`. `settings.css` also owns provider-specific
input sizing, icon positioning, clear-button sizing, and clear hover/focus
states.

That duplicates the shared compact search primitive already defined in
`field.css` as `.search-field`, `.search-field-icon`, `.search-field-input`,
and `.search-field .oc-button[data-ui$="-search-clear"]`.

## Recall

| Source                                            | Constraint                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                       | Remove UI double sources and keep mature/shared primitives as the single behavior and visual source.                                                    |
| `2026-06-19-memory-search-field-primitive.md`     | Search rows should use `.search-field`, `.search-field-input`, `.search-field-icon`, and Button primitive clear actions.                                |
| `2026-06-19-retire-toolbar-search-residue.md`     | `.search-field*` is the search input primitive surface; retired toolbar search hooks should not be preserved.                                           |
| `2026-06-19-retire-field-input-action-residue.md` | Live field owners are `.field-input`, `.field-input-group`, and shared `.search-field*`; old per-surface action/icon/search families should be retired. |
| `2026-06-20-settings-textarea-primitive.md`       | Provider settings has browser coverage that can open the real dialog and inspect provider controls.                                                     |

## Evidence Sweep

| Command                                                                            | Result                                                                                                                                             | Decision                                                                              |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `rg -n "provider-search                                                            | search-field                                                                                                                                       | field-input-action                                                                    | toolbar-search | search-clear" packages/overlay/src/components/settings/ProvidersPanel.tsx packages/overlay/src/styles/surfaces/settings.css packages/overlay/src/styles/surfaces/field.css packages/overlay/test specs` | Provider settings is the remaining production search surface with private `provider-search-*` chrome. `field.css` owns shared search chrome and tests already protect task/file/memory search. | Move provider search to the shared search classes and remove provider-specific search chrome from `settings.css`. |
| `provider-auth-panel.test.ts` inspection                                           | Existing browser coverage opens real Provider settings, measures search layout, types into search, clears it, and screenshots the settings dialog. | Extend the same test to assert shared classes and save focused/typed screenshots.     |
| `provider-search-clear-primitive.test.ts` and `icon-affordance-visibility.test.ts` | Tests currently pin provider-specific clear CSS.                                                                                                   | Update tests so provider search clear is governed by the shared `.search-field` rule. |

## Fix Plan

1. Change `ProvidersPanel` search label to `class="provider-search-field search-field"`.
2. Change search icon to include `search-field-icon`.
3. Change input to `class="provider-search-input search-field-input"`.
4. Keep `data-testid` and `data-ui="provider-search-clear"` so behavior tests and the Button primitive contract remain stable.
5. Delete provider-specific search chrome from `settings.css`; no compatibility rule remains.
6. Update static tests so provider search participates in the shared
   `search-field` contract and cannot reintroduce provider-specific clear/input
   CSS.
7. Extend provider browser coverage to verify focused and typed provider search
   states on the real settings dialog and save screenshots.

## Acceptance

- Provider search DOM uses shared `.search-field`, `.search-field-icon`, and
  `.search-field-input`.
- `settings.css` contains no provider-specific search chrome or clear hover
  rules.
- Provider search behavior still filters and clears provider rows.
- Browser screenshots verify idle/focused/typed provider search without icon or
  placeholder overlap.
