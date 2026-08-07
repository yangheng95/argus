# Guidelines — Checkbox Group (多选框组件)

<!-- - Component import: `@ainvest/checkbox-group` -->
- Related: `radio-group.md`, `color.md`, `spacing.md`
- Component source: `/components/checkbox-group.md`

## 0. Document Role

This document defines the rules for selecting and configuring the **Checkbox Group (多选框组件)** component across App and Web platforms. It is intended for AI-assisted design generation and must be consulted whenever a multi-selection UI element is needed.

Related files:
- Component source: `ainvest-design-system/references/components/checkbox-group`
- radio-group: `ainvest-design-system/references/components/radio-group.md`
- Design tokens: `ainvest-design-system/references/tokens/colors`, `ainvest-design-system/references/tokens/spacing`

---

## 1. Definition

Checkbox Group (多选框组件) is a selection control used for content item selection. It is generally used in multi-selection interfaces. The user can select one item, multiple items, or all items by tapping. Tapping an item toggles it between selected and unselected.

There are **four design variants** in the current design system, each suited to different interaction contexts.

---

## 2. When to Use

Use the Checkbox Group component when:

- The user may select **one or more** items simultaneously from a set.
- The selection is part of a **filter bar**, **settings panel**, **list**, or **agreement confirmation** flow.
- Individual items can be independently toggled without affecting others.
- The interface requires a clear visual distinction between selected and unselected items.

---

## 3. When NOT to Use

| Situation | Use Instead |
|---|---|
| User must select **exactly one** item | RadioGroup (单选框组件) |
| There is only a single on/off toggle | Toggle / Switch |
| The selection drives a mutually exclusive setting | RadioGroup (单选框组件) |
| The option list is very long (10+ items) | Dropdown / Select with multi-select |

---

## 4. Anatomy

### Required Parts
- **Checkbox indicator** — the square selection marker (filled with checkmark when selected, empty when not)
- **Label** — text describing the option

### Optional Parts
- **Supporting content** (right side) — e.g., price change (`+4.35%`), secondary label, count badge
- **Reset / Select-all control** — used in Web filter lists (e.g., a Reset row with a confirm checkmark)
- **Dropdown arrow** — used in 多选框 (filter pill) variants that reveal sub-options
- **Count badge** — used in 多选框特殊样式3 to display the number of selected items inline in the pill

---

## 5. Variants Overview

The system provides four variants. Use the decision logic below to select the correct one:

```
Is the context a SETTINGS panel?
  └─ Yes → Use: 多选框特殊 (Special Checkbox) — equal-width segments, 16px/12px padding

Is the context a FILTER bar (pill-style)?
  └─ Yes → Does the pill show content or a count when active?
        ├─ No sub-content (plain selected state) → 多选框 (Standard Filter Checkbox)
        ├─ Shows selected option text inline   → 多选框特殊样式2 (Filter: Show Option Content)
        └─ Shows selected item count badge     → 多选框特殊样式3 (Filter: Show Count Badge)

Is the context a BINARY yes/no choice (e.g. agree to terms)?
  └─ Yes → Use: 二元选择 (Binary Checkbox) — single standalone checkbox per boolean

Default list or search result multi-select?
  └─ Use: 基础多选 (Basic Checkbox)
```

### Variant Summary Table

| Variant | Chinese Name | Primary Context | Confirm Required | Indicator Style |
|---|---|---|---|---|
| Basic Checkbox | 基础多选 | Lists, dropdowns, search results | Optional | Square checkbox |
| Binary Checkbox | 二元选择 | Agreement / boolean toggle | No | Square checkbox |
| Standard Filter Checkbox | 多选框 | Filter bars, tag pills | No | Filled pill |
| Filter: Show Option Content | 多选框特殊样式2 | Filter bars with sub-labels | No | Filled pill + text |
| Filter: Show Count Badge | 多选框特殊样式3 | Filter bars with count display | No | Filled pill + badge |
| Special Checkbox | 多选框特殊 | Settings panels | No | Filled segment |

---

## 6. Content Guidelines

- **Label text** must be concise. Prefer 1–3 words for filter and settings variants.
- **Supporting content** (right side) is optional and should only appear when directly relevant (e.g., price change percentage, secondary value label).
- Filter pill labels should use **sentence case**, not ALL CAPS.
- **Text inside filter pills** is left-aligned with **16px** left and right padding; pill width is self-adapting with a **minimum width of 66px**.
- For **multilingual layouts**, all components must be **mirrored** according to the component spec when adapting to RTL languages (内容需镜像处理).
- In the **North American interface**, the 多选框特殊 (Special Checkbox / settings) variant uses **equal-width distribution only**, because English strings tend to be longer.

---

## 7. Layout & Composition

### Alignment
- The checkbox indicator is always **vertically centered** with the list row it belongs to.

### Positioning by Platform and Content

| Platform | Theme Prop | Right side has content? | Checkbox position |
|---|---|---|---|
| App | `mobile` (default) | No | Right side of row |
| App | `mobile` (default) | Yes | Left side of row |
| Web | `pc` | Any | Always left side |

### Filter Bar (多选框) Spacing
- Text padding inside filter pill: **16px left and right**
- Minimum pill width: **66px**
- Pill width: self-adapting to content length
- Gap between multiple filter pills: **8px**
- Wrap to next line when overflow; row gap: **8px**

