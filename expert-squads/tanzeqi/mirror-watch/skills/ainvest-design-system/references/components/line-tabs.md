# Guidelines — line-tabs

> **Component Spec:** `ainvest-design-system/references/components/line-tabs.md`

---

## 0. Document Role

This document covers **when and how to use** the line-tabs (线性标签页) component. It focuses on decisions a designer must make explicitly — visual details handled automatically by the component are omitted.

<!-- - Component import: `@ainvest/line-tabs` -->

---

## 1. Definition

line-tabs is a **top-level tab** with an underline indicator on the active label. It is reserved for pages whose tab hierarchy is **deep enough that pill-tabs alone cannot visually distinguish all tiers** — typically pages with **3 tab tiers**. The outermost tier becomes line-tabs; the inner tiers remain pill-tabs (`level="page"` and `level="module"` respectively).

Compared with other tab sub-types:

| Sub-type | Purpose |
|----------|---------|
| **line-tabs** | Outermost tier when a page needs ≥ 3 tab tiers and pill-tabs alone (`page` + `module`) is no longer sufficient to distinguish hierarchy |
| pill-tabs | Default tab for top-level / secondary / module-level switching (1–2 tab tiers) — **always use pill-tabs first**; only escalate to line-tabs when a 3rd outer tier is needed |
| segment-tabs | Dense segmented control inside a bordered container (e.g. chart timeframe) |

---

## 2. When to Use

> **Primary trigger:** line-tabs is allowed **only when the page needs ≥ 3 tab tiers** (i.e. when stacking `pill-tabs page` + `pill-tabs module` is no longer enough to express the hierarchy and an additional outer tier is required). In all 1-tier and 2-tier scenarios — including pages with a breadcrumb — use `pill-tabs` instead. See `pill-tabs.md §2, §5a — Tier-based mapping`.

| Condition | Use line-tabs? |
|-----------|----------------|
| Page has **≥ 3 tab tiers** (e.g. outer tab switches major content groups; middle tab is a `pill-tabs page`; inner tab is a `pill-tabs module`) — the outermost tier | **YES** |
| Outermost tier switches **major independent content groups**, and each group already needs both `pill-tabs page` AND `pill-tabs module` below | YES |
| User expects a persistent top-of-page switcher that stays visible on scroll | YES (with sticky enabled) |
| The tab row may need to overflow horizontally on narrow viewports | YES |
| Page has only **1 tab tier** | **NO — use `pill-tabs`** (`level="page"` for top in-page rows; `level="module"` for module primary switchers) |
| Page has **2 tab tiers** that can be distinguished by `pill-tabs page` + `pill-tabs module` | **NO — use two `pill-tabs` of different `level`** (see §3) |
| Page is a category / detail / sub-page under a breadcrumb, with content that needs at most 2 tab tiers | **NO — use `pill-tabs`** |

### MUST

- **MUST be used only when the page genuinely requires 3 tab tiers.** If the hierarchy can be expressed with `pill-tabs page` + `pill-tabs module` (2 tiers), that is the correct solution — line-tabs is a third-tier escalation, not a default.
- MUST be paired with **at least one `pill-tabs page` and one `pill-tabs module`** nested inside its panels — a line-tabs row that does not sit on top of a 2-tier pill-tabs structure is a misuse
- MUST keep exactly one tab selected at all times (single-select)
- MUST render only one line-tabs instance per page (there is exactly one outermost tier)

### SHOULD

- SHOULD use the **fixed-gap** variant on Web (recommended default)
- SHOULD enable sticky (吸顶) when the page has long scrollable content below the tabs

---

## 3. When NOT to Use

| Condition | Use Instead |
|-----------|-------------|
| **Page has only 1 tab tier** (regardless of breadcrumb presence) | `pill-tabs level="page"` (top in-page row) or `pill-tabs level="module"` (module primary) |
| **Page has 2 tab tiers** that can be expressed by stacking `pill-tabs page` over `pill-tabs module` | Two `pill-tabs` rows with **different `level`** values (page on top, module below) — never line-tabs |
| Switching between filters of the same list (module-level) | pill-tabs |
| Chart timeframe / dense segmented control | segment-tabs |
| Action trigger (submit, save, delete) | Button |
| Navigation to a completely different page / URL | Link / Nav |
| Multi-select filtering | Checkbox group / Chip group |
| Only one panel exists (no switching needed) | Remove tabs entirely |

