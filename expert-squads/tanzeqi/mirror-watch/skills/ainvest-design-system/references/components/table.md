# Guidelines — table

> **Component Spec:** `ainvest-design-system/references/components/table.md`

---

## 0. Document Role

This document covers **when and how to use** the table (通用表格) component. It focuses on decisions a designer must make explicitly — visual details handled automatically by the component are omitted.

<!-- - Component import: `@ainvest/table` -->

---

## 1. Definition

Table is a data-display component for presenting **large amounts of structured tabular data** with support for filtering, sorting, pagination, column pinning, sticky headers, and virtual scrolling. Each row represents one record; each column represents one attribute.

It is the correct choice when the user's primary task is **scanning, comparing, and filtering** many records across multiple attributes.

Table supports several feature modes, including a dedicated **Event Calendar** variant (§5.9) for date-grouped data streams.

---

## 2. When to Use

| Condition | Use Table? |
|-----------|-----------|
| Displaying large datasets with many rows (e.g. stock screeners, watchlists, holdings) | YES |
| User needs to sort data by columns | YES |
| User needs to compare the same attribute across many records | YES |
| Data has ≥ 3 attributes per record and attributes benefit from column alignment | YES |
| Data is paginated or fetched in pages from a server | YES |
| Data needs a sticky header while scrolling long lists | YES |
| Data has too many columns to fit in the viewport (horizontal scroll + fixed first column) | YES |
| Data is a time-ordered / date-grouped event feed (earnings calendar, economic calendar) | YES — use **Event Calendar variant** (§5.9) |

### MUST

- MUST use Table when the user needs to scan, sort, or compare many records across aligned columns
- MUST use Table when the dataset is large and requires pagination, virtualization, or infinite scroll to stay performant
- MUST use the Event Calendar variant (§5.9) when data is primarily classified by date (high priority) and grouped per day
- MUST place Pagination directly below the Table when `pagination` is enabled (see `ainvest-design-system/references/components/pagination.md`)

### SHOULD

- SHOULD enable `stickyHeader` (or `enableVirtualization`, which auto-enables sticky) when the list is long enough to scroll past the header
- SHOULD enable `enableVirtualization` for lists ≥ 100 rows to maintain render performance
- SHOULD pin the first column (`initialColumnPinning.left`) ONLY when there are too many data columns to fit and horizontal scroll is required

---

## 3. When NOT to Use

| Condition | Use Table? | Alternative |
|-----------|-----------|-------------|
| Recommendation / card-style lists (e.g. 推荐股单列表 — 3-col or 4-col cards with sparkline + price + change button) | NO | Card list / stock-card component (see §3.1 below) |
| Data has only 1–2 attributes per record | NO | Simple list / Tag list |
| Content is a continuous feed (news, social) | NO | Infinite-scroll feed, not a table |
| Data is a single record with many fields (detail view) | NO | Descriptions / key-value list |
| Showing a short summary inside a card or widget | NO | Summary card / key metrics |
| Mobile narrow viewport (≤ 500px) displaying full table | NO | Mobile stock-list style (see §9) |

### 3.1 Recommendation Stock Lists Are NOT Tables

Ainvest's "推荐股单列表" (3-col / 4-col card-style lists like `标的 + 火花图 + 数据`, `标的 + 火花图 + 数据 + 涨跌按钮`) look tabular but are **card lists**, not tables:

- Each row is a tappable card jumping to the stock detail page
- There is NO sortable header bar, NO pagination, NO column resize, NO sticky header
- Hover fills the whole row and highlights the symbol color
- Arrow direction in the change button matches up/down color

→ **Use the Card list pattern, NOT this Table component.** (See `ainvest-design-system/references/rules/card.md`.)

### MUST NOT

- MUST NOT use Table for recommendation card lists — those are Card lists
- MUST NOT use Table for data with ≤ 2 fields per row
- MUST NOT use Table for continuous feeds (news, comments)
- MUST NOT place Table inside a narrow container (< 500px) without switching to mobile stock-list style
- MUST NOT mix card layouts (rounded borders per row, large paddings) with Table — those are different components

---

## 4. Anatomy

### 4.1 Top-Level Structure (Generic Table)

