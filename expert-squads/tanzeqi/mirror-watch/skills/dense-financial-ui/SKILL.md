---
name: dense-financial-ui
description: Generate high-density financial product UI as interactive HTML artifacts. Use this skill whenever a product manager or designer asks to generate, design, prototype, or demo any financial interface — including stock dashboards, trading screens, market data panels, portfolio views, risk monitors, options flow, earnings reports, or any data-heavy financial UI. Trigger even if the user only says "make me a demo", "generate a page", "prototype this screen", or similar — as long as the context is a financial product UI. Also trigger when the user asks to "add a section", "adjust the layout", or "redesign this card" for an existing financial HTML artifact.
---

# Dense Financial UI — Generation Skill

Generate interactive single-file HTML artifacts for financial product UIs. Style reference: Unusual Whales (unusualwhales.com). Default to dark mode; support light mode via theme toggle.

---

## 0. Generation Checklist — MUST VERIFY BEFORE OUTPUT

> **这是强制核查表。每次生成界面前，必须逐条对照，确保输出符合所有规范。不得跳过。**

### 0.1 Color Tokens
- [ ] **所有颜色只使用 CSS token 变量**，不得硬编码 hex 值（图表 series 颜色除外，ECharts 不支持 CSS 变量）
- [ ] **`--color-chart-*` 仅用于 ECharts series**（line/bar/pie fill）。表格文字、标签、徽章等 UI 内容严禁使用 `--color-chart-*`，改用 `--color-aux-*`
- [ ] 价格涨跌只用 `--color-price-up` / `--color-price-down`
- [ ] 系统反馈只用 `--color-status-*`

### 0.2 Card / Panel
- [ ] **卡片默认严禁有 border**。背景用 `--color-bg-surface`，靠背景色区分层级，不加任何描边
- [ ] Panel header 结构：`display:flex; flex-direction:row; align-items:flex-start; justify-content:space-between`。title + subtitle 包在左侧 `<div>` 里，右侧放控件
- [ ] Panel title ↔ subtitle 间距 `margin-top: 4px`（垂直排列，subtitle 在下）
- [ ] 所有卡片网格容器必须设置 `align-items: start`，防止短卡片被拉伸产生底部空白
- [ ] 页面内容区 bottom padding 必须为 `24px`，不得使用更大的值

### 0.3 Table（card 内嵌）
- [ ] 使用 `<table class="table-dense">` 结构，不得用 div + grid 模拟表格
- [ ] 数据列全部 `width: 1px`（shrink-to-content），**最后一列**加 `<th/td class="col-fill">` 吸收剩余空间
- [ ] **所有数据列左对齐**（不设 `text-align:right`）；`col-fill` 放末尾，右侧自然留空
- [ ] 分割线加在 `tbody tr` 上（`border-bottom`），不得加在 `td` 上
- [ ] card 内嵌表格：`tr` 分割线，无斑马纹；全页列表：斑马纹，无 `tr` 分割线

### 0.4 Segment Tab
以下数值必须精确，不得修改：
```css
.seg-tabs {
  height: 24px;       /* 容器高度 — 固定值 */
  padding: 2px;       /* 容器内边距 — 固定值 */
  gap: 4px;           /* 选项间距 — 固定值，不得为 0 */
  border: 1px solid var(--color-divider-level2);
  border-radius: 4px;
}
.seg-tab {
  height: 20px;       /* 选项高度 — 固定值 */
  padding: 0 8px;
  font-size: 12px;    /* 不得用 11px 或其他值 */
  font-weight: 500;   /* 所有状态统一 500，不得用 400 或 600 */
  line-height: 16px;
  border-radius: 4px;
}
```

### 0.5 ECharts Grid
```js
// 所有 ECharts 图表必须使用以下 grid 配置
grid: { top: 10, right: 0, bottom: 36, left: 0, containLabel: true }
// 禁止设置 grid.left 为像素值（如 46px）——会与卡片 padding 叠加产生过大间距
// 禁止手动设置 yAxis axisLabel.align —— ECharts 默认值已经正确
```

### 0.6 Pill Tab（页面级）
- [ ] 无 border / stroke；选中态背景 `--color-button-black-default`

### 0.7 Panel Header with Segment Tab（完整结构）
```html
<!-- ✅ 正确结构 -->
<div class="panel-header">
  <div>
    <div class="panel-title">图表标题</div>
    <div class="panel-sub">副标题描述</div>
  </div>
  <div class="seg-tabs">
    <div class="seg-tab active">1M</div>
    <div class="seg-tab">3M</div>
  </div>
</div>

<!-- ❌ 错误：title 和 subtitle 直接作为 panel-header 的子节点 -->
<div class="panel-header">
  <div class="panel-title">...</div>   <!-- ❌ 会变成左右排列 -->
  <div class="panel-sub">...</div>
</div>
```

### 0.8 Hover
- [ ] **只有真正可交互的元素才加 hover 态**，纯展示内容 MUST NOT 添加 hover 反馈
- [ ] 所有 hover 状态必须使用 `transition: all 150ms ease-out`
- [ ] 可点击元素 hover 时 `cursor: pointer`；静态内容 MUST NOT 使用 `pointer`
- [ ] 卡片 hover — 深色模式：叠加 `--color-interaction-hover` overlay；浅色模式：`box-shadow: inset 0 0 0 1px var(--color-divider-level2)`（背景不变，增加描边）
- [ ] 表格行 hover：整行叠加 `--color-interaction-hover`，使用 `!important` 覆盖斑马纹
- [ ] 颜色一律使用 `--color-interaction-hover` / `--color-interaction-active`，禁止硬写 hex

---

# Part I — Design Tokens

## 1. Color System

