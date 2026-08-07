# Guidelines — Collapse (折叠面板)

> **Component Spec:** `ainvest-design-system/references/components/collapse.md`
>
> **See also:** `ainvest-design-system/references/components/text-collapse.md`

---

## 0. Document Role

This document covers **when and how to use** the Collapse (折叠面板) component for **module-level** and **list-level** folding. It focuses on decisions a designer must make explicitly — visual details handled automatically by the component are omitted.

<!-- - Component import: `@ainvest/collapse` -->
- For **paragraph-level text folding** (`See more` / `See less` on long copy), see `ainvest-design-system/references/components/text-collapse.md` .

**Platform parity:** Web and Mobile (APP) follow the **same behavior model** for both 全隐藏 and 半隐藏 patterns. Visual details (font size, hit area) follow standard responsive rules in §9.

---

## 1. Definition

Collapse (折叠面板) is a container that hides secondary, over-long, or auxiliary information to help the page show global classification or the content that follows. It balances **information density** with **page tidiness**: users can choose to unfold only what they need.

This document covers two module/list-level patterns:

- **全隐藏 (Panel)** — hides an entire module behind a header + arrow
- **半隐藏 (List)** — shows the first N list rows with a `View All` action; supports either **navigation (jump to a detail page)** or **inline expansion**

> Paragraph-level text folding (**文字折叠 / TextCollapse**) has moved to its own document: see `rules/text-collapse.md`.

Compared with other information-density components:

| Component | Purpose |
|-----------|---------|
| Collapse | Hides / reveals bulk of secondary or overflow content inside an inline container |
| TextCollapse | Truncates a long paragraph of text at N lines (see `rules/text-collapse.md`) |
| Tab | Switches between peer content groups, only one active at a time |
| Pagination | Page-by-page navigation through large structured data sets |
| Popover / Tooltip | Temporarily reveals auxiliary info in a floating layer |

---

## 2. When to Use

| Condition | Use Collapse? |
|-----------|---------------|
| A module is low-priority on the page and should be foldable to free vertical space | YES — 内容全隐藏 |
| FAQ list with many questions, user only cares about a subset | YES — 全隐藏 (FAQ Accordion) |
| Feed-stream / large content list where users dig deeper on a separate page | YES — 半隐藏 with **navigation** (`View All` jumps to detail page) |
| Information page composed of multiple content blocks; each block is a folded entry that jumps to its own page | YES — 半隐藏 with **navigation** |
| The module has only a small amount of extra content and the page has spare vertical space | YES — 半隐藏 with **inline expansion** (product team decides) |
| Module groups need unified folding in a Mobile layout | YES — Panel mode |
| A long text paragraph exceeds 3 lines and should be truncated with a "See more" link | NO — use **TextCollapse** (`rules/text-collapse.md`) |
| Web table / grid with large data set that users must scan or filter through | NO — use **Pagination** (see §3) |

### MUST

- MUST pick the correct pattern based on content type (see §5)
- MUST provide a clear expand control (arrow icon or action text) — never hide the collapse state from the user
- MUST default to the **navigation** variant for 半隐藏 unless the product team explicitly chooses **inline expansion**

### SHOULD

- SHOULD use **全隐藏 (Panel)** for grouped/FAQ content where each section stands alone
- SHOULD prefer **multi-expand** mode (multiple panels open at once) unless the product explicitly requires accordion behavior
- SHOULD use **TextCollapse** (not Collapse) for long paragraph text — see `rules/text-collapse.md`

---

## 3. When NOT to Use

| Condition | Use Collapse? | Alternative |
|-----------|---------------|-------------|
| Content is essential and users must see it immediately | NO | Flatten the content, don't fold |
| Switching between peer groups (e.g. tabs by timeframe) | NO | Tab |
| Temporarily showing auxiliary info on hover | NO | Tooltip / Popover |
| Long-form article with a clear reading flow | NO | Scroll / Pagination |
| Critical error messages or alerts | NO | Notice Bar / Notification |
| Form fields that should all be visible during data entry | NO | Flatten the form |
| Long paragraph text that needs truncation | NO | TextCollapse (`rules/text-collapse.md`) |
| **Web table / grid with large data sets** that users need to scan, sort, or filter through | NO | **Pagination** — switch the visible page directly (see `rules/pagination.md`) |

### MUST NOT

- MUST NOT hide primary content (核心功能、主要行动路径) inside Collapse — use Collapse only for secondary/overflow content
- MUST NOT nest Collapse inside Collapse more than one level deep — causes navigation confusion
- MUST NOT hide mandatory form fields behind a collapsed panel
- **MUST NOT** use 半隐藏 to fold large structured data sets in a Web table — **use Pagination instead**
- MUST NOT use the half-hidden pattern (内容半隐藏) if the hidden child cells are critical for the user's decision — use a dedicated detail page instead

