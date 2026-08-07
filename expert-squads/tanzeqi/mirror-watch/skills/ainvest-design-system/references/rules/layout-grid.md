# Layout Grid Skill
# AI-Readable Rules for Layout Grid, Layout Framework, and Responsive Adaptation

## 1. Goal

This skill defines how web layouts should be structured and adapted across different widths.

Goals:
- keep page structure stable
- keep module alignment consistent
- preserve scan efficiency in dense financial interfaces
- make layout decisions predictable, not arbitrary
- balance global consistency with scenario-based flexibility

---

## 2. Global Principles

### Principle 1 — Use a shared layout language
Use one shared layout language across pages, because system consistency depends on repeatable spacing, grid, and breakpoint logic.

### Principle 2 — Keep structure stable before changing presentation
Preserve the main page structure and information hierarchy before adjusting module appearance, because responsive design should reduce layout pressure without breaking reading flow.

### Principle 3 — Adapt frame first, then content
Always resolve the frame layer before the content layer, because module behavior must be based on a clear and stable layout area.

### Principle 4 — Prioritize scan efficiency
In dense financial layouts, preserve fast scanning of core data before preserving full visual richness, because usability depends more on readable priority information than on keeping every secondary detail visible.

### Principle 5 — Use exceptions only when necessary
Use special layout only when general layout is not sufficient, because exceptions reduce system consistency and should remain explicit and justified.

---

## 3. Foundation Rules

## 3.1 Base Unit

### Rule 1 — Use an 8px base unit
Use **8px** as the base unit for layout rhythm, spacing, and alignment, because a single spacing system creates predictable structure and reduces visual inconsistency.

### Rule 2 — Prefer multiples of 8
Use spacing values in multiples of 8 whenever possible, because consistent spacing improves rhythm, alignment, and reuse.

---

## 3.2 Grid Rules

### Rule 1 — Build layout on a column grid
Align primary modules to a shared column grid, because grid alignment keeps the page orderly and makes module relationships easier to maintain across breakpoints.

### Rule 2 — Keep primary modules on grid columns
Primary modules must align to the grid columns, because content should be organized by the system frame rather than by independent local logic.

### Rule 3 — Do not create layout logic outside the grid system
Do not invent separate layout rules outside the defined grid structure, because this breaks alignment consistency across pages.

### Rule 4 — Keep grid logic consistent across breakpoints
Grid behavior may change by breakpoint, but the logic must remain consistent, because responsive change should adjust structure without changing the system language.

---

## 4. Breakpoint Rules

Use the existing breakpoint ranges exactly as defined.

| Breakpoint | Width Range | Meaning |
|---|---|---|
| XL | ≥ 1410px | full desktop layout |
| LG | 900px–1410px | standard desktop layout |
| MD | 500px–900px | compact layout |
| SM | < 500px | narrow layout |

### XL — ≥ 1410px
Use the fullest layout capacity, because this range has the most horizontal space and can support more visible modules at once.

### LG — 900px–1410px
Begin moderate compression while keeping the main structure intact, because horizontal capacity decreases but desktop behavior still applies.

### MD — 500px–900px
Reduce module width and visible density, because the available space is no longer sufficient for full-width desktop presentation.

### SM — < 500px
Simplify content further, because narrow widths require stronger reduction of non-critical information to preserve readability.

---

## 5. Frame Adaptation Rules

### Definition
The frame layer controls:
- available content width
- outer margins
- grid area
- column distribution
- base module placement

### Rule 1 — Adapt the frame first
Adapt the frame layer before the content layer, because module behavior must be derived from the available layout container, not guessed independently.

### Rule 2 — Move from outside to inside
Responsive change should move from outside to inside:
1. page width
2. content container
3. grid area
4. content modules

Because layout pressure should be absorbed by the frame first.

### Rule 3 — Keep fixed structural areas stable
Fixed structural areas should remain stable where defined, because core frame elements should not shift without strong reason.

### Rule 4 — Exclude fixed side areas from content width
Fixed side areas are not part of the responsive content width, because content adaptation should be calculated from the true usable area.

---

## 6. Content Adaptation Rules

### Definition
The content layer adjusts after the frame layer is defined.

It controls:
- visible module count
- module width
- information density
- simplification level

### Rule 1 — Resolve content only after frame is resolved
Adjust content only after the frame is resolved, because module adaptation must respond to real space constraints.

### Required Order
1. reduce visible module count
2. reduce module width or horizontal span
3. compress secondary information
4. simplify structure only if necessary