All colors must use CSS custom properties from the AInvest Design System. Never hardcode hex values in component styles — always reference a token variable.

### CSS Variable Block

Paste this block verbatim into every generated HTML `<style>`:

```css
:root {
  --color-brand-primary: #165DFF;
  --color-button-brand-default: #165DFF;
  --color-button-brand-press: #1454E5;
  --color-button-brand-disabled: rgba(22,93,255,0.3);
  --color-button-brand-text: #FFFFFF;
  --color-button-black-default: #000000;
  --color-button-black-text: #FFFFFF;
  --color-button-grey-default: rgba(0,0,0,0.05);
  --color-button-grey-text: #000000;
  --color-price-up: #009B67;
  --color-price-down: #FF381A;
  --color-price-neutral: #000000;
  --color-status-success: #009B67;
  --color-status-error: #FF381A;
  --color-status-warning: #FFAA00;
  --color-status-info: #165DFF;
  --color-text-primary: rgba(0,0,0,1);
  --color-text-secondary: rgba(0,0,0,0.6);
  --color-text-tertiary: rgba(0,0,0,0.4);
  --color-text-quaternary: rgba(0,0,0,0.2);
  --color-text-special: rgba(0,0,0,0.8);
  --color-text-inverse: #FFFFFF;
  --color-text-link: #165DFF;
  --color-text-aime: #165DFF;
  --color-mask-level1: rgba(0,0,0,0.8);
  --color-mask-level2: rgba(0,0,0,0.6);
  --color-mask-level3: rgba(0,0,0,0.2);
  --color-bg-page: #FFFFFF;
  --color-bg-surface: #FFFFFF;
  --color-bg-weak: rgba(0,0,0,0.05);
  --color-bg-nav: #FFFFFF;
  --color-divider-level1: rgba(0,0,0,0.2);
  --color-divider-level2: rgba(0,0,0,0.1);
  --color-divider-level3: rgba(0,0,0,0.05);
  --color-border-default: rgba(0,0,0,0.2);
  --color-pattern-zebra: #FAFAFA;
  --color-aux-blue: #165DFF;
  --color-aux-green: #009B67;
  --color-aux-red: #FF381A;
  --color-aux-orange: #FF6600;
  --color-aux-yellow: #FFAA00;
  --color-aux-cyan: #00CCCC;
  --color-aux-indigo: #4433FF;
  --color-aux-purple: #B34D9D;
  --color-aux-gold: #CCA570;
  --color-alpha-blue: rgba(22,93,255,0.1);
  --color-alpha-green: rgba(0,155,103,0.1);
  --color-alpha-red: rgba(255,56,26,0.1);
  --color-alpha-orange: rgba(255,102,0,0.1);
  --color-alpha-yellow: rgba(250,170,0,0.1);
  --color-alpha-cyan: rgba(0,204,204,0.1);
  --color-alpha-indigo: rgba(68,51,255,0.1);
  --color-alpha-purple: rgba(179,77,157,0.1);
  --color-alpha-gold: rgba(204,165,112,0.1);
  --color-ramp-blue: #E6E9FA;
  --color-ramp-cyan: #E4EFF7;
  --color-ramp-green: #ECF0E6;
  --color-ramp-purple: #EEEBFA;
  --color-ramp-amber: #FAF1E6;
  --color-chart-primary: #265FFC;
  --color-chart-01: #3B80FF;
  --color-chart-02: #F564B0;
  --color-chart-03: #735DD6;
  --color-chart-04: #00CCCC;
  --color-chart-05: #273D8F;
  --color-chart-06: #FF7040;
  --color-chart-07: #9EA5C7;
  --color-chart-08: #808080;
  --color-interaction-hover: rgba(0,0,0,0.05);
  --color-interaction-active: rgba(0,0,0,0.1);
}

[data-theme="dark"] {
  --color-brand-primary: #3371FF;
  --color-button-brand-default: #3371FF;
  --color-button-brand-press: #2E66E5;
  --color-button-brand-disabled: rgba(51,113,255,0.3);
  --color-button-black-default: #FFFFFF;
  --color-button-black-text: #000000;
  --color-button-grey-default: rgba(255,255,255,0.2);
  --color-button-grey-text: #FFFFFF;
  --color-price-up: #00A36D;
  --color-price-down: #FF4A2E;
  --color-price-neutral: #FFFFFF;
  --color-status-success: #00A36D;
  --color-status-error: #FF4A2E;
  --color-status-warning: #FFB114;
  --color-status-info: #3371FF;
  --color-text-primary: rgba(255,255,255,1);
  --color-text-secondary: rgba(255,255,255,0.6);
  --color-text-tertiary: rgba(255,255,255,0.4);
  --color-text-quaternary: rgba(255,255,255,0.2);
  --color-text-special: rgba(255,255,255,0.8);
  --color-text-inverse: #FFFFFF;
  --color-text-link: #3371FF;
  --color-text-aime: #8BAEFF;
  --color-bg-page: #0D0D0D;
  --color-bg-surface: #1A1A1A;
  --color-bg-weak: rgba(255,255,255,0.2);
  --color-bg-nav: #171717;
  --color-divider-level1: rgba(255,255,255,0.22);
  --color-divider-level2: rgba(255,255,255,0.12);
  --color-divider-level3: rgba(255,255,255,0.07);
  --color-border-default: rgba(255,255,255,0.22);
  --color-pattern-zebra: #1A1A1A;
  --color-interaction-hover: rgba(255,255,255,0.1);
  --color-interaction-active: rgba(255,255,255,0.2);
  --color-ramp-blue: #111839;
  --color-ramp-cyan: #11222E;
  --color-ramp-green: #1B240E;
  --color-ramp-purple: #211B38;
  --color-ramp-amber: #292014;
  /* chart / aux / alpha tokens are mode-invariant — no override needed */
}
```

