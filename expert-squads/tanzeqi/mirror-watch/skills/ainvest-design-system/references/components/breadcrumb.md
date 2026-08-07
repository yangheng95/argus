# Guidelines — Breadcrumb

> **Component Spec:** `ainvest-design-system/references/components/breadcrumb.md`

---

## 0. Document Role

This document covers **when and how to use** the Breadcrumb (面包屑) component. It focuses on decisions a designer must make explicitly — visual details handled automatically by the component are omitted.

<!-- - Component import: `@ainvest/breadcrumb -->

---

## 1. Definition

Breadcrumb is a **secondary navigation component** that displays the user's current location within the site's information architecture and provides a path to navigate back up the hierarchy.

It supplements — not replaces — primary navigation (e.g. top nav bar, sidebar).

---

## 2. When to Use

| Condition | Use Breadcrumb? |
|-----------|-----------------|
| Page has a clear hierarchical position (e.g. Markets > USA > Stocks > Electronic Technology) | YES |
| Page is deeper than 2 levels in the information architecture | YES |
| User may need to navigate back to a parent category | YES |
| Page content is dynamically generated from a hierarchical path (e.g. search results, filtered lists) | YES |
| User arrived via search or filter and needs to see the navigation context | YES |

### MUST

- MUST use Breadcrumb when the page is at level 3 or deeper in the site hierarchy
- MUST use Breadcrumb when the page is part of a drill-down flow (e.g. Markets → USA → Stocks → Sector)

### SHOULD

- SHOULD use Breadcrumb on level 2 pages if the parent context aids orientation

---

## 3. When NOT to Use

| Condition | Use Breadcrumb? | Alternative |
|-----------|-----------------|-------------|
| Page is a top-level / landing page (L1) | NO | Primary nav already indicates location |
| Page is a standalone feature with no hierarchy (e.g. SPA tools like TradingView Options) | NO | None needed |
| Page structure is flat (all content at one level) | NO | Tab or primary nav |
| Page is a modal or overlay | NO | Modal header / close action |
| Mobile app with native back navigation | NO | System back gesture / button |

### MUST NOT

- MUST NOT use Breadcrumb as primary navigation — it is supplementary
- MUST NOT use Breadcrumb on pages that have no parent-child relationship
- MUST NOT use Breadcrumb in modals, drawers, or floating panels

---

## 4. Anatomy

```
[ Node 1 ]  /  [ Node 2 ]  /  [ ... ]  /  [ Node N-1 ]  /  [ Current Node ]
  (link)    sep   (link)    sep (overflow) sep  (link)    sep   (plain text)
```

### Reference rendering (visual contract)

Correct visual weight (left → right = dark → light):

```
Markets   /   USA   /   ...   /   Electronic Technology   /   Industries
 ▓▓▓▓▓▓▓      ▓▓▓       ▓▓▓         ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓              ░░░░░░░░░░
 primary      primary   primary     primary                       quaternary
 (clickable)  (clickable) (clickable) (clickable)                  (non-interactive)
 ← 400 regular, 14px, single line — color is the ONLY signal separating current from parents →
```

Failure signature (do not ship):

```
Markets / USA / Electronic Technology / Industries        ← current rendered bold + dark
 ░░░░      ░░░    ░░░░░░░░░░░░░░░░░░     ▓▓▓▓▓▓▓▓▓▓▓     ← parents rendered light gray
