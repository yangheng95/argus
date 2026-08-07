# List & Table Pattern Rules

**Category:** Component Pattern
**Scope:** All data tables, stock lists, trade lists, leaderboards, feed lists

---

## No Outer Border on List/Table Containers

### MUST NOT

- MUST NOT add an outer border (`border: 1px solid`) to the container wrapping a list or table
- MUST NOT add `box-shadow` to a list/table container for the purpose of visual boundary

### MUST

- MUST rely on row-level dividers (`border-top` or `border-bottom` on each row) to provide internal structure
- MUST rely on spacing (margin/padding from surrounding content) to separate the list from adjacent content
- MUST use `color.divider.l3` for row dividers (lightest — does not compete with content)
- MUST use `color.divider.l2` for the header-to-body separator (one step stronger, signals hierarchy)

### Rationale

The Ainvest page background and surface background are the same color (`color.bg.page` = `color.bg.surface` = white). Adding an outer border to a list creates an unnecessary visual box that feels heavy and card-like. Lists are content streams — they should feel open, not enclosed.

Cards get borders. Lists do not.

---

## Row Interaction

- MUST apply `:hover` background: `color.hover` (rgba(0,0,0,0.05))
- MUST use `cursor: pointer` on clickable rows
- Row transitions: `background 0.12s` — fast, not distracting

---

## Table Header

- Column headers: `font-size.12` / `font-weight.semibold` / `color.text.tertiary`
- Header row bottom border: `color.divider.l2`
- Header background: same as page — `color.bg.surface` (NOT `color.bg.weak`)
- Headers are NOT sticky by default (only apply sticky if explicitly specified in Page Spec)

---

## Distinguishing: List vs Card

| Pattern           | Outer border       | Row divider         | Background            |
| ----------------- | ------------------ | ------------------- | --------------------- |
| Data table / list | MUST NOT           | yes (l3)            | transparent / surface |
| Card              | yes (l3) or shadow | optional internal   | surface               |
| Carousel card     | yes (l3)           | no (card is atomic) | surface               |

---

## Table Column Alignment

### MUST

- MUST right-align all numeric and financial value columns:
  `Amount`, `Price`, `Return`, `Change`, `%`, `Volume`, `P/E`, `Market Cap`, `Quantity`, any column containing numbers
- MUST left-align all identifier and text columns:
  `Name`, `Politician`, `Ticker` (symbol text), `Transaction type`, `Date`, `Status`, `Category`, `Source`, `Rating`

### MUST NOT

- MUST NOT center-align numeric columns — center alignment breaks vertical scanning of values
- MUST NOT mix alignment within the same logical column across rows vs header

### Rationale

Right-alignment for numbers is a universal financial table convention. When numbers are right-aligned, the decimal points and digit positions stack vertically, allowing rapid comparison. Left-aligned text columns improve readability of labels and identifiers which are scanned from the left.

### Column alignment reference

| Column type       | Example columns                               | Alignment |
| ----------------- | --------------------------------------------- | --------- |
| Financial values  | Return, Amount, Change, Price                 | **Right** |
| Percentages       | +12.5%, -3.2%                                 | **Right** |
| Text / label      | Politician, Name, Transaction, Status, Rating | Left      |
| Date              | Filed, Traded, Date                           | Left      |
| Symbol identifier | Ticker cell (logo + symbol together)          | Left      |

### Header must match body

Table `<th>` headers MUST use the same alignment as their column's `<td>` cells.

---

## Table Edge Padding

### MUST

- MUST apply `padding-left` to the **first column** (`th:first-child`, `td:first-child`) so text does not touch the left edge of the table container
- MUST apply `padding-right` to the **last column** (`th:last-child`, `td:last-child`) so text/icons do not touch the right edge
- Minimum edge padding: `16px` on both sides

### MUST NOT

- MUST NOT let text or icons in the first or last column butt up against the table container edge with zero horizontal padding
- MUST NOT rely on table container padding alone — set it directly on the cell

### Rationale

Without explicit first/last column padding, content bleeds to the edge of the container and feels cramped, especially on narrow screens. Edge padding creates visual breathing room and aligns with the overall page padding rhythm.

---

## FAILURE

- If a table or list has an outer `border` property → remove it. Lists define their structure through rows, not containers.
- If a numeric column (Return, Amount, Price) is left- or center-aligned → fix to right-align.
- If the `<th>` header alignment does not match its `<td>` body → fix to match.
- If text in the first or last column touches the table container edge → add `padding-left: 16px` / `padding-right: 16px` to those cells.
