# Retire Toolbar Search Residue

## Context

Independent GUI review found `settings.css` still accepted
`input.s-toolbar-search` as a toolbar search entry. No production component
creates that class anymore. Search inputs now route through the shared
`.search-field`, `.search-field-input`, and `.search-field-icon` primitive.

## Recall

| Source | Constraint |
| --- | --- |
| `2026-06-19-memory-search-field-primitive.md` | Memory search retired private search chrome and made `.search-field*` the shared compact search source. |
| `packages/overlay/src/components/settings/primitives.tsx` | `SettingsToolbar` renders only `.s-toolbar`; it does not create `s-toolbar-search`. |
| `packages/overlay/src/styles/surfaces/field.css` | Search field focus, icon, input, and clear-button styling lives in the shared primitive. |
| `rg -n -F "s-toolbar-search" packages/overlay/src packages/overlay/test specs/new-arch docs packages/web` | The only live hit was `settings.css`. |

## Fix

- Remove `input.s-toolbar-search` from the `.s-toolbar` flex rule.
- Keep `.s-toolbar > .field-input` so non-search field inputs inside settings
  toolbars preserve their layout.
- Extend `search-field-unification.test.ts` to reject the retired selector and
  keep the live toolbar field-input rule pinned.

## Acceptance

- No production source or test contract references `.s-toolbar-search`.
- `.search-field*` remains the only search-input primitive surface.
- `.s-toolbar > .field-input` remains available for ordinary toolbar fields.