```

If your output matches the failure signature, regenerate per §8 Color States + Typography rules.

| Part | Required | Description |
|------|----------|-------------|
| Root node (first node) | MUST | The top-level entry point (e.g. "Markets") |
| Intermediate nodes | MUST (if depth > 2) | Parent categories between root and current page |
| Current node (last node) | MUST | The current page — displayed as plain text, NOT clickable |
| Separator | MUST | Visual divider between nodes — use `/` or `>` per system convention |
| Overflow indicator (`...`) | Conditional | Appears when breadcrumb is truncated due to space constraints |
| Overflow dropdown | Conditional | Shown on hover of `...`, lists collapsed intermediate nodes |

### Rules

- MUST always display at minimum: root node + current node
- MUST NOT make the current (last) node clickable — it represents the active page
- MUST display all nodes as clickable links except the current node
- Overflow indicator MUST be interactive — hover reveals a dropdown listing the collapsed nodes

---

## 5. Variants Overview

| Variant | Figma key | Usage scenario |
|---------|-----------|----------------|
| Full breadcrumb | `@reuse@ainvest/breadcrumb` | Default — all nodes visible when space permits |
| Collapsed breadcrumb | Single element: `Title  Title  ...` | When horizontal space is insufficient — intermediate nodes collapse into `...` |

### Decision Logic

```
if available_width >= total_breadcrumb_width:
    use Full breadcrumb (all nodes visible)
else:
    use Collapsed breadcrumb:
        MUST keep: root node + current node
        MUST collapse: intermediate nodes (starting from level 2)
        MUST show: "..." as overflow indicator with hover dropdown
```

---

## 6. Content Guidelines

### Node Label

- MUST use the actual page/category name — MUST NOT abbreviate arbitrarily
- MUST keep labels concise — avoid labels longer than ~20 characters when possible
- SHOULD support hover tooltip showing the full label if truncated
- MUST use sentence case or title case consistent with the page title

### Separator

- MUST use the forward slash character `/` (U+002F) as the separator between nodes
- MUST NOT use `>` (chevron / greater-than), `»`, `→`, `·`, `|`, custom icons, or any other character
- MUST render the separator as plain text at the same `font-size` and `line-height` as the node labels (not as an icon font, not as an SVG chevron, not as `::before` arrow pseudo-element)
- MUST apply `color.text.quaternary` to the separator — the separator is visually the lightest element in the row (see §8 Color States)
- MUST surround each separator with symmetric horizontal spacing — recommended `spacing.8` (8px) gap on each side, so the row reads as `node [8px] / [8px] node`

### Overflow (`...`)

- MUST appear as a single `...` node when intermediate levels are collapsed
- MUST show a dropdown on hover listing collapsed nodes
- Dropdown items MUST be clickable — each navigates to the corresponding level page
- Root node and current node MUST NOT be collapsed into `...`

---

## 7. Layout & Composition

### Position

- MUST be placed below the global navigation bar
- MUST be placed above the page title / main content area
- MUST be left-aligned with the content area

### Relationship with Other Components

| Component | Relationship |
|-----------|-------------|
| Top navigation bar | Breadcrumb sits below nav; MUST NOT overlap or duplicate nav items |
| Page title | Breadcrumb sits above page title; the last breadcrumb node and page title should represent the same page |
| Tab (page-level) | Breadcrumb sits above tabs if both are present |
| Search bar (global) | Independent — breadcrumb remains visible during search |

### Spacing

- Follow `ainvest-design-system/references/spacing.md` for vertical gap between breadcrumb and adjacent elements
- Breadcrumb row MUST NOT introduce extra card or container — render directly on the page surface

---

## 8. Behavior

### Color States

| Element | State | Token |
|---------|-------|-------|
| Link node (parent levels) | Default | `color.text.primary` |
| Link node (parent levels) | Hover | `color.text.secondary` |
| Separator (`/`) | — | `color.text.quaternary` |
| Current node (last) | — | `color.text.quaternary` |
| Overflow trigger (`...`) | Default | `color.text.primary` |
| Overflow trigger (`...`) | Hover | `color.text.secondary` |

- Link nodes MUST use `color.text.primary` by default — MUST NOT use `color.text.secondary` as the resting state
- Hover MUST dim the node to `color.text.secondary` — NOT brighten it
- Current (last) node MUST use `color.text.quaternary` — MUST NOT use `color.text.tertiary`

### Typography

All breadcrumb nodes — parent links, separators, overflow trigger, and current node — MUST share one type style:

| Property | Value |
|----------|-------|
| `font-size` | `14px` (`font.size.14`) on Web; `14px` on App |
| `font-weight` | `400` (`font.weight.regular`) — **all nodes, including the current node** |
| `line-height` | `20px` (single-line) |
| `font-family` | `font.family.primary` (inherited from body) |

MUST:
- MUST keep every breadcrumb node (parent, separator, `...`, current) at the **same `font-size` and `font-weight`** — visual hierarchy between parents and current is expressed **only by color token**, not by weight or size
- MUST render breadcrumb nodes on a single line (one row) — never wrap to two lines; if width is insufficient, collapse intermediate nodes via `...` (see §8 Overflow Behavior)

MUST NOT:
- MUST NOT bold the current node
- MUST NOT bold any parent link node (default state)
- MUST NOT increase the current node's `font-size` to mark it as "the current page"
- MUST NOT mix sizes across nodes (e.g. parents at 14, current at 16) — all nodes are uniform

### Visual Hierarchy — Anti-Pattern (Common Failure)

The most common implementation error is **inverting the visual weight**: making the current (last) node the darkest/boldest element and rendering parent links as light gray. This is wrong.

The correct hierarchy is:

```
 parent (clickable, dark)  /  parent (clickable, dark)  /  current (non-interactive, light)
      primary                     primary                        quaternary
