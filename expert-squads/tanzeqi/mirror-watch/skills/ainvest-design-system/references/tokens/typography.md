# Design System — Typography Tokens

All UI MUST follow this typography system.

---

# 0. Core Principles

- MUST use semantic typography tokens
- MUST NOT define font manually
- MUST maintain hierarchy
- MUST NOT mix styles randomly

---

# 1. Font Family

> **Critical — Font Source**
> This package uses one declared operating-system UI font stack. It does not load a second web-font source at runtime.

### font.family.web
- alias: `--font-family-web` (全局字体 / canonical system stack)
- value: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"`
- purpose: the single canonical family value for the package

### font.family.primary
- source: operating-system UI fonts declared by `font.family.web`
- primary value: `<font.family.web>`
- CSS value (final): `var(--font-family-web)`
- expanded: `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";`
- MUST use for: **all** UI text including **all numeric values** — titles, body, labels, buttons, navigation, prices, percentages, volume, market cap, P/E ratios, amounts
- MUST be declared only through the canonical `font.family.web` value

> **Numeric values — use `font-variant-numeric: tabular-nums`**
> The system does **not** define a monospace font family. To keep digits aligned in tables and data grids, apply `font-variant-numeric: tabular-nums` to the numeric text; the font family stays `font.family.primary`. A dedicated mono/JetBrains family is **not** part of this design system — MUST NOT introduce one.

---

# 1.1 Font Declaration Rules （强制声明规范）

Every generated page declares the canonical system stack locally. Do not add `<link>`, `@font-face`, preconnect hints, font downloads, or another family source.

### MUST

- MUST set `body { font-family: var(--font-family-primary); }` once globally; every element inherits primary
- MUST apply `font-variant-numeric: tabular-nums` to numeric values inside tables, data grids, and aligned number columns

### MUST NOT

- MUST NOT introduce a downloaded web font or a component-level family override
- MUST NOT introduce a monospace / JetBrains Mono / SF Mono / code font family for UI numerics; use `tabular-nums`

### Canonical CSS variables

```css
:root {
  --font-family-web: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji",
    "Segoe UI Emoji", "Segoe UI Symbol";
  --font-family-primary: var(--font-family-web);
}
body { font-family: var(--font-family-primary); }
.num { font-variant-numeric: tabular-nums; }   /* font-family inherited from body */
```

### FAILURE conditions

- Page loads or declares a second font source → **regenerate** using only the canonical system stack
- Page declares or references `--font-family-mono` / `"JetBrains Mono"` / `"SF Mono"` / `ui-monospace` anywhere → **regenerate**, remove the mono family and rely on `font-variant-numeric: tabular-nums` for digit alignment
- Numeric values in tables / data grids missing `font-variant-numeric: tabular-nums` → **regenerate** with tabular-nums applied

---

# 2. Font Weight

Font weight tokens MUST be written as **numeric values** in CSS. Keyword strings like `"SemiBold"` are invalid and fail the typography contract.

### font.weight.bold
- value: Bold
- CSS numeric: `700`

### font.weight.semibold
- value: SemiBold
- CSS numeric: `600`

### font.weight.medium
- value: Medium
- CSS numeric: `500`

### font.weight.regular
- value: Regular
- CSS numeric: `400`

### Rules

- MUST write CSS as `font-weight: 700` (not `font-weight: Bold` / `font-weight: "SemiBold"`)
- MUST request matching weights in the Google Fonts URL — any weight used in CSS must be declared in `wght@...` or the browser will synthesize a fake bold (ugly, inconsistent)
- Default body weight = `400` (Regular); default title weight = `700` (Bold); default SemiBold for emphasis = `600`

---

# 3. Font Size

### font.size.10
- value: 10

### font.size.11
- value: 11

### font.size.12
- value: 12

### font.size.14
- value: 14

### font.size.16
- value: 16

### font.size.18
- value: 18

### font.size.20
- value: 20

### font.size.24
- value: 24

### font.size.26
- value: 26

### font.size.32
- value: 32

### font.size.40
- value: 40

### font.size.56
- value: 56

---

# 3.1 Allowed Sizes （强制字号白名单）

Font size in this system is a **closed set**. Any size outside this list is a system violation.

### Allowed values (MUST)