### Token Usage Rules

| Category | When to use |
|---|---|
| `--color-price-*` | Financial data only: price, return, P&L. Never for system feedback. |
| `--color-status-*` | System feedback only: alerts, form validation, API errors. Never for price data. |
| `--color-chart-*` | **ECharts series colors ONLY** — line/bar/pie/area fill. NEVER use for table cell text, labels, badges, or any UI text outside of chart series. |
| `--color-aux-*` | Highlighted data values in tables/lists (e.g. Dark Pool vol, special metrics), tags, labels, badges. Use instead of `--color-chart-*` for any non-chart content. |
| `--color-alpha-*` | Tinted backgrounds (hover state, selected row, badge bg). |
| `--color-interaction-hover` | Hover overlay for all interactive elements (cards, rows, tabs, icons, buttons). |
| `--color-interaction-active` | Press/active overlay, stronger than hover. Also used for image hover masks. |
| `--color-bg-page` | Page background only. Light mode MUST be `#FFFFFF`, never gray. |
| `--color-bg-surface` | Card / panel background. |
| `--color-bg-nav` | Top nav and sidebar background. |
| `--color-gray-*` | **NEVER use directly.** Use semantic tokens instead. |

---

## 2. Spacing System

Spacing encodes belonging. Tight spacing = strong grouping. Apply the proximity principle consistently.

| Context | Value |
|---|---|
| Label ↔ Value (within a stat pair) | 4px |
| Items within the same data group | 4px – 8px |
| **Card / panel title ↔ subtitle / description** | **4px** |
| Card internal padding | 12px |
| Gap between cards — both horizontal and vertical | **6px** |
| Gap between page sections / floor rows | **16px** |
| **Floor / section title ↔ first card row** | **8px** |
| Card border-radius | **6px** |

**Card gap rule:** All grid gaps between cards must be 6px — both row-gap and column-gap. Use `gap: 6px` on every grid container that holds cards.

**Floor title spacing rule:** When a section title (16px/600) precedes a grid of cards, the margin between the title and the first card row must be **8px**.

**Page bottom padding rule:** Content wrapper bottom padding MUST be **24px** — not 48px or larger. Excessive bottom padding creates a visually empty band at the page bottom that has no layout meaning.

**Card grid stretch rule:** All card grid containers (`grid-3`, `grid-main`, etc.) MUST set `align-items: start`. This prevents shorter cards from being stretched to match the tallest sibling, which creates large empty areas inside cards with less content.

```css
.grid-3   { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; align-items: start; }
.grid-main { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 6px; align-items: start; }
```

**Rule:** Never use spacing > 16px inside a card. Extra whitespace inside a card signals a layout problem, not breathing room.

---

## 3. Typography

### Font Family

**Plus Jakarta Sans** — load via Google Fonts CDN in every generated HTML:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet">
```

```css
body { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif; }
```

Only load weights 400 / 500 / 600. **Weight 700 is prohibited** — never use `font-weight: 700` or `bold` anywhere in the output.

### Scale

| Role | Size | Weight | Color token |
|---|---|---|---|
| **Key metric / stat number** | **18px** | **600** | `--color-text-primary` |
| **Section / floor title** | **16px** | **600** | `--color-text-primary` |
| **Emphasized value / data** | **14px** | **600** | `--color-text-primary` |
| Card title | 14px | 500 | `--color-text-secondary` |
| Body text | 12px | 400 | `--color-text-secondary` |
| Label / description | 12px | 400 | `--color-text-secondary` |
| Aux / timestamp / unit | 10px | 400 | `--color-text-tertiary` |

```css
.stat-label  { font-size: 10px; font-weight: 400; color: var(--color-text-tertiary); }
.stat-hero   { font-size: 18px; font-weight: 600; color: var(--color-text-primary); }
.stat-emph   { font-size: 14px; font-weight: 600; color: var(--color-text-primary); }
.stat-value  { font-size: 12px; font-weight: 400; color: var(--color-text-primary); }
```

---

# Part II — Layout

## 4. Page Layout Grid

默认布局**不包含左侧 Sidebar**。仅当用户明确描述需要侧边栏时，才加入 Sidebar 结构。

### 默认布局（无 Sidebar）

```
┌──────────────────────────────────────────┐
│  Top nav  (height: 44px max)             │
├──────────────────────────────────────────┤
│  Content area  (max-width: 1560px)       │
│  ┌──────────────────────────────────────┐│
│  │ Symbol header                        ││
│  ├──────────────────────────────────────┤│
│  │ Stat row  (4–5 col grid)             ││
│  ├──────────────────────────────────────┤│
│  │ Chart / multi-section  (2–3 col grid)││
│  ├──────────────────────────────────────┤│
│  │ Tables / primary charts  (full width)││
│  └──────────────────────────────────────┘│
└──────────────────────────────────────────┘
```

### 带 Sidebar 布局（仅用户明确要求时使用）

```
┌─────────────────────────────────────────┐
│  Top nav  (height: 44px max)            │
├──────────┬──────────────────────────────┤
│ Sidebar  │  Content area  (max 1560px)  │
│ 200–220px│  ┌──────────────────────────┐│
│          │  │ Symbol header            ││
│          │  ├──────────────────────────┤│
│          │  │ Stat row  (4–5 col grid) ││
│          │  ├──────────────────────────┤│
│          │  │ Chart / multi-section    ││
│          │  │ (2–3 col grid)           ││
│          │  ├──────────────────────────┤│
│          │  │ Tables / primary charts  ││
│          │  │ (full width)             ││
│          │  └──────────────────────────┘│
└──────────┴──────────────────────────────┘
```

- Sidebar 宽度：200–220px，固定宽度

### 通用规则

- **Content area max-width:** 1560px
- **Top nav height:** 44px max
- **Stat cards row:** 4–5 columns
- **Chart / feature cards:** 2–3 column grid
- **Tables / primary charts:** full width acceptable

---

## 5. Card & Panel Rules

### Card Basics

```css
/* ✅ Correct — no border, background separation only */
.card { background: var(--color-bg-surface); border-radius: 6px; padding: 12px; }

