# Retire LLM Provider Summary Residue

Date: 2026-06-19

LLM means Large Language Model. CSS means Cascading Style Sheets. UI means
User Interface.

## Problem

Provider settings now render through the settings primitive layer:
`SettingsPanel`, `SettingsRow`, and `SettingsPill`, with provider-specific
layout owned by `.provider-settings-row` and `.provider-row-summary`.

The old LLM provider summary UI still has CSS selectors in
`settings.css`, and `config-panel-sizing.test.ts` still treats
`.llm-summary-row` as a live flat settings surface. Those selectors have no
production component owner, so keeping them creates CSS debt and a stale test
contract.

## Recall

| Source                                                       | Relevant constraint                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `2026-06-18-settings-primitives-single-source-completion.md` | Provider rows must render through `SettingsRow`; old provider row wrappers should be retired instead of preserved. |
| `2026-06-18-retire-settings-config-shell-residue.md`         | Retired settings shells should become absence guards once production creation points are gone.                     |
| `2026-06-18-select-control-shell-single-source.md`           | Settings controls should converge on shared primitives, not local hand-written shells.                             |
| `provider-settings-layout.test.ts`                           | Current provider surface contract is `.provider-settings-row`, `.provider-row-summary`, and `SettingsPill`.        |

## Evidence Sweep

| Command                       | Result                | Decision             |
| ----------------------------- | --------------------- | -------------------- | ----------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `rg -n 'llm-panel             | llm-summary-row       | llm-summary          | llm-api-key-summary     | llm-auth-row' packages/overlay/src packages/overlay/test specs docs --glob '_._'` | Runtime hits are only `settings.css`; test hit is `config-panel-sizing.test.ts`. No component or HTML owner emits these classes.                                  | Delete the CSS selectors and convert the test to an absence guard.                                                                                              |
| `rg -n 'provider-settings-row | provider-row-summary  | provider-panel       | provider-refresh-button | provider-search-input                                                             | SettingsRow                                                                                                                                                       | SettingsPill' packages/overlay/src/components/settings/ProvidersPanel.tsx packages/overlay/src/styles/surfaces/settings.css packages/overlay/test --glob '_._'` | Provider UI has active owners in `ProvidersPanel.tsx` and provider CSS. | Keep provider-specific owner classes; do not replace them with LLM-era names. |
| `rg -n 'provider-flat-row     | provider-settings-row | provider-row-summary | SettingsRow             | llm-summary-row                                                                   | llm-panel' specs/records/2026-06/2026-06-18-settings-primitives-single-source-completion.md packages/overlay/src/components/settings packages/overlay/test --glob '_._'` | Specs/tests support primitive provider rows; no current spec requires `.llm-*`.                                                                                 | Treat `.llm-*` as retired residue, not compatibility.                   |

## Fix

- Remove `.llm-panel` from the `.general-panel` grouping and delete its
  standalone rule.
- Delete `.llm-summary-row`, `.llm-summary`, `.llm-api-key-summary`, and
  `.llm-auth-row` rules from `settings.css`.
- Remove `.llm-summary-row` from the flat borderless owner surface list.
- Add a focused guard that rejects `.llm-*` provider summary selectors in
  production settings CSS and settings component source.

## Acceptance

- `settings.css` and settings component source have no live `.llm-*` provider
  summary selectors.
- Provider settings continue to use `SettingsRow`, `SettingsPill`,
  `.provider-settings-row`, and `.provider-row-summary`.
- `config-panel-sizing.test.ts`, `provider-settings-layout.test.ts`, overlay
  typecheck, and real browser provider settings screenshot review pass.