### Decision Logic
- keep grid alignment first, because alignment stability supports readability
- keep primary information first, because core business data must remain easy to scan
- reduce quantity before breaking structure, because fewer stable modules are better than many damaged ones
- compress horizontal space before removing key content, because layout pressure should be absorbed gradually
- simplify secondary content only when width is insufficient, because unnecessary simplification reduces useful information too early

---

## 7. Layout Framework Rules

### Goal
This section defines how to choose the correct page layout framework for web design.

Goals:
- keep page structure consistent
- improve layout decisions across scenarios
- balance consistency and flexibility
- ensure the right width strategy is used for the right page type

### Layout Types
Web layout frameworks are divided into:
1. General Layout Framework
2. Special Layout Framework

---

## 8. General Layout Framework

### Definition
General layout is the default framework for most pages.

It includes:
- Fixed-Width Layout
- Adaptive-Width Layout

### Shared System Rule
Fixed-width layout and adaptive-width layout use the same:
- grid system
- breakpoint system
- responsive adaptation logic

They differ mainly in:
- maximum width definition
- horizontal expansion behavior
- content carrying capacity

Because the system must keep a unified layout language, both layout types share the same grid and breakpoint logic.
Because different page types require different horizontal capacity, width strategy must vary by scenario.

---

## 9. Layout Selection Guidance

### Rule 1 — Use fixed-width layout for regular pages
Use fixed-width layout for regular pages, because regular pages prioritize structural stability, reading comfort, and consistency over maximum horizontal expansion.

For regular pages, default to **1560px** fixed width. See §11 for the width selection decision order before choosing a narrower preset.

### Rule 2 — Use adaptive-width layout for dense horizontal data pages
Use adaptive-width layout for aggregated stock lists, scrollable multi-header lists, and similar data-heavy pages, because these pages need more horizontal display capacity.

### Rule 3 — Use adaptive-width layout for large-space functional pages
Use adaptive-width layout for functions that require large visual space, such as heatmaps and wide analytical modules, because wider content space improves functional clarity and information efficiency.

### Rule 4 — Use special layout only when general layout fails
Use special layout only when the general layout framework cannot support the page requirement, because custom structure should remain an explicit exception.

---

## 10. Fixed-Width Layout Rules

### Definition
Fixed-width layout is the default layout in the general layout framework.

Its core principle is to place page content inside a predefined content container width, because stable width helps preserve structure, reading rhythm, and layout consistency across screens.

Fixed-width layout is not static.
It responds to viewport changes, but in a fixed priority order:
1. keep the content width stable
2. keep module position stable
3. absorb width changes through outer margins first
4. adapt content only when necessary

### Shared Adaptation Rules

#### Rule 1
Keep module width and position stable first, because stable information structure is more important than reacting too early to viewport change.

#### Rule 2
When the viewport is wider than the target fixed width, increase left and right margins and keep content centered, because outer whitespace should absorb extra space before content changes.

#### Rule 3
When the viewport becomes narrower than the target fixed width, reduce left and right margins first until the minimum allowed margin of the current breakpoint is reached, because margin is the first buffer layer.

#### Rule 4
When minimum margin is reached and the viewport continues to shrink, adapt the content, because outer spacing alone is no longer enough to preserve usability and readability.

---

## 11. Fixed-Width Presets

Use the following fixed content widths for consistency across pages.

Important:
**1560 / 1164 / 768 are fixed content-width presets, not breakpoints.**
Breakpoints still follow the shared breakpoint system.

| Width | Role | When to Use |
|---|---|---|
| 1560px | default | any page with parallel/multi-module content |
| 1164px | narrow display | single-focus presentation pages |
| 768px | reading | long-form text pages |

### Default Rule (READ FIRST)

**1560px is the default. Use 1560px UNLESS the page clearly matches the typical cases of 1164px or 768px below.**

When uncertain, choose 1560px. Do not pick 1164px as a "safe middle option" — 1164px is a narrower preset for a specific page type, not a compromise between 1560 and 768.

---

### 11.1 — 1560px (Default)

Use 1560px when the page contains **two or more parallel content units on the same horizontal row**, because multi-unit pages need horizontal capacity for side-by-side scanning.

#### Typical Cases (use 1560px)
- multi-card grids (news cards, article cards, stock cards, event cards)
- dashboards with multiple modules
- list pages (any page showing a collection of items)
- pages mixing charts + tables + cards
- aggregation pages, hub pages, category pages
- any page where the user scans across multiple items horizontally

