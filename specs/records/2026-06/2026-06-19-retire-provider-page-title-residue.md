# Retire Provider Page Title Residue

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model. UI means
User Interface.

## Problem

Euler found `.provider-page-title` in `settings.css` with no production DOM
owner. The Providers settings header has already moved to the shared
`SurfaceHeader` primitive inside `.provider-title-block`.

## Recall

| Source                                                  | Relevant constraint                                                                                                                     |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-19-provider-head-actions-responsive-source.md` | Provider header layout is owned by `.provider-command`, `.provider-title-block`, `.provider-head-actions`, and the responsive override. |
| `2026-06-19-provider-refresh-spinner-owner.md`          | Provider-specific CSS hooks are valid only when `ProvidersPanel.tsx` owns them.                                                         |
| `provider-settings-layout.test.ts`                      | Existing static coverage already guards Provider header/action ownership.                                                               |
| `provider-auth-panel.test.ts`                           | Existing browser coverage opens the real Settings -> Providers panel and screenshots the Provider command surface.                      |

## Evidence Sweep

| Command                                                                                     | Result                                                                                                     | Decision                                            |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------- | ------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `rg -n "provider-page-title                                                                 | provider-title-block                                                                                       | provider-toolbar-count                              | provider-stat-strip | SurfaceHeader | provider-command-main" packages/overlay/src packages/overlay/test specs/new-arch` | `.provider-page-title` appears only in CSS. Live owners are `.provider-title-block`, `.provider-toolbar-count`, `.provider-stat-strip`, and `SurfaceHeader` in `ProvidersPanel.tsx`. | Delete `.provider-page-title`; do not add compatibility markup. |
| `Get-Content packages/overlay/src/components/settings/ProvidersPanel.tsx` around the header | The visible title is `title={t("provider.title")}` passed into `<SurfaceHeader variant="settings-group">`. | Keep `SurfaceHeader` as the single title primitive. |
| `Get-Content packages/overlay/src/styles/surfaces/settings.css` around the provider block   | `.provider-page-title` defines a second title typography source beside `.oc-surface-header__title`.        | Remove the dead title rule.                         |

## Fix Plan

1. Delete the `.provider-page-title` CSS rule.
2. Extend static Provider layout coverage so neither `ProvidersPanel.tsx` nor `settings.css` can reintroduce the retired class.
3. Extend the real Providers browser test to assert no `.provider-page-title` DOM exists while `.provider-title-block .oc-surface-header` remains present and visible.

## Acceptance

- No source or stylesheet emits `.provider-page-title`.
- Provider title remains rendered through `SurfaceHeader`.
- Existing Provider command, count, stat strip, and actions layout stay non-overlapping in the browser screenshot.