/* ❌ Wrong — border not allowed on default state */
.card { background: var(--color-bg-surface); border: 1px solid var(--color-divider-level2); border-radius: 6px; }
```

- Cards MUST NOT have a border in their default state
- All cards use `border-radius: 6px`
- Single-module pages: do NOT wrap content in a card container

### Card-Internal Stat Pair Layout

| Stat pairs | Internal grid |
|---|---|
| 1–3 | `flex` row, equal width |
| 4–5 | `grid, 2 columns`, gap: 8px row / 12px col |
| **6+** | **`grid, 3 columns`**, gap: 8px row / 12px col |

### Panel Header Layout

```html
<div class="panel-header">
  <div>
    <div class="panel-title">Chart Title</div>
    <div class="panel-sub">Subtitle · description</div>  <!-- margin-top: 4px -->
  </div>
  <div class="seg-tabs"><!-- optional right-side controls --></div>
</div>
```

```css
.panel-header {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 10px;
}
.panel-title { font-size: 14px; font-weight: 500; color: var(--color-text-secondary); }
.panel-sub   { font-size: 10px; font-weight: 400; color: var(--color-text-tertiary); margin-top: 4px; }
.floor-title { font-size: 16px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 8px; }
```

NEVER put title and subtitle as direct siblings of `.panel-header` — they would appear left/right instead of stacked.

---

# Part III — Components

## 6. Table

### Table Class Selection

| Class | Columns | Width behavior |
|---|---|---|
| `.table-dense` | 6+ | `width: 100%`, columns fill container |
| `.table-sparse` | ≤ 5 | `width: auto`, columns size to content |

### Zebra vs Divider

| Context | Row separation |
|---|---|
| **Full-page stock list** | **Zebra** — odd rows transparent, even rows `--color-pattern-zebra`. MUST NOT use `border-bottom` on td. |
| **Card-embedded table** | **Row dividers** — `border-bottom` on `tbody tr`. MUST NOT use zebra. |

### Column Width Rule

- All data cells are **left-aligned** with `padding: 5px 8px`
- Use `width: 1px` on every data column (shrink-to-content)
- Add `<th/td class="col-fill">` as the **LAST column** to absorb remaining space
- NEVER place `.col-fill` between data columns

### CSS Templates

```css
/* ─── Dense table (6+ columns) ─────────────────── */
.table-dense {
  width: 100%;
  table-layout: auto;
  border-collapse: collapse;
  font-size: 12px;
}
.table-dense th {
  font-size: 10px; font-weight: 500; color: var(--color-text-tertiary);
  text-align: left; padding: 4px 8px;
  border-bottom: 1px solid var(--color-divider-level2);
  white-space: nowrap; cursor: pointer; user-select: none;
}
.table-dense td {
  padding: 5px 8px;
  color: var(--color-text-primary); white-space: nowrap;
}
.table-dense th, .table-dense td { width: 1px; }
.table-dense th.col-fill, .table-dense td.col-fill { width: auto; }
.table-dense tbody tr         { border-bottom: 1px solid var(--color-divider-level3); }
.table-dense tbody tr:last-child { border-bottom: none; }

/* ─── Sparse table (≤5 columns) ────────────────── */
.table-sparse {
  width: auto;
  table-layout: auto;
  border-collapse: collapse;
  font-size: 12px;
}
.table-sparse th {
  font-size: 10px; font-weight: 500; color: var(--color-text-tertiary);
  text-align: left; padding: 4px 8px;
  border-bottom: 1px solid var(--color-divider-level2);
  white-space: nowrap; cursor: pointer; user-select: none;
}
.table-sparse td {
  padding: 5px 8px;
  color: var(--color-text-primary); white-space: nowrap;
}

/* ─── Full-page list: zebra, no dividers ────────── */
.table-zebra tr:nth-child(odd)  td { background: transparent; }
.table-zebra tr:nth-child(even) td { background: var(--color-pattern-zebra); }

/* ─── Shared modifiers ──────────────────────────── */
.table-dense tr:hover td,
.table-sparse tr:hover td  { background: var(--color-interaction-hover) !important; cursor: pointer; }
.table-dense th:hover,
.table-sparse th:hover     { color: var(--color-text-secondary); }
.num  { text-align: right; font-variant-numeric: tabular-nums; }
.up   { color: var(--color-price-up); }
.down { color: var(--color-price-down); }
```

### Column Gap

| Column type | `padding-right` |
|---|---|
| Date | 16px |
| Name / Firm / Symbol | 24px |
| Numeric (price, value) | 12px |
| Last column | 0 |

---

## 7. Stock List Row

### Measurements

| Element | Value |
|---|---|
| Row height | 28px |
| Logo size | 16×16px, border-radius: 50% |
| Row left edge → Logo | 12px |
| Logo → Ticker | 8px |
| Ticker → Full name | 8px |

### Typography

| Content | Size | Weight |
|---|---|---|
| Ticker symbol | 12px | 600 |
| Company full name | 12px | 400 |
| All data columns | 12px | 400 |

### Markup & CSS

```html
<td class="stock-list-id">
  <img src="logo.png" width="16" height="16" style="border-radius:50%;flex-shrink:0">
  <span class="ticker">GM</span>
  <span class="fullname">General Motors Company</span>
