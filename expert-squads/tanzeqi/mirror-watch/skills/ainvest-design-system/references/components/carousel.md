# Guidelines — carousel

> **Component Spec:** `ainvest-design-system/references/components/carousel.md`

---

## 0. Document Role

This document covers **when and how to use** the carousel (轮播图) component. It focuses on decisions a designer must make explicitly — visual details handled automatically by the component are omitted.

<!-- - Component import: `@ainvest/carousel` -->

This document focuses on the **Web Carousel Indicator** sub-system (Dot Indicator / Free-Scroll Indicator / Pagination Arrow). Visual tokens and anatomy of the three indicator sub-components are detailed in §3 onwards.

---

## 1. Definition

The Carousel (轮播图) is a component that displays multiple cards or images within a fixed area, supporting automatic or manual cycling. It is used for homepage Banners, promotional recommendations, and product showcases.

The **Web Carousel Indicator** system consists of three sub-components:

| Sub-Component | Purpose |
|---------------|---------|
| **Dot Indicator** | Shows total pages and current position via dots; supports full-page snapping |
| **Free-Scroll Indicator** | Progress bar for free-scroll (non-snapping) content; proportional width indicates visible portion |
| **Pagination Arrow** | Left/right arrow buttons for manual page navigation; 3 size tiers |

---

## 2. When to Use

| Condition | Use? | Sub-Component | Arrow Tier |
|-----------|------|---------------|-----------|
| Full-page banner / hero (snap-to-page) | YES | Dot Indicator + Pagination Arrow | **Tier 1** (48px, inside card) |
| Card deck — fixed count per page, snap-to-page | YES | Dot Indicator + Pagination Arrow | **Tier 1** (48px, inside card, 24px from inner edge) |
| Single-row horizontal card list with fixed page count | YES | Dot Indicator + Pagination Arrow | **Tier 1** (when module height > 44px) |
| Card grid that supports horizontal free-scroll (no snap) | YES | Free-Scroll Indicator | — |
| Top-tab row that overflows (component height ≤ 44px) | YES | Pagination Arrow only | **Tier 2** (36px, at the tab row) |
| Module title overflow hint | YES | Pagination Arrow only | **Tier 3** (20px, inline with title) |
| Onboarding / walkthrough pages | YES | Dot Indicator | — (no arrow) |
| Content has only 1 page (no overflow) | NO | No indicator needed | — |
| Vertical scrollable content | NO | Use Scroll Bar instead | — |
| Paginated data table | NO | Use Pagination component | — |

> **Tier selection is by component height, not by position.** Even if arrows sit at the section
> title row, a card module > 44px tall is **Tier 1 inside the card**, not Tier 2. Tier 2 is
> reserved for cases where the carousel container *itself* is ≤ 44px tall (e.g. a top-tab row).

---

## 3. When NOT to Use

| Condition | Use Instead |
|-----------|------------|
| Vertical scroll | Scroll Bar |
| Data table pagination (page numbers) | Pagination component |
| Single image / no overflow | No indicator |
| Tab-based content switching | Tab component |
| Mobile-only swipe carousel | Mobile carousel indicator (separate Figma component) |

---

## 4. Anatomy

### 4a. Dot Indicator

```
              ● ○ ○        ← Dots centered below/inside card
```

- **Active dot**: Solid circle, `#000000` (light) / `#FFFFFF` (dark)
- **Inactive dot**: Same shape, reduced opacity — `rgba(0,0,0,0.10)` on light cards, `rgba(255,255,255,0.12)` on dark cards
- Dots are horizontally centered relative to the card/carousel area

### 4b. Free-Scroll Indicator

```
         ▓▓▓░░░░░░░░        ← Progress bar below cards
```

- **Track**: Full-width bar (total length fixed). Color matches inactive-dot token —
  `rgba(0,0,0,0.10)` on light cards, `rgba(255,255,255,0.12)` on dark cards
  (equivalent to `color.divider.level2`)
- **Active segment**: Proportional width = (visible columns / total columns) × total length
- Active segment fills dark (`#000000` / `#FFFFFF`)

### 4c. Pagination Arrow

```
    ┌───┐                           ┌───┐
    │ ‹ │    [   CARD CONTENT   ]   │ › │
    └───┘                           └───┘
```

- Circular buttons with chevron icon
- 3 size tiers (see §5)
- Can be positioned inside or outside the card area

---

## 5. Variants Overview

### 5a. Dot Indicator Sizes

| Breakpoint | Dot Size | Dot-to-Dot Gap | Top/Bottom Margin | Position |
|------------|---------|----------------|-------------------|----------|
| Web > 500px | 8px diameter | 8px | 16px | Centered below or inside card |
| Web ≤ 500px | 6px diameter | 6px | 8px | Centered below or inside card |
| App (Mobile) | 6px diameter | 6px | 8px | Centered below card |

### 5b. Free-Scroll Indicator Sizes

