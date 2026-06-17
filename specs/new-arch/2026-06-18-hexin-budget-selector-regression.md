# Hexin Budget Selector Regression

Date: 2026-06-18

## Problem

The current working tree regressed the Hexin budget selector from the
2026-06-17 accepted shape:

- the budget moved out of the OpenCorvus chip label row into a separate strip;
- budget refresh was keyed only by model name;
- the 10 minute refresh timer was removed;
- low-balance red state was removed;
- formatting reverted to host locale instead of the overlay app locale;
- browser/static tests were weakened to accept the looser layout.

This reintroduces the same UI/UX and stale-data risks recorded as BH-053,
BH-054, BH-055, and BH-056 in `specs/bug-hunt-2026-06-17.md`.

Follow-up audit found the behavior fixed but the selector contract still
advertised the retired strip: production rendered `HexinBudgetInline` with
`.executor-budget-row`, and `.executor-budget-error` remained only because the
static test expected it. The class contract must match the inline layout so
future audits do not treat the rejected strip as a live surface.

## Recall

- `2026-06-17-hexin-budget-display.md` added the budget row under the composer
  model selector only for Hexin models.
- `2026-06-17-hexin-budget-refresh-db-sidecar-cleanup.md` then tightened the
  contract: 10 minute refresh, low balance below 20 USD in red, app-locale
  formatting, and a compact single-row selector layout with the budget inside
  the OpenCorvus chip label row.

## Call Points

| Surface | Evidence | Required action |
| --- | --- | --- |
| `ExecutorSelector.tsx` | `hexinBudgetKey` currently returns only `parts.name`; `HexinBudgetRow` renders after `.executor-dualbar`. | Restore a composite key containing directory, model, session refresh, task id, and timer tick. Render the budget as chip meta. |
| `composer.css` | `.executor-budget-row` currently styles a full-width strip. | Restore inline chip label-row styling and low-balance state, then rename the live selector to `.executor-budget-inline`. |
| `executor-selector-dualbar.test.ts` | Static assertions no longer require refresh timer, directory key, low-balance state, or inline meta. | Restore contract assertions. |
| `executor-selector-redesign.test.ts` | Browser test no longer validates one-row layout, status semantics, low-balance color, or compact popover bounds. | Restore visual/DOM checks and keep real hit-tested clicks. |

## Fix

- Reintroduce `HEXIN_BUDGET_REFRESH_MS = 10 * 60 * 1000` and
  `HEXIN_BUDGET_LOW_USD = 20`.
- Format budget values with `localeTag()`.
- Key budget requests by active directory, selected Hexin model, selected task,
  session config refresh token, and refresh tick.
- Render `HexinBudgetInline` through the OpenCorvus chip `meta` slot.
- Use `.executor-budget-inline` as the only root budget selector and delete
  the uncreated `.executor-budget-error` rule.
- Mark low balance with `data-low-budget="true"` and keep `role="status"` /
  `aria-live="polite"`.
- Keep the browser test's physical click hit-test for the external chip.
- Treat browser-test startup 4xx responses and console errors as failures. The
  first screenshot pass exposed fixture-only mission and prompt-profile 404
  toasts; the fixture must cover those startup routes so visual evidence is not
  polluted by ignored runtime errors.

## Acceptance

- Static tests reject model-only budget keys and full-width budget strips.
- Static tests reject retired `.executor-budget-row` and
  `.executor-budget-error` contracts.
- Browser test verifies a low balance renders red inside the OpenCorvus chip and
  the meta row remains one compact row.
- Browser test fails on unexpected startup 4xx responses or console errors.
- Non-Hexin model selection removes the budget without another budget request.
- Overlay typecheck and a real screenshot review pass.