</td>
```

```css
.stock-list-id {
  display: flex; align-items: center; gap: 8px;
  height: 28px; padding-left: 12px; white-space: nowrap;
}
.ticker   { font-size: 12px; font-weight: 600; color: var(--color-text-primary); }
.fullname { font-size: 12px; font-weight: 400; color: var(--color-text-secondary); }
.stock-list td { padding: 0 12px; height: 28px; white-space: nowrap; }
.stock-list tr:nth-child(odd)  td { background: transparent; }
.stock-list tr:nth-child(even) td { background: var(--color-pattern-zebra); }
.stock-list tr:hover td { background: var(--color-interaction-hover) !important; }
```

---

## 8. Button

### Dimensions

| Property | Value |
|---|---|
| Height | 28px |
| Border-radius | 4px |
| Padding left/right | 8px |
| Font size / line-height / weight | 12px / 16px / 600 |
| Min gap between buttons | 4px |

### Types

| Type | Default bg | Default text | Hover | Use when |
|---|---|---|---|---|
| **Type 1 — Grey** | `--color-button-grey-default` | `--color-button-grey-text` | + `--color-interaction-hover` overlay | Primary / functional actions |
| **Type 2 — Stroke** | transparent | `--color-text-primary` | + `--color-interaction-hover` overlay, border keeps | Secondary / cancel |
| **Type 3 — Brand Blue** | `--color-text-aime` | `--color-button-brand-text` | + `--color-interaction-hover` overlay | Paid / trade actions |

### Rules
- MUST NOT use `border-radius: 9999px` (pill shape)
- MUST NOT place two Type 1 buttons in the same action group
- Height MUST be exactly 28px

---

## 9. Tab Components

### 9a. Line Tab

Use only when a page needs ≥ 3 tab tiers. For 1–2 tier pages, use pill-tab instead.

| Property | Value |
|---|---|
| Container height | 26px |
| Font size / line-height | 12px / 16px |
| Font weight — active | 600 |
| Font weight — inactive / hover | 500 |
| Tab gap | 16px |
| Underline thickness | 2px |

| State | Text color | Underline |
|---|---|---|
| Active | `--color-text-primary` | `--color-text-primary`, 2px |
| Inactive | `--color-text-primary` | none |
| Hover (inactive) | `--color-text-secondary` | none — MUST NOT add underline on hover |

```css
.line-tabs { display: flex; align-items: flex-end; gap: 16px; height: 26px; overflow: hidden; }
.line-tab {
  font-size: 12px; line-height: 16px; font-weight: 500;
  color: var(--color-text-primary); cursor: pointer;
  padding-bottom: 4px; border-bottom: 2px solid transparent;
  white-space: nowrap; user-select: none;
  transition: all 150ms ease-out;
}
.line-tab:hover  { color: var(--color-text-secondary); }
.line-tab.active { font-weight: 600; border-bottom-color: var(--color-text-primary); }
```

---

### 9b. Pill Tab — Page Level

Default top in-page tab row. For page-level switching (1–2 tab tiers).

| Property | Value |
|---|---|
| Container height | 24px |
| Option border-radius | 4px |
| Gap between options | 4px |
| Font size / weight | 12px / 500 (all states) |

| State | Background | Text | Stroke |
|---|---|---|---|
| Selected | `--color-button-black-default` | `--color-button-black-text` | none |
| Unselected | `--color-button-grey-default` | `--color-button-grey-text` | none |
| Hover (unselected) | grey + `--color-interaction-hover` | unchanged | none |

```css
.pill-tabs-page { display: flex; align-items: center; gap: 4px; height: 24px; overflow: hidden; }
.pill-tab-page {
  height: 24px; padding: 0 8px; border-radius: 4px; border: none;
  background: var(--color-button-grey-default); color: var(--color-button-grey-text);
  font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap;
  transition: all 150ms ease-out;
}
.pill-tab-page:hover:not(.active) {
  background: color-mix(in srgb, var(--color-button-grey-default), var(--color-interaction-hover));
}
.pill-tab-page.active { background: var(--color-button-black-default); color: var(--color-button-black-text); }
```

---

### 9c. Pill Tab — Module Level

Module-level switcher inside a card. Distinguished from page level by 1px stroke on all states.

| State | Background | Text | Stroke |
|---|---|---|---|
| Selected | `--color-button-grey-default` | `--color-button-grey-text` | `1px --color-divider-level2` |
| Unselected | transparent | `--color-button-grey-text` | `1px --color-divider-level2` |
| Hover | `--color-interaction-hover` (5%) | unchanged | `1px --color-divider-level2` |

```css
.pill-tabs-module { display: flex; align-items: center; gap: 4px; height: 24px; overflow: hidden; }
.pill-tab-module {
  height: 24px; padding: 0 8px; border-radius: 4px;
  border: 1px solid var(--color-divider-level2);
  background: transparent; color: var(--color-button-grey-text);
  font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap;
  transition: all 150ms ease-out;
}
.pill-tab-module:hover:not(.active) { background: var(--color-interaction-hover); }
.pill-tab-module.active { background: var(--color-button-grey-default); }
```

**Page vs Module distinction:**

| Signal | Page level | Module level |
|---|---|---|
| Selected bg | `--color-button-black-default` (black) | `--color-button-grey-default` (grey) |
| Stroke | **none** | **1px on all states** |

---

### 9d. Segment Tab

Dense segmented control inside a single bordered capsule. Module-level only. MUST NOT be used as page-level navigation.

| Property | Value |
|---|---|
| Container height | **24px** |
| Container padding | **2px** |
| Container border | **1px solid `--color-divider-level2`** |
| Container border-radius | **4px** |
| Option height | **20px** |
| Option padding | **0 8px** |
| Gap between options | **4px** |
| Font size / weight | **12px / 500** (all states) |

| State | Background | Text |
|---|---|---|
| Selected | `--color-button-grey-default` | `--color-button-grey-text` |
| Unselected | transparent | `--color-text-primary` |
| Hover (unselected) | `--color-interaction-hover` | `--color-text-primary` |
| Press (unselected) | `--color-interaction-active` | `--color-button-grey-text` |

```css
.seg-tabs {
  display: inline-flex; align-items: center;
  height: 24px; padding: 2px; gap: 4px;
  border: 1px solid var(--color-divider-level2);
  border-radius: 4px; background: transparent;
}
.seg-tab {
  height: 20px; padding: 0 8px; border-radius: 4px; border: none;
  background: transparent; font-size: 12px; line-height: 16px;
  font-weight: 500; color: var(--color-text-primary);
  cursor: pointer; white-space: nowrap; font-family: inherit;
  display: flex; align-items: center;
  transition: all 150ms ease-out;
}
.seg-tab:hover:not(.active) { background: var(--color-interaction-hover); }
.seg-tab:active:not(.active) { background: var(--color-interaction-active); color: var(--color-button-grey-text); }
.seg-tab.active { background: var(--color-button-grey-default); color: var(--color-button-grey-text); }
```

---

## 10. Dropdown Menu

### Container

```
border-radius:   10px
background:      var(--color-bg-overlay)
border:          1px solid var(--color-divider-level2)
padding:         8px 0
min-width:       120px / max-width: 300px / max-height: 400px
gap to trigger:  4px
```

### Option Row

| Element | Size | Weight | Color |
|---|---|---|---|
| Option label | 12px | 400 | `--color-text-primary` |
| Description | 11px | 400 | `--color-text-tertiary` |
| Group header | 11px | 400 | `--color-text-tertiary` |

### Interaction States

```
row hover:    var(--color-interaction-hover) overlay
row press:    var(--color-interaction-active) overlay
row disabled: text --color-text-quaternary, pointer-events: none, no hover
```

### Spacing

```
panel left/right padding:   16px
group header margin:        8px top / 8px bottom
row-to-row vertical gap:    8px
```

### Checkbox / Radio

| Control | Size | Checked bg | Checked icon color |
|---|---|---|---|
| Checkbox | 16×16px, 4px radius | `--color-text-primary` | `--color-bg-page` |
| Radio | 16×16px, circle | `--color-text-primary` | `--color-bg-page` inner dot 6px |

> ⚠️ MUST use `--color-bg-page` for checkmark/dot — NOT `--color-bg-layer1`.

### Rules
- MUST use `border-radius: 10px`
- Checkbox for multi-select; Radio for single-select — MUST NOT mix

---

## 11. Pagination

| Property | Value |
|---|---|
| Button size | 24×24px |
| Button border-radius | 4px |
| Gap between buttons | 4px |
| Font | 12px / 16px / 400 |

| State | Background | Text | Border |
|---|---|---|---|
| Default | transparent | `--color-text-primary` | `--color-divider-level2` |
| Hover | `--color-interaction-hover` | `--color-text-primary` | `--color-divider-level2` |
| Active (current) | `--color-button-black-default` | `--color-button-black-text` | — |
| Disabled | transparent | `--color-text-quaternary` | `--color-divider-level2` |

- Hide entirely when total pages = 1
- Mobile (≤ 500px): replace with "展示更多" text button

---

## 12. Breadcrumb

### When to Use
- **MUST**: page depth ≥ L3, or drill-down flow
- **SHOULD**: L2 page where parent context helps
- **NEVER**: L1 top-level pages, Modal/drawer, mobile native-gesture pages

### Spec

| Property | Value |
|---|---|
| Font | 12px / 400 / 16px line-height (all nodes uniform) |
| Separator | `/` only — never `>`, `»`, `→`, SVG arrows |
| Separator gap | 4px on each side |
| Overflow | Keep root + current; fold middle nodes to `...` |

### Colors

| Element | State | Token |
|---|---|---|
| Parent node (clickable) | Default | `--color-text-primary` |
| Parent node (clickable) | Hover | `--color-text-secondary` |
| Current page (not clickable) | — | `--color-text-quaternary` |
| Separator `/` | — | `--color-text-quaternary` |

> Current page MUST be the lightest (quaternary). NEVER make current page bold or dark.

---

# Part IV — Interaction

## 13. Hover System

### 13.1 Pre-condition (Mandatory)

Before adding any hover style, ask: **does clicking this element trigger a real action?**

- If **yes** (navigate, open, expand, toggle, trigger modal, etc.) → add hover
- If **no** (pure display content) → MUST NOT add hover feedback

```
Priority: Component's own spec > hover.md > other rules
```

### 13.2 Cursor Rule

| Element | Cursor |
|---|---|
| All clickable / interactive elements | `cursor: pointer` |
| Static / display content | `cursor: default` (never `pointer`) |

### 13.3 Transition (Mandatory)

All hover state changes MUST use smooth transition — no hard cuts.

```css
/* Apply to every interactive element */
transition: all 150ms ease-out;
/* Or scope to specific properties: */
transition: background-color 150ms ease-out, border-color 150ms ease-out, box-shadow 150ms ease-out;
```

### 13.4 Color Tokens

| Token | Value (light) | Value (dark) | Use for |
|---|---|---|---|
| `--color-interaction-hover` | `rgba(0,0,0,0.05)` | `rgba(255,255,255,0.1)` | Hover overlay for cards, rows, icons, tabs |
| `--color-interaction-active` | `rgba(0,0,0,0.1)` | `rgba(255,255,255,0.2)` | Press/active overlay; image hover mask |

NEVER hardcode hex values for hover states. Always use these tokens.

### 13.5 Nested Hover Rule

When hover has a nesting relationship (outer card is hoverable, inner item is also hoverable):
- Hovering inner item: **outer hover persists**, inner item's hover **overlays on top**
- Mouse leaves inner item but stays on outer: only outer hover remains

### 13.6 Card Hover

填充卡片的 hover 行为根据深浅模式**差异化处理**：

| Mode | Normal | Hover | Rationale |
|---|---|---|---|
| **Dark mode** | `--color-bg-surface` (dark bg) | Overlay `--color-interaction-hover` on top of bg | White 10% overlay creates visible lightening effect |
| **Light mode** | `--color-bg-surface` (white bg) | Background unchanged + `box-shadow: inset 0 0 0 1px var(--color-divider-level2)` | 5% black overlay on white is imperceptible; border provides clear feedback |

```css
/* Light mode (default) — add inset border on hover */
.card { transition: box-shadow 150ms ease-out; cursor: pointer; }
.card:hover { box-shadow: inset 0 0 0 1px var(--color-divider-level2); }

