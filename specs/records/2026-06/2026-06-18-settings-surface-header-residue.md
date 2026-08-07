# Settings Surface Header Residue

Date: 2026-06-18

CSS means Cascading Style Sheets. UI means User Interface.

## Problem

Independent review found the `SurfaceHeader` architecture guard is stale after
the General settings panel gained the Database reset group. `GeneralPanel`
correctly renders three settings groups now: Connection, Database, and
Behaviour. The guard still expects two headers.

The deeper issue is not the header count. Retired local settings header
selectors remain in active CSS and tests:

- `.config-panel-group-title`
- `.config-panel-group-head`

No production component creates those classes anymore. Keeping the selectors
lets a second header style source survive beside `SurfaceHeader`.

## Recall

| Source                                                 | Relevant constraint                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `2026-06-18-settings-db-reset-safe-route.md`           | General settings intentionally gained a Database reset group using the existing `SurfaceHeader` and `Button` primitives. |
| `2026-06-11-center-workbench-header-alignment.md`      | `SurfaceHeader` is the shared source for panel title bars.                                                               |
| `packages/overlay/src/components/ui/SurfaceHeader.tsx` | `data-surface="settings-group"` is the canonical settings group header hook.                                             |
| `AGENTS.md`                                            | High-confidence dead CSS may be cleaned as part of the bug-hunt goal; do not leave dual-source residue.                  |

## Impact Sweep

| Sweep                                                                                            | Result                                                                                                                  | Decision                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `rg -n "SurfaceHeader" packages/overlay/src/components/settings packages/overlay/src/components` | Settings panels and center workbench panels use `SurfaceHeader`; `GeneralPanel` has three valid settings-group headers. | Keep GeneralPanel structure unchanged.                                                                                       |
| `rg -n "config-panel-group-(title                                                                | head)" packages/overlay/src packages/overlay/test`                                                                      | Only `settings.css`, `settings-section-headers-typography.test.ts`, and architecture guards reference the retired selectors. | Delete the CSS and update tests to assert the shared header primitive.                    |
| `rg -n "settings.section.database                                                                | settings-db-reset                                                                                                       | db_reset" packages/overlay/src packages/overlay/test specs`                                                         | Database reset is already covered by source tests, i18n keys, and browser reset coverage. | Update the header guard to semantic three-group expectations, not a blind count. |

## Fix Plan

- Remove `.config-panel-group-title` and `.config-panel-group-head` from
  `settings.css`.
- Update `settings-section-headers-typography.test.ts` to check
  `.oc-surface-header[data-surface="settings-group"]` instead of the retired
  local selector.
- Update `overlay-architecture-guards.test.ts` so `GeneralPanel` must contain
  the Connection, Database, and Behaviour `SurfaceHeader` calls, while
  `settings.css` must not contain the retired local selectors.
- Extend the existing General settings browser test to capture the top-of-panel
  screenshot and assert the three settings-group header computed styles.
- Preserve the actual `GeneralPanel` UI.

## Acceptance

- Full `overlay-architecture-guards.test.ts` no longer fails on the stale
  two-header assertion.
- No production CSS defines `.config-panel-group-title` or
  `.config-panel-group-head`.
- Browser screenshot of Settings > General shows the three group headers
  rendered consistently and the Database reset row not overlapping.