| Platform | Bar Height | Total Length | Active Segment | Min Active | Max Active |
|----------|-----------|-------------|---------------|-----------|-----------|
| Web | 6px | 36px | `(visibleCols / totalCols) × 36` | 6px | 20px |
| App | 3px | 24px | `(visibleCols / totalCols) × 24` | 6px | 20px |

### 5c. Pagination Arrow Tiers

| Tier | Button Size | Icon Size | Hit Area | Condition | Usage |
|------|------------|----------|----------|-----------|-------|
| **Tier 1** | 48px circle | 24px | 48×48px | Carousel module height > 44px | Major modules — chart, index cards, hero banners, card decks |
| **Tier 2** | 36px circle | 20px | 36×36px | Carousel container itself ≤ 44px | Page-level lightweight nav (top-tab area that overflows) |
| **Tier 3** | 20–48px variable | 20px | 20×20px min | Module title overflow hint | Inline with module title, hidden until needed |

> **Tier selection rule:** decided by the **height of the carousel container**, not by where the
> arrows visually sit. A 200px-tall card module with arrows aligned to the section title row is
> still Tier 1 (inside the card module). Tier 2 applies only when the scrollable element itself
> is a thin row (≤ 44px), e.g. a tab bar.

---

## 6. Content Guidelines

### Dot Indicator
- No text content — purely visual

### Pagination Arrow
- Icon only — no text labels
- Chevron direction MUST match navigation direction (‹ = back, › = forward)

### MUST
- Active dot MUST be visually distinct (solid vs semi-transparent)
- Free-scroll indicator active segment MUST be proportional to visible/total ratio

### MUST NOT
- MUST NOT add page numbers to dots
- MUST NOT add text labels to arrows

---

## 7. Layout & Composition

### Dot Indicator Positioning

| Position | When | Spacing from bottom edge |
|----------|------|------------------------|
| **Inside card** (overlay) | When dots sit within the card visual area | 16px from card bottom edge |
| **Outside card** (below) | When dots sit below the card | 16px gap between card bottom and dots |

### Pagination Arrow Positioning

| Tier | Position | Offset from card/content edge |
|------|----------|------------------------------|
| Tier 1 | Inside the carousel card, on left/right edges | 24px from card inner edge (Web > 500px); 8px (Web ≤ 500px) |
| Tier 2 | At the right end of the thin scrollable row itself (the row **is** the container) | Flush with the row end, aligned to the section title row visually |
| Tier 3 | Within module title bar | Adjacent to title content |

### Responsive Rules

| Breakpoint | Arrows (Tier 1) | Dots |
|------------|----------------|------|
| Web > 500px | Inside card, 24px margin from content edge | 8px dots, 16px spacing |
| Web ≤ 500px | Inside card, 8px margin from edge (tighter) | 6px dots, 8px spacing |

---

## 8. Behavior

### 8a. Dot Indicator Behavior

| Event | Behavior |
|-------|----------|
| Page changes (swipe or arrow click) | Active dot switches instantly — no transition animation on dots themselves |
| Auto-play (if enabled) | Dots update in sync with auto-advancing content |
| Dot click (optional) | Jump directly to corresponding page |

### 8b. Pagination Arrow Behavior

**Right Arrow (→):**

| State | Visibility |
|-------|-----------|
| First page, has more pages | Visible (default) |
| Middle pages | Visible |
| Last page | **Hidden immediately** — no fade, no delay |
| User scrolls back from last page | **Reappears immediately** |

**Left Arrow (←):**

| State | Visibility |
|-------|-----------|
| First page | **Hidden** |
| Second page or later | **Visible immediately** — no animation/slide-in |
| User returns to first page | **Hidden immediately** |

**Hover behavior:**
- On hover: button switches to highlight style (e.g. shadow deepens or background color changes) — see §8d for exact per-tier rules
- Use a short 150ms ease-out transition on the hover-changing property only (`box-shadow` for light Tier 1/2, `background-color` for dark Tier 1/2 and Tier 3) — per `hover.md` §2.5
- MUST NOT use `opacity` or `translateX` as the hover transition mechanism (those are reserved for show/hide and slide animation)
- Reference: Apple official interaction style (direct, immediate response)

**Disabled state:**
- Reduced opacity for arrows that cannot navigate further
- Only applies to Tier 1/2 when explicitly locked; normally arrows hide instead of disable

### 8c. Card/Banner Transition Animation

| Property | Value |
|----------|-------|
| Transition method | Horizontal slide (`translateX()`) |
| Duration | 300ms |
| Easing | `cubic-bezier(0.4, 0, 0.2, 1)` (Material ease) |
| Trigger | One click on arrow = one page transition |

**Click right arrow (→):**
- Current card: `translateX(0)` → `translateX(-100%)`
- Next card: `translateX(100%)` → `translateX(0)`

**Click left arrow (←):**
- Current card: `translateX(0)` → `translateX(100%)`
- Previous card: `translateX(-100%)` → `translateX(0)`

### 8d. Pagination Arrow Color States

> Hover behavior follows the rules in `references/rules/hover.md`. Tier 1/2 (light) is an "icon container + shadow" per hover.md §3.6; Tier 3 is "icon-as-button" per hover.md §3.6.

