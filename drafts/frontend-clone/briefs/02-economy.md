# Economy module research brief - TradingView-style competitor page

> Scope: deep research for cloning a TradingView-style Economy module inside the existing frontend-clone mission. This is a product and implementation brief, not a claim to use TradingView private data, brand assets, or private bundles.
> Research date: 2026-06-01.

## Source URLs inspected

- TradingView World Economy: https://www.tradingview.com/markets/world-economy/
- TradingView Economic Indicators list: https://www.tradingview.com/markets/world-economy/indicators/
- TradingView Countries list: https://www.tradingview.com/markets/world-economy/countries/
- TradingView Economic Indicators Heatmap: https://www.tradingview.com/markets/world-economy/indicators-heatmap/
- TradingView Economic Calendar: https://www.tradingview.com/economic-calendar/
- TradingView US GDP indicator detail: https://www.tradingview.com/symbols/ECONOMICS-USGDP/
- TradingView Macro Maps: https://www.tradingview.com/macro-maps/
- TradingView Economic Calendar help: https://www.tradingview.com/support/solutions/43000759911-economic-calendar-track-all-major-market-events/
- TradingView Macro Maps help: https://www.tradingview.com/support/solutions/43000764925-macro-maps-on-tradingview-explore-compare-track/
- TradingView Macro Maps launch/update posts:
  - https://www.tradingview.com/blog/en/macro-maps-on-tradingview-53883/
  - https://www.tradingview.com/blog/en/updated-macro-maps-56960/
- TradingView Calendar widgets: https://www.tradingview.com/widget-docs/widgets/calendars/economic-calendar/
- Forex Factory calendar reference: https://www.forexfactory.com/calendar
- Investing.com calendar reference summary: https://stratbase.ai/en/tools/investing-com-calendar
- Econoday product reference: https://www.econoday.com/
- Candidate data providers:
  - FRED API, Federal Reserve Economic Data: https://fred.stlouisfed.org/docs/api/fred/
  - World Bank Indicators API: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
  - OECD API, Organisation for Economic Co-operation and Development: https://www.oecd.org/en/data/insights/data-explainers/2024/09/api.html
  - Trading Economics API: https://docs.tradingeconomics.com/get_started/

## Executive conclusion

TradingView's Economy feature is not a single economic calendar. It is a macro research surface made of five connected experiences:

1. World Economy landing page: overview, trends, country entry points, ideas, heatmap preview, indicator clusters, news, economic calendar, and FAQ.
2. Indicator comparison pages: per indicator, e.g. GDP (Gross Domestic Product), with country/region tabs and ranking-style tables.
3. Country and indicator symbol pages: each macro series behaves like a symbol with chart, key data points, source, frequency, units, related indicators, news, and community ideas.
4. Calendar: chronological events with time, country, importance, event name, actual, forecast, prior, details, chart launch, overview link, and calendar export.
5. Macro Maps and Heatmaps: matrix and world map visualizations for comparing countries by macro indicators, with historical date navigation, legend, table, news, and chart integration.

For our competitor page, the best product strategy is not to copy every TradingView route. We should build one cohesive Economy module with the same macro research loop:

- "What is happening globally?" via overview cards, heatmap, and macro map.
- "Which country/indicator matters?" via country/indicator tables and detail drill-down.
- "When is the next release?" via economic calendar.
- "How does this affect markets?" via route links into Chart, Symbol Detail, News, and shared watch/alert boundaries.

The minimum viable product (MVP, Minimum Viable Product) should ship the landing page, heatmap matrix, economic calendar, and indicator detail drawer/page. Macro Maps can be a second-phase enhancement unless the current UI stack already has a map component.

## TradingView information architecture

### World Economy page

Observed public page sections:

- Page title: Economy.
- Tabs/anchors: Overview, Countries, Ideas, Economic indicators heatmap, Main indicators, Global industrial map, News, Economic Calendar, FAQ.
- Overview area uses country and indicator cards. Browser probe showed quick entries such as India, Indonesia, Mainland China, South Korea, Turkey, Saudi Arabia, plus specific series like US unemployment rate, US interest rate, and US trade balance.
- Countries area lists major countries/regions such as Argentina, Australia, Brazil, Canada, European Union, France, Germany, India, Indonesia, Italy, Japan, Mainland China, Mexico, Russia, Saudi Arabia, South Africa, South Korea, Turkey, United Kingdom, and United States.
- Heatmap preview columns: GDP, GDP Growth, Budget to GDP, Government Debt to GDP, Interest Rate, Inflation Rate, Unemployment Rate, Current Account to GDP, Industrial Production YoY.
- Heatmap preview rows include USA, Mainland China, EU, Germany, Japan, India, UK, France, Canada, Russia.

