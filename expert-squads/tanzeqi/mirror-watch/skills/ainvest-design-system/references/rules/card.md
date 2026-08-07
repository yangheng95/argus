# Card Rules

**Category:** Visual Style + Interaction Pattern
**Scope:** All card components — Comparison Card, Popular Comparison Card, News Card, Stock Card, Trade Event Card, Politician Card, any `border-radius` surface that acts as a contained content unit

---

## 1. Visual Style (Static)

### Background

- Default: **no background color** (transparent)
- Background is determined by business context — card.md does not restrict the value
- MUST NOT hardcode a background color in shared card components; override at the feature/page level if needed

### Border

- MUST use a `2px solid` border with `color.divider.level3` (`rgba(0,0,0,0.05)`) as the default card outline
- MUST NOT use shadow to define card boundaries — borders carry this role
- MUST NOT use `color.border.default` for the default state (too prominent; reserved for focus/selected states)

### Corner Radius

- Default card → `radius.md` (16px)
- Large card / floating panel → `radius.lg` (24px)
- MUST NOT mix radius values within the same card component

### Padding

- Web — viewport width **> 500px**: `padding: 24px 20px` (top/bottom 24px, left/right 20px)
- Web — viewport width **≤ 500px**: `padding: 16px 12px` (top/bottom 16px, left/right 12px)
- MUST NOT use arbitrary padding values outside these two responsive steps

### Internal Spacing

- Gap between elements within a card → `spacing.8` (8px)
- Gap between sub-sections within a card → `spacing.12` (12px)

### Shadow

- Default state: **no shadow**
- Whether to add a shadow is decided by the business/feature owner, not by this base spec
- When shadow is needed, use `shadow.md` — MUST NOT use custom shadow values
- MUST NOT apply shadow universally to all card instances

---

## 2. Hover & Active States

Hover and active (pressed) state styles for cards are defined in and governed by **`hover.md` §3.2**.

Key rules (summary only — `hover.md` is authoritative):

- Hover feedback uses flat background fill only
- MUST NOT use `transform: translateY(...)` (vertical lift)
- MUST NOT add or increase `box-shadow` on hover
- MUST NOT use `opacity` changes on hover
- Transition: `background 0.15s ease-out`

> For nested card hover behavior (card contains clickable sub-elements), see `hover.md` §2.5 and §3.2.

---

## 3. Selected State (when applicable)

- MUST change border to `2px solid color.border.default` (`rgba(0,0,0,0.2)`) to indicate selection
- MUST NOT use shadow to communicate selection
- MAY add inset ring: `box-shadow: inset 0 0 0 2px rgba(0,0,0,0.2)` for stronger selection confirmation

---

## 4. State Reference Table

| State          | Background              | Border                          | Shadow            | Transform |
|----------------|-------------------------|---------------------------------|-------------------|-----------|
| Default        | none (business-defined) | 2px `color.divider.level3`      | none (by default) | none      |
| Hover          | see `hover.md` §3.2     | 2px `color.divider.level3`      | none              | none      |
| Active/Pressed | see `hover.md` §3.2     | 2px `color.divider.level3`      | none              | none      |
| Selected       | none (business-defined) | 2px `color.border.default`      | none              | none      |

---

## 5. Carousel Rules

### Card Count

- MUST display **3–6 cards** in the visible area of a compact-card carousel (politician/stock cards)
- MUST display **3–4 cards** for wider event/trade cards
- MUST NOT display more than 6 compact cards at any breakpoint
- MUST NOT display fewer than 3 cards

Breakpoint targets for compact cards:

| Breakpoint    | Visible cards |
|---------------|---------------|
| XL ≥1410px    | 5             |
| LG 900–1410px | 4             |
| MD 500–900px  | 3             |

### Carousel Card Width

- MUST use `flex: 1 0 0` on carousel cards so they fill the full row width without gaps
- MUST retain `min-width` to prevent cards from becoming too narrow
- MUST NOT use fixed `width: calc(...)` formulas
- For MD breakpoint on event-track (wider cards), use `flex: 0 0 280px` to enable horizontal scroll

### Carousel Arrow Overlap

When carousel arrows overlap card borders, apply the **color-opacity-on-overlap** rule — arrows must use solid fill on hover, not transparent. See `rules/color-opacity-on-overlap.md`.

---

## 6. MUST / MUST NOT Summary

### MUST

- Use `2px solid color.divider.level3` as default border
- Use `radius.md` as default corner radius
- Use `padding: 24px 20px` (>500px) or `padding: 16px 12px` (≤500px)
- Follow `hover.md` §3.2 for all hover and active states
- Decide background color and shadow at the business/feature level

### MUST NOT

- Use `box-shadow` on cards in default state
- Use `transform: translateY(...)` on hover
- Use `opacity` changes on hover
- Use `color.border.default` as default border (too strong)
- Hardcode a background color in the base card component
- Invent custom radius, padding, or border-color values

---

## 7. FAILURE

- If a card uses `box-shadow` in default state → remove shadow (unless explicitly required by product)
- If a card hover adds or increases `box-shadow` → remove it, defer to `hover.md`
- If a card hover applies `transform: translateY(...)` → remove it
- If a card hover uses opacity → replace with flat fill per `hover.md`
- If a card uses `radius.lg` for a standard-size card → change to `radius.md`
- If a compact card carousel shows >6 or <3 cards at any breakpoint → fix using `flex: 1 0 0`
- If a ticker logo inside a card appears square → see `rules/image-asset-usage.md`
- If padding does not match the two responsive steps → correct to `24px 20px` or `16px 12px`

---

## 8. Related Documents

- `ainvest-design-system/references/rules/hover.md` — Hover 总规范（卡片 hover/active 行为的权威来源）
- `ainvest-design-system/references/tokens/shadow.md` — 投影 token 定义（业务方按需引用）
- `ainvest-design-system/references/tokens/radius.md` — 圆角 token 定义
- `ainvest-design-system/references/tokens/spacing.md` — 间距 token 定义