**Tier 1 / Tier 2 — Light background (浅色):**

| State | Style |
|-------|-------|
| Default | White fill + 1px border stroke (`color.divider.level2`) + soft shadow |
| Hover | **Shadow deepens: shadow color opacity +8** (e.g. 12% → 20%); fill / border unchanged (per hover.md §3.6 — icon container + shadow) |
| Disabled | Reduced opacity (30%) |

**Tier 1 / Tier 2 — Dark background (深色):**

| State | Style |
|-------|-------|
| Default | Black fill, white icon, no border |
| Hover | Background lightens to `#333333` (dark variant of the icon-button hover; shadow rule does not apply because there is no default shadow) |
| Disabled | Reduced opacity (30%) |

**Tier 3 — Inline:**

| State | Style |
|-------|-------|
| Default | Transparent background, no border, icon only |
| Hover | Rectangular bg `color.interaction.hover` with `radius-sm` (6px) — per hover.md §3.6 (icon-as-button) |
| Disabled | Reduced opacity (30%) |

### 8e. Free-Scroll Indicator Behavior

- Active segment position tracks scroll position proportionally
- Moves continuously as user scrolls (not step-based)
- No snap behavior — indicator stops where user stops scrolling

---

## 9. Platform Differences

| Aspect | Web (>500px) | Web (≤500px) | App (Mobile) |
|--------|-------------|-------------|--------------|
| Dot Indicator size | 8px | 6px | 6px |
| Dot-to-dot gap | 8px | 6px | 6px |
| Dot top/bottom margin | 16px | 8px | 8px |
| Free-scroll bar | 6px × 36px total | 6px × 36px total | 3px × 24px total |
| Arrow Tier 1 | 48px, 24px margin | 48px, 8px margin | N/A (swipe gesture) |
| Arrow Tier 2 | 36px, at tab row | 36px, at tab row | N/A |
| Arrow Tier 3 | 20px inline | 20px inline | N/A |
| Arrow hover | Yes (shadow/color) | Yes | N/A |
| Transition | translateX 300ms | translateX 300ms | Native swipe |

---

## 10. Do / Don't

### DO

| # | Rule |
|---|------|
| 1 | Use Dot Indicator for fixed-page-count carousels (Banner, card deck) |
| 2 | Use Free-Scroll Indicator for variable-length horizontal content (card grids) |
| 3 | Hide left arrow on first page, hide right arrow on last page — no fade animation |
| 4 | Use 300ms `cubic-bezier(0.4, 0, 0.2, 1)` for card slide transitions |
| 5 | Switch dot state instantly with page change (no dot transition animation) |
| 6 | Ensure active/inactive dots have clear contrast (solid vs 10-12% opacity) |
| 7 | Scale dots from 8px to 6px at ≤500px breakpoint |

### DON'T

| # | Rule |
|---|------|
| 1 | DON'T add fade/slide animation to arrow show/hide — instant visibility toggle |
| 2 | DON'T use opacity transitions on arrow hover — use direct color/shadow change |
| 3 | DON'T show pagination arrows when there is only 1 page |
| 4 | DON'T use Free-Scroll Indicator for snap-to-page carousels (use Dot Indicator) |
| 5 | DON'T mix Dot Indicator and Free-Scroll Indicator on the same carousel |
| 6 | DON'T keep disabled arrows visible when they should be hidden |
| 7 | DON'T use vertical pagination arrows (this component is horizontal-only) |

---

## 11. Decision Table

### Which indicator type?

| Content Type | Scroll Behavior | → Indicator |
|-------------|----------------|-------------|
| Banner / hero images | Snap to page | Dot Indicator |
| Card deck (fixed count per page) | Snap to page | Dot Indicator |
| Card grid (variable count, free scroll) | Free scroll, no snap | Free-Scroll Indicator |
| Onboarding flow | Snap to page | Dot Indicator |

### Which arrow tier?

| Carousel Container Height | Role | → Arrow Tier |
|--------------------------|------|-------------|
| > 44px | Primary content module (cards, charts, banners) | **Tier 1** (48px, inside card, 24px from inner edge) |
| ≤ 44px | The container itself is a thin nav row (e.g. tab bar) | **Tier 2** (36px, at row end) |
| Any | Hint inside a module title bar | **Tier 3** (20px, inline with title) |

> Common mistake: placing **Tier 2** in a section because "the arrows are at the title row".
> The deciding factor is the height of the carousel **container** (the element that scrolls),
> not where the arrow visually sits.

### Dot position?

| Condition | → Position |
|-----------|-----------|
| Carousel is a hero banner / full-bleed image | Inside card (16px from bottom) |
| Carousel shows discrete cards with gaps | Outside card (16px below card) |

---

## 12. Related Documents

| Document | Relationship |
|----------|-------------|
| `ainvest-design-system/references/components/pagination.md` | Data table pagination — separate component |
| `ainvest-design-system/references/components/button.md` | Arrow buttons follow general button state rules |
