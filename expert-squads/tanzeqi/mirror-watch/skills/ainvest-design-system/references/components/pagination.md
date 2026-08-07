# Guidelines — Pagination (分页器)

<!-- > Component import: `@ainvest/pagination` -->
> Component Spec: `ainvest-design-system/references/components/pagination.md`

---

## 0. Document Role

This file defines **when, where, and how** to use the Pagination component — it is the **usage guideline** (使用规范).

Pagination is a **Web-only** navigation component that splits large datasets into multiple pages and provides controls for users to switch between them. It is NOT used on Mobile — on narrow viewports it is replaced by a `View more >` button.


### AI Resolution Rules

- When generating Pagination UI, MUST read **both** documents
- **Component style / structure / API / code / default values** → follow `components/pagination.md`
- **Usage decision (when / where / Web vs Mobile / replacement pattern)** → follow this file
- If rules conflict: **component spec takes priority** for visual/structural/API details; **this guideline takes priority** for scenario logic and platform decisions
- MUST NOT invent props or defaults that are absent from `components/pagination.md` — refer there for exact defaults (e.g. `siblings`, `boundaries`, `pageSizeOptions`)
- MUST NOT ignore the **Web-only** constraint defined in this guideline

---

## 1. Definition

Pagination is a navigation component that splits a long list, table, or dataset into discrete pages. It provides interactive controls (page numbers, previous/next arrows, ellipsis, and optional page-size selector) that let the user jump between pages efficiently.

It is used primarily for **data lists, tables, and search results** where the total item count exceeds what fits comfortably on one page.

---

## 2. When to Use

| Condition | Use Pagination? |
|-----------|-----------------|
| Content is a data list or table with more than one page of records | YES |
| User needs to browse different data blocks across pages | YES |
| Total dataset is large and loading all at once would hurt performance | YES |
| Content is a search results list | YES |
| Content is a tabular / grid view with sortable columns | YES |
| Page is on Web and width > 500px | YES (prerequisite) |

### MUST

- MUST use Pagination when data is split across multiple server-side pages (Web only)
- MUST place Pagination at the bottom of the data area it controls
- MUST use `hideOnSinglePage` (or equivalent product logic) to hide the bar when total pages = 1

### SHOULD

- SHOULD use Pagination when total item count exceeds a single viewport of content
- SHOULD enable `showSizeChanger` when the user benefits from controlling page density (typical in data tables)

---

## 3. When NOT to Use

| Condition | Use Pagination? | Alternative |
|-----------|-----------------|-------------|
| Content is a continuous feed (e.g. news timeline, social feed) | NO | Infinite scroll / "Load more" button |
| Data fits within a single page without scrolling | NO | No pagination needed |
| Mobile / Web viewport width ≤ 500px | NO | `View more >` button |
| Content inside a modal or popover | NO | Scroll within the container |
| Exactly one page of results | NO | Hide the component entirely |
| Mobile app (native) | NO | Infinite scroll or `View more >` |

### MUST NOT

- MUST NOT use Pagination for continuous / feed-style content — use infinite scroll
- MUST NOT show Pagination when total pages = 1 — hide the component entirely
- MUST NOT use Pagination on Mobile (width ≤ 500px) — replace with `View more >` button
- MUST NOT place Pagination inside modals or popovers — the container should scroll instead
- MUST NOT separate Pagination from its data area with other modules — they MUST be visually and structurally adjacent

---

## 4. Anatomy

### Visual Style

| Property | Value | Token |
|----------|-------|-------|
| Button border-radius | **6px** | `var(--radius-sm)` |
| Applies to | Page number buttons, Previous (`<`) button, Next (`>`) button | — |

#### MUST / MUST NOT

- MUST use `border-radius: var(--radius-sm)` (6px) on all pagination buttons (page numbers, prev, next)
- MUST NOT use `border-radius: var(--radius-full)` (9999px / pill shape) on pagination buttons — this is incorrect and visually wrong
- Pagination buttons are **rounded rectangles**, not pills or circles