`10, 11, 12, 14, 16, 18, 20, 24, 26, 32, 40, 56`

### MUST

- MUST use only the twelve sizes above in every `font-size` declaration
- MUST pick the nearest allowed size when tempted to use an "in-between" value (e.g. `13 → 12 or 14`, `15 → 14 or 16`, `22 → 20 or 24`)
- MUST prefer **tokenized** references (`typography.body.tertiary.regular` etc.) over raw `font-size: 12px` so the whitelist is enforced by the token layer

### MUST NOT

- MUST NOT use `9, 13, 15, 17, 19, 21, 22, 23, 25, 28, 30, 36, 48, 64` or any other value outside the whitelist
- MUST NOT express sizes in `em` / `rem` / `%` to bypass the whitelist — the whitelist is the size system, not a CSS unit suggestion
- MUST NOT introduce a new size "just for this one component"; promote the need to the design system first

### FAILURE conditions

- Any `font-size` value outside the whitelist → **regenerate** and snap to the nearest allowed size
- Using `em` / `rem` / `%` to produce a non-whitelisted computed size → **regenerate** in `px` at an allowed size
- Adding a new size without updating §3 of this file → **reject change**

---

# 3.2 Web vs App Usage （场景字号/字体约束）

This system defines **two scenario tracks** for titles and news typography. MUST pick the correct track by device context.

### Web track (desktop browser, responsive web)

- Titles: MUST use `typography.title.web.*` (xl 40 / lg 32 / md 24, weight Bold)
- News **detail page** (article hero + long-form body): MUST use `typography.news.web.*` (title 56 / body 20). News **list / grid cards** (ArticleItem) follow `rules/ArticleItem.md §5.14` — title = `body.primary.bold` 16; the `news.web.*` tokens are NOT for list cards.
- Module / section headers on web pages MUST use `typography.title.web.md` (24, Bold) — **not** the app track's 20
- Rationale: desktop viewport is wider, reading distance is greater, hierarchy needs larger type to feel balanced against a 1560px canvas

### App track (native iOS / Android, in-app webview, compact mobile web)

- Titles: MUST use `typography.title.app.*` (lg 24 / md 20 / sm 18, weight SemiBold)
- News **detail page** (article hero + long-form body): MUST use `typography.news.app.*` (title 26 / body 18). News **list / grid cards** (ArticleItem) follow `rules/ArticleItem.md §5.14` — title = `body.primary.bold` 16.
- Rationale: phone viewport is narrow, one-hand thumb reading, SemiBold reads lighter than Bold at small sizes

### MUST

- MUST decide track **once per page / surface** and apply it consistently — no mixing web-md 24 with app-sm 18 in the same screen
- MUST map "module / section title" on web to `title.web.md` (24)
- MUST map "module / section title" on app to `title.app.md` (20)

### MUST NOT

- MUST NOT use `title.app.*` on desktop web pages just because "20 looks cleaner" — this breaks hierarchy against page-level `title.web.xl`
- MUST NOT use `title.web.*` on in-app surfaces (too heavy, too large for the viewport)
- MUST NOT mix weights across tracks in the same surface (web=Bold, app=SemiBold is a hard distinction)

### FAILURE conditions

- Desktop web page uses `title.app.md` (20) for section headers → **regenerate** with `title.web.md` (24)
- App surface uses `title.web.xl` (40) → **regenerate** with `title.app.lg` (24) or news.app.title (26)
- Same surface contains both web and app title tokens → **regenerate**, pick one track

---

# 3.3 Row-level Field Uniformity （行内并列字段同字号）

The previous rules (§3, §3.1, §3.2) govern **vertical hierarchy** — primary / secondary / tertiary layers of information. This rule governs **horizontal uniformity** — parallel fields inside the same row.

### Why this rule exists

A single data row (e.g. `asset-row`: `logo | name+symbol | sparkline | price | change%`) contains multiple fields. If each field is independently tokenized by its semantic layer (name→body.secondary, price→body.secondary, change%→body.tertiary), each cell is individually valid but **the row looks uneven** because parallel fields end up at different sizes (e.g. price 14 vs change% 12).

Parallel fields at the **same information layer** MUST share one size. Tokens classify layers, not row positions.

### Definition — what counts as "parallel fields"

