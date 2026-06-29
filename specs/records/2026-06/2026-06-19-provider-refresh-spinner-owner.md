# Provider Refresh Spinner Owner

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Problem

The Providers settings panel renders the refresh action through the shared
`Button` primitive with `data-ui="provider-refresh-button"`. Its loading state
is exposed on that same button as `data-spinning="true"`.

`settings.css` still targeted the retired `.provider-refresh-btn` class for the
spinning icon transform. No production component emits that class, so the
refreshing label could appear while the icon transform never matched.

## Recall

| Source                                                       | Relevant constraint                                                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `2026-06-18-settings-primitives-single-source-completion.md` | Settings actions should route through shared primitives while keeping only live domain hooks.               |
| `2026-06-19-retire-llm-provider-summary-residue.md`          | Provider-specific classes remain valid only when `ProvidersPanel.tsx` owns them.                            |
| `config-panel-sizing.test.ts`                                | Provider header actions already assert the live `data-ui="provider-refresh-button"` Button contract.        |
| `ProvidersPanel.tsx`                                         | The refresh state owner is the Button primitive carrying `data-spinning={refreshing() ? "true" : "false"}`. |

## Evidence Sweep

| Command                                                                                                     | Result                          | Decision                                                   |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `rg -n "provider-refresh-btn                                                                                | provider-refresh-button         | provider-refresh-icon                                      | data-spinning" packages/overlay/src packages/overlay/test specs docs --glob "_._"` | `.provider-refresh-btn` appeared only in CSS. `ProvidersPanel.tsx` owns `data-ui="provider-refresh-button"`, `data-spinning`, and `.provider-refresh-icon`. | Retire `.provider-refresh-btn` and bind spinner styling to the live Button selector.                 |
| `rg -n "provider refresh                                                                                    | provider-refresh                | ProvidersPanel                                             | provider-head-actions                                                                       | provider section" specs packages/overlay/test --glob "_._"`                                                                                        | Existing specs/tests treat `ProvidersPanel` and `provider-head-actions` as the active owner surface. | Add guard coverage to the existing provider/config tests rather than creating a parallel test source. |
| `rg -n "provider-refresh-btn" packages/overlay/src/components packages/overlay/src/index.html --glob "*.*"` | No production DOM owner exists. | Do not add compatibility markup; delete the dead selector. |

## Fix

- Delete the retired `.provider-refresh-btn` CSS selector.
- Move the spinning transform to
  `.provider-head-actions .oc-button[data-ui="provider-refresh-button"][data-spinning="true"] .provider-refresh-icon`.
- Keep `.provider-refresh-icon` because the current component owns it.
- Extend static coverage so the retired class cannot return.
- Extend the existing Providers browser test to click the real Refresh button,
  hold `/provider/refresh` pending, and verify the icon transform while the
  real button has `data-spinning="true"`.

## Acceptance

- Production source has no `.provider-refresh-btn` owner or CSS rule.
- The live Button owner drives the spinner transform.
- Static config panel tests pass.
- Browser validation captures the real Providers refresh button in spinning
  state and confirms the old owner class is absent from DOM.
