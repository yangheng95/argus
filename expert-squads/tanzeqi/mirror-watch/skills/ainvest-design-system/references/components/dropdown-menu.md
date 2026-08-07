# Guidelines — dropdown-menu

> **Component Spec:** `ainvest-design-system/references/components/dropdown-menu.md`

---

## 0. Document Role

This document covers **when and how to use** the dropdown-menu (下拉菜单) component. It focuses on decisions a designer must make explicitly — visual details handled automatically by the component are omitted.

<!-- - Component import: `@ainvest/dropdown-menu` -->

---

## 1. Definition

Dropdown Menu is a **floating panel of selectable options** that appears when a user clicks a trigger element (button, icon, text, or custom content). It is used for navigation shortcuts, action collections, and quick selection of values.

The menu panel opens as an overlay positioned relative to its trigger, supports single-select, multi-select, and grouped layouts, and dismisses when an option is selected or the user clicks outside.

---

## 2. When to Use

| Condition | Use Dropdown Menu? |
|-----------|--------------------|
| Present a list of actions for the user to choose from | YES |
| Filter or sort by selecting one option from a set | YES |
| Select a value from a predefined list (single-select) | YES |
| Select multiple values from a predefined list (multi-select with checkboxes) | YES |
| Trigger navigation to a subsection or page via a menu | YES |
| Provide contextual options for a specific element (right-click / more icon) | YES |
| Offer grouped categories of options (with section headers) | YES |

### MUST

- MUST use Dropdown Menu when presenting a collection of discrete actions or selectable options that do not need to be persistently visible
- MUST use Dropdown Menu (not inline radio/checkbox groups) when the option set would consume too much screen space if expanded
- MUST pair the menu panel with a visible trigger element — the menu MUST NOT appear without user-initiated action

### SHOULD

- SHOULD use Dropdown Menu when the option count is between 3 and ~15 items; fewer than 3 may be better served by inline buttons, more than ~15 should consider a searchable select or bottom sheet
- SHOULD default to single-select mode unless the use case explicitly requires multi-select

---

## 3. When NOT to Use

| Condition | Use Dropdown Menu? | Alternative |
|-----------|--------------------|-------------|
| Switching between mutually exclusive content views / panels | NO | Tab |
| Binary on/off toggle (immediate effect) | NO | Switch |
| Form field requiring structured input (date, number) | NO | Specialized input component |
| Presenting a full-page list of options on mobile | NO | Bottom Sheet (Credenza) |
| Persistent filter bar always visible on screen | NO | Chip / Filter group |
| Single primary action | NO | Button |
| Selecting from a very large dataset (50+ items) with search | NO | AutoComplete / Searchable Select |
| Navigating to an entirely different page | NO | Link / Navigation |

### MUST NOT

- MUST NOT use Dropdown Menu for view switching — use Tab instead
- MUST NOT use Dropdown Menu as a substitute for a form select when native select semantics are needed for accessibility
- MUST NOT use Dropdown Menu for actions that require persistent visibility — if the user needs to see all options at all times, use inline radio/checkbox groups or a chip bar
- MUST NOT use Dropdown Menu on mobile when items exceed 5 AND the menu is a complex variant (multi-select, grouped) — adapt to a bottom sheet panel instead (see §9 Adaptive Rules)

---

## 4. Anatomy

### Standard Menu (Single-Select / Action List)

```
  ┌──────────────────┐
  │ Leveraged  ∧     │   ← Trigger (capsule or text style, with indicator arrow)
  └──────────────────┘
  ┌──────────────────┐
  │ Option 1         │   ← Menu item (default)
  │ Option 2         │   ← Menu item (hover highlight)
  │ Option 3         │   ← Menu item
  │ Option 4         │   ← Menu item
  │ Option 5         │   ← Menu item
  │ Option 6         │   ← Menu item (disabled — faded)
  └──────────────────┘
```

### Menu with Icons, Descriptions, and Groups

```
  ┌──────────────────────────────┐
  │ ⊕ Option 1                  │   ← Left icon + label
  │   Description text...       │
  │ ⊕ Option 2            Text ›│   ← Left icon + label + right text + chevron
  │   Description text...       │
  │ ⊕ Option 3                  │
  │   Description text...       │
  │─────────────────────────────│   ← Group divider
  │ CUSTOMIZE COLUMNS           │   ← Section header (group label)
  │ ⊕ Option 4                  │
  │   Description text...       │
  │ ⊕ Option 5                  │
  │   Description text...       │
  └──────────────────────────────┘
```