```

- Parent links **ARE** the interactive, scannable part → they are the **darkest** element in the row
- Current node **IS NOT** interactive; it only marks "you are here" → it is the **lightest** element in the row
- Separators are neutral structural glue → quaternary

MUST NOT:
- MUST NOT render the current node in `color.text.primary`, `color.text.secondary`, or any bold weight under the justification "so users can see which page they're on" — the page title right below the breadcrumb already does that job
- MUST NOT render parent links in `color.text.secondary` or `color.text.tertiary` as a default resting color — they MUST be `color.text.primary`
- MUST NOT reverse the rule on hover (e.g. parent hover → primary, default → secondary) — hover **dims** parents from primary to secondary

### Click Behavior

- Clicking any node (except the current/last node) MUST navigate to that node's corresponding page
- MUST NOT open links in a new tab by default — use same-window navigation
- The current (last) node MUST NOT respond to click — MUST visually appear as non-interactive (use `color.text.quaternary`)

### Overflow Behavior

- When the breadcrumb exceeds available width, MUST collapse intermediate nodes into `...`
- Collapse priority:
  1. MUST keep the root node (first) and current node (last) visible at all times
  2. MUST collapse from the second-level nodes first (closest to root)
  3. On hover of `...`, MUST show a dropdown listing all collapsed nodes
  4. Clicking a dropdown item MUST navigate to that level's page

### Keyboard Behavior

- Each clickable node MUST be focusable via Tab key
- Enter / Space on a focused node MUST trigger navigation
- Overflow dropdown MUST be accessible via keyboard

---

## 9. Platform Differences

### Web

| Breakpoint | Behavior |
|------------|----------|
| width > 1410px | Full breadcrumb; width follows content panel |
| 990px < width <= 1410px | Full breadcrumb; width follows content panel |
| 500px < width <= 990px | Collapsed breadcrumb likely; intermediate nodes collapse to `...` |
| width <= 500px | Collapsed breadcrumb; width follows bottom sheet or card panel |

- On all Web breakpoints, breadcrumb row width MUST follow the content panel width (not viewport width)
- MUST NOT fix breadcrumb width independently of the content layout

### App (Mobile)

- MUST ensure breadcrumb node tap targets meet minimum hot zone requirements (minimum 44px height for touch)
- SHOULD evaluate whether native back navigation makes breadcrumb redundant
- If breadcrumb is used on mobile, MUST collapse aggressively — show at most: root + `...` + current

---

## 10. Do / Don't

| | Practice | Reason |
|---|---------|--------|
| DO | Show full path when space permits | Users can scan the complete hierarchy at a glance |
| DO | **Render parent links in `color.text.primary` (darkest) and the current node in `color.text.quaternary` (lightest)** | Parents are the interactive scannable part; the current node is a non-interactive marker |
| DO | **Use `/` (forward slash) as the only separator character, rendered as plain text at the same size/weight as node labels** | System-standard separator; consistent across all Ainvest pages |
| DO | **Keep every node (parent, separator, `...`, current) at the same font-size (14px) and weight (400 regular)** | Color is the sole hierarchy signal; weight/size uniformity preserves the compact breadcrumb rhythm |
| DO | Collapse intermediate nodes with `...` when space is tight | Preserves root + current context without horizontal overflow |
| DO | Make `...` hoverable to reveal collapsed nodes in a dropdown | Users can still access any level without extra navigation |
| DO | Keep the last node as plain non-interactive text | Avoids confusion — clicking the current page is meaningless |
| DON'T | **Render the current node in bold, in `color.text.primary`, or at a larger font-size** | The page title below the breadcrumb already marks the current page — the breadcrumb's role is to show the path, not re-emphasize the current location |
| DON'T | **Render parent links in a light gray (`secondary` / `tertiary` / `quaternary`) as the default state** | Parents are the interactive part; lightening them makes them look disabled |
| DON'T | **Use `>` / `»` / `→` / `·` / `|` / chevron icon / arrow SVG as the separator** | Only `/` is allowed; any other separator is a system violation |
| DON'T | Wrap the breadcrumb to a second line | Breadcrumbs are strictly single-line; use `...` collapse if width is insufficient |
| DON'T | Use breadcrumb on top-level landing pages | No parent hierarchy to show — adds visual noise |
| DON'T | Use breadcrumb in SPA tools with flat structure | Misleading — implies hierarchy that doesn't exist |
| DON'T | Make the current (last) node clickable | Violates breadcrumb convention; creates a no-op click |
| DON'T | Truncate node labels silently without hover tooltip | Users lose context if labels are cut without explanation |
| DON'T | Collapse the root or current node into `...` | These are the two essential orientation anchors |
| DON'T | Use breadcrumb inside modals or floating panels | Breadcrumb is a page-level construct, not a panel-level one |

---

## 11. Decision Table

| Page depth | Page type | Hierarchy clear? | Platform | Action |
|------------|-----------|-------------------|----------|--------|
| L1 (top-level) | Landing / Home | — | Any | MUST NOT use breadcrumb |
| L2 | Category page | YES | Web | SHOULD use breadcrumb |
| L3+ | Detail / sub-category | YES | Web | MUST use breadcrumb |
| Any | Standalone SPA tool | NO hierarchy | Web | MUST NOT use breadcrumb |
| Any | Modal / Drawer | — | Any | MUST NOT use breadcrumb |
| L3+ | Detail page | YES | App | Evaluate: if native back nav is sufficient → SHOULD NOT; otherwise → MAY use collapsed breadcrumb |

### Special Scenarios

| Scenario | Breadcrumb behavior |
|----------|---------------------|
| User arrives via search/filter to a category page | MUST show full hierarchical path; breadcrumb may also reflect the search context (e.g. filter conditions) |
| Dynamically generated list page (e.g. "Pre-market most active") | MUST show the path from root to the current dynamic list; nodes are generated from the navigation path |
| Page with both breadcrumb and page-level tabs | Breadcrumb sits above tabs; both are visible simultaneously. **The top in-page tab row on such a page MUST be `pill-tabs` with `level="page"` — never `line-tabs`.** The breadcrumb already owns the top-tier navigation role, so the in-page tab tier starts one step lower. See `components/pill-tabs.md §2, §5a` and `components/line-tabs.md §2–§3`. |

---

## 12. Related Documents

- `ainvest-design-system/references/components/breadcrumb.md`
- `ainvest-design-system/SKILL.md`
- `ainvest-design-system/references/rules/spacing.md`
- `ainvest-design-system/references/rules/typography.md`
- `ainvest-design-system/references/rules/color.md`
- `ainvest-design-system/references/rules/page-structure-types.md`
