# Settings Segmented Aria Label Forwarding

Date: 2026-06-18

## Problem

`PermissionsPanel` gives every permission action segmented control an
`ariaLabel={row.label()}` so screen readers can announce which tool permission
the Allow / Ask / Deny group controls. `SettingsSegmented` did not forward that
prop to the shared `SegmentedControl` API. It passed `aria-label` as a JSX prop
to a Solid component, while `SegmentedControl` reads `props.ariaLabel`.

The rendered ToggleGroup root therefore had no accessible name even though the
caller supplied one.

## Evidence Sweep

| Search                                                                | Result                                                                                                                                | Decision                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `rg -n "SettingsSegmented                                             | SegmentedControl                                                                                                                      | ariaLabel                                                                   | aria-label" packages/overlay/src/components/settings packages/overlay/src/components/ui packages/overlay/test specs/new-arch` | `SettingsSegmented` is the only settings segmented wrapper; `SegmentedControl` owns Kobalte ToggleGroup semantics and expects `ariaLabel`. | Fix the wrapper prop forwarding, not the shared primitive or individual callers. |
| `packages/overlay/src/components/settings/PermissionsPanel.tsx`       | `PermissionsPanel` already passes `ariaLabel={row.label()}`.                                                                          | Leave caller behavior unchanged.                                            |
| `packages/overlay/test/browser/settings-segmented-aria-label.test.ts` | Focused browser coverage can open the real Settings menu and Permissions panel without depending on unrelated dialog drag assertions. | Assert every `.s-segmented` label matches its visible permission row title. |
| `specs/new-arch/2026-06-18-app-dialog-segmented-control.md`           | `SegmentedControl` was extracted as the generic Kobalte-backed ToggleGroup wrapper.                                                   | Do not add another settings-only ToggleGroup implementation.                |

## Fix

- Change `SettingsSegmented` to pass `ariaLabel={props.ariaLabel}` to
  `SegmentedControl`.
- Make `SettingsSegmentedProps.ariaLabel` required, matching the settings
  `SettingsSelect` contract.
- Add a static primitive test that rejects `aria-label={props.ariaLabel}` inside
  `SettingsSegmented` and rejects optional `ariaLabel?: string`.
- Add a focused browser test that opens the real Permissions panel and asserts
  every `.s-segmented` group exposes the matching visible row title as its
  `aria-label`.
- Save a screenshot of the permissions panel after opening it for visual review.

## Acceptance

- `SettingsSegmented` forwards the accessible name through the shared
  `SegmentedControl` API.
- New settings segmented controls cannot compile without an explicit
  `ariaLabel`.
- The real permissions panel renders every permission segmented group with an
  `aria-label` equal to its visible row title.
- Existing Allow / Ask / Deny active state and PATCH behavior continue to pass.
- No new segmented-control implementation or local settings-only aria logic is
  introduced.