### Multi-Select Menu

```
  ┌──────────────────────────────┐
  │ ☐ Option 1                  │   ← Checkbox + label
  │   Description text...       │
  │ ☑ Option 2            ✓     │   ← Checked state + checkmark
  │   Description text...       │
  │ ☐ Option 3                  │
  │   Description text...       │
  └──────────────────────────────┘
```

### Single-Select Menu (Radio)

```
  ┌──────────────────────────────┐
  │ ○ Option 1                  │
  │   Description text...       │
  │ ● Option 2                  │   ← Selected radio
  │   Description text...       │
  │ ○ Option 3                  │
  │   Description text...       │
  └──────────────────────────────┘
```

| Part | Required | Description |
|------|----------|-------------|
| Trigger | MUST | The interactive element that opens the menu — capsule button, text label, icon, or custom content |
| Indicator Arrow | Conditional | Chevron (∧ / ∨) on the trigger indicating expandable menu; MUST be present for capsule and text triggers; NOT required for icon-only or custom triggers |
| Menu Panel | MUST | Floating overlay container holding menu items; uses `shadow.md` and `radius.md` |
| Menu Item (label) | MUST | Primary text of each option |
| Menu Item (description) | Optional | Secondary descriptive text below the label; max width 300px, truncated with ellipsis |
| Left Icon | Optional | Icon preceding the label — for visual identification (e.g. globe, heart, avatar) |
| Right Element | Optional | Text, checkmark (✓), chevron (›), toggle, or other control on the right side of the item |
| Checkbox | Conditional | Selection indicator for multi-select items. Renders the **Checkbox** component inline (left side of item row). State (checked/unchecked) is managed by the Dropdown Menu, not by the Checkbox component itself. See: `ainvest-design-system/references/components/checkbox-group.md`|
| Radio | Conditional | Selection indicator for single-select items with explicit radio affordance. Renders the **Radio** component inline (left side of item row). State is managed by the Dropdown Menu. See: `ainvest-design-system/references/components/radio-group.md` |
| Switch (Toggle) | Conditional | Inline binary control on the right side of a Toggle Item. Renders the **Switch** component. State is managed by the Dropdown Menu; menu stays open after toggling. See: `ainvest-design-system/references/components/switch.md` |
| Slider | Conditional | Inline range control embedded in a Slider Item. Renders the **Slider** component. Value changes are managed by the Dropdown Menu. See: [Slider Guidelines](./Slider.md) *(pending)* |
| Group Header | Conditional | Section label text (e.g. "CUSTOMIZE COLUMNS") separating item groups |
| Group Divider | Conditional | 1px horizontal rule between groups |
| Scrollbar | Conditional | Appears when items exceed max height (400px). Renders the **ScrollBar** component at Size S (4px thumb, overlay, auto-hide). See: [ScrollBar Guidelines](./ScrollBar.md) |
| Loading State | Conditional | Spinner displayed when menu content is loading asynchronously |
| Error State | Conditional | "Network error" message with Refresh button when loading fails |

### Rules

- Trigger MUST be visually identifiable as an interactive element
- Indicator arrow direction: ∨ (down) when closed, ∧ (up) when opened
- Menu panel MUST appear as a floating overlay — MUST NOT push page content
- Menu items MUST have sufficient click/tap target height (minimum 36px per item row)
- Description text MUST truncate with ellipsis when exceeding the max width (300px)
- Group headers MUST be non-interactive — they are labels only, not selectable

### Composition Rules — Embedded Components

When Dropdown Menu embeds other components (Checkbox, Radio, Switch, Slider, ScrollBar), the following container-level rules apply. Internal behavior and visual styling of each embedded component follows its own guidelines.

#### Checkbox (Multi-Select Items)
- The Dropdown Menu owns and manages the checked/unchecked state of all Checkbox items — the Checkbox component itself does NOT hold independent state here
- MUST NOT mix Checkbox items and Radio items in the same panel
- MUST NOT mix Checkbox items with single-select Checkmark items in the same panel
- Clicking a Checkbox item row toggles the checkbox; the menu stays open
- See: `ainvest-design-system/references/components/checkbox-group.md`

