# Executor Chip Density Guard

Date: 2026-06-18

CSS means Cascading Style Sheets.

## Problem

The titlebar browser density guard samples the real composer executor chips
because the bottom composer row is part of the visible app shell. The executor
chip Button primitive overrode its horizontal padding and gap to
`calc(10px * var(--ui-scale))`. At the browser fixture scale this computed to
10.4px, above the 9px compact-control ceiling enforced for shell controls.

This is not a titlebar-only issue and the guard should not be relaxed. The
composer chip should stay in the shared Button primitive spacing contract.

## Recall

| Source | Existing decision |
| --- | --- |
| `2026-06-18-retire-composer-selector-residue.md` | The live composer selector is a compact prompt-profile plus executor-chip row. |
| `2026-06-18-hexin-budget-selector-regression.md` | The executor chips must remain one compact selector row with inline Hexin budget metadata. |
| `2026-06-17-hexin-budget-refresh-db-sidecar-cleanup.md` | Visual acceptance already requires Expert Squad, OpenCorvus budget, and External executor to share one meta row. |

## Impact Sweep

| Sweep | Result |
| --- | --- |
| `rg -n "executor-chip-slot \\.oc-button|oc-button-padding-x|oc-button-gap|columnGap|paddingLeft" specs/new-arch packages/overlay/src packages/overlay/test` | The executor chip local Button override is the only live composer chip spacing source. |
| Browser `titlebar-menubar.test.ts` density sample | The real app shell measured `[data-ui^="executor-chip-"]` at 10.4px column gap and horizontal padding, exceeding the compact ceiling. |

## Fix

Use the existing compact Button padding token for executor chip horizontal
padding and gap:

- `--oc-button-padding-x: var(--ui-btn-mini-padding-x)`;
- `--oc-button-gap: var(--ui-btn-mini-padding-x)`.

The token is already capped in `design-language.css` and used by the Button
primitive, so the executor chip no longer creates a parallel spacing source.

## Acceptance

- Static executor selector tests require the compact Button token and reject
  the retired `10px * var(--ui-scale)` override.
- Browser shell density guard reports no loose executor chip spacing.
- The existing compact one-row executor selector layout remains intact.