```
┌──────────────────────────────────────────────────────────────────┐
│ [SearchHeader] [Header-Col] [Header-Col] ...  [Header-Col] [ + ] │   ← Header row (sticks on scroll)
├──────────────────────────────────────────────────────────────────┤
│ [Symbol-Cell]  [Cell]       [Cell]      ...   [Cell]             │
│ [Symbol-Cell]  [Cell]       [Cell]      ...   [Cell]             │   ← odd row: default bg
│ [Symbol-Cell]  [Cell]       [Cell]      ...   [Cell]             │   ← even row: zebra bg (color-pattern-zebra-web)
│ ...                                                              │
├──────────────────────────────────────────────────────────────────┤
│ [Pagination: size selector] [range] [prev] [1 2 3 ...] [next]    │   ← Pagination row
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Top-Level Structure (Event Calendar Variant)

```
┌──────────────────────────────────────────────────────────────────┐
│ [v Thursday Jan 14, 2025]     [Header-Col] [Header-Col] ...      │   ← Date header row (group 1)
├──────────────────────────────────────────────────────────────────┤
│ [Symbol/Event cell]           [Cell] [Cell] ...                  │
│ [Symbol/Event cell]           [Cell] [Cell] ...                  │   ← already-released events
│ ══════════════════════════════════════════════════════════════   │   ← Orange timeline (boundary)
│ [14:30 (orange-bg)] [Event]   [Cell] [Cell] ...                  │   ← first un-released event today
│ [Symbol/Event cell]           [Cell] [Cell] ...                  │
├──────────────────────────────────────────────────────────────────┤
│ [v Thursday Jan 15, 2025]     [Header-Col] [Header-Col] ...      │   ← Date header row (group 2)
├──────────────────────────────────────────────────────────────────┤
│ [Symbol/Event cell]           [Cell] [Cell] ...                  │
│ ...                                                              │
└──────────────────────────────────────────────────────────────────┘
                                     ↓ scroll past bottom → auto-load more