#### Radio (Single-Select Items)
- The Dropdown Menu owns and manages the selected state across all Radio items — only one Radio may be selected at a time
- MUST NOT mix Radio items and Checkbox items in the same panel
- Clicking a Radio item selects it and closes the menu (standard single-select behavior)
- See: `ainvest-design-system/references/components/radio-group.md`

#### Switch (Toggle Items)
- The Dropdown Menu owns and manages the on/off state of each Switch item
- Toggling a Switch MUST NOT close the menu
- MUST NOT combine a Switch with right-text or a badge in the same item row
- MUST NOT use Switch items and Slider items in the same panel
- See: `ainvest-design-system/references/components/switch.md`

#### Slider (Slider Items)
- The Dropdown Menu owns and manages the value of each Slider item
- Dragging the Slider MUST NOT close the menu
- MUST NOT combine a Slider with a Checkbox, Radio, or Switch in the same item row
- Slider items SHOULD include a visible current-value label adjacent to the Slider
- See: [Slider Guidelines](./Slider.md) *(pending)*

#### ScrollBar (Panel Overflow)
- ScrollBar appears automatically when total item height exceeds the panel max height (400px)
- MUST use ScrollBar at **Size S** (4px thumb width, overlay mode, auto-hide)
- The scrollable region includes all items; group headers SHOULD remain sticky during scroll where technically feasible

---

## 5. Variants Overview

### 5.1 Type Variants (Menu Item Content)

| Type | Left Element | Label | Description | Right Element | Embedded Component | Usage |
|------|-------------|-------|-------------|---------------|--------------------|-------|
| **Plain** | — | Text only | — | — | — | Basic action list or simple selection |
| **Left Icon** | Icon | Text | — | — | — | Options with visual category identification |
| **Icon + Description** | Icon | Text | Secondary text (max 300px, ellipsis) | — | — | Rich options needing explanation |
| **Grouped** | — | Text | Optional | — | — | Categorized options with section headers and dividers |
| **Multi-Select** | Checkbox | Text | Optional | — | **Checkbox** — See: `ainvest-design-system/references/components/checkbox-group.md` | Multiple items can be selected simultaneously |
| **Single-Select (Radio)** | Radio | Text | Optional | — | **Radio** — See: `ainvest-design-system/references/components/radio-group.md` | Exactly one item selected with explicit radio indicator |
| **Single-Select (Checkmark)** | Optional icon | Text | Optional | ✓ (checkmark) | — | Exactly one item selected, indicated by right-side checkmark |
| **With Right Text** | Optional icon | Text | Optional | Secondary text + optional chevron (›) | — | Items with auxiliary value display or sub-menu navigation |
| **With Toggle** | — | Text | Optional | Switch | **Switch** — See: `ainvest-design-system/references/components/switch.md` | Items containing an inline binary on/off control; menu stays open on toggle |


### 5.2 Trigger Variants (Indicator / Arrow)

| Trigger Style | Visual | Usage |
|---------------|--------|-------|
| **Capsule Arrow** | Pill-shaped button with chevron (∨/∧) | Default — standard dropdown trigger; follows Button Tier styling |
| **Text Arrow** | Plain text label with chevron (∨/∧) | Lightweight — inline text trigger without button background |
| **None (Custom)** | No default trigger chrome — fully custom content (e.g. icon button, avatar) | Advanced — for contextual menus, icon triggers, or composite trigger areas |

### 5.3 Panel States

| State | Trigger Visual | Panel | Item Behavior |
|-------|---------------|-------|---------------|
| **Default (Closed)** | Resting trigger style | Hidden | — |
| **Hover (Trigger)** | Hover overlay on trigger | Hidden | — |
| **Opened** | Active trigger style; arrow flips (∧) | Visible floating panel | Items are interactive |
| **Disabled** | Faded trigger; `pointer-events: none` | Cannot open | — |

### 5.4 Menu Item States