---

### Variant A — Simple Pagination (page numbers only)

```
[ < ]  [ 1 ]  [ 2 ]  [ 3 ]  [ 4 ]  [ 5 ]  [ ... ]  [ 42 ]  [ > ]
 prev   pages (with active highlight)                  last    next
```

### Variant B — Full Pagination (with page-size selector and item range)

```
[ 20 per page v ]   [ 1-20 of 100 ]   [ < ]  [ 1 ]  [ 2 ]  [ 3 ]  [ 4 ]  [ 5 ]  [ ... ]  [ 42 ]  [ > ]
  page-size select    item range          prev         page numbers                  last      next
```

| Part | Required | Description |
|------|----------|-------------|
| Page number buttons | MUST | Numbered buttons for each page; active page is visually highlighted |
| Previous button (`<`) | MUST | Navigates to the previous page |
| Next button (`>`) | MUST | Navigates to the next page |
| Ellipsis (`...`) | Conditional | Shown when there are too many pages to display; represents collapsed page ranges |
| First page number | MUST | Always visible as the leftmost number |
| Last page number | MUST | Always visible as the rightmost number so users know the total count |
| Page-size selector (`20 per page`) | Optional | Dropdown to change number of items per page (Variant B only) |
| Item range label (`1-20 of 100`) | Optional | Shows current item range and total count (Variant B only) |

### Rules

- MUST always show the first page (`1`) and the last page number
- Active (current) page MUST be visually distinct — use filled/highlighted style
- `...` MUST appear when there are collapsed page ranges between visible numbers
- `...` is **non-interactive** — it is a visual indicator only
- Previous (`<`) and Next (`>`) buttons MUST be disabled (greyed out) when on the first or last page respectively

---

## 5. Variants Overview

### 5a. Variant Decision

| Variant | When to Use |
|---------|-------------|
| **Simple pagination** (Variant A) | Page numbers + prev/next only; used when page-size control is NOT needed |
| **Full pagination** (Variant B) | Includes page-size selector + item range + page numbers; used in data-heavy Web tables |

### 5b. Variant Decision Logic

```
if viewport_width <= 500px:
    DO NOT use Pagination → use "View more >" button instead

if viewport_width > 500px AND needs_page_size_control:
    use Full pagination (Variant B)

if viewport_width > 500px AND simple_list:
    use Simple pagination (Variant A)
```

### 5c. Responsive Rules

| Viewport | Behavior |
|----------|----------|
| Web > 500px | Pagination is fully shown, left-aligned, fixed width. If the surrounding content is tight, the content area supports horizontal scroll — Pagination itself does NOT truncate |
| Web ≤ 500px / Mobile | Pagination is **removed entirely**. Replace with a `View more >` text button at the bottom of the content area |

### 5d. Default Values (reference only)

All default values (`siblings`, `boundaries`, `pageSizeOptions`, `locale`, etc.) are defined in `components/pagination.md`. When generating code, MUST follow the component spec's defaults exactly — do NOT hardcode defaults from this guideline.

---

## 6. Content Guidelines

### Page Numbers — Display Rules

Page-number windowing follows a standard shrink/expand rule so the bar stays a consistent width.

- When **total pages ≤ 7**: show ALL page numbers without ellipsis (e.g. `1 2 3 4 5 6 7`)
- When **total pages > 7**:
  - Current page **near the start** → show first N pages + `...` + last page
  - Current page **in the middle** → show first page + `...` + surrounding pages + `...` + last page
  - Current page **near the end** → show first page + `...` + last N pages
- `...` MUST be placed between the boundary pages and the middle window
- Both `siblings` (neighbors around current) and `boundaries` (fixed count at each end) follow the **component spec defaults** — see `components/pagination.md`

### Page-Size Selector