---

## 4. Anatomy

### 4a. 内容全隐藏折叠面板 (Fully Hidden — Collapse.Panel)

```
Collapsed state:
┌──────────────────────────────────────┐
│  Here's how it works              ∨  │
└──────────────────────────────────────┘

Expanded state:
┌──────────────────────────────────────┐
│  Here's how it works              ∧  │
├──────────────────────────────────────┤
│  Full content body goes here.        │
│  Multiple lines supported.           │
└──────────────────────────────────────┘
```

| Part | Required | Description |
|------|----------|-------------|
| Header | MUST | The title line, always visible; acts as the click target |
| Arrow icon | MUST | Right side, `∨` when collapsed and `∧` when expanded |
| Hover zone | MUST | Entire header row is the hit area (`color-hover-5` on hover) |
| Content body | MUST | Hidden when collapsed, revealed when expanded |
| Divider (optional) | Optional | Border line between header and body in expanded state |

**Common usage contexts (examples only — visual structure stays the same):**

- **Cell-list panel (单元列表内容全隐藏)** — multiple Panel rows stacked as an independent list
- **Module panel — standard (模块折叠面板-标准)** — Panel rows used inside a standalone module
- **Module panel — landing page (模块折叠面板-落地页中)** — Panel rows embedded inside a landing-page module (often with a card outline)

These are illustrative scenarios; they share the same Anatomy and Behavior — only the surrounding context differs.

### 4b. 内容半隐藏折叠面板 (Half Hidden — Collapse.List)

The 半隐藏 pattern has **two interaction variants**. They share the same visible-cell structure but differ in what happens when the user clicks the action.

#### Variant 1 — Navigation (点击跳转, default)

The `View All` action **navigates to a separate detail page**. Use this when the full data set is too large or too rich to fit inline (feed streams, big lists, multi-block info pages).

```
┌──────────────────────────────────────┐
│  WSM  Williams-Sonoma   6.86 +47.10% │
│  WSM  Williams-Sonoma   0.64 +33.33% │
│  WSM  Williams-Sonoma   6.67 +32.89% │
│  View All  >                         │  ← text on the LEFT, right-chevron `>` on the RIGHT
└──────────────────────────────────────┘
```

| Part | Required | Description |
|------|----------|-------------|
| Visible cells | MUST | First N items (default `visibleCount: 3`) fully rendered |
| Action — `View All` | MUST | Label on the **left**, **right-chevron `>`** on the right (indicates navigation) |
| Click behavior | MUST | Click navigates to a separate detail / list page — does NOT expand inline |
| Gradient mask | Optional | Off by default; only enable when child cells have unpredictable height (long text, images) AND the product team explicitly opts in |
| Collapse action | N/A | No 收起 — navigation leaves the page |

#### Variant 2 — Inline Expansion (点击展开更多)

The `View All` action **expands the list inline** in the current container. Use this only when the module has limited extra content and the page has spare vertical space.

```
Collapsed state:
┌──────────────────────────────────────┐
│  WSM  Williams-Sonoma   6.86 +47.10% │
│  WSM  Williams-Sonoma   0.64 +33.33% │
│  WSM  Williams-Sonoma   6.67 +32.89% │  ← optional gradient on the tail (product opt-in)
│  View All  ∨                         │  ← text on the LEFT, down-arrow `∨` on the RIGHT
└──────────────────────────────────────┘

Expanded state (only when 收起 is required):
┌──────────────────────────────────────┐
│  … all items fully displayed         │
│  See less  ∧                         │  ← text on the LEFT, up-arrow `∧` on the RIGHT
└──────────────────────────────────────┘
```

| Part | Required | Description |
|------|----------|-------------|
| Visible cells | MUST | First N items (default `visibleCount: 3`) fully rendered |
| Action — `View All` | MUST | Label on the **left**, **down-arrow `∨`** on the right (indicates inline expand) |
| Click behavior | MUST | Click expands the remaining cells inline (向下平铺) — does NOT navigate |
| Gradient mask | Optional | Off by default; only enable when child cells have unpredictable height (long text, images) AND the product team explicitly opts in |
| Collapse action | Optional | By default, inline expansion does NOT offer 收起 after expanding |
| Expanded collapse arrow | Conditional | Only when the scenario explicitly requires a collapse action — label on the left, **up-arrow `∧`** on the right, placed at the bottom of the expanded content |
| Scroll anchor | MUST when expanded content is long enough to require scrolling — clicking 收起 MUST scroll the page back to the collapse anchor |