Two or more fields in the **same row** that carry the **same information layer** — they answer the same kind of question at the same importance. The clearest case is **numeric status fields** of the same subject:

- `price` + `change%` + `change$` + `volume` in a ticker row → **parallel, same layer**
- `name` + `symbol` → **NOT parallel** (name is primary identity, symbol is tertiary alias)
- `metric-card title` (14) + `metric-card value` (26) + `metric-card sub` (12) → **NOT parallel** (vertical hierarchy inside the card)
- `news-item title` (16) + `news-meta` (11) → **NOT parallel** (title vs meta)

### MUST

- MUST use **the same `font-size`** for all numeric status fields in the same row (price, change%, change$, volume, market cap, P/E — whichever appear together as current-state data)
- MUST use **the same `font-size`** for all fields that a user would scan as "one group of facts about this row"
- MUST determine the shared size by the **primary** field in the group — e.g. if `price` is 14 then `change%` is also 14, not 12
- MUST default to a single row-data size per surface — pick 14 for dense tables, 12 for very compact lists, and apply it to every parallel numeric field on that surface
- MUST keep identity aliases (`symbol`, `sub`, secondary ID) at their caption size (11 / 10) — they are NOT parallel to the primary name; they are a sub-layer

### Explicit constrained-width variant

Only when a parallel field **physically cannot fit** at the shared size (column too narrow, causes ellipsis / wrap / overflow), MAY step that single field **one** size down in the whitelist (e.g. 14 → 12). Apply in this order:

1. First try to widen the column / reduce gap / truncate other content
2. Only if none of the above work, step the offending field down by one whitelist rung
3. MUST NOT step down more than one rung (14 → 12 is the only allowed constrained-width variant; 14 → 10 is forbidden)
4. MUST NOT step down by default "to make room" — the exception triggers only when overflow is measurable

### MUST NOT

- MUST NOT assign different sizes to parallel numeric fields "because change% feels secondary" — visual weight for change% comes from color (up/down), not from being smaller
- MUST NOT size a field by its semantic token label alone when it sits in a row alongside other same-layer fields — the row layer wins over the individual cell's token
- MUST NOT use tertiary (12) for `change%` while using secondary (14) for `price` in the same row
- MUST NOT apply the constrained-width variant without first trying column / truncation adjustments

### FAILURE conditions

- Price and change% in the same row use different `font-size` → **regenerate** at the shared size (default: match price)
- Two numeric columns in the same table body use different `font-size` without a documented constrained-width reason → **regenerate** uniform
- Row uses 3+ different `font-size` values across parallel fields → **regenerate**, collapse to a single size for parallel fields (keep identity aliases at their caption size as a separate layer)

### Worked example — asset-row (Trending panel)

| Field | Layer | Size | Reason |
|---|---|---|---|
| `name` (Bitcoin) | primary identity | 14 | body.secondary — row primary |
| `symbol` (BTC) | identity alias (caption) | 11 | caption.11 — sub-layer under name, **not** parallel to name |
| `price` ($67,412.30) | numeric status, primary | **14** | row-level numeric layer |
| `change%` (+2.41%) | numeric status, primary | **14** | parallel to price → **same size**, not 12 |

---

# 4. Line Height

### font.lineHeight.tight
- value: 14

### font.lineHeight.normal
- value: 16

### font.lineHeight.medium
- value: 18

### font.lineHeight.relaxed
- value: 22

### font.lineHeight.large
- value: 28

### font.lineHeight.xlarge
- value: 32

### font.lineHeight.display
- value: 48

### font.lineHeight.hero
- value: 68

---

# 5. Title

## Title — App

### typography.title.app.lg
- font: Plus Jakarta Sans
- weight: SemiBold
- size: 24
- lineHeight: 28

### typography.title.app.md
- font: Plus Jakarta Sans
- weight: SemiBold
- size: 20
- lineHeight: 24

### typography.title.app.sm
- font: Plus Jakarta Sans
- weight: SemiBold
- size: 18
- lineHeight: 22

---

## Title — Web

### typography.title.web.xl
- font: Plus Jakarta Sans
- weight: Bold
- size: 40
- lineHeight: 48

### typography.title.web.lg
- font: Plus Jakarta Sans
- weight: Bold
- size: 32
- lineHeight: 38

