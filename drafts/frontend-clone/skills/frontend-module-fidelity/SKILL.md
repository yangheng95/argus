---
name: frontend-module-fidelity
description: Engineering discipline for cloning a multi-module, data-driven web app (e.g. a TradingView-style site) one module at a time on top of shared foundations. Load this when implementing or planning a single frontend module that must reuse a single shared data domain, API envelope, route registry, and boundary system — not a one-off page. Signals — the brief asks to 复刻 / clone / 还原 a named site or module, or to build "模块/module" against existing "shared shell / 底座 / foundations"; or the stack is a multi-page frontend app with a synthetic data backend. Do NOT load for a single isolated page mockup (use the webpage reference skill) or a non-frontend task.
auto_detect:
  task_signals:
    request_text_any:
      - 复刻
      - 还原
      - clone
      - 全站
      - 整站
      - 多模块
      - module
      - shared shell
      - 底座
      - foundations 
priority: 50
required_tools:
  - webpage_render
  - webpage_vision_judge
  - webpage_evaluate
---

> DRAFT / NOT INSTALLED / HISTORICAL. Do not use for current OpenCorvus webpage-clone tasks; active flows use frontend_design plus the project-visible web-clone-source handoff.

# Frontend Module Fidelity Skill

This skill loads inside a dispatched engine_task's build / design agents — not
the mission supervisor and not the orchestrator. You implement (or plan) ONE
module of a larger multi-module web app, on top of foundations that already
exist. You do NOT own cross-module sequencing or task dispatch — that belongs to
the mission supervisor (Gateway Master) and the orchestrator + architect. Your
contract is: this module, built to the shared rules below, accepted by integrity.

Glossary (spell out abbreviations once): template = frontend template;
SPEC = implementation specification; DoD = Definition of Done; MVP = Minimum
Viable Product; IA = Information Architecture; OHLC = Open/High/Low/Close bar;
SSOT = Single Source Of Truth.

## Evidence is the only source of UI truth

- Every visible string, layout, and visual value traces to the frontend-design
  frontend template (and its `visual_consistency_contract`) or to extracted DOM facts for
  this module's reference. Do not invent UI that has no source.
- When the reference does not reveal an interaction (SPA internal state, paid /
  logged-in surface), write it as a known gap and degrade honestly. Never
  fabricate a feature to look complete.
- The module's live reference URL, when the brief supplies one, is authoritative;
  restore it 1:1 as closely as the stack allows.

## Shared foundations are single-source — reuse, never re-create

The foundations task already produced these. Treat each as the only copy:

- **One instrument/quote domain.** Chart, Screener, Markets, Symbol Detail all
  read the same instrument / quote / bar tables. Never define a second symbol
  model inside a module.
- **One API envelope.** Every endpoint returns the shared `ApiResponse<T>`
  shape (`ok:true{data,meta}` | `ok:false{error{code,message,boundary}}`).
  Consume it; do not invent a per-module response format.
- **One route registry.** Cross-module navigation goes through the central
  route registry (symbol link → Symbol Detail, "see on chart" → Chart). Never
  hardcode a sibling module's path string locally.
- **One boundary system.** auth / paid / route-placeholder / unsupported are the
  shared components. Never write a per-module auth modal or route placeholder.
- **Shared shell + components** (header, footer, search, table, cards, modal,
  toast). If a primitive is missing, add it to the shared layer, not inside the
  module — recurring structure must be abstracted, not copy-pasted.

If a module's real code path genuinely needs to touch a shared file, do it and
make the reason visible in build evidence — `owned_paths` are collaboration
responsibilities, not a sandbox.

## No static mock, no fake success

- Data comes from the local DB / deterministic synthetic engine via the API
  layer. No quotes/rows hardcoded in components. No screenshot pasted as UI.
- Deterministic + reseedable data; OHLC bars must be legal; the same asset
  universe must satisfy this module's tables, cards, filters, and charts.
- Login, payment, real market data, real trading, alert push, cloud save are
  NOT implemented — they resolve to the matching boundary (auth/paid/unsupported)
  and are recorded in the degradation list. Never pretend any of them succeeded.

## Visual fidelity check before you call it done

When a reference URL/image exists, verify the rendered module against it with
`webpage_render` → `webpage_vision_judge` / `webpage_evaluate`, and cite any
spec id you fail. Do not self-accept on taste; integrity owns the final gate.

## Module Definition of Done

A module is done only when ALL hold:

1. Its template requirements have evidence anchors (no unsourced assertions).
2. The MVP for this module is implemented and reachable through the shared shell.
3. Backend endpoints exist behind the shared envelope and the UI reads from them.
4. Shared domain / components / route registry / boundaries are reused, not
   duplicated.
5. A Playwright spec covers this module's golden path + its cross-module links.
6. Every change ships with a test (new behavior asserted; removed/auto behavior
   asserted absent).
7. Degraded / unsupported items are written down, not silently dropped.

Regression rule: never let an already-accepted module (e.g. Screener, Chart)
lose functionality when you build a new one.
