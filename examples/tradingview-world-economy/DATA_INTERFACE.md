# Data Interface

This artifact uses one in-repo data module as the single source:

- `src/economy-data.js`

The current page is a static clone target, so no remote API is invented. Every rendered region imports data from that module.

Exports:

| Export | Shape | Consumers |
| --- | --- | --- |
| `gdpRows` | `{ country, flag, growth, nominal, currency }[]` | GDP table |
| `countryChips` | `string[]` | Countries chip list |
| `indicators` | `{ title, code, type, values, yTicks, xTicks, actual, forecast, nextRelease }[]` | Indicator cards and charts |
| `inflationBandByContinent` | `Record<string, number>` | Inflation map color defaults |
| `inflationBandByISO` | `Record<string, number>` | Country-level inflation map color overrides |
| `ideas` | `{ title, symbol, author, time, likes, body }[]` | Ideas list |
| `news` | `[title, time][]` | News list |
| `calendarRows` | `[date, event, value][]` | Economic calendar |
| `faqRows` | `[question, answer][]` | FAQ details |

Term notes:

- GDP means Gross Domestic Product.
- YoY means year over year.
- USD means United States Dollar.
- FAQ means Frequently Asked Questions.

Verification:

```powershell
node examples\tradingview-world-economy\test\visual-check.mjs
```

The check starts the artifact's Node static server, opens desktop and mobile viewports with Playwright, asserts geometry and runtime cleanliness, and writes screenshots under `examples/tradingview-world-economy/screenshots`.

Map geometry:

- `src/world-countries-110m.geojson` is Natural Earth 1:110m Admin 0 country geometry, served locally and rendered as SVG paths by `src/app.js`.
- Natural Earth publishes the source dataset as public domain map data.