| State | Visual | Notes |
|-------|--------|-------|
| **Default** | Standard label and icon colors | — |
| **Hover** | Stacked `color.interaction.hover` overlay on the item row | MUST NOT use solid fill replacement |
| **Active / Press** | Stacked `color.interaction.active` overlay | Triggers selection or action |
| **Selected** | Checkmark (✓) or filled checkbox/radio; item may have subtle highlight | Indicates current selection |
| **Disabled** | Faded text and icon; `pointer-events: none` | Non-interactive item within the menu |

### 5.5 Size Constraints

| Property | Value | Notes |
|----------|-------|-------|
| Min width | 120px | Prevents overly narrow panels |
| Max width | 300px | Text exceeding this truncates with ellipsis |
| Max height | 400px | Exceeding items trigger internal scroll |

> For exact token mappings, spacing values, and item height specs, see `ainvest-design-system/references/components/dropdown-menu.md`.

---

## 6. Content Guidelines

### Menu Item Labels

- MUST be concise — typically 1–4 words
- MUST clearly describe the option or action
- SHOULD use consistent grammatical structure across all items (all nouns, all verb phrases, etc.)
- For action menus: use verb phrases ("Edit Profile", "Delete Item")
- For selection menus: use noun phrases ("Market Cap", "Revenue Growth")

### Description Text

- MUST provide additional context that the label alone cannot convey
- MUST truncate with ellipsis ("...") when exceeding max width (300px)
- SHOULD be kept to one line; two lines maximum
- Typography: secondary text style, `color.text.secondary`

### Group Headers

- MUST be uppercase or consistently styled to distinguish from selectable items
- MUST NOT be interactive — group headers are organizational labels only
- Typography: tertiary text style, `color.text.tertiary`

### Examples

| Good | Bad | Reason |
|------|-----|--------|
| "Market Cap" | "Click to filter by Market Cap" | Label should be a noun, not an instruction |
| "Micro Cap: Below $300M" | "microcap below 300m" | Use proper formatting and capitalization |
| "MARKET CAPITALIZATION" (group header) | "Market Capitalization" (same style as items) | Group headers must be visually distinct |
| "Sector Communications ∨" | "Select Sector" | Trigger label shows current value, not instruction |

---

## 7. Layout & Composition

### Menu Alignment

| Alignment | Behavior | Usage |
|-----------|----------|-------|
| **Left-aligned** | Panel left edge aligns with trigger left edge | Default — most common |
| **Right-aligned** | Panel right edge aligns with trigger right edge | When trigger is near the right viewport edge |
| **Auto** | Automatically selects left or right based on available viewport space | Recommended for responsive layouts |

### Rules

- Menu panel MUST be positioned directly below (or above, if near viewport bottom) the trigger
- Panel offset from trigger: 4px gap (matching SearchBar dropdown convention)
- Panel MUST NOT overflow the viewport — if space below is insufficient, open upward; if lateral space is insufficient, shift alignment
- When the trigger sits at the bottom of the page, menu MUST flip to open above the trigger

### Trigger-to-Panel Width Relationship

- Menu panel width is independent of the trigger width
- Panel width adapts to content within min (120px) and max (300px) constraints
- Panel width MUST NOT be narrower than 120px even if the trigger is smaller

### Spacing References

| Scene | Token / Value |
|-------|--------------|
| Trigger-to-panel gap | 4px |
| Panel internal padding (vertical) | 8px top and bottom |
| Item horizontal padding | 12px |
| Item vertical padding | Context-dependent — see component spec |
| Group divider vertical margin | 8px above and below |
| Icon-to-label gap | 8px |

---

## 8. Behavior

### Open / Close

- **Open:** Click (or Enter/Space on keyboard) the trigger → panel appears → arrow indicator flips to ∧
- **Close — Selection:** Click a menu item (single-select / action) → action fires → panel closes
- **Close — Multi-select:** Panel stays open on item click; closes when user clicks outside or presses Escape
- **Close — Outside click:** Click anywhere outside the panel → panel closes
- **Close — Escape:** Press Escape → panel closes, focus returns to trigger

### Selection Modes

| Mode | Behavior | Close on Select? |
|------|----------|-----------------|
| **Action list** | Each item triggers an action (navigate, execute) | YES — immediately |
| **Single-select** | One item is selected; selected item shows checkmark or radio fill | YES — immediately |
| **Multi-select** | Multiple items can be toggled; checkbox reflects state | NO — panel stays open; close on outside click or Escape |