> **Default choice:** prefer **Variant 1 (Navigation)**. Use **Variant 2 (Inline Expansion)** only when the product team explicitly chooses it for a low-content, space-rich module.

> **Paragraph text folding (文字折叠) anatomy** — see `rules/text-collapse.md`.

---

## 5. Variants Overview

### 5a. Pattern Decision — Which pattern to use

| Scenario | Use Pattern | Implementation |
|----------|-------------|----------------|
| Module is low-priority, wants to fold entire module | **全隐藏** | `Collapse` (Panel mode) |
| FAQ, where each Q is independent and some users expand multiple | **全隐藏 + multi-expand** | `Collapse` multiple instances |
| Feed-stream / large content list where the full set lives on its own page | **半隐藏 — Navigation** | `Collapse.List` with `View All >` linking out |
| Multi-block info page where each block is a folded preview that jumps to its own page | **半隐藏 — Navigation** | `Collapse.List` with `View All >` linking out |
| Module has limited extra rows and page has spare vertical space (product team opts in) | **半隐藏 — Inline Expansion** | `Collapse.List` expanding inline |
| Web table / grid with large data sets users must scan, sort, filter | **Pagination** (NOT Collapse) | See `rules/pagination.md` |
| Long paragraph text that exceeds 3 lines | **TextCollapse** | See `rules/text-collapse.md` |

### 5b. Expansion Mode — Multi-expand vs Single-expand (全隐藏 only)

The 全隐藏 Panel supports two expansion behaviors. **Prefer multi-expand** unless the product explicitly requires accordion.

| Mode | Description | When to Use |
|------|-------------|-------------|
| **Multi-expand (多条展开, PREFERRED)** | User may open multiple Collapse items at the same time | FAQ, help center, grouped settings — users often compare answers side by side |
| **Single-expand (单条展开, accordion)** | Opening a new item automatically collapses the previous | Only when product requirements dictate (e.g. tight space, guided reading flow) |

### 5c. Default State

| Pattern | Default |
|---------|---------|
| 全隐藏 (Panel) | Collapsed (`defaultExpanded: false`) |
| 全隐藏 — FAQ Module | All collapsed, OR the first item expanded by default if product requires |
| 半隐藏 — Navigation | First `visibleCount` items visible (default 3); clicking `View All >` navigates away |
| 半隐藏 — Inline Expansion | First `visibleCount` items visible (default 3); clicking `View All ∨` expands inline |

### 5d. 半隐藏 Variant Decision

| Product context | Variant |
|-----------------|---------|
| Default | **Navigation** (point users to a detail / list page) |
| Feed stream, large content list | Navigation |
| Information page composed of multiple folded blocks | Navigation |
| Small amount of extra content + page has spare vertical space + business opts in | Inline Expansion |

### 5e. FAQ Module

| Setting | Value |
|---------|-------|
| Default state | All collapsed, OR first one expanded (per product) |
| Expansion mode | Multi-expand (preferred) or Single-expand (accordion) |
| Hover zone | **Entire row** (title + right arrow area) on Web |
| Hover background | `color-hover-5` |
| Layout | Stack vertically, each item is a full-width Collapse.Panel |

> **Responsive width rules for paragraph text folding** have moved to `rules/text-collapse.md` §5b.

---

## 6. Content Guidelines

### Panel Header (全隐藏)

- MUST be concise — a clear noun phrase or short question
- MUST fit on a single line; truncate with ellipsis if constrained
- SHOULD describe what's inside so the user can decide whether to expand
- MUST NOT duplicate the content body's first sentence

### Action Labels (半隐藏)

| Variant | Default Action Label | Trailing Icon |
|---------|----------------------|----------------|
| Navigation (点击跳转) | `View All` (or `View More`) | **Right-chevron `>`** |
| Inline Expansion (点击展开) | `View All` (or `View More`) | **Down-arrow `∨`** |
| Inline Expansion — collapse | `See less` (only when 收起 is supported) | **Up-arrow `∧`** |

- Labels MUST be verbs or verb phrases ("View All", "Show more details")
- Custom labels via `actionLabel` are allowed and should follow the same voice
- The trailing icon MUST match the variant — `>` for navigation, `∨`/`∧` for inline expand/collapse — so users can predict the outcome before clicking
- MUST NOT mix `View All` (半隐藏) with `See more` (TextCollapse) on the same page unless the two labels mean semantically different things