#### Decision Signal
If the page shows **a collection** (more than one item of the same type side by side), it is a 1560px page — even if each individual card looks "simple."

The number of cards does not determine simplicity. Three cards in a row is still multi-module and still requires 1560px.

---

### 11.2 — 1164px (Narrow Display)

Use 1164px ONLY for pages presenting **a single focused subject** with no parallel multi-item structure.

#### Typical Cases (use 1164px)
- single-entity profile pages (one company, one person, one fund)
- single-form pages (settings, account configuration)
- single-summary overview pages with vertically stacked sections
- onboarding / single-task flow pages

#### Anti-Cases (do NOT use 1164px)
- ❌ multi-card grids — even if cards look simple, use 1560px
- ❌ list pages — use 1560px
- ❌ dashboards — use 1560px
- ❌ pages with side-by-side modules — use 1560px

#### Disambiguation
"Display-oriented" in this preset means **single-subject display**, not **card-based display**. If multiple items are displayed in parallel, the page is multi-module and belongs to 1560px.

---

### 11.3 — 768px (Reading)

Use 768px for pages where the primary content is long-form text and line-length readability is the dominant constraint.

#### Typical Cases (use 768px)
- article detail pages
- news detail pages
- long-form reading pages
- text-heavy explanation pages
- terms / policy / documentation pages

---

### Width Selection Decision Order (for AI)

When choosing a fixed width, evaluate in this exact order and **stop at the first match**:

1. Is the primary content long-form prose? → **768px**
2. Does the page show two or more parallel items / modules / cards on the same row? → **1560px**
3. Is the page a single-subject focused page (one entity, one form, one summary)? → **1164px**
4. Otherwise → **1560px** (default)

Never pick 1164px because the page "feels lighter" or "has fewer modules." 1164px is for single-subject pages only.

---

## 12. Fixed-Width Layout — Single-Column Rules

### Definition
Single-column layout is the base form of fixed-width layout.

The page uses one centered content container, and all modules are placed inside this shared container.

Modules may use:
- equal division
- unequal division

Both must stay inside the same fixed-width container, because the core of single-column layout is a unified content area.

### Reading Rule
When a page mainly contains long-form text, prefer a **768px** fixed-width container and allow line wrapping at this width, because excessive line length reduces readability.

Typical cases:
- article detail pages
- news detail pages
- long-form reading pages
- text-heavy explanation pages

### Module Composition Rules

#### Equal Division
Use equal division when modules have similar structure and similar visual weight, because equal-width distribution creates stable and repeatable rhythm.

#### Unequal Division
Use unequal division when modules differ in content density, importance, or visual priority, because not all modules should receive identical horizontal space.

#### Shared Constraint
Whether equal or unequal, all modules must remain inside the current fixed-width container, because fixed-width single-column layout depends on one shared content frame.

### Output Constraint for AI
When generating a fixed-width single-column layout:
1. choose one width preset: 1560, 1164, or 768
2. keep one centered content container
3. place all modules inside the container
4. decide whether the module relationship is equal or unequal
5. increase outer margins when space grows
6. reduce margins first when space shrinks
7. adapt content only after minimum margin is reached

### Multi-Page Prototype Consistency Rule

When generating a set of pages that form a single prototype (e.g. list page + detail page + sub-page), ALL pages in the set MUST use the **same `max-width` value** for their content container.

- MUST NOT mix different width presets across pages in the same prototype (e.g. one page at 1560px and another at 1164px)
- The width preset is decided once for the prototype and applied consistently to every page
- This rule overrides per-page width selection when pages belong to the same prototype flow

---

## 13. Fixed-Width Layout — Multi-Column Rules

### Definition
Multi-column layout is used inside a fixed-width content container to organize multiple parallel content areas.

The most common case is a two-column layout.

Its core principle is:
- keep one fixed-width container
- split content inside the container into columns
- keep a unified column gap
- derive column widths from a shared system logic instead of defining them arbitrarily

---

## 14. Fixed-Width Layout — Two-Column Rules

### Definition
Two-column layout is a common multi-column pattern inside fixed-width layout.

It is used when the page needs two parallel content areas, such as:
- primary content + secondary content
- main workspace + supporting information
- major module + auxiliary module

### Core Rules

#### Rule 1
Use a fixed-width container first, because column layout must be built inside a stable content frame.

#### Rule 2
Use two columns inside the container, because two-column layout is an internal content structure, not a separate page-width system.