/* Dark mode — overlay lightening */
[data-theme="dark"] .card:hover {
  background: color-mix(in srgb, var(--color-bg-surface) 100%, var(--color-interaction-hover));
  box-shadow: none;
}
```

> ⚠️ 浅色模式 hover 时出现的描边是**临时交互态**，不违反"default 状态卡片无 border"规则。

### 13.7 Table Row Hover

```css
.table-dense tr:hover td,
.table-sparse tr:hover td {
  background: var(--color-interaction-hover) !important; /* overrides zebra */
  cursor: pointer;
}
```

### 13.8 Text Hover

| Text type | Hover style |
|---|---|
| Primary text (clickable, `--color-text-primary`) | Add underline; color unchanged |
| Secondary text (clickable, `--color-text-secondary`) | Elevate to `--color-text-primary`; underline optional |

- Underline color MUST match text color
- MUST NOT use both color change + background change simultaneously

### 13.9 Icon Hover

| Icon role | Hover style |
|---|---|
| Icon as button (standalone, no container) | Add rectangular bg, `border-radius: 6px`, fill `--color-interaction-hover` |
| Toggle icon (e.g. star ☆ → ★) | Preview the selected state color on hover (e.g. grey outline → yellow outline) |

```css
.icon-btn {
  border-radius: 6px;
  transition: background 150ms ease-out;
  cursor: pointer;
}
.icon-btn:hover { background: var(--color-interaction-hover); }
```

### 13.10 Image Hover

```css
.img-clickable { position: relative; cursor: pointer; overflow: hidden; }
.img-clickable::after {
  content: '';
  position: absolute; inset: 0;
  background: transparent;
  transition: background 150ms ease-out;
}
.img-clickable:hover::after {
  background: var(--color-interaction-active); /* rgba black/white 10% */
}
```

- Image hover mask is **mode-invariant**: same overlay in both light and dark
- MUST NOT use `transform: scale` or brightness as the sole hover feedback

### 13.11 Do / Don't Summary

| | Rule |
|---|---|
| ✅ | Only add hover to elements with real click behavior |
| ✅ | `cursor: pointer` on all interactive elements |
| ✅ | `transition: all 150ms ease-out` on every hover element |
| ✅ | Use `--color-interaction-hover` / `--color-interaction-active` tokens only |
| ✅ | Light mode card hover → inset border; dark mode → overlay |
| ✅ | Nested hover: outer persists, inner overlays on top |
| ❌ | NEVER add hover to pure display content |
| ❌ | NEVER hardcode hex for hover colors |
| ❌ | NEVER use 0ms hard-cut hover transitions |
| ❌ | NEVER apply hover effects on mobile (touch devices) |
| ❌ | NEVER replace color with solid fill — always use overlay |

---

## 14. Interactivity Requirements

Every generated page must include all of the following:

| Feature | Implementation |
|---|---|
| **Theme toggle** | `data-theme="dark"` on `<html>`, button toggles to `"light"`. Re-init all ECharts on toggle. |
| **Tab switching** | Pure JS class toggle. No page reload. |
| **Chart tooltips** | ECharts built-in. Style with surface/border tokens. |
| **Table column sort** | Click `<th>` to sort asc/desc. Numeric and string-aware. |
| **Modal / drawer** | At least one actionable modal (e.g., trade, detail, filter). |
| **Live data simulation** | `setInterval` (600–1000ms) to update at least one live metric and add rows to a live feed table. |

---

# Part V — Charts

## 15. Chart Library (ECharts)

- **Use ECharts** (CDN: `https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js`)
- **Do not use** Chart.js, D3, or Recharts
- All chart colors must reference `--color-chart-*` CSS variables via `getComputedStyle`
- `backgroundColor: 'transparent'` on every chart instance
- Re-initialize (dispose + re-init) all charts on theme toggle

### Grid Rule

`bottom` 值根据图表高度分两档，避免小图表底部出现过多空白：

| 图表高度 | `bottom` 值 | 说明 |
|---|---|---|
| **≥ 300px**（主图、大图） | `36` | 标准值，留足 x 轴标签空间 |
| **< 300px**（小图，如 220px 卡片图） | `24` | 减小底部预留，防止轴标签区过大导致底部空白 |

```js
// 主图（高度 ≥ 300px）
grid: { top: 10, right: 0, bottom: 36, left: 0, containLabel: true }