> **TextCollapse action labels** (`See more` / `See less`) — see `rules/text-collapse.md` §6.

---

## 7. Layout & Composition

### Placement

- Collapse sits **inline inside a module container** — it does not float
- Collapse header and body occupy the full width of the module's inner content area
- 半隐藏 (`Collapse.List`) inherits the parent module's padding

### Vertical Spacing

- Gap between stacked Collapse items (FAQ): **default to the module's vertical gap**
- Gap between Collapse header and body when expanded: **8px** minimum
- Gap between the last visible cell and the `View All` action: **8px**

### FAQ Layout

- Each FAQ question = one `Collapse.Panel`
- Questions are stacked vertically with a consistent divider
- Entire row is the click target — hover state uses `color-hover-5`

---

## 8. Behavior

### Expansion — 全隐藏 (Panel)

- Click anywhere on the header row to toggle
- Arrow rotates from `∨` to `∧` on expand
- Body animates height from 0 to `auto` (height transition)
- Multi-expand is the default behavior; accordion mode is opt-in per product
- **Coexistence rule:** when one Panel is already expanded, hovering on a sibling Panel (collapsed or expanded) MUST still apply the standard `color-hover-5` row hover — expanded state does not suppress hover feedback on neighbors

### Action — 半隐藏 Variant 1 (Navigation)

- Click `View All >` navigates to a separate detail / list page
- The current page does NOT animate or expand — navigation is the only outcome
- No 收起 action exists — the user returns via the back / navigation pattern of the destination page

### Action — 半隐藏 Variant 2 (Inline Expansion)

- Click `View All ∨` to expand the remaining cells inline (向下平铺) in the current container
- If a gradient mask is enabled, it fades out as the full content renders
- **By default, inline expansion does NOT provide a 收起 action** after expansion
- If the product explicitly needs 收起:
  - A `See less ∧` action appears at the bottom of the expanded content (label on the left, up-arrow on the right)
  - Clicking it collapses the content back to `visibleCount` items
  - If the expanded content required scrolling to read fully, clicking 收起 MUST scroll the page back to the collapse anchor position

### Hover (Web only) — 全隐藏

- Entire header row is the hover zone
- Background turns `color-hover-5` on hover
- Cursor changes to pointer

### Hover (Web only) — 半隐藏

Hover behavior is **split between two zones**:

| Hover target | Effect |
|--------------|--------|
| Hovering on the **`View All` text (link itself)** | Text gets an **underline**; cursor → pointer. No row background change |
| Hovering on **other parts of the cell / row** (e.g., a list item or the surrounding card area) | Background turns `color-hover-5` (matches the standard row hover); cursor → pointer if that area is also clickable |

The two effects are **mutually exclusive** — only one applies at a time depending on which zone the cursor is over. They are NOT combined.

### Keyboard Behavior

- The header row (全隐藏) and the `View All` action (半隐藏) MUST be focusable via Tab
- `Enter` or `Space` on a focused element MUST trigger the action (toggle / navigate / expand inline)
- When 全隐藏 expands, focus SHOULD move into the newly revealed content on next Tab

### Click Target

- Mobile: minimum 44×44px hit area
- Web: whole row (全隐藏) or the action label (半隐藏 `View All`); no need for 44×44 enforcement on desktop pointer devices

> **TextCollapse behavior** (inline 向下平铺 expansion, `See less` screen-efficiency rule) — see `rules/text-collapse.md` §8.

---

## 9. Platform Differences

Behavior is **identical across Web and Mobile**. Only visual / input details differ:

| Aspect | Web (> 500) | Mobile (≤ 500) |
|--------|-------------|-----------------|
| Header font size (全隐藏) | 20px | 18px (auto-shrunk at ≤ 500) |
| Hover interaction | Supported (see §8 hover rules) | N/A (tap only) |
| `View All` underline on hover | Supported | N/A |
| Click hit area | Whole row (全隐藏) / label (半隐藏) | Whole row, ≥ 44×44px |
| FAQ expansion mode | Multi-expand (default) | Multi-expand (default) |
| 半隐藏 default variant | Navigation (default) | Navigation (default) |
| Scroll anchor on 收起 | Required if expanded content scrolls | Required if expanded content scrolls |

---

## 10. Do / Don't

