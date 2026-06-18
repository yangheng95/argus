# Provider Head Actions Responsive Source

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model. UI means
User Interface.

## Problem

`ProvidersPanel` renders the provider toolbar actions through
`.provider-head-actions`. The first base rule in `settings.css` correctly owns
the desktop layout before the `@media (max-width: 900px)` responsive override.

The same stylesheet later declared a second `.provider-head-actions` rule after
that media block. It had the same specificity and re-applied
`justify-content: flex-end` and `align-items: center`, so narrow screens lost
the intended left-aligned stacked provider action layout.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-19-provider-refresh-spinner-owner.md` | Provider refresh styling should bind to the live `data-ui="provider-refresh-button"` Button owner. |
| `2026-06-19-retire-llm-provider-summary-residue.md` | Provider-specific classes remain valid only when `ProvidersPanel.tsx` owns them. |
| `config-panel-sizing.test.ts` | Existing provider browser coverage opens the real Settings -> Providers surface and captures refresh button evidence. |
| `ProvidersPanel.tsx` | `.provider-head-actions` and `.provider-refresh-meta` are live DOM hooks owned by the Providers panel header. |

## Evidence Sweep

| Command | Result | Decision |
| --- | --- | --- |
| `rg -n "provider-head-actions|provider-refresh-meta|provider-refresh|provider-catalog-hint|provider-test-result|provider-spinner|provider-model-actions|provider-card-head|Provider|ProvidersPanel" packages/overlay/src packages/overlay/test specs/new-arch docs --glob "*.*"` | `.provider-head-actions` and `.provider-refresh-meta` are live in `ProvidersPanel.tsx`; `settings.css` had duplicate base rules around the provider responsive media block. | Keep the live hooks, but collapse each base selector to one owner. |
| `Get-Content packages/overlay/src/styles/surfaces/settings.css` around the provider block | The first `.provider-head-actions` rule appears before `@media (max-width: 900px)`. The second rule appears after media and resets narrow styles. | Delete the second base rule rather than increasing specificity or adding another override. |
| `Get-Content packages/overlay/test/browser/config-panel-sizing.test.ts` | The existing browser test already opens the real Providers panel and captures provider refresh evidence. | Extend this test with a narrow viewport computed-style check and screenshot. |

## Fix

- Remove the duplicate post-media `.provider-head-actions` and
  `.provider-refresh-meta` base rules.
- Keep `.provider-refresh-icon` and the live
  `.provider-head-actions .oc-button[data-ui="provider-refresh-button"][data-spinning="true"]`
  spinner selector.
- Add static coverage that there is one base owner for
  `.provider-head-actions` and `.provider-refresh-meta`, with the responsive
  override after that base owner.
- Add browser coverage at a narrow viewport to assert the computed toolbar
  alignment is `flex-start` and capture a provider command screenshot.

## Acceptance

- Desktop provider actions still align right through the single base rule.
- Narrow provider actions compute `justify-content: flex-start` and
  `align-items: flex-start`.
- No duplicate post-media provider action selector can reintroduce the bug.
- Browser screenshot review confirms provider header actions remain readable
  and do not overlap at the narrow viewport.