### MUST NOT

- **MUST NOT use line-tabs when the page has only 1 or 2 tab tiers.** A 2-tier hierarchy MUST be expressed as `pill-tabs page` (outer) + `pill-tabs module` (inner) — escalating it to line-tabs collapses the visual rhythm and breaks the tier-distinction system.
- MUST NOT use line-tabs as a "page-level emphasis" shortcut just because the page feels important or has a breadcrumb — breadcrumb presence does not factor into this decision; only tier count does
- MUST NOT stack two line-tabs rows on the same page — only one outermost tier is allowed; any further nested tiers MUST be pill-tabs
- MUST NOT use line-tabs for actions — use Button
- MUST NOT use line-tabs when only one panel is available (≥ 2 tabs required)
- MUST NOT allow zero tabs to be selected
- MUST NOT recreate a line-tabs look by mixing an "active filled pill" with "unstyled text" inactive items — if the design calls for capsule-shaped tabs, use `pill-tabs` as-is; if it calls for underline tabs, use `line-tabs` as-is. Custom hybrid styles are forbidden.

---

## 4. Anatomy

```
┌──────────┬──────────┬──────────┬──────────┐
│ Tab A    │ Tab B    │ Tab C    │ Tab D    │   ← tab labels (text)
│ ━━━━━━━  │          │          │          │   ← 3px underline indicator (active only)
└──────────┴──────────┴──────────┴──────────┘
```

| Part | Required | Description |
|------|----------|-------------|
| Tab Label | MUST | Text identifying the panel content. Inactive default text: `color.text.primary`. Inactive hover text: `color.text.secondary` (no underline added on hover). Active text: `color.text.primary` + bold. |
| Selection Indicator | MUST | **3px underline** on the active tab label, color `color.text.primary`. The 3px value is the component's fixed spec and does NOT follow the global stroke scale — see `tokens/stroke.md` §Component-owned exceptions. |
| Row Container | MUST | Horizontal strip holding all tab items |
| Scroll Arrows (‹ ›) | Conditional | Appear only in the "few tabs + Web overflow" pattern (see §5.1) |
| Overflow Menu (…) | Conditional | Appear only in the "many tabs + Web" pattern (see §5.2) |

---

## 5. Variants Overview

line-tabs has **two spacing variants** and **two content-volume patterns**, combined with **two responsive size tiers**.

### 5a. Spacing Variants

| Variant | When | Platform |
|---------|------|----------|
| **Fixed-gap (固定间距)** | Default for Web page-level navigation | Web (recommended) |
| **Equal-width (均分)** | Small modules or App-specific layouts; AVOID on Web page-level due to viewport width issues | App / small modules / special cases |

- **MUST** use fixed-gap on Web page-level navigation
- **MUST NOT** use equal-width on Web page-level navigation — it only fits inside small modules or mirrors an App-side component
- For small-module usage on Web, reference the App-side line-tabs component

### 5b. Content-Volume Patterns

There are two patterns based on how many tabs are present relative to the container width:

| Pattern | Condition |
|---------|-----------|
| **Pattern A — Few tabs, row overflows** | Tab count is small but the total label width exceeds the container |
| **Pattern B — Many tabs, row overflows** | Tab count is large; some tabs must be hidden behind an overflow menu |

See §5.1 and §5.2 for pattern rules.

### 5c. Responsive Size Tiers

line-tabs adapts its typography and spacing at a **500px** breakpoint:

| Viewport | Font Size | Font Weight | Tab Gap | Overflow Strategy |
|----------|-----------|-------------|---------|-------------------|
| `> 500px` (normal / Web) | **18px** | **Bold** | **48px** | Truncate + fixed arrows (Pattern A) OR `…` overflow menu (Pattern B) |
| `≤ 500px` (mobile) | 16px | Bold | 24px | Truncate without arrows (Pattern A) OR `…` overflow menu with horizontal swipe (Pattern B) |

