# TradingView World Economy Clone Plan

Source request: clone `https://www.tradingview.com/markets/world-economy/`.

Evidence collected:

- Desktop reference screenshot: `.codex-tmp/tradingview-world-economy-reference/desktop.png`, viewport `1440x1400`.
- Mobile reference screenshot: `.codex-tmp/tradingview-world-economy-reference/mobile.png`, viewport `390x1200`.
- Runtime summary: `.codex-tmp/tradingview-world-economy-reference/capture-summary.json`.
- Page title: `World Economy - Rankings and Forecasts - TradingView`.

Reference regions:

| Region              | Desktop evidence                                                                                   | Mobile evidence                                             | Implementation owner                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Header              | 64px tall white header, left logo, search pill, nav links, language/account icons, blue-purple CTA | 64px compact header, menu icon, mark logo, search icon, CTA | `examples/tradingview-world-economy/index.html`, `examples/tradingview-world-economy/src/styles.css` |
| Breadcrumb/title    | `Markets / Economy`, centered `Economy`, large `Overview` with chevron                             | Same hierarchy, smaller spacing                             | `examples/tradingview-world-economy/index.html`, `examples/tradingview-world-economy/src/styles.css` |
| Economic trends map | Left card, rounded 16px, `Inflation map`, orange world choropleth, segmented legend                | Full-width card with same title/map/legend                  | `src/app.js`, `src/economy-data.js`, `src/styles.css`                                                |
| GDP table           | Right card, 6 countries, circular flag marks, three-column desktop table                           | Full-width card, GDP growth and nominal GDP stacked right   | `src/app.js`, `src/economy-data.js`                                                                  |
| Indicator cards     | Three equal cards: unemployment bars, interest step line, trade balance negative bars              | Stacked cards                                               | `src/app.js`, `src/economy-data.js`                                                                  |
| Countries chips     | `Countries` heading and rounded gray pills                                                         | Flowing chips below trends                                  | `index.html`, `src/economy-data.js`                                                                  |
| Lower content       | Ideas/news/calendar/FAQ continue page depth                                                        | Same content stacked                                        | `index.html`, `src/styles.css`                                                                       |

Call-point and naming grep:

- Existing prompt: `specs/artifacts/tc_clone_prompt.md`.
- No existing implementation path for `tradingview-world-economy`.
- Existing browser-preview/task-artifact routes are product internals and are not changed by this artifact.
- Existing `artifacts/gui-audit` is unrelated and remains untouched.

Implementation plan:

1. Add `examples/tradingview-world-economy/index.html` as the local page entry.
2. Add `examples/tradingview-world-economy/src/economy-data.js` as the single data source for GDP rows, indicator series, country chips, idea cards, news rows, and FAQ rows.
3. Add `src/world-countries-110m.geojson` from Natural Earth 1:110m public-domain Admin 0 country geometry and render it locally as SVG.
4. Add `src/app.js` to render map, GDP table, charts, ideas, news, calendar, FAQ, and small hover affordances from the data module.
5. Add `src/styles.css` for the measured layout, typography, cards, responsive breakpoints, and chart visuals.
6. Add `server.mjs` to serve the static artifact with Node.
7. Add `test/visual-check.mjs` to start the Node server, launch Playwright with system Chrome on Windows, assert desktop/mobile geometry, capture screenshots, and fail on console/page errors.
8. Add `DATA_INTERFACE.md` documenting the local data contract and the fact that the current artifact uses an in-repo immutable data module rather than an invented remote API.

Non-goals:

- Do not touch overlay product source.
- Do not use screenshots, iframes, or remote TradingView DOM as the implementation surface.
- Do not add fallback data paths or compatibility branches.