Product reading: the Economy landing page is a hub. It does not ask users to know the exact series name first; it exposes common entry points and lets users branch to indicators, countries, calendar, and news.

#### Frontend-design extraction addendum, 2026-06-01

The current anonymous public page is a white, information-dense market data hub. It is not a purple/blue marketing hero and does not use a large decorative landing-page treatment. The page should therefore be cloned as a utilitarian research surface with compact headings, tables, maps, and link clusters.

Current desktop order:

1. Global TradingView shell and market navigation.
2. Breadcrumb/title area with "Economy" and the active "Overview" selection.
3. Economic trends: left inflation choropleth map, right GDP growth ranking table, then three key US indicator cards.
4. Countries: text/pill links to major countries and regions.
5. Ideas: tabbed community analysis cards.
6. Economic indicators heatmap: country x indicator matrix preview.
7. Main indicators: compact indicator category/link cluster.
8. Global industrial map: world map preview for industrial-production style comparison.
9. News.
10. Economic Calendar preview.
11. FAQ.

Current mobile expectation:

- Keep the page title and section anchors available without creating a separate landing screen.
- Stack the economic trends area vertically: map first, GDP table second, indicator cards after.
- GDP rankings, heatmap, and calendar must preserve scanability through horizontal scroll or compact row cards; do not collapse the data into unreadable prose.
- Countries and indicator links can wrap as dense pills.

Implementation implication: if a downstream PRD calls the first map a "hero", treat "hero" as the first data surface, not as a marketing block. The first viewport must show the inflation map and GDP table relationship, with the next content hinted below on normal desktop and mobile viewports.

### Economic Indicators list

TradingView groups indicators by macro domain:

- GDP (Gross Domestic Product)
- Labor
- Prices
- Health
- Money
- Trade
- Government
- Business
- Consumer
- Housing
- Taxes
- Energy
- Climate

Product reading: this taxonomy is more useful than a flat list because traders think by macro theme. We should encode this as metadata served by the API (Application Programming Interface), not as duplicated UI constants.

### Indicator detail page

Observed example: `ECONOMICS:USGDP`, titled "US GDP".

Visible structure:

- Header with symbol and data source, e.g. World Bank.
- Tabs: Overview, News, Community, More.
- Chart actions: Full chart, time ranges like 5 years, 10 years, All time.
- Key data points: last release, observation period, next release, forecast, highest, lowest.
- About block: category, source, frequency, units, natural-language definition.
- Related indicators: sibling US GDP series such as GDP Growth Rate, Real GDP, GDP Per Capita, GDP From Manufacturing, GDP From Services, Weekly Economic Index, etc.
- News and Ideas blocks reuse the broader TradingView content system.

Product reading: macro series are treated as first-class symbols. This is the right abstraction for us too. A macro indicator should have a stable `macroSymbolId`, not be a one-off row inside a calendar.

### Economic Calendar

TradingView's official help describes these core columns and interactions:

- Announcement/release time.
- Country.
- Importance indicator.
- Event name.
- Actual value.
- Forecast value.
- Prior value.
- Clicking an event exposes description and actions: launch chart, see overview, add to Google Calendar.
- Filters include date/period, countries/regions, time zone, importance, and category.
- Calendar is available as a standalone page and inside Supercharts right toolbar; Supercharts can display economic events on charts for broad indices, futures, and other asset types.
- Public FAQ says the calendar covers more than 300,000 economic indicators from over 190 countries.
- Widget docs confirm a public embeddable economic calendar widget with filters for event importance and affected currencies.

Browser probe on 2026-06-01 saw top controls:

- Today/date selector.
- Time zone selector.
- Tabs: Economic, Earnings, Revenue, Dividends, IPO, More.
- Category filter, initially "All categories".

Product reading: the calendar is both a standalone workflow and a contextual panel for chart users. The same event model should power both contexts.

### Heatmap

The public heatmap page is a table-like country-by-indicator matrix:

- Rows: major countries/regions.
- Columns: GDP, GDP Growth, Budget to GDP, Government Debt to GDP, Interest Rate, Inflation Rate, Unemployment Rate, Current Account to GDP, Industrial Production YoY.
- Purpose: quickly compare key countries and their current macro performance.

Product reading: this is lower-risk than a geographical map and should be part of MVP. It supports dense scanning and works well on desktop; on mobile it should become a horizontally scrollable matrix with sticky country labels.

### Macro Maps

TradingView's Macro Maps expand heatmaps into a global visual exploration tool:

