# Color: Solid Fill When Elements Overlap

**Category:** Color Rule
**Scope:** All interactive elements, floating elements, overlays, hover states, tooltips, popovers, buttons

---

## The Rule

When an element is positioned **on top of** another element that carries visible content — such as borders/strokes, text, icons, graphics, images, or other UI elements — the foreground element MUST use a **solid (opaque) fill color**, not a semi-transparent one.

---

## MUST

- MUST use solid fill colors (`#RRGGBB` or `rgba(r,g,b,1)`) on any element that overlaps non-empty content beneath it
- MUST verify hover, active, and selected states of floating elements (carousel arrows, tooltips, dropdowns, sticky headers) use solid fills
- MUST use solid fills for:
  - Carousel navigation arrows (`.carousel-arrow`) — positioned over cards that have `border` strokes
  - Dropdown menus / popover panels — positioned over page content
  - Sticky nav bar — positioned over scrolled-behind content
  - Tooltips — positioned over any content
  - Modal overlays — use solid backdrop

## MUST NOT

- MUST NOT use `rgba(r,g,b,α)` with `α < 1` for fills on elements that overlap visible strokes, borders, or other content
- MUST NOT use `opacity: < 1` as a hover/active style mechanism when the element is floating above other visible elements
- MUST NOT assume a `color.hover` token (which may be `rgba(0,0,0,0.05)`) is safe to use for floating element hover states

---

## Rationale: The "穿模" (Bleed-Through) Problem

Semi-transparent fills work correctly only when the background is a solid, uniform surface. When the element is positioned over a border stroke, image, or text:

1. The opacity blends with whatever is beneath
2. The underlying border/content becomes **visible through** the element
3. This creates a "ghosting" or "see-through" artifact — visually breaking the element's boundary

**Example — carousel arrow over cards:**

- Arrow background: `rgba(0,0,0,0.05)` — looks fine on white page
- When hovered and positioned over a card border: the card's `1px solid rgba(0,0,0,0.05)` stroke bleeds through the arrow's background
- Fix: use `#E5E5E5` (solid light grey) so the arrow covers the border cleanly

---

## Hover State Color Reference for Floating Elements

| Element type      | Default bg                | Hover bg (solid)                                      |
| ----------------- | ------------------------- | ----------------------------------------------------- |
| Carousel arrow    | `color.bg.surface` (#FFF) | `#E5E5E5`                                             |
| Dropdown item     | `color.bg.surface`        | `color.bg.weak` **only if not floating over borders** |
| Tooltip           | `color.text.primary`      | N/A (not interactive)                                 |
| Sticky nav        | `color.bg.nav`            | N/A                                                   |
| Context menu item | `color.bg.surface`        | `#F0F0F0`                                             |

---

## When Transparent Fills Are Acceptable

Transparent fills ARE acceptable when:

1. The element sits on a **known uniform background** with no borders or graphics beneath
2. The element is an **inline** element (not floating/positioned/overlapping)
3. The token is used for **page-level hover rows** (data table rows hover on solid surface background)

---

## FAILURE

- If a floating element (carousel arrow, popover, dropdown) uses `rgba` or `opacity` for hover/fill → replace with a solid equivalent color
- If pressing a button or hovering a floating element causes underlying strokes or content to visually "bleed through" → the fill is transparent and must be made solid
