# Guidelines — RadioGroup（单选框组件）

<!-- Component import: `@ainvest/radio-group` -->
> Related: `checkbox-group.md`, `dropdown-menu.md`,`radio-group.md`,`color.md`, `spacing.md`

## 0. Document Role

This document defines the rules for selecting and configuring the **RadioGroup（单选框组件）** component across App and Web platforms. It is intended for AI-assisted design generation and must be consulted whenever a single-selection UI element is needed.

Related files:
- Component source: `ainvest-design-system/references/components/multiple-choice`
- Design tokens: `ainvest-design-system/references/tokens/colors`, `ainvest-design-system/references/tokens/spacing`

---

## 1. Definition

RadioGroup（单选框组件） is a selection control that allows the user to choose **one option from a set**, where only the selected item takes effect. It is commonly used in single-selection lists.

There are **four design variants** in the current design system, each suited to different interaction contexts.

---

## 2. When to Use

Use the Multiple Choice component when:

- The user must select **exactly one** item from a list of options.
- The selection is part of a **filter**, **settings panel**, or **confirmation flow**.
- The available options are mutually exclusive.
- The interface requires a clear visual indication of the currently active selection.

---

## 3. When NOT to Use

| Situation | Use Instead |
|---|---|
| User needs to select **multiple** items | CheckboxGroup(多选框组件) |
| There are only two mutually exclusive states | Toggle / Switch |
| The selection is inline within a sentence | Segmented Control |
| The option list is very long (10+ items) | Dropdown / Select |

---

## 4. Anatomy

### Required Parts
- **Radio indicator** — the circular selection marker (filled when selected, empty when not)
- **Label** — text describing the option

### Optional Parts
- **Supporting content** (right side) — e.g., price change (`+4.35%`), secondary label, count badge
- **Checkmark icon** — used in Special List variant instead of the radio indicator
- **Dropdown arrow** — used in Filter variants that reveal sub-options

---

## 5. Variants Overview

The system provides four variants. Use the decision logic below to select the correct one:

```
Is the context a SETTINGS panel?
  └─ Yes → Use: 单选框特殊 (Special Radio)

Is the context a FILTER bar?
  └─ Yes → Does it show selected content inline or a count badge?
        ├─ Shows selected option text → 特殊样式1 (Filter: Show Option Content — single)
        ├─ Shows multi-select content → 特殊样式2 (Filter: Show Option Content — multi)
        ├─ Shows selected count → 特殊样式3 (Filter: Show Count Badge)
        └─ Basic filter → 单选框常规 (Standard Radio Filter)

Does the selection take effect IMMEDIATELY (no confirm button)?
  └─ Yes → Use: 特殊单选列表 (Special Selection List) — shows checkmark on select

Default / needs secondary confirmation?
  └─ Use: 基础单选 (Basic Radio)
```

### Variant Summary Table

| Variant | Chinese Name | Primary Context | Confirm Required | Icon on Select |
|---|---|---|---|---|
| Basic Radio | 基础单选 | Lists, dropdowns | Yes | Radio fill |
| Special Selection List | 特殊单选列表 | Bottom sheets, dropdowns | No | Checkmark (✓) |
| Standard Radio Filter | 单选框常规 | Filter bars | No | Filled pill |
| Special Radio | 单选框特殊 | Settings panels | No | Filled segment |

---

## 6. Content Guidelines

- **Label text** must be concise. Prefer 1–3 words for filter and settings variants.
- **Supporting content** (right side) is optional and should only appear when directly relevant (e.g., price change, category label).
- Filter labels should use **sentence case**, not ALL CAPS.
- For **multilingual layouts**, all components must be **mirrored** according to component spec when adapting to RTL languages.
- In the **North American interface**, only use the **equal-width distribution** style (均分) for the Special Radio variant, as English strings tend to be longer.

---

## 7. Layout & Composition

### Alignment
- The radio indicator is always **vertically centered** with the list row it belongs to.

### Positioning by Platform and Content

| Platform | Theme Prop | Right side has content? | Radio position |
|---|---|---|---|
| App | `mobile` (default) | No | Right side of row |
| App | `mobile` (default) | Yes | Left side of row |
| Web | `pc` | Any | Always left side |

### Filter Bar Spacing
- Text padding inside filter pill: **16px left and right**
- Minimum pill width: **66px**
- Gap between multiple filter pills: **8px**
- Wrap to next line when overflow; row gap: **8px**