```

No pagination. Infinite scroll. On user scroll-up, the latest **date header row sticks** and covers the old date header.

### 4.3 Parts

| Part | Required | Generic | Event Calendar | Description |
|------|----------|---------|----------------|-------------|
| Header row (standard) | MUST | ✓ | — | Single header bar; sticks to top on scroll |
| Date-group header row | MUST | — | ✓ | First column is a collapsible date (`v Thursday Jan 14, 2025`); other cells are standard data headers |
| Search header (first column) | Optional | ✓ | — | First column header hosting a Search component + expand/collapse dropdown |
| Data header cell | MUST | ✓ | ✓ | Standard header cell; supports sort, alignment, single/double-line title; Event Calendar cells do NOT expose the `more-actions` affordance |
| Header-edit entry (`+`) | Optional | ✓ | — | Right-side floating entry; click opens the column-selection panel |
| First-column cell — **Symbol** | Conditional | ✓ | ✓ | Ticker/avatar/full-name; pinned when horizontal scroll is needed |
| First-column cell — **Event** | Conditional | — | ✓ | Event name; used for economic-event feeds (bond auction, GDP release, etc.) |
| Generic data cell | MUST | ✓ | ✓ | Regular cell for numerical / textual / colored data |
| Zebra stripe (even rows) | MUST | ✓ | ✓ | Even rows receive `color-pattern-zebra-web`; controlled by `stripe: true` (default) |
| Pagination | Conditional | ✓ | **NEVER** | Sits below the table. Event Calendar MUST use infinite scroll instead |
| Infinite scroll loader | Conditional | ✓ | MUST | Auto-loads more rows when user scrolls past the bottom |
| Orange timeline (today boundary) | — | — | ✓ | Horizontal orange line + orange-bg timestamp marking today's first un-released event (§5.9) |
| Empty state | Conditional | ✓ | ✓ | `emptyNode` using the Empty component when `dataSource` is empty |
| Skeleton loading | Conditional | ✓ | ✓ | Shown while data is loading |
| Custom scrollbar | Optional (Web) | ✓ | ✓ | Hover/scroll to display, auto-hides after idle |

### 4.4 Header Sub-Parts

| Sub-part | Used in | 使用场景 | Notes |
|----------|---------|----------|-------|
| **表头-搜索组件** Header / Search | Generic only | First column header when symbol search is needed | Supports Entry / Expanded / Active / Input states; expands into a dropdown list |
| **表头-数据项** Header / Data | All variants | All non-search headers (no distinction between first and non-first) | Supports Default / Sorted / Hover header region / Normal Hover sort icon / Selected Hover sort icon |
| **表头-日期组件** Header / Date | Event Calendar only | First column header of each date group | Supports Collapsed / Expanded state; config: with / without "today reminder strip" highlight |
| **表头栏-表头编辑** Header / Edit-Entry (`+`) | Generic only | When the column set must be user-customizable | Pinned and floating on the right side; click opens the column-selection panel |

**Header / Data config capabilities:**

| Config | Options | Generic | Event Calendar |
|--------|---------|---------|----------------|
| 对齐方式 alignment | Right-aligned (numeric) / Left-aligned (textual) | ✓ | ✓ |
| 文案 text | Single-line / Two-line (main + sub, e.g. `EPS dil / TTM`) | ✓ | ✓ |
| 有无更多操作 more-actions | With (hover & selected) / Without | ✓ | — (Event Calendar does not use more-actions) |

### 4.5 First-Column Data Cell — Symbol

Used for the row identifier in generic tables and in Event Calendar rows that point to a ticker.

| State | Description |
|-------|-------------|
| Default | Avatar + ticker + full name |
| Hover | Ticker text color turns to brand/link color; Tip appears immediately showing `ticker — full name` |
| Selected | Row selected; avatar/ticker highlighted |
| Skeleton loading | Skeleton placeholder for the avatar + name |

**Config capabilities (Symbol cell):**

| Config | Options |
|--------|---------|
| Market-status dot | With / Without (pre-market / after-hours indicator) |
| Full name | Short form (`AAPL`) / Short + Long form (`AAPL Apple Inc.`) |
| Timestamp (Event Calendar only) | Without / With timestamp (`18:30`) / With timestamp + market status |

### 4.6 First-Column Data Cell — Event (Event Calendar only)

Used in Event Calendar rows that represent an economic event or calendar item (not a ticker).

| State | Description |
|-------|-------------|
| Not expanded / Default | Event name with a trailing `v` chevron indicating expandability |
| Not expanded / Hover | Hover background on the cell |
| Not expanded / Selected | Cell selected |
| Expanded | Event name with `^` chevron; a detail panel opens below the row (see §5.9 and §8.4) |
| Empty | `--` |

**Config capabilities (Event cell):**

| Config | Options |
|--------|---------|
| Name only | Event name text only (e.g. `30-Year Bond Auction`) |
| With timestamp | Leading timestamp (`14:30`) + event name |
| With importance rating | Importance indicator (supplied by the existing chart/rating library) + event name |
| With timestamp + importance rating | Timestamp + rating + event name |

> Importance ratings use the existing chart library — this guideline does NOT define the rating scale or visual inline.

### 4.7 Generic Data Cell

| State | Description |
|-------|-------------|
| Default | Raw value (numeric, text, or styled tag) |
| Hover | Cell hover state (background or text color) |
| Selected | Cell selected |
| Empty | Empty value displayed as `--` |
| Skeleton loading | Placeholder bar |

**Config capabilities:**

| Config | Options |
|--------|---------|
| 字段是否可单独点击 cell-click | Clickable / Clickable with Hover / Clickable with Selected / Non-clickable |
| 字段是否可向下展开更多 expandable | Cell may expand inline to show more content (e.g. description + embedded chart + action buttons) |
| 字段颜色 field color | 涨 up = `text-price-up`; 跌 down = `text-price-down`; 通用/平 neutral = default text color |

### Rules

- MUST show `--` for empty single-cell values (not blank, not `0`, not `N/A`)
- MUST hide the header-edit `+` entry when the column set is not user-customizable
- MUST keep the header as a **single row** per group (generic: one global row; Event Calendar: one row per date group)
- Sort icon MUST appear next to the title text, right-aligned in the header cell

---

## 5. Variants Overview

Table has **one component** with multiple feature modes controlled by props. Each mode below is a decision point, not a separate component.

### 5.1 Basic Table

Default mode. `dataSource` + `columns` + `rowKey`. Client-side pagination by default.

### 5.2 Sticky-Header Table

`stickyHeader: true`. Requires a fixed-height outer container. Header sticks when the user scrolls past it.

### 5.3 Pinned-Column Table

`initialColumnPinning: { left: ['symbol'], right: [...] }`. Use when there are more data columns than the viewport can show — horizontal scroll is enabled for the unpinned area while the pinned columns remain visible.

### 5.4 Sortable Table

`sorter: true` on the column config + `sortConfig` / `onSortChange` / `sortCycle` on the Table. See §8.1 for the complete sort-cycle rules.

### 5.5 Editable-Header Table

`+` entry on the header right side → opens a column-selection panel. Use when the user needs to customize which columns are visible.

### 5.6 Virtualized Table

`enableVirtualization: true`. Required for long lists (≥ 100 rows). Auto-enables sticky header, auto-disables pagination, requires a fixed-height parent.

### 5.7 Infinite-Scroll Table

`enableVirtualization: true` + `onReachBottom` + `infiniteScrollLoading`. Use when records are streamed in progressively (e.g. search results, historical data).

### 5.8 Excel Mode

`excelMode: true`. Full-border cell style, disables hover/active/selected states, disables sorting. Use only for strict data-grid read-only views.

### 5.9 Event Calendar Mode ★

Specialized variant for **date-grouped event feeds** (earnings calendar, economic calendar, dividend calendar).

**When to use:**
- Data is primarily classified by **date** (high-priority grouping)
- Each date holds multiple events/records
- The stream is time-ordered and open-ended (no fixed page count)

**Defining features:**

| Feature | Rule |
|---------|------|
| Date-group header | First column is a collapsible date header (`v Thursday Jan 14, 2025`); supports Expanded / Collapsed states |
| Multiple date groups | Multiple groups stack vertically; each group contains its own header + rows |
| No pagination | MUST NOT use `pagination`. MUST use infinite scroll (`enableVirtualization: true` + `onReachBottom`) |
| Sticky date header on scroll | When the user scrolls up past a date group, the **latest date header sticks** and covers the previous date header (single visible header bar at the top) |
| Today's orange timeline | See §8.10 for full rules. Summary: a horizontal orange line appears at the boundary between today's already-released and un-released events; the first un-released event's timestamp badge becomes orange-filled |
| First column type | Either Symbol cell (§4.5) OR Event cell (§4.6) — configurable per row |
| Sort support | Same rules as generic (§8.1), BUT the date-group header column itself is not sortable |
| Column-edit (`+`) | NOT used in Event Calendar |
| Expandable row content | Rows MAY expand inline to show detail content (description, chart, `Launch Chart` / `Add to calendar` buttons). **Multiple rows may be expanded simultaneously** |

### Decision Logic

```
if data.primaryGrouping == "date" AND groupCount >= 1:
    use Event Calendar (5.9)