#### Rule 3
Keep the column gap at **48px**, because column spacing must stay synchronized with the overall grid rhythm.

#### Rule 4
Choose **Column 1** from the fixed-width logic or from the width logic derived from the **1560 grid**, because the main column width should be system-based and traceable.

#### Rule 5
Derive **Column 2** from the remaining width, because once the main column and gap are fixed, the secondary column should be resolved from the space that remains.

#### Rule 6
Keep the primary content column wider than the secondary column, because multi-column layout should reflect content hierarchy rather than split space evenly by default.

#### Rule 7
Use the remaining width for the secondary column, because once the primary column width is determined, the secondary area should naturally resolve from the remaining space.

#### Rule 8
Use **8:4** as the default two-column proportion, because it provides a stable balance between main content capacity and supporting content space.

#### Rule 9
Round column widths to whole-pixel values, because layout widths must resolve to practical, repeatable pixel dimensions.

### Width Formula
For a fixed-width two-column layout:
- **Total Width = current fixed-width container**
- **Gap = 48px**
- **Column 1 = selected base width or width derived from the 1560 grid logic**
- **Column 2 = Total Width - Column 1 - Gap**

### Shared Constraint
Even in a multi-column layout, both columns must remain inside the same fixed-width container, because the page should still behave as one unified layout frame.

### Usage Guidance

#### Use two-column layout when:
- the page has a clear primary-secondary hierarchy
- the page needs a main area and a supporting area
- two functional regions need to exist side by side

#### Avoid two-column layout when:
- the page is mainly for long-form reading
- the page does not have a real column-based content structure
- the available width is not sufficient for two effective columns

### Output Constraint for AI
When generating a fixed-width two-column layout:
1. choose the total fixed-width container first
2. keep the total width centered
3. set the column gap to 48px
4. choose Column 1 using the fixed-width logic or the 1560 grid logic
5. calculate Column 2 from the remaining width
6. keep both columns inside the same container
7. do not invent arbitrary column ratios outside the system logic

---

## 15. Adaptive-Width Layout Rules

### Definition
Adaptive-width layout is used for pages that require stronger horizontal capacity than fixed-width layout.

It allows the content area to expand with the available viewport width, because some pages depend on wider horizontal space to display more information or larger functional regions.

### Shared Rules
All adaptive-width layouts:
- use the same grid system
- use the same breakpoint system
- use the same responsive adaptation logic

They differ mainly in whether a maximum width is defined.

---

## 16. Unlimited Adaptive Layout

### Definition
Unlimited adaptive layout is used for pages that require very high horizontal expansion.

It does not use a fixed width and does not define a hard maximum width, because the page needs to stretch horizontally to a suitable area based on the screen size.

### Typical Cases
- heatmaps
- large visual analysis pages
- wide functional workspaces that depend on maximum horizontal space

### Rules

#### Rule 1
Keep the display height fixed where required, because this layout improves capacity mainly through horizontal expansion rather than through vertical restructuring.

#### Rule 2
Do not use a fixed content width, because the layout must stretch horizontally with the screen.

#### Rule 3
When the window size changes, change the display width according to the shared grid system, because even unlimited layouts must stay consistent with the system rhythm.

#### Rule 4
Stretch the content area to a suitable horizontal region instead of mechanically filling space without control, because effective content display matters more than raw expansion.

---

## 17. Limited Adaptive Layout

### Definition
Limited adaptive layout is used for pages that need wide horizontal space but still require a controlled maximum width.

The content area expands with the viewport, but its maximum width is **2530px**.

### Typical Cases
- scrollable multi-header lists
- aggregated stock lists
- wide data pages that still require controlled readability

### Rules

#### Rule 1
Allow the content area to expand horizontally with the viewport, because these pages need more horizontal capacity than fixed-width containers can provide.

#### Rule 2
Set the maximum page width to **2530px**, because these pages still need an upper bound to preserve readability and comparison efficiency on very wide screens.

#### Rule 3
When the viewport exceeds 2530px, keep outer whitespace on both sides, because additional expansion beyond the maximum width does not meaningfully improve information efficiency.

#### Rule 4
When the window size changes, change the display width according to the shared grid system, because limited adaptive layout is still part of the unified layout system.

---

## 18. Adaptive Layout Selection Rules

#### Rule 1
Use unlimited adaptive layout when the page behaves like a wide visual workspace, because these pages depend on maximizing horizontal space.

#### Rule 2
Use limited adaptive layout when the page needs more horizontal content capacity but still requires controlled reading range, because these pages are information-heavy but not fully canvas-like.