### Special Radio (Settings) Padding
- Left/right padding: **16px**
- Top/bottom padding: **12px**
- Gap between options: **8px**

---

## 8. Behavior

### State Transitions

```
Unselected → [User tap/click] → Selected
Selected → [User tap/click on another option] → Previous deselects, new one selects
Disabled → No interaction possible
Selected + Disabled (选中不可改) → Visually selected but cannot be changed
```

### Immediate vs. Deferred Selection
- **Basic Radio (基础单选)** and **Special Selection List (特殊单选列表)**: selection is typically paired with a secondary confirmation action (e.g., a confirm button in a bottom sheet).
- **Special Selection List** in direct-change contexts: selecting immediately applies the result — no confirm button needed.
- **Filter** and **Settings** variants apply immediately on tap.

### States Available

| State | 基础单选 | 特殊单选列表 | 单选框常规 | 单选框特殊 |
|---|---|---|---|---|
| Unselected (未选中) | ✓ | ✓ | ✓ | ✓ |
| Selected (已选中) | ✓ | ✓ | ✓ | ✓ |
| Hover | Web only | Web only | Web only | Web only |
| Disabled (不可选) | ✓ | — | — | — |
| Selected + Locked (选中不可改) | ✓ | — | — | — |

---

## 9. Platform Differences

| Behavior | App (`theme="mobile"`) | Web (`theme="pc"`) |
|---|---|---|
| Hover state | ❌ Not available | ✅ Available |
| Radio position (no right content) | Right side | Left side |
| Radio position (with right content) | Left side | Left side |
| Special List hover style | N/A | Matches dropdown hover style |
| Special Radio equal-width | ✅ Always (North America) | ✅ Always (North America) |
| Filter bar behavior | Same as Web | Same as App |

---

## 10. Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| Use **Basic Radio** when the action requires confirmation before applying | Use Basic Radio for instant-apply selections without a confirm button |
| Place radio on the **right** on App when the row has no right-side content | Place radio on the right when there is already content on the right side of the row |
| Always center the radio **vertically** with the list row | Offset the radio to the top or bottom of a tall row |
| Use **Special Selection List** when selecting immediately changes the result | Use Special Selection List in flows that need a secondary confirm step |
| Use **Standard Radio Filter** for filter bars with multiple pill options | Use Basic Radio for filter bars — it is not optimized for dense filter layouts |
| Mirror layout for RTL/multilingual builds | Leave component layout unmodified for RTL languages |
| Use **equal-width distribution** in North American (English) settings panels | Allow unequal widths in settings panels that must support long English strings |
| Use Hover state on **Web only** | Add Hover state in App implementations |

---

## 11. Decision Table

Use this table to map your design scenario directly to the correct variant and configuration:

| Scenario | Platform | Radio Position | Variant | Confirm Needed | Notes |
|---|---|---|---|---|---|
| Bottom sheet selection, no right content | App | Right | 基础单选 | Yes | — |
| Bottom sheet selection, with price/value | App | Left | 基础单选 | Yes | Right content visible |
| Dropdown menu selection | Web | Left | 基础单选 | Yes | Text width auto-adapts |
| Instant selection dropdown (no confirm) | App / Web | Left | 特殊单选列表 | No | Shows ✓ on select |
| Filter bar, single selection | App / Web | — (pill style) | 单选框常规 | No | Min width 66px |
| Filter bar, shows selected option text | App / Web | — (pill style) | 特殊样式1 | No | Dropdown arrow included |
| Filter bar, shows multi-select content | App / Web | — (pill style) | 特殊样式2 | No | Dropdown arrow included |
| Filter bar, shows selected count badge | App / Web | — (pill style) | 特殊样式3 | No | Count shown in pill |
| Settings panel, mutually exclusive options | App / Web | — (segment style) | 单选框特殊 | No | Equal-width; 16px/12px padding |
| Any RTL / multilingual screen | Any | Mirror | Any | Per variant | Follow mirror spec |

---

## 12. Related Documents

- Checkbox (多选框) guidelines: `/components/checkbox-group.md`
- Dropdown / Select guidelines: `/components/dropdown-menu.md`
- Design tokens (spacing, color): `ainvest-design-system/references/tokens/color.md`
- Component source: `/components/radio-group.md`