### Hover / Interaction States

| Element | State | Visual |
|---------|-------|--------|
| Trigger | Default | Resting style |
| Trigger | Hover | Stacked `color.interaction.hover` overlay |
| Trigger | Opened | Active style; arrow ∧ |
| Trigger | Disabled | Faded; non-interactive |
| Menu Item | Default | Standard colors |
| Menu Item | Hover | Stacked `color.interaction.hover` overlay on item row |
| Menu Item | Active / Press | Stacked `color.interaction.active` overlay |
| Menu Item | Selected | Checkmark (✓) or filled checkbox/radio indicator |
| Menu Item | Disabled | Faded text/icon; `pointer-events: none`; MUST NOT show hover |

### Scroll Behavior

- When items exceed max height (400px), the panel becomes internally scrollable
- Scroll bar renders the **ScrollBar** component at Size S (4px thumb, overlay mode, auto-hide). See: [ScrollBar Guidelines](./ScrollBar.md)
- Group headers SHOULD remain visible / sticky at the top of their group during scroll where technically feasible

### Loading State

- When menu content loads asynchronously, display a centered spinner inside the panel
- Panel MUST open at min-width (120px) or last-known width while loading
- On load success: replace spinner with items
- On load failure: show error state with "Network error" message and a "Refresh" button

### Keyboard Behavior

- `Enter` / `Space` on trigger: open panel
- `↓` / `↑`: navigate between items (skip group headers and disabled items)
- `Enter` / `Space` on focused item: select / activate
- `Escape`: close panel, return focus to trigger
- `Tab`: close panel, move focus to next focusable element
- `Home` / `End`: jump to first / last enabled item

---

## 9. Platform Differences & Adaptive Rules

### Web (viewport > 500px)

- Standard floating dropdown panel positioned below (or above) trigger
- Hover states are active (mouse interaction)
- All type variants (plain, icon, description, grouped, multi-select, single-select, toggle) are available
- Panel width adapts within 120px–300px
- Max height 400px with internal scroll

### Web Responsive Breakpoints

| Breakpoint | Panel Width Behavior | Trigger | Notes |
|------------|---------------------|---------|-------|
| > 1410px | Panel auto-width within 120–300px | Full trigger visible | Standard layout |
| 990–1410px | Same | Full trigger visible | Standard layout |
| 500–990px | Same | Trigger may compress; label may truncate | Consider reducing visible menu items |
| ≤ 500px | **Adapt to bottom sheet** | Trigger still functions | Complex menus (multi-select, grouped) MUST convert to bottom sheet panel (see below) |

### Adaptive Rule — ≤ 500px (CRITICAL)

- When viewport width ≤ 500px AND the menu is a **basic single-select with ≤ 5 items**, the standard dropdown may remain
- When viewport width ≤ 500px AND the menu is **complex** (multi-select, grouped, > 5 items), it MUST adapt to a **bottom sheet panel** (full-width, slides up from bottom)
- The bottom sheet panel uses:
  - Title + Subtitle header with back (‹) and close (×) controls
  - Full-width item list with the same item types as the dropdown
  - Selected items indicated by checkmark (✓) on the right
  - Width: 100% of viewport (auto-adaptive)

### Mobile (App)

- MUST follow the same adaptive rules as Web ≤ 500px — complex menus use bottom sheet
- Simple single-select menus (≤ 5 items, basic variant) may use a native dropdown or action sheet depending on platform convention
- Hover states are not applicable (touch interaction)
- Touch targets MUST meet minimum 44×44px tap area

---

## 10. Do / Don't