- Options and default come from `components/pagination.md` (`pageSizeOptions`, default selection)
- Dropdown MUST show current selection
- Changing page size MUST reset the current page to **1**
- When the user changes page size, MUST call `onPageSizeChange` so the parent can sync state

### Item Range Label

- Format: `{start}-{end} of {total}` (e.g. `1-20 of 100`)
- MUST update dynamically when page or page-size changes
- Custom format is supported via the `totalRender` prop — use only when the default format is insufficient

### Multi-language

- `locale` prop controls the label language for `per page` only
- Range text (`1-20 of 100`) remains in English across locales
- An unsupported requested locale is a contract error; declare a supported locale before rendering

---

## 7. Layout & Composition

### Position

- MUST be placed at the **bottom** of the data area / table it controls
- MUST be left-aligned within the content container
- MUST NOT be separated from its data area by unrelated modules

### Variant B (Full) — Element Order

```
[ Page-size selector ]  [ Item range ]  [ Pagination controls ]
        left                 left              left-aligned, after range
```

- All elements sit in a single row, left-aligned
- Order: page-size selector → item range → page controls
- Right side auto-adapts; the entire row is always fully visible

### Relationship with Other Components

| Component | Relationship |
|-----------|-------------|
| Data table / list | Pagination sits directly below the table; MUST NOT be separated by other modules |
| Filter / Sort controls | Filters sit above the data area; Pagination sits below — they do not overlap |
| `View more >` button | **Replaces** Pagination on Mobile / width ≤ 500px |

---

## 8. Behavior

### Click Behavior

- Clicking a page number MUST navigate to that page and update the active state
- Clicking `<` MUST go to the previous page; clicking `>` MUST go to the next page
- `<` MUST be disabled when current page = 1; `>` MUST be disabled when current page = last page
- Clicking `...` MUST NOT trigger any action — it is a visual indicator only
- Changing page-size MUST reset the current page to 1
- Navigation MUST call `onChange` so the parent can react and re-fetch data

### Page Number Window Logic

```
given: current_page, total_pages, siblings (component default), boundaries (component default)

if total_pages <= 7:
    show all pages: [1, 2, 3, ..., total_pages]
    no ellipsis needed

if current_page near start:
    show: [boundaries pages from start] + [siblings + current window] + ... + [last]
    single ellipsis before the last page

if current_page near end:
    show: [first] + ... + [siblings + current window] + [boundaries pages at end]
    single ellipsis after the first page

else (middle):
    show: [first] + ... + [siblings around current] + ... + [last]
    double ellipsis
```

Exact `siblings` / `boundaries` values are defined in `components/pagination.md` — this guideline only defines the **shape** of the window, not the numbers.

### Single-Page Behavior

- When total pages = 1, the component MUST be hidden
- Use `hideOnSinglePage` prop (see `components/pagination.md`) or product-level conditional rendering
- Also applies when there are zero records

### Keyboard Behavior

- Page number buttons MUST be focusable via Tab
- `Enter` / `Space` on a focused page number MUST trigger navigation
- Previous (`<`) and Next (`>`) buttons MUST be keyboard accessible
- Disabled state MUST be reflected in keyboard behavior (skipped from Tab order or non-actionable)

---

## 9. Platform Differences

| Aspect | Web (> 500px) | Web (≤ 500px) / Mobile App |
|--------|----------------|-----------------------------|
| Pagination displayed | YES | **NO** |
| Layout | Left-aligned, fixed width, fully visible | N/A |
| Tight space handling | Content area supports horizontal scroll; Pagination does NOT truncate | N/A |
| Replacement | — | `View more >` text button at the bottom of the content area |
| Replacement behavior | — | Loads the next page of data, OR navigates to a full-screen list |
| Keyboard behavior | Tab / Enter / Space | N/A |

### Mobile App (Native)

- Pagination is **NOT** used in the native mobile app
- Use infinite scroll, `Load more` button, or `View more >` navigation instead

---

## 10. Do / Don't

