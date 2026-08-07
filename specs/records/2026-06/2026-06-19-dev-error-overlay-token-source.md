# Dev Error Overlay Token Source

Date: 2026-06-19

UI means User Interface.

## Problem

`packages/overlay/src/utils/dev-error.ts` injects the development error overlay
CSS from a TypeScript string. That string still carried raw hex and rgba color
literals. The overlay is development-only, but it is still a visible UI surface
and bypasses the theme token source used by the rest of the overlay.

## Recall

| Source                                         | Relevant constraint                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                    | UI colors must not drift into parallel raw-color systems.                                                   |
| `flat-redesign-color-literal-coverage.test.ts` | Surface and primitive CSS already reject raw color literals outside theme token files.                      |
| `dev-error.ts` header comment                  | The overlay is dev-only and lazily injected; the fix should keep the existing DOM/dedup behavior unchanged. |

## Impact Sweep

| Sweep                     | Result      | Decision                                                                            |
| ------------------------- | ----------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------- | ------------ | --------------- | -------------- | -------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| `rg -n "devWarn\\(        | devError\\( | DEV_ERROR_CSS                                                                       | dev-error" packages/overlay/src packages/overlay/test specs`                                               | `DEV_ERROR_CSS` is the only style owner for the dev overlay; callers use `devWarn` / `devError` and do not style it. | Fix the single style owner; do not add a second stylesheet. |
| `rg -n "#[0-9a-fA-F]{3,8} | rgba?\\(    | hsla?\\(" packages/overlay/src/utils/dev-error.ts packages/overlay/test -g "\*.ts"` | Raw colors are isolated to `DEV_ERROR_CSS`; brand-icon and browser-fixture literals are separate accepted surfaces. | Add a focused source guard for the injected CSS string.                                                              |
| `rg -n -- "--bad          | --bad-dim   | --warn                                                                              | --warn-dim                                                                                                          | --info                                                                                                               | --text                                                      | --text-strong | --text-muted | --menu-panel-bg | --divider-soft | --shadow" packages/overlay/src/styles -g "\*.css"` | Existing cascade tokens cover every dev overlay semantic color. | Reuse existing tokens; do not create `--dev-error-*` aliases. |

## Fix Plan

- Replace raw color literals in `DEV_ERROR_CSS` with existing cascade tokens and
  `color-mix()` over those tokens.
- Keep DOM structure, event delegation, ring buffer, and dev-only behavior
  unchanged.
- Add a static test that extracts `DEV_ERROR_CSS` and rejects raw color
  literals.
- Add a lightweight browser test that injects the same CSS, verifies computed
  colors resolve, and saves a screenshot.

## Acceptance

- `DEV_ERROR_CSS` contains no raw hex, rgb/rgba, hsl/hsla, named black, or named
  white color literals.
- The dev overlay still renders an error and warning entry with nontransparent
  computed colors in a real browser.
- No new token family or fallback style path is introduced.
