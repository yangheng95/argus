# Guidelines — pill-tabs

> **Component Spec:** `ainvest-design-system/references/components/pill-tabs.md`

---

## 0. Document Role

This document covers **when and how to use** the pill-tabs (胶囊标签页) component. It focuses on decisions a designer must make explicitly — visual details handled automatically by the component are omitted.

<!-- - Component import: `@ainvest/pill-tabs` -->

---

## 1. Definition

pill-tabs is a **capsule-shaped tab** used for switching between sibling views that are **closely related** (typically different slices / filters of the same content domain, or a set of parallel modules inside one page).

The component exposes two levels via the `level` prop:

| `level`    | Intended Scenario                                                                                                                                                       | Inactive Style                                  | Height |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------ |
| `"page"`   | **Page-level tab row** — the top in-page tab on a page (default for any second-level page or page with a breadcrumb), or the outer tier of a 2-tier pill-tabs hierarchy | `secondary` (filled capsule on grey background) | 40px   |
| `"module"` | **Module-level primary** switching — top-most switcher inside a self-contained module, or the inner tier of a 2-tier pill-tabs hierarchy (paired below `level="page"`)  | `outline` (bordered capsule)                    | 36px   |

Compared with other tab sub-types:

| Sub-type      | Purpose                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| line-tabs     | Outermost tier when the page needs ≥ 3 tab tiers                                                                                       |
| **pill-tabs** | Default tab for 1–2 tab tiers — page-level (`"page"`), module-level (`"module"`), or both stacked together (page on top, module below) |
| segment-tabs  | Dense segmented control inside a bordered container (e.g. chart timeframe)                                                             |

---

## 2. When to Use

> **Primary trigger:** pill-tabs is the **default tab component** for any page-level or module-level tab row. On any second-level page (i.e. a page that renders a breadcrumb), the top in-page tab row MUST start from `pill-tabs level="page"`. line-tabs is only introduced when the page needs a **third** tab tier on top of an already-existing `pill-tabs page` + `pill-tabs module` 2-tier structure.

