# Task brief — Stock Screener module (research clone)

> Paste as a `kind=workflow` request AFTER the foundation task is accepted.
> It carries a live reference URL, so `frontend_design` runs first
> (mirror-grounded frontend template), then requirements → architect → build → integrity.
> The architect decomposes; do not pre-write goals.

## Goal

Clone the TradingView Stock Screener as one module of the existing shared site,
for research/educational purposes.

## Visual reference (source of truth)

https://www.tradingview.com/screener/

Restore this 1:1 as closely as the stack allows. Visible text/layout/visual
values must trace to the extracted reference; mark anything the public anonymous
page does not reveal as a known gap instead of inventing it.

## Build on the existing shared foundation

This module MUST reuse the shared layer delivered by the foundation task — do
not create parallel copies:

- Read the shared **instrument/quote** domain; do not define a second symbol model.
- Fetch through the shared **API envelope** (`/api/screener/...`).
- Render inside the shared **shell**; use shared **table / cards / filter** components.
- Navigate via the central **route registry**: symbol link → Symbol Detail route,
  "see on chart" → Chart route.
- save / create-alert / edit-watchlist → shared **auth boundary**; premium
  columns/data → shared **paid boundary**. Never fake success.

## In scope

- Screener table with the shared instrument universe.
- Filtering, sorting, column setup, horizontal scroll, in-table symbol search —
  none of these may regress from a baseline screener.
- Filter / column metadata served by the API (not hardcoded in the component).

## Out of scope

- Real TradingView data/API, private bundles, brand assets.
- Real login/payment/watchlist persistence (→ boundaries).
- Other modules (Chart, Markets, Symbol Detail) beyond the route links out.

## Acceptance

- `/screener/` reachable through the shared shell.
- Table renders shared synthetic data via the screener API envelope.
- Filter / sort / column-setup / horizontal-scroll / table-search all work.
- symbol → Symbol Detail route and "see on chart" → Chart route both navigate
  through the route registry.
- auth/paid actions trigger the shared boundary components honestly.
- Visual fidelity checked against the reference (`webpage_render` →
  `webpage_vision_judge`).
- Playwright spec covers the screener golden path + its cross-module links.
- No previously-accepted module regresses.