#### Rule 3
Use unlimited adaptive layout for heatmaps and similar large visual pages, because their value depends on maximum visible area.

#### Rule 4
Use limited adaptive layout for scrollable multi-header lists and similar dense data pages, because they need width expansion with a controlled upper bound.

### Output Constraint for AI
When generating adaptive-width layout:
1. decide whether the page is unlimited or limited adaptive
2. keep the shared grid and breakpoint logic
3. use unlimited mode for canvas-like wide visual pages
4. use limited mode for data-heavy wide pages with a controlled max width
5. set max width to 2530px only for limited adaptive layout
6. keep outer whitespace beyond the max width in limited mode

---

## 19. Special Layout Framework

### Definition
Special layout is used only when the general layout framework cannot support the page requirement.

A page may define its own layout structure and adaptation rules when:
- the page is functionally different from regular content pages
- the page depends on a dedicated working area
- the common framework cannot support its content or interaction needs

### Typical Cases
- Super Chart
- professional tool pages
- highly specialized functional workspaces

### Exception Rule
Use special layout only when general layout is not sufficient, because special layout reduces framework consistency and should remain an explicit exception.

### Constraint
Do not use special layout as a stylistic preference, because special layout is an exception mechanism, not a third default framework.

---

## 20. Module-Level Responsive Rules

## 20.1 Recommendation Cards

### Rule
Reduce the number of visible cards before compressing card structure, because card readability is more important than preserving the maximum count.

**This section covers Wide Cards** (e.g., news cards, article cards, event cards with rich content). For Compact Cards (politician avatars, stock logo cards), see `references/rules/card-interaction.md` — Compact cards follow a 5→4→3 count rule.

| Width Range | Behavior (Wide Cards) | Rule |
|---|---|---|
| ≥ 1410px | 4 → 3 cards | keep full card structure |
| 900px–1410px | 3 → 2 cards | reduce visible count based on width |
| 500px–900px | 2 → 1 card | preserve one readable card |
| < 500px | 1 card | keep only essential presentation |

### Summary
For Wide Cards, visible count decreases in stages: **4 → 3 → 2 → 1**.
For Compact Cards (small avatar/logo cards), visible count decreases in stages: **5 → 4 → 3**.
Both follow the principle: horizontal modules should preserve clarity before preserving quantity.

---

## 20.2 Stock List

### Rule
Compress horizontally before simplifying the list structure, because scan efficiency depends on keeping core rows and key fields readable.

| Width Range | Behavior | Rule |
|---|---|---|
| ≥ 1410px | adaptive full layout | show full information structure |
| 900px–1410px | horizontal compression | reduce horizontal occupation first |
| 500px–900px | narrower layout | keep core data columns |
| < 500px | simplified layout | weaken or remove secondary fields |

### Summary
For stock lists, reduce horizontal density first and simplify secondary information later, because dense data tables must preserve fast scanning of key information.

---

## 21. Global Responsive Priorities

Follow these priorities in all responsive decisions:

1. keep grid alignment first, because structure must stay coherent
2. keep core information first, because business-critical data has highest priority
3. reduce visible quantity before changing hierarchy, because stable hierarchy is easier to understand
4. compress spacing and width before removing key content, because content loss should be the last step
5. simplify only when necessary, because early simplification weakens information value
6. do not break the main reading flow, because responsive design should adjust presentation, not change core user cognition

---

## 22. AI Output Workflow

When generating any page layout, always follow this sequence:

1. identify the page type
2. decide whether the page uses general layout or special layout
3. if general layout, decide whether it uses fixed-width or adaptive-width
4. if fixed-width, follow the **Width Selection Decision Order in §11** (default to 1560 unless the page is single-subject or long-form text)
5. if fixed-width, decide whether the structure is single-column or multi-column
6. if multi-column, keep 48px gap and use system-based width logic
7. if adaptive-width, decide whether it is unlimited or limited
8. if limited adaptive, cap width at 2530px
9. resolve the frame layer first
10. resolve the content layer second
11. preserve core information and scan efficiency
12. simplify only when width no longer supports the current structure

---

## 23. One-Sentence Summary

Use a shared grid-based responsive system where the frame adapts first and content adapts second, fixed-width layout is used for stable regular pages, adaptive-width layout is used for pages that need stronger horizontal capacity, and special layout is used only as an explicit exception, because stable structure, clear hierarchy, and preserved scan efficiency are more important than arbitrary layout variation.