| | Practice | Reason |
|---|---------|--------|
| DO | Use Dropdown Menu for action collections and value selection | Correct semantic purpose |
| DO | Include an indicator arrow (∨/∧) on capsule and text triggers | Communicates expandability |
| DO | Use `shadow.md` on the floating panel | Correct elevation for overlay components |
| DO | Use stacked `color.interaction.hover` overlay for item hover | Consistent interaction model across the design system |
| DO | Truncate description text at 300px with ellipsis | Prevents panel from becoming excessively wide |
| DO | Limit panel max height to 400px and enable internal scroll | Prevents panel from dominating the viewport |
| DO | Adapt to bottom sheet on ≤ 500px viewports for complex menus | Mobile-friendly pattern for multi-select / grouped menus |
| DO | Keep one selection mode per menu instance (single OR multi, not both) | Reduces user confusion |
| DO | Show loading spinner when menu content is async | Communicates data fetching state |
| DO | Show error state with Refresh button on load failure | Provides recovery path |
| DON'T | Use Dropdown Menu for view switching | Use Tab instead |
| DON'T | Use Dropdown Menu for navigation to entirely different pages | Use Link or Navigation |
| DON'T | Use solid fill for item hover state | MUST use stacked overlay (`color.interaction.hover`) |
| DON'T | Allow panel to overflow the viewport | Reposition (flip/shift) to stay within bounds |
| DON'T | Use panel wider than 300px | Truncate content instead; 300px is the max |
| DON'T | Make group headers clickable | They are organizational labels only |
| DON'T | Show multiple spinners in a loading menu | One centered spinner is sufficient |
| DON'T | Keep the dropdown panel open on mobile (≤ 500px) for complex menus | Convert to bottom sheet |
| DON'T | Use Dropdown Menu with only 1–2 options | Use inline buttons or a toggle instead |
| DON'T | Place the trigger without any visual affordance for expandability | User must know the element opens a menu |

---

## 11. Decision Table

### Type Selection

| Context | Type | Selection Mode | Right Element | Notes |
|---------|------|---------------|---------------|-------|
| Simple action list | Plain | Action (no selection) | — | e.g. "Edit", "Delete", "Share" |
| Options with visual category | Left Icon | Single-select / Action | — | e.g. sector icons, asset type icons |
| Options needing explanation | Icon + Description | Single-select | — | e.g. filter criteria with definitions |
| Categorized option groups | Grouped | Single / Multi | — | e.g. table column customization |
| Multiple items can be active | Multi-Select | Multi-select | Checkbox | e.g. "Select visible columns" |
| One item from a set (explicit indicator) | Single-Select (Radio) | Single-select | Radio | e.g. sort order selection |
| One item from a set (checkmark feedback) | Single-Select (Checkmark) | Single-select | ✓ | e.g. current filter value |
| Items with secondary value | With Right Text | Single-select / Action | Text + optional › | e.g. "Market Cap: $1.2T" |
| Inline binary control per item | With Toggle | Per-item toggle | Switch | e.g. notification preference toggles |

### Trigger Selection

| Context | Trigger Style | Notes |
|---------|---------------|-------|
| Standard filter / sort control | Capsule Arrow | Default trigger; follows Button styling |
| Inline text-based control | Text Arrow | Lightweight; no background chrome |
| Icon button (e.g. ⋯ more, ⚙ settings) | None (Custom) | Icon serves as trigger; no arrow needed |
| Custom composite trigger | None (Custom) | e.g. avatar + name as trigger |

### Alignment Selection

| Trigger Position | Alignment | Reason |
|-----------------|-----------|--------|
| Left side of container | Left-aligned | Default; natural reading direction |
| Right side of container / near viewport edge | Right-aligned | Prevents panel overflow |
| Unknown or dynamic position | Auto | Let the system determine best fit |

### Responsive Adaptation

| Viewport | Menu Complexity | Presentation |
|----------|----------------|-------------|
| > 500px | Any | Standard floating dropdown |
| ≤ 500px | Simple (single-select, ≤ 5 items) | Standard floating dropdown (allowed) |
| ≤ 500px | Complex (multi-select, grouped, > 5 items) | Bottom sheet panel (MUST adapt) |

---

## 12. Related Documents

### Component Spec (FINAL)
- `ainvest-design-system/references/components/dropdown-menu.md`

### Embedded Components (referenced inside Dropdown Menu)
- `ainvest-design-system/references/components/checkbox-group.md`
- `ainvest-design-system/references/components/radio-group.md`
- `ainvest-design-system/references/components/switch.md`
- `ainvest-design-system/references/components/button.md`

### Design Tokens
- `ainvest-design-system/SKILL.md`
- `ainvest-design-system/references/tokens/color.md`
- `ainvest-design-system/references/tokens/typography.md`
- `ainvest-design-system/references/tokens/spacing.md`
- `ainvest-design-system/references/tokens/shadow.md`
- `ainvest-design-system/references/tokens/radius.md`