| | Practice | Reason |
|---|---------|--------|
| DO | Use Collapse for secondary / overflow content only | Primary content must stay visible |
| DO | Pick 全隐藏 for grouped/FAQ sections | Each group is independent and scannable |
| DO | Default 半隐藏 to the **Navigation** variant (`View All >`) | Most large lists / feeds belong on a detail page |
| DO | Use 半隐藏 **Inline Expansion** only when the module has little extra content AND the product team opts in | Avoids unnecessary in-place expansion when a detail page exists |
| DO | Match the trailing icon to the variant — `>` for navigation, `∨` / `∧` for inline expand / collapse | Lets users predict the outcome before clicking |
| DO | Use **TextCollapse** for long paragraph text | Paragraph folding is a distinct pattern (`rules/text-collapse.md`) |
| DO | Default to multi-expand in FAQ | Users often compare answers |
| DO | Use `color-hover-5` on the full header row on Web (全隐藏) | Consistent hover feedback |
| DO | Underline the `View All` text on hover; apply `color-hover-5` only to the surrounding row areas | Two distinct hover zones, two distinct affordances |
| DO | Add a scroll anchor when 收起 is used on long inline-expanded content | Prevents the user from being stranded mid-scroll |
| DON'T | Nest Collapse more than 1 level deep | Navigation confusion |
| DON'T | Hide primary actions or mandatory form fields inside Collapse | Users may never find them |
| DON'T | Offer 收起 on the inline-expansion variant by default | The pattern is designed for one-way expansion unless the product asks for it |
| DON'T | Mix `View All` (半隐藏) with `See more` (TextCollapse) inconsistently within the same module | Confuses the user |
| DON'T | Use 半隐藏 to fold a Web table / grid with large structured data sets | Use **Pagination** instead — see `rules/pagination.md` |
| DON'T | Combine the `View All` underline and the row `color-hover-5` at the same time | The two hover zones are mutually exclusive |
| DON'T | Enable the gradient mask by default | Gradient is opt-in, only when child cell heights are unpredictable |
| DON'T | Collapse content that must be seen for decision-making | Defeats the purpose of the page |

---

## 11. Decision Table

### Which Collapse Pattern

| Need | Pattern | Implementation |
|------|---------|----------------|
| Fold an entire module (FAQ, secondary section) | **全隐藏** | `Collapse` (Panel) |
| Feed stream / large content list with its own detail page | **半隐藏 — Navigation** | `Collapse.List` + `View All >` |
| Multi-block info page with each block linking to its own page | **半隐藏 — Navigation** | `Collapse.List` + `View All >` |
| Module with limited extra content and spare vertical space (business opts in) | **半隐藏 — Inline Expansion** | `Collapse.List` + `View All ∨` |
| Web table / grid with large data | **Pagination** (NOT Collapse) | See `rules/pagination.md` |
| Accordion behavior (one-at-a-time) | **全隐藏 + Single-expand** | Product-controlled state logic |
| Long paragraph text | **TextCollapse** | See `rules/text-collapse.md` |

### 半隐藏 Variant Decision

| Product context | Variant | Trailing Icon |
|-----------------|---------|----------------|
| Default | Navigation | `>` |
| Feed / big list / multi-block info page | Navigation | `>` |
| Limited content + spare space + business opts in | Inline Expansion | `∨` (collapsed) / `∧` (expanded, when 收起 enabled) |

### Expansion Mode (全隐藏)

| Product context | Mode |
|-----------------|------|
| FAQ, help center, settings groups | **Multi-expand** (preferred) |
| Guided reading flow, tight vertical space | Single-expand (accordion) |

### 半隐藏 Inline-Expansion 收起 Action

| Product need | 收起 action |
|--------------|-------------|
| Default (informational list) | NOT provided |
| Expanded content is long and users may want to collapse again | Provide `See less ∧` at the bottom; add scroll anchor |

### Hover Zones (Web)

| Pattern | Hover target | Effect |
|---------|--------------|--------|
| 全隐藏 — header row | Anywhere on the row | `color-hover-5` background |
| 半隐藏 — `View All` text | The label itself | Underline on the text |
| 半隐藏 — other clickable cell / row areas | Surrounding row / cell | `color-hover-5` background |
| 全隐藏 — sibling rows when one is expanded | Any sibling header row | `color-hover-5` (expansion of one row does not suppress others' hover) |

---

## 12. Related Documents

- `ainvest-design-system/references/components/collapse.md`
- `ainvest-design-system/references/components/text-collapse.md`
- `ainvest-design-system/references/components/pagination.md`
- `ainvest-design-system/references/components/noticebar.md`
- `ainvest-design-system/references/components/tab.md`
- `ainvest-design-system/references/components/button.md`
- `ainvest-design-system/SKILL.md`
- `ainvest-design-system/references/tokens/color.md`
- `ainvest-design-system/references/tokens/spacing.md`
- `ainvest-design-system/references/tokens/typography.md`