elif dataSet.length >= 100:
    use Virtualized (5.6) + optional Infinite (5.7)
elif dataColumns.count > viewport_can_fit:
    use Pinned-Column (5.3)
elif list_is_long_but_finite:
    use Sticky-Header (5.2) + Pagination
else:
    use Basic (5.1)

if user_can_customize_columns AND variant != Event Calendar:
    add Editable-Header (5.5)

if primary_task_is_comparison:
    enable sorting (5.4) on comparable columns
```

---

## 6. Content Guidelines

### 6.1 Field Color (Up / Down / Neutral)

| Value type | Color token | Use |
|-----------|------------|-----|
| 涨 up (positive change) | `text-price-up` | `+2.44%`, `+8.03%` |
| 跌 down (negative change) | `text-price-down` | `-1.95%`, `-8.03%` |
| 通用 / 平 (neutral or non-financial) | default text color | `35.46M`, `Electronic technology` |

### 6.2 Alignment

- **Numeric columns** (Price, Change%, Volume, P/E, Estimate EPS, etc.) → **right-aligned**
- **Textual columns** (Sector, Symbol, Analyst Rating, Event name) → **left-aligned**
- Column alignment MUST match the content type for scan-ability

### 6.3 Header Title — Single vs Two-Line

| Pattern | When to use | Example |
|---------|-------------|---------|
| Single line | Title is self-explanatory | `Price`, `Volume`, `P/E` |
| Two-line (main + sub) | Title needs a qualifier (unit, period, source) | `EPS dil / TTM`, `Div yield % / TTM`, `EPS dil growth / TTM YoY` |

Use the component's `title: { main, sub }` object form for two-line headers.

### 6.4 Empty Values

- Single-cell empty → `--`
- Entire table empty → render the **Empty component** via `emptyNode`

```tsx
emptyNode={<Empty level={EmptyLevel.Page} iconType={EmptyType.NoData} title="Content is empty" />}
```

### 6.5 First Column — Symbol Display

- Default content: `avatar + ticker + full name` (e.g. `🅺 KO  The Coca-Cola`)
- Hover the **ticker text hot zone** → tooltip appears **immediately** (no delay) showing `ticker — full name`
- `full name` may be truncated with ellipsis when space is tight — the tooltip restores the full text
- Event Calendar Symbol cells MAY prepend a timestamp (`18:30`) and/or market-status dot

### 6.6 First Column — Event Name Display

- Default content: `event name` with a trailing `v` chevron when the row supports expand
- Optional prepend: timestamp (`14:30`) and/or importance-rating indicator
- On expand, content panel opens below the row (§8.4 / §5.9)

### 6.7 Zebra Stripe

- Default: `stripe: true` (ON)
- Background fill: **even rows** only
- Token: `color-pattern-zebra-web`
- Zebra striping MUST apply to all non-header rows
- In Event Calendar, zebra applies **within each date group** independently

### 6.8 Skeleton Loading

- Use during initial data fetch and page-switch fetch
- Show one skeleton bar per cell, matching column width
- Keep header visible — skeleton applies to rows only

---

## 7. Layout & Composition

### 7.1 Position on Page

- Table sits inside its content container
- Pagination (when enabled) sits **directly below** the table (see `rules/Pagination.md`)
- No other modules allowed between Table and its Pagination
- Event Calendar: no pagination — infinite scroll loader sits at the bottom of the scroll area

### 7.2 Column Width Calculation Rules ★

Column widths follow a deterministic calculation shared by **all Table variants**.

#### 7.2.1 Generic Column (non-first column)

| Condition | Computed column width |
|-----------|-----------------------|
| Header title width **>** longest data value width | **Use header title width** as the column width |
| Header title width **<** longest data value width | **Use longest data value width** as the column width |
| Column is sortable AND header title width > longest data value width | Column width = header title width + **16×16 px reserved for the sort icon** (this sum is the minimum width) |

Sort-icon reserved space MUST always be accounted for on sortable columns, regardless of whether the icon is currently visible (unsorted state).

#### 7.2.2 First Column — Symbol (responsive by screen resolution)

| Resolution | Symbol content | Width behavior |
|------------|----------------|----------------|
| **> 1024 px** | Avatar + ticker + full name | Has a **minimum width**. When viewport can fit all columns, Symbol column is **auto-fit**. When viewport cannot fit all columns (horizontal scroll triggered), Symbol column is fixed at its **minimum width** |
| **≤ 1024 px** | Avatar + ticker only (no full name) | Column width = longest value in the column (computed width fits all rows) |

This rule applies to both generic and Event Calendar Symbol cells.

#### 7.2.3 Long Text Columns

Long text fields (Sector, Analyst Rating) use `truncate` with ellipsis when they exceed the column width. Tooltip MAY be used to restore the full text on hover.

### 7.3 Row Density

- Default: single-line rows
- Two-line rows used only when the data requires a sub-label (rare)

### 7.4 With Other Components

| Component | Relationship |
|-----------|-------------|
| Pagination | Directly below the Table (generic); NOT used in Event Calendar |
| Filter / Sort controls | Above the Table area |
| Search (header cell) | Inside the first column header when symbol search is required |
| Empty component | Replaces the Table body when `dataSource` is empty |
| Tooltip | Pops from the Symbol cell on hover |
| Popover / Dropdown | Used for the column-selection panel (`+` entry) |
| Chart library | Embedded in expandable row content; also used for event importance ratings |

---

## 8. Behavior

### 8.1 Sorting ★

Sorting behavior follows the `sortCycle` prop defined in `components/table.md`. Two cycle modes are supported:

#### Mode A — `sortCycle: "default"` (used when the column has NO default sort applied at load)

Three-state cycle:

| Click count | State | Icon |
|-------------|-------|------|
| 0 | Default (unsorted) | Neutral / hidden until hover |
| 1 | Descending (大到小 / 倒序) | `↓` |
| 2 | Ascending (小到大 / 正序) | `↑` |
| 3 | Default (back to unsorted) | Reset |

Cycle: **Default → Desc (↓) → Asc (↑) → Default**

#### Mode B — `sortCycle: "loop"` (used when the column HAS a default sort applied at load)

Two-state toggle:

| Click count | State |
|-------------|-------|
| 1 | Descending ↔ Ascending (toggle between the two) |

Cycle: **Asc (↑) ⇄ Desc (↓)** — no "unsorted" state available.

#### General Rules

- Only **single-column** sort is supported — sorting one column clears any previous sort
- Sort icon placement: right side of the header text
- Sort icon reserved space: **16×16 px** (see §7.2.1)
- Click target: the entire header cell, not just the icon

### 8.2 Sticky Header

- Triggered when `stickyHeader: true` or `enableVirtualization: true`
- Header sticks **at the top of the scroll container** when the user scrolls past the header's natural position
- Requires fixed-height outer container
- In Event Calendar, the latest visible date group's header sticks and **visually replaces** the previous date group's header as the user scrolls

### 8.3 First Column Pinning

- Triggered when `initialColumnPinning.left` is set
- Apply **only when** the number of data columns exceeds what the viewport can display, forcing horizontal scroll on the unpinned area
- When pinned, Symbol column width follows the resolution rule (§7.2.2): > 1024 px = min width fixed; ≤ 1024 px = full-content width

### 8.4 Expandable Row Content

Some rows MAY expand inline to show additional content (description, embedded chart, action buttons such as `Launch Chart` or `Add to calendar`).

- Expand trigger: click the expandable-indicator chevron (`v` → `^`) on an Event cell, or click the cell/row where expansion is configured
- **Multiple rows may be expanded simultaneously** — expanding one row does NOT collapse others
- The expanded panel sits inline below the expanded row, pushing subsequent rows down
- Collapse: click the chevron again (`^` → `v`)
- Content inside the expanded panel is rendered by the business layer (chart, text, buttons); the Table component hosts the container only

### 8.5 Column Editing (+ Panel)

- Right-side floating `+` entry is the open-action (Generic variant only — NOT used in Event Calendar)
- Click → opens a **column-selection panel** (floating overlay) listing available columns with checkboxes
- User checks/unchecks columns to show/hide them
- Panel closes on outside-click or explicit Apply
- Header edit is OPT-IN — only enable when the business requires column customization

### 8.6 Row Hover

- Hover on a row fills the row with hover background
- If first column is a Symbol cell, hover also highlights the ticker color
- Cursor `pointer` when the row is clickable (`onRowClick`)

### 8.7 Row Selected

- Active / selected row uses a distinct background (e.g. `bg-[#e8efff]` in light mode, `bg-[#1d2945]` in dark mode per sample)
- Implemented via `rowClassName(record)` conditional — selected row remains highlighted even on hover
- Use selected-row state for single-record activation (e.g. which row is currently opened in a side panel)

### 8.8 Symbol Hover Tip

- Hover the **ticker text hot zone** (not the entire cell) → tooltip appears **immediately**
- Content: `ticker — full name` (e.g. `CSAI — Cloudastructure, Inc.`)
- Dismissed on mouse leave
- Implemented via the Tooltip component

### 8.9 Cell Context Menu (Right-Click)

- When `onCellContextMenu` is set, right-click on any cell triggers the callback
- Business side renders a custom `DropdownMenu` at the click position
- Context `info` includes: `type (header/body)`, `columnKey`, `record`, `rowIndex`, `value`
- Use for advanced actions: Copy Value, Edit Cell, etc.

### 8.10 Event Calendar — Orange Timeline for Today ★

In the Event Calendar variant, a horizontal **orange timeline** marks the boundary between today's already-released events and today's un-released events.

#### Trigger Conditions

| Today's event state | Timeline displayed |
|---------------------|---------------------|
| Some released AND some un-released | YES — at the boundary between the two groups |
| All events released | NO — timeline hidden |
| All events un-released | NO — timeline hidden |
| No events today | NO — timeline hidden |

#### Visual Rules

- Timeline is a full-width horizontal orange line
- Position: **above the first un-released event row** of the day
- The **timestamp badge** of that first un-released event (e.g. `14:30`) becomes **orange-filled** (contrasts with the default grey timestamp)
- Only ONE timeline per day (never multiple boundaries)
- Only applies to **today** — previous days (all released) and future days (all un-released) do NOT show a timeline

### 8.11 Event Calendar — Infinite Scroll (No Pagination)

- Event Calendar MUST NOT use `pagination` — use `enableVirtualization: true` + `onReachBottom`
- As the user scrolls down past the loaded range, the next batch of date groups loads automatically
- Loading indicator appears at the bottom while new data is being fetched
- Scroll-up behavior: the current date-group header sticks to the top and visually replaces older headers as they scroll out of view

### 8.12 Scrollbar

When the table body overflows the container (horizontal or vertical), a custom scrollbar appears.

#### 8.12.1 Default State
- Scrollbar is **hidden by default**
- Appears only when content height/width exceeds container height/width

#### 8.12.2 Show Triggers
- Mouse enters the scroll container (Hover)
- User starts scrolling (mouse wheel / trackpad)
- User drags the scrollbar thumb

#### 8.12.3 Auto-Hide
- After user stops interacting for **800–1200 ms**, the scrollbar fades out
- Opacity transitions from `1 → 0`

#### 8.12.4 Interaction Behavior

| Interaction | Behavior |
|-------------|----------|
| Mouse wheel / trackpad | Smooth scroll, inertial scroll supported, no speed cap but avoid frame drops |
| Drag thumb | 1:1 sync with content; scrollbar stays visible during drag; content MUST NOT rubber-band / bounce |
| Click on track | Scrolls content by **one viewport height**; does NOT jump to the click position |

#### 8.12.5 Responsive / Device

| Platform | Scrollbar behavior |
|----------|---------------------|
| Web | Custom scrollbar shown; supports hover-to-display; auto-hide after idle |
| Mobile | **No scrollbar shown**; uses native scroll behavior; Hover-related states disabled |

The scrollbar MUST stay inside the scroll container's visible area — it MUST NOT float outside the table region.

### 8.13 Pagination Inside Table

Generic Table has built-in Pagination via the `pagination` prop (Event Calendar does NOT use pagination — see §8.11). Defer to `rules/Pagination.md` for the full specification. Key points:

- `pagination = { pageSize: 10, siblings: 1, boundaries: 1 }` by default (from component spec)
- Standard preset page-size options: **10 / 15 / 20 / 25 / 30** (use these 5 by default; custom values allowed only in special cases)
- Page-number display logic:
  - ≤ 7 pages → show all page numbers, no ellipsis
  - > 7 pages, current near start → first N + `...` + last
  - > 7 pages, current in middle → first + `...` + siblings around current + `...` + last
  - > 7 pages, current near end → first + `...` + last N
- First / last page number is ALWAYS visible
- Active page is visually distinct (solid fill)
- `<` disabled on page 1; `>` disabled on last page
- Changing `pageSize` MUST reset current page to 1
- Total pages = 1 → hide pagination entirely

### 8.14 Empty Data (Whole Table)

- When `dataSource.length === 0`, render the **Empty component** via `emptyNode`
- Use `EmptyLevel.Page` when the Table occupies a full page region; use a smaller level when the Table is embedded
- Header row is still shown; the body is replaced by the Empty component
- Empty text and icon MUST reflect the scenario (no data, filter returned no results, search no matches, etc.)

### 8.15 Keyboard

- Sortable header cells MUST be focusable via Tab; Enter / Space triggers sort cycle
- Pagination buttons inherit keyboard rules from `rules/Pagination.md`
- Row / cell keyboard navigation is NOT required in v1

---

## 9. Platform Differences & Responsive Breakpoints ★

Table follows a **four-breakpoint Web responsive rule**, with an explicit Mobile variant below 500 px.

### 9.1 Web Breakpoints

| Breakpoint | Layout behavior |
|------------|-----------------|
| **1410 < width ≤ 1890** | Table width follows viewport (auto-fit). Columns distribute width by **content weight** (wider content → proportionally wider column) |
| **990 < width ≤ 1410** | Table width follows viewport (auto-fit). Columns keep the **same field structure** as the large-screen variant (no columns dropped) |
| **500 < width ≤ 990** | Table width follows viewport. **Symbol column width is calculated by the minimum-readable width of "avatar + ticker" only** (no full name). Other columns' widths are unchanged from 990–1410 tier |
| **width ≤ 500** | Table is **replaced by the Mobile stock-list style**. Information-display rules and field priority follow the Mobile spec. Same rules as the native Mobile app (see §9.3) |

### 9.2 Horizontal Scroll (All Web Tiers)

- When columns exceed the viewport, the table scrolls horizontally
- Pinned first column (Symbol) remains fixed on the left
- Pagination row is always **fully visible** (does not scroll with the data region)
- Custom scrollbar rules (§8.12) apply

### 9.3 Mobile (≤ 500 px or Native App)

| Aspect | Behavior |
|--------|----------|
| Table form | Replaced by Mobile stock-list style — field priority follows the Mobile spec |
| Sticky header | Supported when the container is tall enough |
| First-column pin | Enabled when horizontal scroll is needed |
| Scrollbar | Hidden — uses native scroll; Hover states disabled |
| Pagination | Replaced by `View more >` button (see `rules/Pagination.md`) |
| Hover states (row, cell, symbol tip, sort icon) | Disabled — mobile has no hover |
| Right-click context menu | N/A |
| `+` header-edit entry | Hidden |

### 9.4 Event Calendar on Small Screens

- Event Calendar follows the same 4-breakpoint responsive rules
- At width ≤ 500 px, the Mobile event-list style is used
- The orange timeline and date-group headers remain functional at all breakpoints
- Sort, column-edit (`+`), and hover states are disabled at ≤ 500 px

---

## 10. Do / Don't

| | Practice | Reason |
|---|---------|--------|
| DO | Use Table for large, sortable, comparable datasets | Primary use case |
| DO | Use the Event Calendar variant when data is date-grouped | Correct variant choice |
| DO | Enable `stickyHeader` (or `enableVirtualization`) for long lists | Keeps column labels visible during scroll |
| DO | Pin the first column only when horizontal scroll is needed | Avoids wasting space |
| DO | Use `color-pattern-zebra-web` on even rows | Matches design system zebra pattern |
| DO | Right-align numeric columns, left-align text columns | Improves scan-ability |
| DO | Show `--` for empty single-cell values | Conveys "no data" consistently |
| DO | Render the Empty component for zero-row states | Matches the design system empty pattern |
| DO | Follow `sortCycle` from component spec — 3-state for no default sort, 2-state for existing default sort | Matches component behavior and design spec |
| DO | Reserve **16×16 px** for the sort icon on sortable columns | Prevents header text wrap or icon clipping |
| DO | Compute column width as max(header title, longest data value) | Deterministic, consistent column widths |
| DO | At Symbol column width > 1024 px, show full name; at ≤ 1024 px, show ticker only | Progressive disclosure on small screens |
| DO | Show tooltip immediately on Symbol hover | Users need fast ticker-to-full-name mapping |
| DO | Use `+` entry + column panel for user-customizable columns | Matches the column-editing pattern |
| DO | Reset to page 1 when `pageSize` changes | Avoids out-of-range pages |
| DO | Prefer the 5 preset `pageSize` options (10/15/20/25/30) | Consistency across lists |
| DO | Show orange timeline only on today's date group, and only when there are both released and un-released events | Matches the design spec precisely |
| DO | Allow multiple expanded rows simultaneously in Event Calendar | Enables comparison across events |
| DO | Use infinite scroll (no pagination) for Event Calendar | Matches the open-ended time-stream pattern |
| DON'T | Use Table for 2-attribute rows or single-record views | Use a list or key-value block |
| DON'T | Use Table for recommendation card lists (推荐股单列表) | Use Card-list pattern |
| DON'T | Pin the first column when it isn't needed | Wastes horizontal space |
| DON'T | Use multi-level / multi-row headers in the generic variant | Keep to a single header row |
| DON'T | Use `pagination` in Event Calendar | Event Calendar MUST use infinite scroll |
| DON'T | Use the `+` column-edit entry in Event Calendar | Not part of Event Calendar pattern |
| DON'T | Use "more-actions" affordance on Event Calendar headers | Event Calendar headers do not expose that affordance |
| DON'T | Mix Excel mode with sortable / hoverable tables | Excel mode disables those states by design |
| DON'T | Place Pagination separated from the Table by other modules | They MUST be visually adjacent |
| DON'T | Show scrollbar permanently | It should auto-hide after idle |
| DON'T | Show hover states on mobile | Mobile has no hover — use tap behavior |
| DON'T | Invent custom `pageSize` values without a business reason | Stick to the 5 presets |
| DON'T | Make `...` in pagination clickable | It is an indicator, not a control |
| DON'T | Auto-collapse other expanded rows when a new row is expanded in Event Calendar | Multiple expanded rows are allowed |
| DON'T | Draw the orange timeline on days that are fully released or fully un-released | Only today's mid-day boundary uses the timeline |

---

## 11. Decision Table

### 11.1 Should I Use Table or Something Else?

| Scenario | Component |
|----------|-----------|
| Sortable, paginated, many-column dataset | **Generic Table** |
| Date-grouped event stream (earnings / economic calendar) | **Table — Event Calendar variant** (§5.9) |
| 3-col / 4-col card list with sparkline + price + change-button (推荐股单列表) | **Card list** (not Table) |
| Continuous scroll feed (news, social) | Feed list (not Table) |
| Single record detail with many fields | Descriptions / key-value list |
| Short 2-column summary inside a card | List / key-value |

### 11.2 Feature Mode Selection

| Data characteristic | Recommended mode |
|---------------------|------------------|
| Date-grouped stream | Event Calendar (5.9) |
| < 100 rows, fits viewport | Basic Table (5.1) |
| Long list, finite count, needs page control | Sticky-Header (5.2) + Pagination |
| More columns than viewport fits | Pinned-Column (5.3) |
| Needs sort on numeric columns | Sortable (5.4) |
| Users need to customize visible columns | Editable-Header (5.5) |
| ≥ 100 rows or streaming data | Virtualized (5.6) |
| Streaming / search results with unknown total | Virtualized + Infinite-Scroll (5.7) |
| Read-only full-grid data | Excel mode (5.8) |

### 11.3 Sort / Pin / Header Behavior Decision

| Condition | Action |
|-----------|--------|
| Column is comparable (numeric or orderable text) | Set `sorter: true` |
| Column is non-comparable (e.g. free-text notes) | Do NOT set `sorter` |
| Column has NO default sort | Use `sortCycle: "default"` → 3-state cycle (Default → Desc → Asc → Default) |
| Column HAS a default sort | Use `sortCycle: "loop"` → 2-state toggle (Asc ⇄ Desc) |
| Column is sortable | Reserve **16×16 px** for the sort icon in column width |
| Data columns > viewport can fit | Pin first column via `initialColumnPinning.left` |
| Container is tall and list is long | Set `stickyHeader: true` + fixed-height container |
| Data list ≥ 100 rows | Use `enableVirtualization: true` |
| User must customize columns (generic only) | Show `+` editor entry + column-selection panel |
| Event Calendar variant | No `+` editor, no pagination, no "more-actions" headers |

### 11.4 Column Width Calculation

| Column type | Condition | Width rule |
|-------------|-----------|------------|
| Generic column (non-sortable) | Header title wider than longest data | Width = header title width |
| Generic column (non-sortable) | Longest data wider than header title | Width = longest data width |
| Generic column (sortable, header wider) | Any | Width = header title width + 16×16 px sort-icon space (minimum) |
| Symbol column | Resolution > 1024 px, viewport fits | Auto-fit (min width reserved) |
| Symbol column | Resolution > 1024 px, horizontal scroll triggered | Fixed at minimum width |
| Symbol column | Resolution ≤ 1024 px | Width = longest "avatar + ticker" combination |

### 11.5 Responsive Breakpoints

| Viewport width | Table behavior |
|----------------|----------------|
| 1410 < w ≤ 1890 | Auto-fit; columns distribute by content weight |
| 990 < w ≤ 1410 | Auto-fit; identical column structure to large-screen tier |
| 500 < w ≤ 990 | Auto-fit; Symbol column compressed to "avatar + ticker" min width; other columns unchanged |
| w ≤ 500 | Switch to Mobile stock-list style (table component NOT used in tabular form) |

### 11.6 Empty / Loading / Hover

| State | Pattern |
|-------|---------|
| Loading (initial or page switch) | Skeleton bars inside each cell; header stays visible |
| Row hover | Row background hover; Symbol cell highlights ticker color |
| Row selected | Distinct background (via `rowClassName`); persists on hover |
| Single cell empty | `--` |
| Whole table empty | `emptyNode` = Empty component |

### 11.7 Scrollbar

| Trigger / State | Result |
|-----------------|--------|
| Container content fits | Scrollbar hidden |
| Content overflows + mouse hover on container | Scrollbar visible |
| User scrolls (wheel / drag) | Scrollbar visible |
| Idle 800–1200 ms | Scrollbar fades out (opacity 1 → 0) |
| Click on track | Scroll by one viewport height |
| Drag thumb | 1:1 scroll sync; scrollbar stays visible until drag ends |
| Mobile device | Scrollbar hidden; native scroll only |

### 11.8 Pagination (Generic Table Only)

| Total pages | Current position | Display |
|-------------|------------------|---------|
| ≤ 7 | Any | All pages shown, no ellipsis |
| > 7 | Near start | `1 2 3 ... last` (single ellipsis before last) |
| > 7 | Middle | `1 ... sibling window ... last` (double ellipsis) |
| > 7 | Near end | `1 ... last N` (single ellipsis after first) |
| = 1 | — | Hide pagination |

### 11.9 Event Calendar — Orange Timeline

| Today's event state | Timeline | Timestamp badge |
|---------------------|----------|-----------------|
| Some released, some un-released | Show at boundary | First un-released event → orange-filled |
| All released | Hide | No timestamp change |
| All un-released | Hide | No timestamp change |
| No events today | Hide | N/A |
| On any non-today date group | Never show | N/A |

---

## 12. Related Documents

- `ainvest-design-system/references/components/table.md`
- `ainvest-design-system/references/components/pagination.md`
- `ainvest-design-system/references/components/tooltip.md`
- `ainvest-design-system/references/components/popover.md`
- `ainvest-design-system/references/components/search-input.md`
- `ainvest-design-system/references/components/dropdown-menu.md`
- `ainvest-design-system/SKILL.md`
- `ainvest-design-system/references/tokens/color.md`
- `ainvest-design-system/references/tokens/spacing.md`
- `ainvest-design-system/references/tokens/typography.md`
---

> **TODO — remaining items pending further screenshots:**
> - Detailed column-selection panel layout (default column set, ordering controls, apply/reset)
> - Mobile stock-list style specification (width ≤ 500 px replacement form)
> - Exact visual tokens for the orange timeline (line thickness, timestamp badge fill)
> - Expandable row content structural template (chart embed, action-button placement)
> - Empty-state scenario-specific copy (no data / filter returned empty / search mismatch)
