# Image Preview Shadow Token Source

Date: 2026-06-18

## Problem

`messages.css` uses a raw named `black` literal in the image preview dialog
image shadow. This fails the surface color literal guard and keeps the preview
shadow outside the theme palette source.

## Recall

| Source                                         | Existing decision                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `2026-06-18-css-token-closure.md`              | Runtime dimensions may be runtime variables, but visible colors must resolve through canonical tokens. |
| `flat-redesign-color-literal-coverage.test.ts` | Surface and primitive CSS must not contain named `white` / `black`, hex, or rgb literals.              |
| `cascade/*` theme files                        | `--ui-shadow-tone` is the theme-owned shadow color token.                                              |
| `css-token-closure-browser.test.ts`            | Image preview dialog is already part of the browser token-closure fixture.                             |

## Evidence Sweep

| Sweep                                                                         | Result                                                                                                                          | Decision                                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `bun test packages/overlay/test/flat-redesign-color-literal-coverage.test.ts` | Fails on `src/styles/surfaces/messages.css:671` because `.image-preview-dialog__image` mixes raw `black`.                       | Fix the source CSS, not the test.                                           |
| `rg -n -e "\\bblack\\b" -e "\\bwhite\\b" packages/overlay/src/styles`         | The only active surface violation is the image preview shadow; cascade theme files intentionally own black/white inside tokens. | Replace the surface literal with an existing token.                         |
| `rg -n "ui-shadow-tone                                                        | box-shadow" packages/overlay/src/styles/surfaces`                                                                               | Other surfaces already use `var(--ui-shadow-tone)` for themed drop shadows. | Use `var(--ui-shadow-tone)` as the image preview shadow color. |

## Fix

- Replace `color-mix(in srgb, black 24%, transparent)` with
  `var(--ui-shadow-tone)` in `.image-preview-dialog__image`.
- Extend the existing CSS token-closure browser fixture to assert the image
  preview shadow resolves to a visible value.
- Keep cascade theme files as the only place where black/white keywords are
  used to define theme shadow/highlight tokens.

## Acceptance

- `flat-redesign-color-literal-coverage.test.ts` passes.
- Browser token closure screenshot still renders the image preview sample.
- Computed image preview `box-shadow` is present and resolves without undefined
  tokens.