// 小图（高度 < 300px，如卡片内 220px 图表）
grid: { top: 10, right: 0, bottom: 24, left: 0, containLabel: true }
```

- `containLabel: true` — axis labels included within grid bounds
- `left: 0 / right: 0` — card padding provides the 12px gap
- MUST NOT set pixel values for `grid.left` (e.g., `46px`) — doubles spacing
- MUST NOT set `axisLabel.align` on yAxis — ECharts defaults are correct

```js
// ❌ Never do this
grid: { top: 10, right: 16, bottom: 40, left: 46 }      // gap = 12px + 46px = 58px
yAxis: { axisLabel: { align: 'left' } }                  // pushes labels INTO chart area
```

---

# Part VI — Data

## 16. Mock Data Architecture

Centralize all mock data in a single `DATA` object at the top of `<script>`:

```js
const DATA = {
  symbol: 'AAPL',
  price: { current: 189.50, change: 1.24, changePct: 0.66, open: 188.26, prevClose: 188.26, high52w: 199.62, low52w: 164.08 },
  volume: { today: 58_234_100, avg30d: 55_100_000 },
  options: { callVolume: 124_500, putVolume: 98_200, pcRatio: 0.79, impliedVolatility: 0.284, ivRank: 42, hv30d: 0.241 },
};
```

### Live Simulation Rule

For `setInterval`, **do NOT call full `render()`** — patch DOM cells directly:

```js
setInterval(() => {
  document.querySelectorAll('#tbody tr').forEach(tr => {
    const ticker = tr.querySelector('.stock-ticker')?.textContent;
    const d = DATA.find(x => x.t === ticker);
    if (!d) return;
    d.p = Math.max(0.01, d.p * (1 + (Math.random() - 0.5) * 0.02));
    const cells = tr.querySelectorAll('td');
    if (cells[1]) cells[1].textContent = '$' + d.p.toFixed(2);
  });
}, 800);
```

Full `render()` is only called on user actions (sort, page change, filter).

---

# Part VII — Quality

## 17. Anti-Patterns — Never Do These

**#1 — Sparse full-width card:** Single card spanning all columns with 1–2 data points.

**#2 — One card per data point:** Six cards for six peer metrics that belong in one grouped card.

**#3 — Oversized header:** Top nav + symbol header together exceeding 15% viewport height.

**#4 — Nested cards:** Card inside a card. Use dividers or spacing to group instead.

**#5 — Decorative empty space:** Padding > 16px inside a card.

**#6 — 14px values in multi-stat cards:** Using `14px` for all values in a 4+ stat card. Use 12px; reserve 14px for single hero metric.

**#7 — Sparse table stretched full width:** `width: 100%` on a ≤5 column table. Use `.table-sparse`.

**#8 — Single generic table class:** One `.table { width: 100% }` for all tables. Always use `.table-dense` vs `.table-sparse`.

**#9 — Hover on display content:** Adding `cursor: pointer` or hover background to non-interactive elements. Sends false "clickable" signal to users.

**#10 — Hard-cut hover transitions:** `transition: none` or 0ms. All hover must use `150ms ease-out`.

---

## 18. Output Checklist

Before finalizing output, verify:

**Tokens & Typography**
- [ ] Plus Jakarta Sans loaded (weights 400/500/600 only); no `font-weight: 700`
- [ ] All colors use `--color-*` CSS variables — no raw hex in component styles
- [ ] `--color-bg-page` light = `#FFFFFF` (not gray)
- [ ] `--color-price-*` only for financial data; `--color-status-*` only for system feedback
- [ ] `--color-chart-*` only for ECharts series; `--color-aux-*` for UI content highlights
- [ ] Hero metric: 18px/600, max 1 per card; Emphasized: 14px/600; Body: 12px/400