### Special Checkbox (Settings / 多选框特殊) Padding
- Left/right padding: **16px**
- Top/bottom padding: **12px**
- Gap between options: **8px**
- Width: equal-width distribution only (均分样式)

### Binary Checkbox (二元选择) Layout
- Single checkbox per boolean item; no grouping into pill or segment style
- Use standalone rows — each row represents one independent yes/no value
- Multiple binary checkboxes may appear stacked in a list (e.g., agreement + display preference)

---

## 8. Behavior

### State Transitions

```
Unselected → [User tap/click] → Selected
Selected → [User tap/click again] → Unselected
Disabled (不可选) → No interaction possible
Selected + Locked (选中不可改) → Visually selected but cannot be changed
```

### Multi-select Behavior
- Each checkbox in the group is independently toggleable — selecting one does not deselect others.
- There is no mutual exclusivity between items (unlike RadioGroup (单选框组件)).
- A Reset control (if present) clears all selections in the group at once.

### Immediate vs. Deferred Selection
- **Basic Checkbox (基础多选)** in lists: selection may be paired with a secondary confirmation action (e.g., a confirm button), or applied immediately depending on context.
- **Filter variants (多选框, 特殊样式2, 特殊样式3)**: selection takes effect immediately on tap — no confirm button required.
- **Special Checkbox (多选框特殊)**: selection takes effect immediately on tap.
- **Binary Checkbox (二元选择)**: each toggle takes effect immediately.

### States Available

| State | 基础多选 | 二元选择 | 多选框 (filter) | 多选框特殊 |
|---|---|---|---|---|
| Unselected (未选中) | ✓ | ✓ | ✓ | ✓ |
| Selected (已选中) | ✓ | ✓ | ✓ | ✓ |
| Hover | Web only | Web only | Web only | Web only |
| Disabled (不可选) | ✓ | ✓ | — | — |
| Selected + Locked (选中不可改) | ✓ | ✓ | — | — |

---

## 9. Platform Differences

| Behavior | App (`theme="mobile"`) | Web (`theme="pc"`) |
|---|---|---|
| Hover state | ❌ Not available | ✅ Available |
| Checkbox position (no right content) | Right side of row | Left side of row |
| Checkbox position (with right content) | Left side of row | Left side of row |
| Filter pill behavior | Same as Web | Same as App |
| Special Checkbox equal-width | ✅ Always (North America) | ✅ Always (North America) |
| Reset control in filter list | ❌ Not used | ✅ Available (top row with confirm checkmark) |
| Multilingual mirror | ✅ Required | ✅ Required |

---

## 10. Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| Use **Basic Checkbox** when the user needs to pick multiple independent items from a list | Use Basic Checkbox when only one item can be selected — use RadioGroup (单选框组件) instead |
| Place checkbox on the **right** on App when the row has no right-side content | Place checkbox on the right when there is already content on the right side of the row |
| Place checkbox on the **left** on Web regardless of right-side content | Place checkbox on the right on Web |
| Always center the checkbox **vertically** with the list row | Offset the checkbox to the top or bottom of a tall row |
| Use **Binary Checkbox** for standalone yes/no items (e.g., agree to terms) | Use a full checkbox group for a single boolean toggle |
| Use **多选框特殊样式3** when a filter pill needs to communicate how many items are selected | Show selected item text inline when the count alone is sufficient |
| Use **equal-width distribution** in North American settings panels (多选框特殊) | Allow unequal widths in settings panels that need to support long English strings |
| Mirror layout for RTL / multilingual builds | Leave component layout unmodified for RTL languages |
| Use Hover state on **Web only** | Add Hover state in App implementations |
| Use a Reset control in Web filter lists to allow clearing all selections at once | Omit a clear/reset mechanism when the filter group has more than 3 options |

---

## 11. Decision Table

Use this table to map your design scenario directly to the correct variant and configuration:

| Scenario | Platform | Checkbox Position | Variant | Confirm Needed | Notes |
|---|---|---|---|---|---|
| List multi-select, no right content | App | Right | 基础多选 | Optional | Checkbox on right per App rule |
| List multi-select, with price / value | App | Left | 基础多选 | Optional | Right content present |
| List multi-select | Web | Left | 基础多选 | Optional | Checkbox always left on Web |
| Search result multi-select with Reset | Web | Left | 基础多选 | No | Reset row at top; confirm checkmark |
| Boolean / agreement toggle | App / Web | Right (App) / Left (Web) | 二元选择 | No | Single standalone checkbox per item |
| Filter bar, plain multi-select pill | App / Web | — (pill style) | 多选框 | No | Min width 66px; wraps on overflow |
| Filter bar, shows selected option text | App / Web | — (pill style) | 多选框特殊样式2 | No | Dropdown arrow included |
| Filter bar, shows selected item count | App / Web | — (pill style) | 多选框特殊样式3 | No | Count badge shown inside pill |
| Settings panel, independent toggles | App / Web | — (segment style) | 多选框特殊 | No | Equal-width; 16px/12px padding |
| Any RTL / multilingual screen | Any | Mirror | Any | Per variant | Follow mirror spec |

---