---

## 5.1 Pattern A — Few Tabs, Row Overflows

Used when the total number of tabs is small but the labels still do not fit within the container width.

### On Web (> 500px)

- **Adaptation rule:** Tabs are truncated; arrow buttons (`‹` `›`) are fixed on the left and right ends of the row
- User clicks arrows to scroll the tab row horizontally
- Active underline always follows the selected tab

### On Mobile (≤ 500px)

- **Adaptation rule:** No arrows — labels are rendered in full (not truncated) at reduced size
- Font size shrinks to **16px**
- Tab-to-tab gap shrinks to **24px**
- Row is horizontally swipeable

---

## 5.2 Pattern B — Many Tabs, Row Overflows

Used when the total number of tabs is large and a portion must be hidden to keep the primary row readable.

### On Web (> 500px)

1. An ellipsis entry (`…`) is appended **after the last visible tab**
2. Only the portion of tabs that fits is displayed; user **cannot** scroll the tab row left/right
3. When the viewport narrows below the width needed to show the last visible tab, the last-visible tab is **collapsed into the overflow menu** automatically
4. Clicking `…` opens a dropdown menu containing **only the overflowed tabs** (tabs already visible in the row are not repeated inside the menu)
5. When an item in the dropdown is selected, that tab becomes active and the `…` label is **replaced with the selected label**
6. The tab row supports **sticky (吸顶)** on scroll
7. The dropdown menu content is **customizable per business** (supports grouping, icons, info tooltips, etc.)
8. A single tab may have its own **special style override** (see §7)

### On Mobile (≤ 500px)

1. **All tabs** are rendered inside the row; user can horizontally **swipe left/right** to view more
2. A "More" button (`…`) is **permanently pinned** to the right edge of the tab row (visual style may vary with container width)
3. The dropdown from "More" lists **all** tabs (not only overflowed ones)
4. Tapping a tab inside the dropdown auto-scrolls the row to the matching tab and selects it
5. The tab row supports **sticky (吸顶)** on scroll
6. The dropdown menu content is **customizable per business**
7. A single tab may have its own **special style override** (see §7)

---

## 6. Behavior

### Selection

- Exactly **one** tab must be selected at all times
- Clicking an unselected tab switches the content panel immediately
- Clicking the already-selected tab is a no-op (must not deselect)
- Active tab label color: `color.text.primary`
- Active indicator: **3px** underline, color `color.text.primary`, spans the full label width

### Hover

line-tabs hover feedback is **text-color only**. There is **no hover underline** — the underline is exclusively the active-state indicator, so users never confuse a hovered tab with the selected one.

| Target | State | Visual | Token |
|--------|-------|--------|-------|
| Inactive tab label | Default | Text only, no underline | Text: `color.text.primary` |
| Inactive tab label | **Hover** | Text color **lightens** to secondary; **no underline added** | Text: `color.text.secondary` |
| Inactive tab label | Pressed | Same as hover | Text: `color.text.secondary` |
| Active tab label | Default / Hover | 3px underline always present; hover does not change visual | Text: `color.text.primary`; underline: `color.text.primary` |

Rules:

- MUST change the **text color** to `color.text.secondary` on hover for inactive tabs — this is the only hover visual
- MUST NOT add an underline (or any other indicator) on hover — the 3px underline is reserved for the active state
- MUST NOT add background fill, box-shadow, or transform on hover
- MUST NOT change the active tab's appearance on hover — it stays at `color.text.primary` + 3px underline regardless of cursor position
- MUST reserve 3px of vertical space for the active underline at all times so the row height does not shift between inactive and active states
- The hover rule here is the authoritative spec for line-tabs and supersedes the generic "一级 Tab" entry in `references/rules/hover.md §3.5`

### Sticky (吸顶)

- line-tabs supports sticky positioning: when the page scrolls past the tabs, the tab row pins to the top of the viewport
- Use sticky when the content panel is long enough that the user may lose the tab row while scrolling

### Overflow Interaction

- **Pattern A (few tabs):** Arrows control horizontal scroll on Web; swipe on Mobile
- **Pattern B (many tabs):**
  - Web — overflow menu via `…` (opens dropdown of overflowed tabs only)
  - Mobile — swipe to reveal any tab + pinned "More" button for full-list dropdown