**Layout & Cards**
- [ ] Top nav ≤ 44px; header block ≤ 15% vh
- [ ] Stat cards row: 4–5 columns; gap: 6px
- [ ] All cards: `border-radius: 6px`, no default border
- [ ] Cards with 6+ peer stats use 3-column internal grid
- [ ] Panel header: row flex, title+sub in wrapper div, subtitle `margin-top: 4px`
- [ ] Floor titles: 16px/600, `margin-bottom: 8px`

**Components**
- [ ] `.table-dense` for 6+ columns; `.table-sparse` for ≤5 columns
- [ ] Card-embedded tables: `tr` border-bottom, no zebra; `col-fill` as last column
- [ ] Segment tab: height 24px, padding 2px, gap 4px, font 12px/500
- [ ] Pill tab page: no stroke; Pill tab module: 1px stroke all states
- [ ] Line tab hover: text to secondary, NO underline, NO background

**Hover**
- [ ] Only interactive elements have hover styles
- [ ] All hover uses `transition: all 150ms ease-out`
- [ ] Clickable elements: `cursor: pointer`; static content: no pointer
- [ ] Card hover — light: `inset 0 0 0 1px var(--color-divider-level2)`; dark: `--color-interaction-hover` overlay
- [ ] Table row hover: `--color-interaction-hover !important`
- [ ] No hardcoded hex for hover colors

**Charts & Data**
- [ ] ECharts grid: `{ top:10, right:0, bottom:36, left:0, containLabel:true }`
- [ ] No `axisLabel.align` on yAxis
- [ ] `backgroundColor: 'transparent'` on all charts
- [ ] `DATA` object contains all mock values
- [ ] `setInterval` patches DOM directly (no full re-render)

**Interactivity**
- [ ] Theme toggle present, re-inits ECharts
- [ ] At least one `setInterval` live feed
- [ ] At least one interactive modal
- [ ] Table columns sortable