| Condition                                                                                                                                       | Use pill-tabs?                                                  | Which `level`                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| **Top in-page tab row on any second-level page or any page with a breadcrumb**                                                                  | **YES — pill-tabs is the default starting tier on these pages** | **`"page"`**                                                |
| **Top in-page tab row on a top-level page (no breadcrumb), with only 1 tab tier needed**                                                        | YES                                                             | `"page"`                                                    |
| **2 tab tiers needed**: outer tier switches major content groups; inner tier filters within each group                                          | YES — outer = `"page"`, inner = `"module"` (different shapes)   | `"page"` (outer) + `"module"` (inner)                       |
| **Inner tiers nested inside a `line-tabs` panel** (3-tier page)                                                                                 | YES — middle tier = `"page"`, innermost tier = `"module"`       | `"page"` (middle) + `"module"` (innermost)                  |
| **Primary switcher of a named module / floor (sits directly under a `FloorTitle` or section heading and switches the entire module's content)** | **YES**                                                         | **`"module"`**                                              |
| Primary switcher at the top of a self-contained module (card / widget)                                                                          | YES                                                             | `"module"`                                                  |
| Parallel slices of the same content domain (e.g. "Stocks / ETFs / Crypto" filters)                                                              | YES                                                             | `"page"` or `"module"` by hierarchy (see §5a decision tree) |
| A right-side action icon (e.g. filter, sort, settings) needs to live next to the tab row                                                        | YES                                                             | either (see §5b)                                            |

### MUST

- **MUST be used as the default tab component for any second-level page or any page with a breadcrumb.** Start from `pill-tabs level="page"` — do not jump to `line-tabs` just because the page renders a breadcrumb or feels visually important.
- **MUST express a 2-tier hierarchy as `pill-tabs level="page"` (outer) + `pill-tabs level="module"` (inner).** The two tiers MUST use different `level` values so they are visually distinguishable as separate tiers.
- **MUST avoid two same-shape pill-tabs rows directly adjacent with no content between them.** If two pill-tabs of the **same `level`** sit next to each other with nothing in between (no module title, no divider, no data, no card boundary), the user cannot tell them apart as separate tiers — see §2a below.
- MUST set `level` explicitly based on hierarchy
- MUST keep exactly one tab selected at all times (single-select)
- MUST keep the tab row on a single line (no wrapping)

### SHOULD

- SHOULD use pill-tabs when sibling tabs are **related slices** of one domain, OR for any tab row that is not the third tier of a deep hierarchy
- SHOULD place pill-tabs directly above the content it switches, with no other interactive elements between them

---

## 2a. Same-shape adjacency rule (authoritative)

When two pill-tabs rows are placed near each other on the page, they MUST NOT use the same `level` if there is no separating content between them. Same-shape rows stacked back-to-back read as a single broken / wrapped row, not as two tiers — defeating the purpose of pill-tabs entirely.

### Forbidden patterns

```
❌  ╭─Tab A╮ ╭─Tab B╮ ╭─Tab C╮     ← pill-tabs level="page"
   ╰──────╯ ╰──────╯ ╰──────╯
   ╭─Tab D╮ ╭─Tab E╮ ╭─Tab F╮     ← pill-tabs level="page" (SAME shape, NO content in between)
   ╰──────╯ ╰──────╯ ╰──────╯

❌  ╭─Tab A╮ ╭─Tab B╮ ╭─Tab C╮     ← pill-tabs level="module"
   ╰──────╯ ╰──────╯ ╰──────╯
   ╭─Tab D╮ ╭─Tab E╮ ╭─Tab F╮     ← pill-tabs level="module" (SAME shape, NO content in between)
   ╰──────╯ ╰──────╯ ╰──────╯
```

This anti-pattern often appears when a single `pill-tabs` row has too many options and a designer **manually wraps it onto two visual lines**. That is wrong — let the component handle overflow (see §6) instead of breaking the row in two.

### MUST

- MUST NOT place two pill-tabs rows of the **same `level`** directly adjacent with no separating content (title, divider, data block, card boundary, etc.) between them
- MUST NOT manually wrap a single pill-tabs row across two visual lines to fit more options — let the component's overflow logic handle it (see §6)
- MUST express a 2-tier hierarchy with **different `level`** values (`page` on top, `module` below) so the two tiers are visually distinct
- If a hierarchy genuinely needs **two same-level pill-tabs rows** (extremely rare), MUST insert a clear separating element between them — e.g. a `FloorTitle`, a section heading, a divider, or a content block — so the user perceives them as belonging to two distinct contexts

---

## 2b. Vertical-only stacking rule for `page` + `module` (authoritative)

When a 2-tier hierarchy uses `pill-tabs page` (outer) + `pill-tabs module` (inner), the two rows MUST be stacked **vertically** — `page` on top, `module` directly below it, each occupying the **full content width**. They MUST NOT be placed side-by-side in the same horizontal row, and they MUST NOT be split into two horizontal columns of the page.

### Rationale

- The two tiers represent a **parent → child** relationship: the inner `module` row filters within the outer `page` row's selection. Side-by-side placement breaks that "drill-down" reading order and makes the two tiers compete for attention as siblings.
- Vertical stacking guarantees the inner row's content always reflects the outer row's current selection — there is exactly one outer context at a time.
- The outline-vs-fill shape difference (§5c) is designed to be read **top-down**, not left-right.

### Forbidden patterns

```
❌  ╭─Stocks (active)╮ ╭─ETFs╮ ╭─Crypto╮       ╭─Top Gainers (active)╮ ╭─Top Losers╮     ← page (left) + module (right) on the SAME ROW
   ╰────────────────╯ ╰─────╯ ╰───────╯       ╰─────────────────────╯ ╰───────────╯
   ↑ pill-tabs page                            ↑ pill-tabs module

❌  Two-column page split:                                                                ← left column = page tier, right column = module tier
   │ ╭─Stocks╮ ╭─ETFs╮              │ ╭─Top Gainers╮ ╭─Top Losers╮ │
   │ ╰───────╯ ╰─────╯              │ ╰────────────╯ ╰───────────╯ │
```

### Required pattern

```
✓  ╭─Stocks (active)╮ ╭─ETFs╮ ╭─Crypto╮ ╭─Forex╮                        ← pill-tabs page (full width)
   ╰────────────────╯ ╰─────╯ ╰───────╯ ╰──────╯
   ╭─Top Gainers (active)╮ ╭─Top Losers╮ ╭─Most Active╮ ╭─52W High╮     ← pill-tabs module (full width, directly below)
   ╰─────────────────────╯ ╰───────────╯ ╰────────────╯ ╰──────────╯
```

### MUST

- MUST stack `page` (outer) above `module` (inner) **vertically**, each on its own line
- MUST give each tier the **full content width** of the surrounding container (or the full panel width inside a card / line-tabs panel)
- MUST keep the vertical gap between `page` and `module` rows tight (component-default spacing) so the parent → child relationship is unambiguous
- MUST update the `module` row's content to reflect the currently selected `page` tab (the inner tier is scoped to the outer selection)

### MUST NOT

- MUST NOT place `page` and `module` in the same horizontal row (e.g. `page` on the left half, `module` on the right half)
- MUST NOT split the page into two columns where one column hosts `page` and the other hosts `module`
- MUST NOT swap the order (`module` above `page`) — the outer tier always sits on top
- MUST NOT insert unrelated content (banners, ads, cards) between the two rows; only tight vertical spacing is allowed so the pair reads as one tab system

> Right-side action icons (§5b) are **not** an exception — they live at the **end of the same row** as their tab list, never as a separate column carrying another tab tier.

---

## 3. When NOT to Use

| Condition                                                             | Use Instead                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Page genuinely needs ≥ 3 tab tiers** — the outermost tier           | **line-tabs** (middle tier remains `pill-tabs page`, innermost remains `pill-tabs module`) |
| Chart timeframe / dense segmented control inside a bordered container | segment-tabs                                                                               |
| Action trigger (submit, save, delete)                                 | Button                                                                                     |
| Navigation to a completely different page / URL                       | Link / Nav                                                                                 |
| Multi-select filtering                                                | Checkbox group / Chip group                                                                |
| Only one panel exists (no switching needed)                           | Remove tabs entirely                                                                       |

### MUST NOT

- MUST NOT use pill-tabs as the **outermost** tab tier when the page genuinely has 3 tab tiers — the outermost tier MUST be `line-tabs` (see `line-tabs.md §2`)
- MUST NOT use pill-tabs for actions — use Button
- MUST NOT use pill-tabs when only one panel is available (≥ 2 tabs required)
- MUST NOT allow zero tabs to be selected
- MUST NOT stack two pill-tabs rows of the **same `level`** with no content between them (see §2a)

---

## 4. Anatomy

```
┌─ level="page" ─────────────────────────────────────┐
│  ╭───────╮ ╭───────╮ ╭───────╮ ╭───────╮           │
│  │ Tab A │ │ Tab B │ │ Tab C │ │ Tab D │  [⚙ action]│
│  ╰───────╯ ╰───────╯ ╰───────╯ ╰───────╯           │
└────────────────────────────────────────────────────┘

┌─ level="module" ───────────────────────────────────┐
│  ╭─────╮ ╭─────╮ ╭─────╮ ╭─────╮                   │
│  │Tab A│ │Tab B│ │Tab C│ │Tab D│      [⚙ action]   │
│  ╰─────╯ ╰─────╯ ╰─────╯ ╰─────╯                   │
└────────────────────────────────────────────────────┘
```

> The right-side action icon (§5b) is optional on **both** levels — `page` and `module`. It always sits at the far right of the same row as the tabs, never on its own line.

| Part                   | Required    | Description                                                                             |
| ---------------------- | ----------- | --------------------------------------------------------------------------------------- |
| Tab Label              | MUST        | Text identifying the panel content, wrapped in a capsule shape                          |
| Active Capsule         | MUST        | Filled capsule marking the currently selected tab                                       |
| Row Container          | MUST        | Horizontal strip holding all tab items, single-line                                     |
| Overflow Entry         | Conditional | Appears automatically when the row does not fit (see §6)                                |
| Right-side Action Icon | Optional    | A single action (filter / sort / settings) placed at the far right of the row (see §5b) |

---

## 5. Variants Overview

### 5a. Level Variants

| `level`    | Typical Placement                                                                                                                                                                                                                | Inactive Style                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `"page"`   | Top in-page tab row on a second-level page or any page with a breadcrumb (default starting tier); top in-page tab row on a top-level page that needs 1–2 tab tiers; OR the middle tier nested under `line-tabs` on a 3-tier page | Secondary capsule                                                 |
| `"module"` | Top of a card / widget switching the module's own primary view; OR the inner tier under a `pill-tabs page` on a 2-tier page; OR the innermost tier under `line-tabs` on a 3-tier page                                            | **Outline capsule — 1px stroke `color.divider.level2`** (see §5c) |

Designers MUST choose the `level` based on the tab's **position in the page hierarchy**, not on visual preference.

> **Visual distinction rule (authoritative):** The visible difference between `level="page"` and `level="module"` is the inactive item's border. `level="page"` inactive items carry **no stroke** (background-only or transparent capsule). `level="module"` inactive items carry a **1px stroke using `color.divider.level2`** on all four sides of the capsule. See §5c for exact values.

#### Decision tree — `"page"` vs `"module"` (authoritative)

Apply these checks **in order**. Stop at the first match.

1. **Is the pill-tabs the top in-page tab row on a second-level page or any page with a breadcrumb?**
   → `level="page"`. (See "Tier-based mapping" table below.)
2. **Is the pill-tabs the top in-page tab row on a top-level page (no breadcrumb) that needs only 1 or 2 tab tiers?**
   → `level="page"`.
3. **Is the pill-tabs the inner tier under a `pill-tabs page` (i.e. a 2-tier pill-tabs hierarchy)?**
   → `level="module"`. The outer tier is `page`, the inner tier is `module` — different shapes signal different tiers.
4. **Is the pill-tabs nested under a `line-tabs` panel on a 3-tier page?**
   → `level="page"` for the middle tier; `level="module"` for the innermost tier.
5. **Does the pill-tabs sit directly under a `FloorTitle` / section heading, and does it switch the _entire content_ of that named module / floor (not a sub-slice within it)?**
   → **`level="module"`**. The named module is itself a self-contained unit — even if the floor is rendered without a card border, the tab is the module's primary switcher.
6. **Is the pill-tabs at the top of a card / widget, switching the card's primary view?**
   → `level="module"`.

> **Anti-pattern — do not infer `"page"` from "this tab lives on a page":** A pill-tabs row that is the named module's own primary switcher is `"module"` regardless of whether the surrounding page has a breadcrumb. The trigger for `"module"` is **"is this the module's primary content switcher?"**, not "is this inside a card?".

#### Tier-based mapping (authoritative)

Use this table to decide the **top tab row**'s component and level, plus any tiers nested below it. The trigger is the **number of tab tiers the page needs** — not whether a breadcrumb is present.

| Page situation                                                                                                                | # of tab tiers | Outer tier         | Middle tier        | Inner tier         |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------ | ------------------ | ------------------ |
| **Top-level page (no breadcrumb), 1 tab tier**                                                                                | 1              | `pill-tabs page`   | —                  | —                  |
| **Top-level page (no breadcrumb), 2 tab tiers**                                                                               | 2              | `pill-tabs page`   | `pill-tabs module` | —                  |
| **Second-level page / page with breadcrumb, 1 tab tier**                                                                      | 1              | `pill-tabs page`   | —                  | —                  |
| **Second-level page / page with breadcrumb, 2 tab tiers**                                                                     | 2              | `pill-tabs page`   | `pill-tabs module` | —                  |
| **Any page that genuinely needs 3 tab tiers**                                                                                 | 3              | `line-tabs`        | `pill-tabs page`   | `pill-tabs module` |
| **Primary switcher of a named module / floor** (under a `FloorTitle` or section heading, switches the whole module's content) | —              | `pill-tabs module` | —                  | —                  |
| **Primary switcher inside a card / widget**                                                                                   | —              | `pill-tabs module` | —                  | —                  |

> **Note on "L" terminology.** This table refers to **tab-tier depth** (how many nested tab rows the page uses to switch its content). This is a different axis from `rules/page-structure-types.md`'s L1 / L2 / L3, which classifies **content-structure complexity** (single block / multiple modules / multi-group). Breadcrumb presence is **not** a trigger for the tab-tier decision — it only sets the default starting tier as `pill-tabs page` (it never demands or forbids line-tabs).

Rules implied by this mapping:

- **pill-tabs is the default tab component for 1-tier and 2-tier pages**, regardless of whether the page renders a breadcrumb.
- **2-tier pages MUST use `pill-tabs page` (outer) + `pill-tabs module` (inner)** — different shapes, not two same-shape rows. See §2a.
- **3-tier pages use `line-tabs` (outer) + `pill-tabs page` (middle) + `pill-tabs module` (inner)** so each tier is visually distinct.
- A pill-tabs that is the **named module's own primary content switcher** (sitting under a `FloorTitle` / section heading and switching the whole module) MUST use `level="module"`.
- Never use `line-tabs` on a 1-tier or 2-tier page; never use two same-shape pill-tabs rows back-to-back (see §2a).

### 5c. Inactive Item Stroke Rules (authoritative)

The stroke on an **inactive** pill item is the primary visual signal that distinguishes `level="page"` from `level="module"`. Designers and implementers MUST follow this table exactly — no substitution, no opacity scaling, no alternative tokens.

| `level`    | Inactive background   | Inactive stroke | Inactive stroke color token                                                           | Active background                                  | Active stroke                                      |
| ---------- | --------------------- | --------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| `"page"`   | `color.bg.weak`       | **None**        | —                                                                                     | `color.button.black.default` (filled dark capsule) | None                                               |
| `"module"` | Transparent (no fill) | **1px solid**   | **`color.divider.level2`** (`rgba(0,0,0,0.10)` light / `rgba(255,255,255,0.10)` dark) | `color.button.black.default` (filled dark capsule) | None (stroke is removed when the item is selected) |

> **Shared-grey-with-More-pill note.** The `page` inactive fill (`color.bg.weak`) is intentionally the **same grey** as the `page`-style More pill (§6.2 / §6.4). They share the shape and fill because a More pill _is_ structurally a page-level inactive pill — the only difference is the 3-dot icon content. Do NOT try to distinguish them by using a different grey on the More pill.

#### Visual reference — `level="module"` inactive row

```
┌─────────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│  Overview   │ │ Stocks  │ │  ETFs   │ │ Crypto  │ │  Forex  │   ← 1px stroke
│  (active)   │ │         │ │         │ │         │ │         │     color.divider.level2
└─────────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
     ▲
     │ active capsule: no stroke,
     │ filled black (button.black.default)
```

#### MUST

- MUST apply a **1px solid** border to every inactive item when `level="module"`
- MUST use **`color.divider.level2`** as the stroke color — no other divider / border token is allowed here
- MUST use the full capsule perimeter for the stroke — no partial (top-only / bottom-only) borders
- MUST remove the stroke (or set border to transparent) on the **active** item so the filled capsule reads as a single solid shape
- MUST ensure the item height remains identical between inactive (1px stroke) and active (no stroke) states — use a same-color 1px transparent border on the active item, or adjust padding, so the row does not shift vertically when selection changes

#### MUST NOT

- MUST NOT use `color.divider.level1`, `color.divider.level3`, `color.border.default`, or any gray token other than `color.divider.level2` for this stroke
- MUST NOT use a stroke on `level="page"` inactive items — stroke is the exclusive visual signal for `"module"` and using it on `"page"` collapses the level distinction
- MUST NOT vary stroke thickness (`0.5px`, `1.5px`, `2px`) — `level="module"` is always 1px on Web
- MUST NOT layer a stroke on top of the active dark capsule — the active state is a solid fill only

#### App platform note

On App (mobile), the stroke width matches the app-side stroke scale per `tokens/stroke.md` (§2.1) — **1px** for medium / large pills, **0.5px** only if an exceptionally small pill size is used. The color token remains `color.divider.level2`.

#### FAILURE

- A `level="module"` inactive pill has no visible border → add `border: 1px solid color.divider.level2`
- A `level="module"` inactive pill uses a different gray (e.g. `rgba(0,0,0,0.2)`) → replace with `color.divider.level2`
- A `level="page"` inactive pill has a border → remove the border; `"page"` is background-only
- Row height jumps when switching selection → add matching transparent 1px border on the active item, or adjust padding so total box height stays constant

### 5b. Content Variants

pill-tabs at either level supports two content layouts:

| Sub-variant                            | Description                                                                                    | When                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Plain pill tabs**                    | Only the tab row, no trailing element                                                          | Default                                                             |
| **Pill tabs + right-side action icon** | A single icon-only action pinned to the right end of the row (e.g. filter, sort, view-options) | When the module needs one persistent action tied to the current tab |

Rules for the right-side action icon:

- MUST be a **single** icon-only button — do not stack multiple icons
- MUST represent an action that applies to the **currently active panel**, not tab-level navigation
- The action is **not** a tab and MUST NOT appear selected
- If the tab row overflows, the action icon MUST remain visible (the tab row collapses before the icon does)

---

## 6. Behavior

### Selection

- Exactly **one** tab must be selected at all times
- Clicking an unselected tab switches the content panel immediately
- Clicking the already-selected tab is a no-op (must not deselect)

### Overflow & Responsive Adaptation (authoritative)

The component adapts its overflow behavior on **two independent axes only**:

1. **Container width** — `>500px` ("正常尺寸" / normal) vs. `≤500px` ("移动尺寸" / compact)
2. **Item count vs. available width** — "fits" (all pills render in full) vs. "does not fit" (overflow)

> **Platform is NOT an axis.** The same rules apply to Web and App — only the container width matters. A narrow side panel on Web and a phone viewport on App both follow the `≤500px` rules; a wide tablet App and a desktop Web both follow the `>500px` rules.

`level` (`page` vs `module`) does **not** change the overflow pattern itself — it only changes the heights / type sizes and the More pill's visual shape within the same pattern.

The resulting matrix (authoritative):

|                      | **Fits**                                               | **Few options · doesn't fit**                             | **Many options · doesn't fit**                                |
| -------------------- | ------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------- |
| **>500px** (normal)  | §6.1 — single line, no chrome                          | §6.2 — end-fixed arrows + horizontal swipe                | §6.3 — inline More pill + dropdown (no arrows, no swipe)      |
| **≤500px** (compact) | §6.4 — compact sizing, tail hard-clipped at right edge | §6.4 — same as "fits"; the edge-clip handles a small tail | §6.5 — compact + swipe + **bare floating 3-dot** (no capsule) |

#### 6.0 Layout invariants (authoritative, apply across §6.1–§6.4)

##### MUST

- MUST keep the row on a **single line** at every width and every state — never wrap
- MUST keep **exactly one tab active** during every transition (swipe, dropdown, sheet)
- MUST keep the **active pill visible** in the row after any selection — if the user picks a hidden tab from a dropdown / sheet, the row MUST update so the active pill is exposed (§6.3 rule 5 = swap into visible slot; §6.5 rule 6 = auto-scroll the swipe row)
- MUST render **every tab label in full** — never truncate a label with an ellipsis. Overflow is handled by collapsing the whole pill (>500px many options, §6.3), end-fixed arrows + swipe (>500px few options, §6.2), or hard-clipping the whole pill at the container's right edge (≤500px, §6.4 / §6.5) — never by shortening the text
- MUST support **sticky-on-scroll** (吸顶) for both `page` and `module` rows when placed at the top of a scrollable region
- MUST keep the **right-side action icon (§5b)** visible during overflow — tabs collapse first, the action icon never does
- MUST use a **10px inter-tab gap** at all widths — this spacing is canonical for both levels and MUST NOT be altered per page; the same 10px also applies between the last visible tab and any trailing affordance (arrow / inline More / bare 3-dot)

##### MUST NOT

- MUST NOT use the inline More pill (§6.3) and end-fixed arrows (§6.2) simultaneously at >500px — they are mutually exclusive overflow patterns selected by option count
- MUST NOT use end-fixed arrows at ≤500px — the ≤500px bucket relies on edge-clip (§6.4) or bare 3-dot (§6.5) instead
- MUST NOT let any trailing affordance (arrow / inline More / bare 3-dot) overlap a tab pill in a way that hides tab text — keep a 10px gap between the last visible tab and the affordance
- MUST NOT redesign the overflow visual per page — the component's defaults in §6.1–§6.5 are authoritative

#### 6.1 Width >500px · "few options" (fits without overflow)

- Single line, every tab fully visible
- **No arrows, no More pill** — row is self-contained
- Hover state is available; active state is the filled black capsule (§5c)
- Heights / type (default):
  - `page`: height **40px**, active **16px semibold**, inactive **16px medium**
  - `module`: height **36px**, active **14px semibold**, inactive **14px medium**
- Inter-tab gap: **10px**

#### 6.2 Width >500px · "few options but does not fit" (arrow-swipe)

When the option count is small (handful) but the row still cannot fit the container width, the component MUST use **arrow-swipe**:

1. **Two arrow affordances pinned to the row's two ends** — `‹` on the left, `›` on the right.
2. Pills **between the arrows are horizontally swipeable** by pointer drag / trackpad scroll.
3. Arrows stay **fixed at the ends** while pills swipe underneath; arrows do not move with the content.
4. **Arrow visual: bare chevron icon, NO background, NO circular button.** The arrow is rendered as the chevron glyph (`‹` / `›`) alone, color `color.text.primary`, vertically centered to the tab-row height, with tap-target padding around it. **No fill, no stroke, no pill / circle wrapper.**
5. No More pill, no dropdown — the short list is fully reachable by swipe.
6. Sticky-on-scroll MUST be supported.

> **Why arrows here and not for "many options"?** When the hidden tail is small, arrows give a deterministic, linear way to reach it. A dropdown would be over-engineering. The threshold between "few" and "many" is a product judgement — when there is a natural collapsible tail (usually ≥ 2–3 hidden pills of meaningful length), switch to §6.3.

#### 6.3 Width >500px · "many options" (collapse to inline More + dropdown)

When the option count is large enough that arrow-swipe becomes tedious (the user would scroll through many pills to reach the tail), the component MUST collapse the tail into an **inline More pill** with a dropdown:

1. **Exposed leading pills remain fully visible** in the row, in their normal positions. **The visible tab count is reduced** — only the leading tabs that fit in full are rendered inline; the rest are collapsed out of the row entirely (not clipped, not truncated, not overflowed).
2. **The trailing tail is hidden behind a single inline More pill** at the row's right end. The tail tabs exist only inside the dropdown until one is selected.
3. The row is **NOT** horizontally swipeable — all hidden tabs are accessed via the dropdown, not by dragging.
4. **No arrows.** Arrows and the More pill are mutually exclusive in the >500px bucket: §6.2 = arrows only, §6.3 = More pill only.
5. **Clicking the More pill opens a dropdown** listing the currently hidden tabs. Selecting a hidden tab:
   - **swaps** the selected tab into the row by replacing the **last visible** pill (which moves into the dropdown), so the active pill is always visible in the row
   - keeps the More pill in place at the end of the row
6. **Active state in dropdown.** Any tab that is currently active, if it appears in the dropdown, MUST be rendered with a highlighted / selected row style.
7. Sticky-on-scroll MUST be supported.
8. Dropdown content layout is business-customizable (single-column list, grouped, with secondary info, etc.).
9. A single tab MAY be granted special per-tab visual treatment (icon + label, accent badge) when product needs require it.

**More pill shape at >500px (inline More)** (differs by `level`):

| `level`    | More pill shape                                                                                                      | More pill content                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `"page"`   | **Filled grey capsule** — background `color.bg.weak`, no stroke, height **40px** (matches active tab)                | 3-dot ellipsis icon: exactly **3 dots**, each **4×4px**, 4px equal gap, color `color.text.primary` |
| `"module"` | **Outline capsule** — transparent background, 1px solid `color.divider.level2`, height **36px** (matches active tab) | Text label **"More"** — 14px semibold, color `color.text.primary`                                  |

> The More pill at >500px is **inline** — it sits in the row's normal flow after the last visible tab, with a 10px gap. It is **not** overlaid / floating at this width.

#### 6.4 Width ≤500px · "few options" (compact + hard edge-clip)

At ≤500px the component applies **compact sizing** uniformly. When the option count is small, the row is rendered as-is; a tail pill that doesn't fit is **hard-clipped at the container's right edge** (no affordance chrome).

Compact-sizing transform (applied to both `page` and `module` at any ≤500px state):

| Property                   | >500px value                | ≤500px value                                                      |
| -------------------------- | --------------------------- | ----------------------------------------------------------------- |
| Tab height                 | `page` 40px / `module` 36px | **32px** (both levels)                                            |
| Tab text size              | `page` 16px / `module` 14px | **14px** (both levels)                                            |
| Tab font weight (active)   | semibold                    | **semibold** (unchanged)                                          |
| Tab font weight (inactive) | medium                      | **semibold** (unified — inactive also becomes semibold at ≤500px) |
| Inter-tab gap              | 10px                        | **10px** (unchanged)                                              |

"Few options" behavior:

- All tabs render in full, single line, compact sizing
- **No arrows, no More button, no swipe affordance**
- If the list is wider than the viewport, the tail pill is **hard-clipped at the container's right edge** — the pill's shape is cut by the edge (not the text). This is the affordance: the visible cut implicitly tells the user "more on the right, swipe to see".
- Horizontal swipe may still be enabled silently as a gesture (no affordance chrome), but no visual swipe hint is shown

> The hard edge-clip is **intentional** and **replaces arrows at ≤500px** — narrow viewports cannot spare the width for an arrow button, so the edge-cut acts as the sole visual signal.

#### 6.5 Width ≤500px · "many options" (compact + swipe + bare 3-dot with sheet)

When the option count is large at compact width, the component MUST provide **two parallel access paths** to the full tab list — the row itself remains fully populated but may extend past the viewport:

1. **All tabs are rendered inline** in the row, in their declared order. The row is **wider than the viewport** and extends past the right edge — **tabs near the tail may be partially or fully clipped by the container's right edge**. Clipping is visual only; every tab still occupies its natural width and renders its label in full (never ellipsis-truncated).
2. **Dual-affordance access** to the clipped / off-screen tail:
   - **Swipe** — the row is horizontally swipeable; swiping left drags the clipped tail into view.
   - **Tap the bare 3-dot** — opens a bottom-sheet / dropdown panel listing **all** tabs (visible + clipped + off-screen).
3. **A bare 3-dot affordance is pinned to the row's right edge**, 10px gap from the last visible tab. The 3-dot does NOT move with swipe — it stays fixed at the right.
4. **The bare 3-dot is NOT a capsule** — no fill, no stroke, no pill wrapper. Just three 4×4px dots with 4px gap, color `color.text.primary`, vertically centered to the compact row height.
5. **Both `page` and `module` use the identical bare 3-dot affordance at ≤500px** — the level distinction is already carried by the tab row's own pill style; the affordance does not repeat it.
6. Selecting a tab from the sheet:
   - closes the sheet
   - marks the tab active
   - **auto-scrolls the underlying swipe row** to bring the selected pill into view
7. The active tab in the sheet MUST be rendered with a highlighted / selected row style.
8. Sticky-on-scroll MUST be supported.
9. Sheet content layout is business-customizable.
10. Single-tab special styling MAY be applied.

**Floating 3-dot affordance at ≤500px** (same for both levels):

| Property      | Value                                                                             |
| ------------- | --------------------------------------------------------------------------------- |
| Shape         | None — bare 3-dot icon, no capsule background, no stroke                          |
| Content       | Exactly **3 dots × 4×4px**, 4px equal gap, color `color.text.primary`             |
| Position      | Pinned to the right edge of the tab row, 10px gap from the last visible tab       |
| Level variant | None — both `page` and `module` use the identical bare 3-dot affordance at ≤500px |

> **≤500px drops the capsule.** Unlike the >500px inline More pill (which has a capsule + level-specific shape), the ≤500px affordance is **content-only** — just the 3 dots, no pill wrapper. This matches the tighter mobile layout and avoids the "pill-on-pill" visual.

> **§6.5 differs from §6.3.** At >500px "many options" (§6.3), the row **drops** tabs from the inline layout and collapses them into a dropdown — no swipe, only click-to-open. At ≤500px "many options" (§6.5), the row **keeps every tab inline** and lets the tail extend past the viewport — the user may either **swipe** to pull the tail in, OR **tap the bare 3-dot** to see every tab in a sheet. Tabs MAY be clipped by the right edge (the clip is a swipe affordance, identical in spirit to §6.4's edge-cut); tab **labels** are still never truncated with an ellipsis.

#### MUST (summary, cross-cutting)

- MUST pick the width bucket by the **surrounding container's width**, not by platform — `>500px` uses §6.1/§6.2/§6.3, `≤500px` uses §6.4/§6.5
- MUST apply the full compact transform (height 32px, text 14px, inactive weight semibold) as a single atomic switch at ≤500px
- MUST pick the >500px overflow pattern by option count:
  - **few options, doesn't fit** → §6.2 arrows + swipe (no More pill)
  - **many options** → §6.3 inline More pill + dropdown (no arrows)
- MUST keep the >500px inline More pill shape matched to `level` (page = filled grey + 3 dots; module = outline + "More" text)
- MUST use a **bare 3-dot affordance (no capsule) for both levels** at ≤500px — the capsule disappears in the compact bucket
- MUST render the active tab with a highlight row in any dropdown / sheet that includes it
- MUST keep a **10px gap** between the last visible tab and any trailing affordance (arrow, inline More pill, or bare 3-dot at ≤500px)

#### MUST NOT

- MUST NOT truncate a tab label with an ellipsis — the label is always full text
- MUST NOT wrap the tab row onto a second line at any width
- MUST NOT shrink tab-row horizontal padding as an overflow-handling step — there is no "shrink padding first" phase; at >500px go straight to arrows (few) or More (many), at ≤500px go straight to edge-clip (few) or 3-dot hint (many)
- MUST NOT mix arrows and the More pill in the same state at >500px (§6.2 and §6.3 are mutually exclusive)
- MUST NOT use arrows at ≤500px — ≤500px relies on edge-clip (§6.4) or bare 3-dot (§6.5)
- MUST NOT wrap the ≤500px 3-dot hint in a capsule / background / stroke — the ≤500px affordance is **bare dots only**
- MUST NOT use the "More" text label at ≤500px — the text label is a >500px-only module-style chrome; at ≤500px both levels use the bare 3-dot
- MUST NOT mix the two >500px More styles across levels:
  - MUST NOT render a `page`-row >500px More as an outline + "More" text (that is the module style)
  - MUST NOT render a `module`-row >500px More as a filled grey + 3-dot icon (that is the page style)
- MUST NOT change the 3-dot count (always exactly **3 dots × 4×4px with 4px gap**)

#### FAILURE

- Tab labels are truncated with `…` to fit a narrower pill → remove truncation; at >500px use §6.3 dropdown, at ≤500px use §6.5 sheet or let §6.4 edge-clip the whole pill
- Tab row at >500px shrinks its horizontal padding before showing arrows/More → remove the shrink step; go directly to §6.2 or §6.3 based on option count
- The ≤500px 3-dot has a grey capsule background → remove the capsule; the ≤500px affordance is bare dots only
- Arrows appear at ≤500px → remove arrows; the ≤500px pattern is edge-clip (§6.4) or bare 3-dot (§6.5)
- An active pill disappears into the dropdown / sheet after selection → swap it back into the visible row (§6.3 rule 5) or auto-scroll it into view (§6.5 rule 5)

### Keyboard

- `ArrowLeft` / `ArrowRight`: move focus between tabs
- `Home` / `End`: move to first / last tab
- `Tab`: move focus out of the tablist

### SEO / Deep Linking

- pill-tabs supports rendering each trigger as an `<a>` tag via the `href` prop
- Use this when tabs should be directly linkable / indexable (e.g. public-facing content pages)

---

## 7. Configurable Options

The following decisions should be made explicitly by the designer; other visual details are handled by the component.

| Option                   | Purpose                                                           | Typical Values                                          |
| ------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------- |
| `level`                  | Hierarchy level of the tab row                                    | `"page"` (page secondary) / `"module"` (module primary) |
| `defaultValue` / `value` | Which tab is active on load / controlled value                    | tab `value` string                                      |
| `href` (per trigger)     | Render trigger as `<a>` for SEO / deep linking                    | URL string                                              |
| Right-side action icon   | Whether a single trailing icon-only action is attached to the row | present / absent                                        |

Designers MUST decide explicitly:

- Which **level** (§5a) applies based on page hierarchy
- Whether a **right-side action icon** (§5b) is needed, and which single action it represents
- Whether triggers need `href` for SEO / deep linking

---

## 8. Do / Don't

|       | Practice                                                                                                                                                                                                                                                                                                        | Reason                                                                                                                                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DO    | **Use `pill-tabs level="page"` as the default top in-page tab row for any second-level page or any page with a breadcrumb**                                                                                                                                                                                     | pill-tabs is the default starting tier — never start from line-tabs on these pages                                                                                                                                          |
| DO    | **Express a 2-tier hierarchy as `pill-tabs page` (outer) + `pill-tabs module` (inner)** — different shapes for different tiers                                                                                                                                                                                  | Same-shape rows back-to-back read as a single broken row, not as two tiers (see §2a)                                                                                                                                        |
| DO    | **Stack `page` (outer) and `module` (inner) vertically, each on its own line at full content width**                                                                                                                                                                                                            | The two tiers are a parent → child drill-down; vertical stacking preserves that reading order (see §2b)                                                                                                                     |
| DO    | On 3-tier pages, use `line-tabs` (outer) + `pill-tabs page` (middle) + `pill-tabs module` (inner)                                                                                                                                                                                                               | Three visually distinct tiers — each one signals a different hierarchy level                                                                                                                                                |
| DO    | Use `level="module"` for the primary switcher of a named module — whether inside a card/widget or under a `FloorTitle` / section heading that owns the whole module's content                                                                                                                                   | Outline (1px `color.divider.level2`) stroke signals module-level primary context; see §5c                                                                                                                                   |
| DO    | Use pill-tabs for related slices of one content domain                                                                                                                                                                                                                                                          | Capsule shape signals "same domain, different slice"                                                                                                                                                                        |
| DO    | **Switch overflow pattern by container width AND option count**: <br>· >500px + few + doesn't fit → end-fixed arrows + swipe (§6.2) <br>· >500px + many → inline More pill + dropdown (§6.3) <br>· ≤500px + few → compact + edge-clip (§6.4) <br>· ≤500px + many → compact + swipe + bare floating 3-dot (§6.5) | This is the only responsive axis — platform (Web vs App) does not matter (see §6)                                                                                                                                           |
| DO    | **Let the tab row's tail hard-clip at the container's right edge when ≤500px and the list slightly overflows** (no arrows, no affordance)                                                                                                                                                                       | The visible edge-cut is the affordance itself — adding arrow buttons would duplicate the signal (see §6.4)                                                                                                                  |
| DO    | **Use the inline More pill (with capsule) at >500px many options; use the bare 3-dot (no capsule) at ≤500px many options** — match >500px inline-pill shape to `level` (page = filled grey + 3 dots; module = outline + "More" text); ≤500px is bare dots regardless of level                                   | The capsule disappears in compact bucket because the level cue is already carried by the row itself (see §6.3 / §6.5)                                                                                                       |
| DO    | Keep the right-side action icon to a **single** icon-only button                                                                                                                                                                                                                                                | Prevents the row from competing with the tabs                                                                                                                                                                               |
| DON'T | **Use `line-tabs` on a 1-tier or 2-tier page** — even if the page has a breadcrumb or feels visually important                                                                                                                                                                                                  | line-tabs is reserved for 3-tier pages only; breadcrumb presence does NOT trigger line-tabs                                                                                                                                 |
| DON'T | **Use `pill-tabs` as the outermost tier when the page genuinely needs 3 tab tiers** — the outermost tier MUST be `line-tabs`                                                                                                                                                                                    | line-tabs exists specifically to provide the third visual tier                                                                                                                                                              |
| DON'T | **Stack two pill-tabs rows of the same `level` directly adjacent with no content between them** — this includes manually wrapping one pill-tabs row onto two visual lines because it has too many options                                                                                                       | Two same-shape rows back-to-back read as a single broken / wrapped row, defeating the tier system; let the component's overflow handle long lists (see §2a, §6)                                                             |
| DON'T | **Place `page` and `module` side-by-side in the same row, or split the page into two columns where one column hosts `page` and the other hosts `module`**                                                                                                                                                       | The two tiers are parent → child, not siblings; side-by-side placement destroys the drill-down relationship (see §2b)                                                                                                       |
| DON'T | **Wrap a pill-tabs row onto a second visual line when there are too many options** — use the component's width × count overflow logic                                                                                                                                                                           | Wrapping breaks the single-line invariant and collapses the tier distinction (see §6)                                                                                                                                       |
| DON'T | **Shrink the tab row's horizontal padding as an overflow-handling step** — there is no "shrink padding first" phase; pick the pattern directly from {width, count}                                                                                                                                              | Padding shrink was removed from the spec to keep the matrix unambiguous (see §6)                                                                                                                                            |
| DON'T | **Use end-fixed arrows at ≤500px** — at ≤500px arrows are replaced by edge-clip (§6.4) or bare 3-dot (§6.5)                                                                                                                                                                                                     | Arrows cost too much horizontal space on narrow viewports                                                                                                                                                                   |
| DON'T | **Use the inline More pill (with capsule) at ≤500px** — at ≤500px the affordance is bare dots without any pill / fill / stroke                                                                                                                                                                                  | A capsule-on-a-compact-row creates a "pill on pill" visual; the level cue is already carried by the row's own pill style (see §6.5)                                                                                         |
| DON'T | **Mix end-fixed arrows and the inline More pill in the same state at >500px**                                                                                                                                                                                                                                   | §6.2 (arrows for few) and §6.3 (More for many) are mutually exclusive                                                                                                                                                       |
| DON'T | **Truncate a tab label with an ellipsis** to make it fit a narrower pill                                                                                                                                                                                                                                        | The label is always full text; overflow is handled by collapsing the whole pill (>500px many options) or hard-clipping the whole pill at the container edge (≤500px few options) — never by shortening the label (see §6.0) |
| DON'T | **Mix the two >500px More shapes across levels** — page row must use filled grey + 3-dot icon; module row must use outline capsule + "More" text                                                                                                                                                                | Shape is the level cue at >500px; swapping them collapses the level signal (see §6.3)                                                                                                                                       |
| DON'T | **Use the "More" text label at ≤500px** — at ≤500px both levels use the bare 3-dot affordance                                                                                                                                                                                                                   | The text label is a >500px-only chrome; ≤500px drops it (see §6.5)                                                                                                                                                          |
| DON'T | **Fake a tab row with custom markup (e.g. a black filled rectangle for the active item and plain text for inactive items)**                                                                                                                                                                                     | This is neither line-tabs nor pill-tabs; it bypasses the component and its overflow / accessibility behavior                                                                                                                |
| DON'T | Upgrade a pill-tabs row to line-tabs because the page has a breadcrumb or "looks important"                                                                                                                                                                                                                     | Breadcrumb presence no longer forces line-tabs; tier count does (≥ 3 tiers)                                                                                                                                                 |
| DON'T | Put multi-icon action clusters beside the tab row                                                                                                                                                                                                                                                               | Use a single trailing icon; move extra actions into the panel                                                                                                                                                               |
| DON'T | Redesign the overflow visual per page                                                                                                                                                                                                                                                                           | The component's default overflow behavior is authoritative                                                                                                                                                                  |
| DON'T | Use pill-tabs for actions or multi-select filters                                                                                                                                                                                                                                                               | Use Button / Checkbox group instead                                                                                                                                                                                         |
| DON'T | Allow zero selected tabs                                                                                                                                                                                                                                                                                        | pill-tabs is single-select — always one active                                                                                                                                                                              |
