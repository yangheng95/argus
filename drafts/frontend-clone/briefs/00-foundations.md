# Task brief — Shared platform foundation (research clone)

> Paste this as a single `kind=workflow` request to OpenCorvus. Do NOT hand it a
> role list or a T0–T15 graph — the architect decomposes it into goals, build
> implements per goal, integrity gates. This brief is the request, not the plan.

## Goal

Build the shared foundation for a multi-module, TradingView-style web app built
for research/educational purposes (not a real trading product). This foundation
is what every later module (Screener, Chart, Markets, Symbol Detail, …) sits on,
so the modules are one coherent site instead of isolated pages.

## Stack

<fill in — e.g. React + Vite + TypeScript frontend, Node/Bun + SQLite backend,
Playwright for e2e. State your real choice; the foundation must not be stack-coupled
beyond this.>

## In scope (deliver all of these as the single shared layer)

- **Shared shell**: GlobalHeader, GlobalFooter, GlobalSearch modal, theme,
  modal/toast infrastructure, an app layout that every module renders inside.
- **Central route registry**: one place that defines `/`, `/screener/`,
  `/chart/`, `/markets/`, `/symbols/:exchangeTicker/`, etc. Modules navigate
  through it; no module hardcodes another module's path.
- **Boundary system** (shared components, used by all modules):
  auth / paid / route-placeholder / unsupported. Each is honest — it never fakes
  a successful login/payment/save.
- **Synthetic market-data engine + local DB**: deterministic, reseedable. One
  instrument/quote/bar/metric domain that Chart, Screener, Markets, Symbol Detail
  all share. OHLC (Open/High/Low/Close) bars must be legal; multiple timeframes.
- **API layer with a single response envelope**:
  `{ ok:true, data, meta? } | { ok:false, error:{ code, message, boundary? } }`.
  Expose at least: instruments search/detail, quotes, bars, and a site nav/search
  endpoint. Everything reads through this envelope.

## Out of scope (explicitly)

- Any real TradingView API, private bundle, brand assets, or real market feed.
- Any actual login / payment / trading / alert push / cloud save.
- Building the modules themselves — this task is only the shared layer.
- Static mock UI (screenshots-as-UI, quotes hardcoded in components).

## Acceptance

- App boots locally; base routes resolve and render inside the shared shell.
- GlobalHeader/Footer/search visible and consistent.
- Boundary components mount and are reusable from any route.
- Synthetic engine seeds deterministically and includes a known core asset set
  (e.g. NASDAQ:NVDA, NASDAQ:AAPL, BINANCE:BTCUSDT) used by later modules.
- API health check + the listed endpoints return the shared envelope.
- A Playwright site-smoke spec passes (boot, base route, header present).
- Every piece of the above is covered by a test.

## Notes for the team

This is the SSOT (Single Source Of Truth) foundation. Later module tasks will
reference it by name and must reuse it, not re-create it. After acceptance,
propose the first module task (Screener) as a follow-up.