### Keyboard

- `ArrowLeft` / `ArrowRight`: move focus between tabs
- `Home` / `End`: move to first / last tab
- `Tab`: move focus out of the tablist

---

## 7. Configurable Options

The following behaviors should be exposed as props (or equivalent design decisions) on line-tabs:

| Option | Purpose | Typical Values |
|--------|---------|----------------|
| `showArrows` | Show fixed `‹ ›` arrows on both ends when tab row overflows (Web, Pattern A) | `true` / `false` |
| `overflowMode` | How to handle overflow when tab count is large | `"menu"` (Pattern B — `…` dropdown) / `"scroll"` (Pattern A — arrows or swipe) |
| `sticky` | Pin the tab row to top of viewport on scroll | `true` / `false` |
| `spacing` | Spacing variant | `"fixed-gap"` (Web default) / `"equal"` (App / small modules) |
| `dropdownContent` | Custom content slot for the overflow dropdown (allows business-specific layout, grouping, icons) | `ReactNode` |
| `tabStyleOverride` | Allow a single tab to carry a special style (e.g. highlight, badge) | per-tab override |
| `responsiveBreakpoint` | Viewport width at which Mobile-size rules take over | Default `500px` |

Designers MUST decide explicitly:

- Which **spacing variant** to use (§5a)
- Which **overflow pattern** applies based on tab count (§5.1 vs §5.2)
- Whether the tab row should be **sticky**
- Whether any tab requires a **special style override**, and what it is

---

## 8. Do / Don't

| | Practice | Reason |
|---|---------|--------|
| DO | Use line-tabs **only** when the page needs ≥ 3 tab tiers (line-tabs outermost, `pill-tabs page` middle, `pill-tabs module` inner) | line-tabs is a third-tier escalation, not a default page-level tab |
| DO | Use a **3px** underline for the active indicator only, color `color.text.primary` | Underline is reserved for the active state — never use it as a hover visual |
| DO | On hover of an inactive tab, only change the **text color** to `color.text.secondary` (no underline, no background) | Hover stays minimal so the active state remains the only underlined item |
| DO | Use fixed-gap spacing on Web | Recommended default; equal-width doesn't scale to page widths |
| DO | Enable sticky when content below is long | Keeps navigation visible |
| DO | Use Pattern A (arrows) when tab count is small but overflows | Minimal visual complexity |
| DO | Use Pattern B (`…` menu) when tab count is large | Keeps primary row readable |
| DO | Replace `…` with the selected label when a dropdown item is chosen (Web, Pattern B) | Confirms current selection in the primary row |
| DON'T | **Use line-tabs when the page has only 1 or 2 tab tiers** — even on a top-level page with no breadcrumb | 1-tier and 2-tier hierarchies MUST be expressed with `pill-tabs` (page / module); line-tabs is reserved for 3-tier pages |
| DON'T | Stack two line-tabs rows on the same page | Only one outermost tier exists; nested tiers MUST be `pill-tabs` |
| DON'T | Use a 1px / 2px / 4px underline | Spec-fixed at **3px** for the active indicator |
| DON'T | **Add an underline on hover** | Underline is exclusive to the active state; hover uses text-color change only |
| DON'T | Add background fill or transform on hover | Only the text color changes (`color.text.primary` → `color.text.secondary`) |
| DON'T | **Invent a hybrid style (active filled pill + unstyled text inactive)** | Such a design is neither line-tabs nor pill-tabs — pick one and use it as the component defines |
| DON'T | Use equal-width (均分) spacing at Web page level | Viewport width too variable — only suitable for App / small modules |
| DON'T | Repeat already-visible tabs inside the `…` dropdown on Web | Dropdown should contain overflowed tabs only |
| DON'T | Hide tabs on Mobile by default | On Mobile, all tabs should be swipeable in-row; use the pinned "More" button for full-list access |
| DON'T | Use line-tabs for actions or for multi-select filters | Use Button / Checkbox group instead |
| DON'T | Allow zero selected tabs | line-tabs is single-select — always one active |
