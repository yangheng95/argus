# Retire Settings Continuation Residue

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model. UI means
User Interface.

## Problem

The old settings continuation slice still contains selector families that no
current settings component renders. They sit next to live settings selectors,
making the slice look active and encouraging future edits to preserve dead UI
contracts.

The owner sweep also found one important correction: `#channelConfigBody` is
live through `ConfigDialogHost`, and `#channelList` still has imperative
consumers in `dialog.ts` / `dom.ts` but no rendered element. That means
`#channelList` is not merely dead CSS; the missing DOM owner breaks the
intended channel-tab focus/scroll target.

## Recall

| Source                                                       | Relevant constraint                                                                                               |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-settings-primitives-single-source-completion.md` | Settings panels should use current primitives and remove old local shells.                                        |
| `2026-06-18-retire-settings-config-shell-residue.md`         | Retired settings selectors should become absence guards once no production owners remain.                         |
| `2026-06-19-retire-detail-card-residue.md`                   | The same continuation slice already had dead `.detail-*` selectors; this pass must not leave same-origin residue. |
| `2026-06-18-extension-head-field-label-single-source.md`     | `.extension-head` and `.extension-head .field-label` remain live and must stay owned by settings CSS.             |

## Evidence Sweep

| Command                    | Result                  | Decision                                                                                                                         |
| -------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------- | -------------- | ------------- | ---------------- | ----------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `rg -n "playwright-options | channel-public-url-head | config-inline-popup                                                                                                              | config-row                                                                                                  | config-label                                                                                                                         | config-value                                          | opacity-field                                   | opacity-header | opacity-value | config-field-row | channelConfigBody | channelList" packages/overlay/src packages/overlay/test specs docs --glob "_._"` | `playwright-options`, `channel-public-url-head`, `config-field-row`, `config-inline-popup`, `config-row`, `config-label`, `config-value`, and `opacity-field` are CSS-only. `channelConfigBody` is rendered by `ConfigDialogHost`; `channelList` is referenced by services/dom but not rendered. | Delete CSS-only selector families; keep `channelConfigBody`; restore `channelList` DOM owner. |
| `rg -n "config-inline-form | extension-head          | general-panel                                                                                                                    | loading-hint                                                                                                | channel-settings-row" packages/overlay/src/components packages/overlay/src/styles packages/overlay/test specs --glob "_._"` | These selector families have active component owners. | Keep them and add tests that they stay present. |
| `rg -n "windowOpacity      | ui-window-opacity       | opacity" packages/overlay/src/components/settings packages/overlay/src/styles packages/overlay/test specs --glob "_._"` | Window opacity is token-driven through `--ui-window-opacity`; no settings component emits `.opacity-field`. | Retire `.opacity-field*`, keep token-driven opacity contracts.                                                                       |

## Fix

- Delete dead selector families from `settings.css`:
  `.playwright-options*`, `.channel-public-url-head .field`,
  `.config-field-row*`, `.config-inline-popup*`, `.config-row`,
  `.config-label`, `.config-value*`, and `.opacity-field*`.
- Delete `.sections .config-field-row` from `field.css`.
- Keep `#channelConfigBody` because `ConfigDialogHost` renders it.
- Render `#channelList` around live channel rows so `focusConfigSection("channel")`,
  `dom.ts`, and `#channelList` CSS have a real owner.
- Extend tests to reject retired selector families while preserving the live
  settings selectors in the same slice.

## Acceptance

- Production CSS/source has no retired selector families listed above.
- `#channelConfigBody` remains rendered and styled.
- `#channelList` is rendered when Channel settings has rows.
- `.config-inline-form`, `.extension-head`, `.general-panel`, and
  `.loading-hint` remain live.
- Focused tests, overlay typecheck, and real Channel settings browser screenshot
  review pass.