- Countries are color-coded by selected macro indicator.
- Indicator search and favorites.
- Smooth zooming.
- Historical date picker/scrubber with month precision.
- Tooltip with country details.
- Tooltip action to add the selected series to chart.
- Interactive legend that highlights countries in a value range.
- Extras: table of all countries and latest economic news.
- Access as a standalone page and from the right-side platform panel.

Product reading: Macro Maps are a strong differentiator, but they require geospatial rendering, color-scale rules, missing-data handling, and historical time slicing. Implement after the shared macro data model is stable.

## Competitor gap notes

Forex Factory:

- Strong calendar density for active FX (Foreign Exchange) traders.
- Columns: Date, Time, Currency, Impact, Alerts, Detail, Actual, Forecast, Previous, Graph.
- Fast week navigation and "Up Next" workflow.
- Less of a global macro research portal; strongest as a calendar.

Investing.com:

- Calendar aggregates macro releases like NFP (Nonfarm Payrolls), CPI (Consumer Price Index), GDP, PMI (Purchasing Managers' Index), rate decisions, jobless claims, plus corporate/commodity releases.
- Shows consensus forecast, previous value, and actual result at release.
- Filters by country, impact, category, and time window.
- Broad retail audience; more cluttered, but strong breadth.

Econoday:

- Professional-grade economic calendar and commentary.
- Emphasis on economist-written analysis, forecast/actual/prior values, and historical data.
- Strong for depth, weaker for public self-serve visual product unless licensed.

Opportunity for our page:

- Combine TradingView's macro navigation with Forex Factory's fast event scanning.
- Add clearer "why this matters" summaries per event/indicator, inspired by Econoday, but generated from owned static metadata and not hidden synthetic messages.
- Make cross-asset context explicit: event -> affected currencies/assets -> chart route.

## Recommended data model

Use one macro domain shared by calendar, heatmap, map, indicator detail, and chart overlays.

Core entities:

- `MacroCountry`: id, ISO (International Organization for Standardization) country code, display name, region, currency code, flag asset, G20 flag.
- `MacroIndicatorDefinition`: id, slug, display name, category, description, unit, frequency, default transform, source label, release authority, comparable flag, chartable flag.
- `MacroSeries`: id, macro symbol id, country id, indicator definition id, source id, observation frequency, unit, latest value, latest observation period, next release id.
- `MacroObservation`: series id, observation date, period label, value, revised flag, vintage timestamp, source revision id.
- `MacroReleaseEvent`: id, scheduled time, country id, currency code, indicator definition id, series id, importance, category, title, actual, forecast, prior, revised prior, status, source, event description.
- `MacroImpactLink`: event id or indicator id, route target, affected asset classes, affected symbols, explanation.
- `MacroNewsLink`: indicator/country/event id, news id.

Important implementation rule: do not create separate "calendar event country", "heatmap country", and "map country" models. That would immediately violate the single-source domain requirement. Calendar rows, heatmap cells, map tooltips, and indicator details must all read the same `MacroSeries` and `MacroReleaseEvent` records.

## Candidate data-source strategy

For a clone implementation we should not use TradingView private APIs or scrape live private bundles.

Recommended staged source plan:

1. Synthetic deterministic dataset for implementation and visual fidelity.
   - Use stable seeded values for G20 countries and 9 core indicators.
   - Include historical observations for at least 5 years so charts, heatmap deltas, and Macro Maps scrubber can work.
   - Include 2 weeks of calendar events with actual/forecast/prior values and mixed status.

2. Optional real open data adapters later:
   - World Bank Indicators API: broad annual macro series, no API key required, nearly 16,000 time series indicators, many over 50 years.
   - FRED API: strong US/international economic time series, release calendars, vintages, and observations; API key required.
   - OECD API: free SDMX (Statistical Data and Metadata eXchange) API, useful for OECD member macro comparisons.

3. Paid production adapter if the product needs real-time calendar:
   - Trading Economics API: direct access to 300,000 economic indicators and streaming updates from economic calendar and earnings releases calendar, but requires subscription/API key.

The page should be architected around provider interfaces, but the frontend must not know provider details. The API should expose normalized macro entities only.

## Product requirements for our Economy module

### AInvest PRD overlay

Additional downstream source: `D:/myhexin-local/demos/nova-market/apps/web/market/docs/prd/economy/01-economy-overview-hub.md`.

The AInvest PRD maps TradingView `/markets/world-economy/` to `/market/economy`. Treat that as a route alias or local route registry decision; it must not change the shared macro domain model. The product surface still follows the TradingView page order extracted above.

PRD-required content blocks:

- P0: inflation choropleth map, GDP growth ranking table, three US key indicator cards, countries directory, server-rendered first-screen data, SEO metadata, dark mode, i18n key discipline, and responsive mobile layout.
- P1: economy Ideas preview, economic indicators heatmap preview, global industrial map preview, economy news preview, economic calendar preview, FAQ with structured data, and exposure/click analytics.

PRD reconciliation notes:

- The PRD suggests reusing an existing heatmap component. In this clone brief, reuse is acceptable only if the component already supports macro indicators. Do not force an equity/stock heatmap shape into the economy module; the single source of truth is the macro country/indicator/series domain.
- The PRD's "Inflation map Hero" must render as a data-first choropleth section matching TradingView's current operational layout, not as a decorative marketing hero.
- FAQ JSON-LD, canonical metadata, and SSR (Server-Side Rendering) requirements are part of acceptance when the target app has the corresponding metadata framework.
- Dark mode and mobile behavior are required acceptance surfaces, not optional theme polish.

### MVP surface

- Route: `/markets/world-economy/` or local route registry equivalent. If the target product is AInvest, route this module at `/market/economy`.
- Header: "Economy" with market shell navigation consistent with accepted foundation.
- Anchor tabs: Overview, Countries, Indicators, Heatmap, Calendar, News, FAQ.
- Overview:
  - Key country cards for G20 or configured priority countries.
  - Key indicator cards: US unemployment rate, US interest rate, US trade balance, global inflation, GDP growth.
  - "Upcoming high-impact events" strip using the calendar domain.
- Countries:
  - Region filters: G20, World, North America, Europe, Middle East / Africa, Mexico and South America, Asia / Pacific.
  - Country list/table with latest GDP, inflation, unemployment, interest rate.
- Indicators:
  - Category taxonomy from metadata.
  - Indicator tiles linking to indicator comparison pages.
- Heatmap:
  - Matrix of countries x core indicators.
  - Color encoding by value relative to indicator-specific ranges.
  - Sticky country column and sortable indicator columns.
  - Clicking a cell opens series detail or navigates to macro symbol detail.
- Economic Calendar:
  - Date range selector: yesterday, today, tomorrow, this week, next week, custom.
  - Time zone selector.
  - Filters: country/region, currency, importance, category.
  - Table columns: time, country/currency, importance, event, actual, forecast, prior.
  - Event detail drawer: description, affected assets, release source, actions.
  - Actions:
    - "Open chart" -> shared Chart route with macro symbol.
    - "See overview" -> macro indicator detail route.
    - "Add to calendar" -> honest boundary unless `.ics` export is implemented.
- Indicator detail:
  - Header with macro symbol, country, source, unit.
  - Chart preview with time ranges.
  - Key data points.
  - About/definition.
  - Related indicators.
  - Linked news/ideas placeholders through shared boundary if content module is absent.

### Phase 2 surface

- Macro Maps:
  - World map with country value coloring.
  - Indicator selector and favorites.
  - Historical month scrubber.
  - Legend range hover.
  - Tooltip with country, value, observation period, chart action.
  - Table/news side panel.
- Chart event overlays:
  - Economic events displayed on chart timeline for broad indices, futures, FX, bonds.
  - Reuse `MacroReleaseEvent`, not a chart-specific duplicate event model.
- Widget/embed preview:
  - A local "Get widget" boundary or real embeddable public component depending on product scope.

## Visual and UX direction

This is an operational market-research surface, not a marketing landing page.

- Dense information layout, restrained visual styling, low-radius cards, and table-first scanning.
- Keep charts, tables, filters, and maps visible above explanatory copy.
- Use icons for filters, calendar actions, chart open, favorites, and map controls.
- Avoid one-note color palettes. Heatmap colors should be semantic and calibrated per indicator.
- Page sections should be full-width bands or unframed layouts; only repeated country/indicator items and drawers should be card-like.
- Mobile:
  - Use sticky top tabs.
  - Heatmap becomes horizontal matrix with sticky country labels.
  - Calendar becomes grouped event list by day with actual/forecast/prior chips.
  - Macro Maps can degrade to ranked table until map is implemented.

## Implementation constraints

- No real TradingView API, private bundle, brand asset, or hidden scrape dependency.
- No static mock that bypasses the API. Synthetic data is acceptable only through the shared backend/API envelope.
- No parallel data models for countries, indicators, events, or macro symbols.
- Calendar, heatmap, map, indicator detail, and chart overlays must share the same macro domain.
- Auth, paid, alert, calendar export, watchlist, and widget generation actions must route through existing shared boundaries unless truly implemented.
- Filters and column metadata must be served by API metadata, not hardcoded in leaf UI components.

## Acceptance criteria

- `/markets/world-economy/` renders inside shared shell.
- If the target product uses the AInvest route map, `/market/economy` renders the same Economy hub through the route registry instead of a duplicated page implementation.
- Economy page uses the shared route registry and API response envelope.
- Countries, indicators, heatmap, calendar, and detail routes all read the shared macro domain.
- The first viewport follows the 2026-06-01 extraction: page title/overview state, inflation choropleth, GDP growth table, and three key US indicator cards before secondary content.
- Heatmap renders at least 10 countries x 9 indicators with deterministic values and legends.
- Calendar renders at least 2 weeks of deterministic release events, with date/country/importance/category filters.
- Event detail drawer exposes actual/forecast/prior values, description, affected asset links, chart link, overview link, and honest calendar-export boundary.
- Indicator detail page renders chart preview, key data points, source/frequency/unit, related indicators, news/ideas placeholders.
- Cross-module links:
  - Macro symbol -> Symbol Detail or macro detail route.
  - "Open chart" -> Chart route.
  - News -> News route or shared route-placeholder boundary.
- Playwright coverage:
  - Economy landing smoke.
  - AInvest route alias smoke if `/market/economy` is in scope.
  - Heatmap click-through to indicator detail.
  - Calendar filter and event drawer.
  - Open chart route link.
  - Mobile layout for calendar and heatmap.
- SEO/SSR coverage:
  - First-screen GDP table, key indicator cards, and FAQ content are present in the initial HTML when the target framework supports SSR.
  - FAQ structured data and canonical metadata are generated once through the shared metadata layer.
- Theme coverage:
  - Dark mode preserves heatmap/map contrast and table readability.
  - Mobile viewport keeps map/table/calendar data readable without text overlap.
- Visual fidelity check against live references for desktop and mobile.

## Task brief - Economy module

> Paste as a `kind=workflow` request after the shared foundation and earlier dependent market shell work are accepted.

### Goal

Clone the TradingView Economy module as one module of the existing shared site, for research/educational purposes.

### Visual references

- Primary: https://www.tradingview.com/markets/world-economy/
- Calendar: https://www.tradingview.com/economic-calendar/
- Heatmap: https://www.tradingview.com/markets/world-economy/indicators-heatmap/
- Indicator detail: https://www.tradingview.com/symbols/ECONOMICS-USGDP/
- Phase 2 reference: https://www.tradingview.com/macro-maps/
- Downstream PRD overlay: `D:/myhexin-local/demos/nova-market/apps/web/market/docs/prd/economy/01-economy-overview-hub.md`

Restore these surfaces 1:1 as closely as the stack allows. Visible text/layout/visual values must trace to extracted public references; mark anything the public anonymous page does not reveal as a known gap instead of inventing it.

### Build on the existing shared foundation

This module MUST reuse the shared layer delivered by the foundation task. Do not create parallel copies:

- Use one macro country/indicator/series/event domain shared across landing, heatmap, calendar, map, and detail pages.
- Fetch through the shared API envelope.
- Render inside the shared shell and reuse shared table, card, filter, drawer, chart-preview, and route-link components.
- Navigate via the central route registry:
  - indicator/country/symbol -> macro detail or Symbol Detail route,
  - "open chart" -> Chart route,
  - news links -> News route or route-placeholder boundary.
- Auth, alert, watchlist, premium data, calendar export, and widget generation actions -> shared boundaries. Never fake success.

### In scope

- World Economy landing page.
- Countries and indicators metadata surfaces.
- Economic indicators heatmap.
- Economic calendar with filters and event detail drawer.
- Macro indicator detail page with chart preview and related indicators.
- Deterministic synthetic macro dataset served by backend/API, including historical observations and release events.

### Out of scope

- Real TradingView data/API/private bundles.
- TradingView brand assets.
- Real paid data, login, alert, watchlist, Google Calendar OAuth, or widget publishing.
- Full Macro Maps world-map implementation unless explicitly scheduled as phase 2.

### Acceptance

- All MVP routes render inside the shared shell.
- All data comes from the shared macro domain through the API envelope.
- No duplicated country/indicator/event models.
- Heatmap, calendar, and detail pages remain internally consistent when clicking between them.
- Calendar filters and event drawer work.
- Cross-module chart/detail/news links route through the registry or honest shared boundaries.
- Visual fidelity is checked against the listed references.
- Playwright tests cover landing, heatmap, calendar, detail, cross-route links, and mobile behavior.
- No previously accepted module regresses.
