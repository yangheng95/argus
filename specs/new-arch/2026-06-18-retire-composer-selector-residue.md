# Retire Composer Selector Residue

Date: 2026-06-18

CSS means Cascading Style Sheets.

## Problem

The composer selector surface had already moved to prompt-profile select plus
dual executor chips, but `composer.css` and architecture tests still treated
old build/version/meta and executor-chip selectors as live UI contracts.

Keeping those selectors makes audits believe the rejected multi-row composer
shape and old executor chip model split still exist.

## Recall

| Source | Existing decision |
| --- | --- |
| `2026-06-17-agent-card-css-retirement.md` | Dead runtime CSS should be removed when no component or HTML creates the class contract. |
| `2026-06-18-retire-prompt-editor-css-residue.md` | Tests must reject retired selectors instead of preserving them. |
| `2026-06-18-hexin-budget-selector-regression.md` | The composer selector must remain a compact prompt-profile plus executor-chip row. |

## Impact Sweep

| Sweep | Result |
| --- | --- |
| `rg -n "chat-build|chat-version-link|chat-version-sep|chat-version-name|chat-compose-meta-right" packages/overlay/src packages/overlay/test` | Only `composer.css` and architecture tests referenced those selectors; production creates `chat-version`, `chat-version-copy`, `chat-compose-meta`, and `chat-compose-meta-left`. |
| `rg -n -F "chat-compose-meta-left a" packages/overlay/src packages/overlay/test specs/new-arch` | Only `composer.css` and architecture tests referenced the nested anchor selector; `ChatComposer.tsx` renders prompt-profile Select plus `ExecutorSelector`, not an anchor inside `.chat-compose-meta-left`. |
| `rg -n "executor-chip-identity|executor-chip-model|executor-chip-provider|executor-chip-name" packages/overlay/src packages/overlay/test` | Production no longer creates those chip split selectors; current source creates `executor-chip-copy`, `executor-chip-label-row`, `executor-chip-label`, `executor-chip-value`, and `executor-chip-caret`. |
| `rg -n "executor-budget-row|executor-budget-error" packages/overlay/src packages/overlay/test` | Budget behavior is inline chip meta; `executor-budget-error` had no production creator and the old row root name contradicted the live inline layout. |

## Fix

- Rename the live budget root selector to `.executor-budget-inline`.
- Delete uncreated `.executor-budget-error`.
- Delete uncreated build/version strip selectors:
  - `.chat-build`;
  - `.chat-version-link`;
  - `.chat-version-sep`;
  - `.chat-version-name`.
- Delete uncreated `.chat-compose-meta-right`.
- Delete uncreated `.chat-compose-meta-left a` link rules.
- Update architecture/static tests so they require the current live selectors
  and reject retired selector contracts.

## Acceptance

- Production source and CSS no longer contain retired composer selectors.
- Tests reject retired selectors instead of preserving them.
- Live footer version text and compact composer selector layout remain covered.