| | Practice | Reason |
|---|---------|--------|
| DO | Place Pagination at the bottom of the data table it controls | Users expect page controls after scanning data |
| DO | Always show first page and last page number | Gives users a sense of total scope |
| DO | Use ellipsis to collapse large page ranges | Prevents the bar from becoming excessively long |
| DO | Disable `<` on page 1 and `>` on last page | Prevents confusion from non-functional clicks |
| DO | Replace with `View more >` on Mobile / ≤ 500px | Pagination is too cramped on small screens |
| DO | Show all pages without ellipsis when total pages ≤ 7 | Full visibility is better when the count is small |
| DO | Reset to page 1 when page-size changes | Avoids invalid page references |
| DO | Enable `hideOnSinglePage` when the dataset might shrink to one page | Removes unnecessary UI noise |
| DO | Use `totalCount + pageSize` when total records are known | Automatic calculation, includes size changer |
| DON'T | Use `border-radius: var(--radius-full)` (pill) on pagination buttons | Correct shape is 6px rounded rectangle (`var(--radius-sm)`) — pill shape is visually wrong |
| DON'T | Show Pagination when there is only 1 page | Empty Pagination adds noise |
| DON'T | Use Pagination for continuous feeds / timelines | Infinite scroll is the correct pattern |
| DON'T | Make `...` clickable | Ellipsis is an indicator, not a control |
| DON'T | Keep current page when page-size changes | MUST reset to page 1 |
| DON'T | Use Pagination inside modals or popovers | Scroll within the container instead |
| DON'T | Truncate or wrap the Pagination bar | Use horizontal scroll on the content area instead |
| DON'T | Use Pagination on Mobile | Use `View more >` or infinite scroll |

---

## 11. Decision Table

### Platform / Content Decision

| Data type | Total pages | Platform | Width | Action |
|-----------|-------------|----------|-------|--------|
| Table / data list | > 1 | Web | > 500px | Use Simple or Full Pagination |
| Table with page-size control | > 1 | Web | > 500px | Use Full Pagination (Variant B) |
| Table / data list | > 1 | Web | ≤ 500px | Remove Pagination → `View more >` |
| Table / data list | = 1 | Any | Any | MUST NOT show Pagination |
| Feed / timeline | Any | Any | Any | MUST NOT use Pagination → infinite scroll |
| Any | > 1 | Mobile App | Any | MUST NOT use Pagination → `View more >` or infinite scroll |
| Any | Any | Any | Inside modal / popover | MUST NOT use Pagination → container scroll |

### Variant Selection

| Need | Variant |
|------|---------|
| Simple page-number navigation only | **Simple Pagination** (Variant A) |
| Page-size selector + item range needed | **Full Pagination** (Variant B) |
| Mobile / ≤ 500px | Neither — use `View more >` |

### Page Number Display

| Total pages | Current page position | Display |
|-------------|----------------------|---------|
| ≤ 7 | Any | All pages shown, no ellipsis |
| > 7 | Near start | `1 2 3 ... [N] ... last` (single ellipsis before last) |
| > 7 | Middle | `1 ... [window around current] ... last` (double ellipsis) |
| > 7 | Near end | `1 ... [N last pages]` (single ellipsis after first) |

### Single Page / Empty Data

| Condition | Behavior |
|-----------|----------|
| Total pages = 1 AND `hideOnSinglePage` = true | Component is hidden (returns null) |
| Total pages = 1 AND `hideOnSinglePage` = false | Component is shown but has no pagination purpose — AVOID |
| Zero records | Treat as single-page — hide via `hideOnSinglePage` |

---

## 12. Related Documents

- `ainvest-design-system/references/components/pagination.md`
- `ainvest-design-system/references/components/breadcrumb.md`
- `ainvest-design-system/references/components/collapse.md`
- `ainvest-design-system/SKILL.md`
- `ainvest-design-system/references/tokens/spacing.md`
- `ainvest-design-system/references/tokens/typography.md`
- `ainvest-design-system/references/tokens/color.md`