### typography.title.web.md
- font: Plus Jakarta Sans
- weight: Bold
- size: 24
- lineHeight: 28

---

# 6. Body

## Primary

### typography.body.primary.bold
- size: 16
- weight: Bold
- lineHeight: 22

### typography.body.primary.semibold
- size: 16
- weight: SemiBold
- lineHeight: 22

### typography.body.primary.medium
- size: 16
- weight: Medium
- lineHeight: 22

### typography.body.primary.regular
- size: 16
- weight: Regular
- lineHeight: 22

---

## Secondary

### typography.body.secondary.semibold
- size: 14
- weight: SemiBold
- lineHeight: 16

### typography.body.secondary.medium
- size: 14
- weight: Medium
- lineHeight: 18

### typography.body.secondary.regular
- size: 14
- weight: Regular
- lineHeight: 18

---

## Tertiary

### typography.body.tertiary.semibold
- size: 12
- weight: SemiBold
- lineHeight: 16

### typography.body.tertiary.medium
- size: 12
- weight: Medium
- lineHeight: 16

### typography.body.tertiary.regular
- size: 12
- weight: Regular
- lineHeight: 16

---

# 7. Caption

### typography.caption.11.semibold
- size: 11
- weight: SemiBold
- lineHeight: 14

### typography.caption.11.medium
- size: 11
- weight: Medium
- lineHeight: 14

### typography.caption.11.regular
- size: 11
- weight: Regular
- lineHeight: 14

### typography.caption.10.semibold
- size: 10
- weight: SemiBold
- lineHeight: 12

### typography.caption.10.medium
- size: 10
- weight: Medium
- lineHeight: 12

### typography.caption.10.regular
- size: 10
- weight: Regular
- lineHeight: 12

---

# 8. News (Special Scenario)

> **Scope — Detail Page Only**
>
> The `typography.news.*` tokens below are for the **news detail page** (the full-screen article view): the article hero title and the long-form article body copy. They are **NOT** for list / grid cards, feed items, or any ArticleItem instance.
>
> - News list / grid / feed cards (ArticleItem — `default` / `ranked` / `newsflash` / `vertical`) MUST use `body.primary.bold` (16) for title and `caption.11.*` / `caption.10.*` for meta rows. See `references/rules/ArticleItem.md §5.14 Typography Mapping`.
> - News detail page hero title MUST use `typography.news.web.title` (56) on web, `typography.news.app.title` (26) on app.
> - News detail page body copy MUST use `typography.news.web.body` (20) on web, `typography.news.app.body` (18) on app.
>
> **FAILURE conditions**
>
> - ArticleItem title uses `news.web.title` (56) or `news.web.body` (20) → **regenerate** with `body.primary.bold` (16)
> - News detail page hero title uses `title.web.xl` (40) → **regenerate** with `news.web.title` (56)

### typography.news.web.title
- size: 56
- weight: Bold
- lineHeight: 68
- scope: News detail page — article hero title (web)

### typography.news.web.body
- size: 20
- weight: Regular
- lineHeight: 30
- scope: News detail page — article body copy (web)

### typography.news.app.title
- size: 26
- weight: Bold
- lineHeight: 32
- scope: News detail page — article hero title (app)

### typography.news.app.body
- size: 18
- weight: Regular
- lineHeight: 28
- scope: News detail page — article body copy (app)

---

# 9. Rules

### MUST

- use semantic typography
- follow hierarchy (title > body > caption)
- use consistent line height

### MUST NOT

- mix font sizes randomly
- use arbitrary font weight
- override line height manually

---

# 10. AI Rules

### Mapping

- page title (web) → typography.title.web.xl / lg
- page title (app) → typography.title.app.lg
- section / module title (web) → typography.title.web.md (24, Bold)
- section / module title (app) → typography.title.app.md (20, SemiBold)
- main content → typography.body.primary (16)
- secondary info → typography.body.secondary (14)
- meta / labels → typography.body.tertiary (12)
- annotation / badge → typography.caption (10 / 11)
- numeric values (prices, %, volume, market cap) → same body/caption scale + `font-variant-numeric: tabular-nums`, **no** mono family

---

### Failure

If violated → regenerate UI
