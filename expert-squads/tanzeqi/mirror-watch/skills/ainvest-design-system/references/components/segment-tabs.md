# Guidelines — segment-tabs

> **Component Spec:** `ainvest-design-system/references/components/segment-tabs.md`

---

## 0. Document Role

This document covers **when and how to use** the segment-tabs (分段标签页) component. It focuses on decisions a designer must make explicitly — visual details handled automatically by the component are omitted.

<!-- - Component import: `@ainvest/segment-tabs` -->

---

## 1. Definition

segment-tabs is a **module-level primary switcher** rendered as a single capsule-shaped segmented control. All options live inside one rounded container, with the active option highlighted by a filled pill.

Typical usage is inside a self-contained module (chart card, data widget, detail card) where the user switches between **parallel slices of the same data set** — most commonly **timeframes** (1D / 5D / 1M / 3M / 6M / 1Y / 5Y / All), but also indices / markets / units / other dense mutually-exclusive filters.

Compared with other tab sub-types:

| Sub-type | Purpose |
|----------|---------|
| line-tabs | Page-level primary navigation — independent sibling views |
| pill-tabs | Page-level secondary / module-level switching with separate capsule items |
| **segment-tabs** | Module-level dense segmented control inside a single bordered capsule |

---

## 2. When to Use

| Condition | Use segment-tabs? |
|-----------|-------------------|
| Chart timeframe switcher (1D / 5D / 1M / 3M / 6M / 1Y / 5Y / All) | YES |
| Dense mutually-exclusive filters over the same data (e.g. Indices / Stocks / Crypto / Futures / Forex / Bonds / ETFs inside a market widget) | YES |
| Module-level primary switcher where all options are short labels and must be visible at a glance | YES |
| A segmented control inside a card / chart / widget | YES |

### MUST

- MUST use segment-tabs only at **module level** (inside a card / widget), not as page-level navigation
- MUST keep exactly one option selected at all times (single-select)
- MUST keep option labels **short and uniform** in length (1–3 characters or a single word is typical)
- MUST keep the whole control on a single line — never wrap

### SHOULD

- SHOULD use segment-tabs when options are parallel slices of the **same** metric (e.g. timeframes of one chart)
- SHOULD use this component when the number of options is small to medium and all labels are short

---

## 3. When NOT to Use

| Condition | Use Instead |
|-----------|-------------|
| Page-level primary navigation between independent sections | line-tabs |
| Page-level secondary or module-level switching with longer labels | pill-tabs |
| Options lead to independent page sections (not slices of one data set) | line-tabs / pill-tabs |
| Action trigger (submit, save, delete) | Button |
| Multi-select filtering | Checkbox group / Chip group |
| Only one option exists | Remove the control entirely |

### MUST NOT

- MUST NOT use segment-tabs for actions — use Button
- MUST NOT use segment-tabs when only one option is available (≥ 2 options required)
- MUST NOT allow zero options to be selected
- MUST NOT mix long-form labels with short labels inside one segment-tabs
- MUST NOT use segment-tabs as page-level primary navigation — on any page the top tab row is either `line-tabs` (top-level pages with no breadcrumb) or `pill-tabs level="page"` (whenever a breadcrumb is present above the page title). See `pill-tabs.md §2, §5a` and `line-tabs.md §3`.

---

## 4. Anatomy

```
╭──────────┬──────┬──────┬──────┬──────┬──────┬──────┬──────╮
│ 1 day ▼  │  5D  │  1M  │  3M  │  6M  │  1Y  │  5Y  │  All │
│  0.24%   │ 0.68%│ 3.24%│ 8.14%│ 5.94%│ 2.40%│44.12%│ 393… │
╰──────────┴──────┴──────┴──────┴──────┴──────┴──────┴──────╯
   ▲ active pill
```

| Part | Required | Description |
|------|----------|-------------|
| Outer Capsule | MUST | Single rounded container enclosing all options |
| Option Label | Conditional | Short text identifying each segment (MUST for label-only / label+sub-value layouts; absent for icon-only layout) |
| Option Icon | Conditional | Icon identifying each segment (MUST for icon-only layout; absent for label-based layouts) |
| Option Sub-value | Optional | A secondary value (e.g. % change) rendered under the label on the same option (see §5b) |
| Active Pill / Circle | MUST | Filled background marking the currently selected option — **pill-shaped** for label-based layouts, **circular** for icon-only layout (§5d) |
| Dropdown Caret (`▼`) on an option | Optional | Signals that the option has an additional sub-picker (e.g. "1 day" opens a finer-grain picker); may coexist with sub-value (§5b) |
| Overflow "More" Entry | Conditional | Appears at the right end of the capsule when options do not fit (Web: §6c; Mobile: §6c) |

**Visual States:**

All options support hover and selected states. See §6a for color token specifications.

---

## 5. Variants Overview

### 5a. Option Content Layouts

| Sub-variant | Description | When |
|-------------|-------------|------|
| **Label only** | Each option shows a single short label | Default — use when no comparable per-option value is available |
| **Label + sub-value** | Each option shows a label on top and a secondary value below (e.g. % change, count) | Use when the sub-value helps the user choose the segment (e.g. chart timeframe showing the return for each range) |
| **Icon only** | Each option shows only an icon (no text label) | Use for compact visual filters where icons are universally recognizable (e.g. chart type switchers) |

Rules:

- MUST use **one** layout consistently across all options in a single segment-tabs — do not mix "label only" and "label + sub-value" or "icon only"
- Sub-values MUST be of the **same type and format** across options (e.g. all percentages with the same decimals and sign style)
- Icon-only options MUST use icons that are immediately recognizable without text labels
- Icon-only options use a **circular** selected state instead of the standard pill shape (see §5d)

### 5b. Option with Dropdown Caret

A single option MAY carry a dropdown caret (`▼`) indicating that clicking it opens a finer-grain picker (e.g. "1 day" expands to intraday intervals).

- MUST be limited to **one** option per segment-tabs (typically the first / shortest timeframe)
- The caret is **part of the option**, not a separate action — clicking the option still selects it
- If no finer-grain picker is needed, do not add the caret
- The caret **MAY coexist** with a sub-value (e.g. "1 day ▼" with "0.24%" below) — this is common in chart timeframe switchers where both the dropdown and the performance metric are useful

### 5c. Spacing and Sizing

Two distinct spacing rule sets exist, depending on the content layout (§5a):

#### Rule Set A — Label only / Icon only

Use for short, uniform labels or icons where visual rhythm across options matters.

**Web — Default (container width ≥ 1024px):**

- Option horizontal padding (left/right): **16px**
- Minimum option width: **46px** (including padding) — enforced to keep visual rhythm

**Web — Compact (container width < 1024px):**

- Option horizontal padding (left/right): **12px**
- Minimum option width: **46px** (unchanged)

**Common:**

- Outer capsule border radius: **9999px** (fully rounded)
- Active pill border radius: **9999px** (fully rounded) — circular for icon-only (§5d)
- Gap between options: **0px**

#### Rule Set B — Label + sub-value (special case)

Use **exclusively for Label + sub-value layout** — typically the chart timeframe switcher where each option shows a timeframe label plus a performance metric (e.g. "5D / 0.68%", "1M / 3.24%").

- Option horizontal padding (left/right): **16px** default, **12px** minimum
- Option width: **based on text content width + horizontal padding** — NO fixed minimum width
- Options naturally vary in width depending on their label + sub-value length (e.g. "1Y / 2.40%" vs "5Y / 44.12%")
- Outer capsule border radius: **9999px** (fully rounded)
- Active pill border radius: **9999px** (fully rounded)
- Gap between options: **0px**

**Why no minimum width here:**

Sub-values (percentages) already differ in character count across options; enforcing a uniform minimum width would create wasted whitespace around short values. Letting each option size to its content keeps the capsule compact and readable.

**Responsive behavior:**

1. Start at **16px** padding on all options
2. When the capsule does not fit the container, reduce padding uniformly down to **12px**
3. If it still does not fit, apply the overflow strategy (§6c)

#### Mobile / App

Both rule sets reuse Web spacing rules — no platform-specific adjustments.

### 5d. Icon-only Variant — Circular Selected State

When using **icon-only** options (§5a), the selected state uses a **circular** background instead of the standard pill shape:

- Selected option: **circular** fill (not pill-shaped)
- Unselected options: no background
- Icon color follows standard text color tokens
- Selected icon color: uses `color.button.black.text.default` or equivalent high-contrast token
- Selected background: uses `color.button.black.default`

This variant is typically used for compact visual switchers (e.g. chart type icons, view mode toggles).

---

## 6. Behavior

### 6a. Visual States

segment-tabs options have the following visual states:

| State | Description | Visual Treatment |
|-------|-------------|------------------|
| **Default (unselected)** | Option is not selected and not being interacted with | No background fill; text uses standard text color token |
| **Hover (unselected)** | User hovers over an unselected option | Background: `color.interaction.hover`; text color unchanged |
| **Selected** | Option is currently active | Background: `color.button.black.default` (pill shape, or circular for icon-only variant §5d); text: `color.button.black.text.default` |
| **Selected + Hover** | User hovers over the already-selected option | Same as Selected (no additional hover effect on selected state) |

**Color Token Rules:**

- MUST use `color.interaction.hover` for unselected option hover state
- MUST use `color.button.black.default` for selected option background
- MUST use `color.button.black.text.default` for selected option text
- MUST NOT use raw hex values or custom colors for these states

**Icon-only Variant (§5d):**

- Selected state uses a **circular** background instead of pill shape
- All color tokens remain the same

### 6b. Selection

- Exactly **one** option must be selected at all times
- Clicking an unselected option switches the active pill and the content immediately
- Clicking the already-selected option is a no-op (unless it has a dropdown caret, in which case it opens the sub-picker)

### 6c. Overflow — when options do not fit

The component applies overflow logic in two steps, and the designer chooses one of two final strategies based on option count. Mobile / App follows the same rules as Web.

**Step 1 — Shrink first (always applied):**

Reduce each option's left / right padding from **16px** down to **12px** (§5c). This step is automatic and applies to both rule sets (Label only / Icon only and Label + sub-value).

**Step 2 — If still does not fit, apply one of two strategies:**

#### Strategy A — Many options: **"More ▼" (anchored right)**

**Trigger condition:** At least **one option cannot fit** even after Step 1 (padding already reduced to 12px).

When triggered:

- A **"More ▼"** entry appears and is **anchored to the right end** of the capsule (固定锚点)
- Options that cannot fit are collapsed into the "More ▼" dropdown
- The visible options before "More ▼" remain fully rendered (no visual truncation)
- Clicking "More ▼" reveals the hidden options in a dropdown (Web) or dropdown / bottom sheet (Mobile)

**Responsive behavior (container width changes dynamically):**

- As the container narrows, the **rightmost visible options move into "More ▼"** one by one
- As the container widens, options **return from "More ▼"** to the visible area one by one
- **"More ▼" stays pinned to the right edge at all times** — it does not shift left as options are removed, and it does not get pushed off the edge
- **"More ▼" disappears only when all options fit** (Step 1 padding is sufficient for every option)
- Option transitions use **instant layout reflow** — no animation / no sliding

**Rule summary:**

| Container state | Display |
|-----------------|---------|
| Wide enough for all options at 16px padding | All options shown, default padding, no "More ▼" |
| Fits all at 12px padding only | All options shown, compact padding, no "More ▼" |
| At least one option does not fit at 12px | Visible options + **"More ▼"** anchored right |

#### Strategy B — Few options: **truncate**

**Trigger condition:** Used when the designer explicitly chooses truncation over "More ▼" — typically for 3–6 short options where the trailing items are low-priority.

When the capsule exceeds the available width after Step 1:

- The capsule is **truncated at its right edge**
- The last visible option is cut off visually; **no "More ▼" entry is added**
- No responsive "More" behavior applies — this strategy does not include an anchored entry

**Selection guideline:**

| Context | Recommended Strategy |
|---------|---------------------|
| Timeframe switcher with 7–8+ options (e.g. 1D / 5D / 1M / 3M / 6M / 1Y / 5Y / All) | Strategy A (More ▼ anchored right) |
| Filter with 3–6 short options and known narrow container | Strategy B (truncate) — acceptable if last options are low-priority |
| Any mobile / app scenario | Same as Web — usually Strategy A (More ▼) |

Designers only need to decide **which strategy is acceptable for the module**. Do not redesign the overflow visual — the component provides it.

### 6d. Keyboard

- `ArrowLeft` / `ArrowRight`: move focus between options
- `Home` / `End`: move to first / last option
- `Tab`: move focus out of the control

---

## 7. Configurable Options

The following decisions should be made explicitly by the designer; other visual details are handled by the component.

| Option | Purpose | Typical Values |
|--------|---------|----------------|
| `defaultValue` / `value` | Which option is active on load / controlled value | option `value` string |
| Option content layout | Label only, label + sub-value, or icon only | `"label"` / `"label+value"` / `"icon"` (consistent across all options) |
| Dropdown caret on an option | Whether a single option opens a finer-grain picker | present on ≤ 1 option / absent |
| Overflow strategy | Which behavior applies when the row does not fit | `"more"` (Strategy A, §6c) / `"truncate"` (Strategy B, §6c) |
| Density mode | Spacing applied based on container width | auto: default (≥ 1024px → 16px padding) / compact (< 1024px → 12px padding). Minimum width 46px applies only to Label only / Icon only (Rule Set A, §5c). Label + sub-value has no minimum width (Rule Set B, §5c). |

Designers MUST decide explicitly:

- Which **option content layout** (§5a) applies, and ensure it is consistent across all options
- Whether any option needs a **dropdown caret** (§5b), and if so, which one
- Which **overflow strategy** (§6c) is acceptable given the expected option count and container width
- For **icon-only** layouts, confirm icons are universally recognizable without text (§5d)

---

## 8. Do / Don't

| | Practice | Reason |
|---|---------|--------|
| DO | Use segment-tabs for chart timeframes and other dense module-level slicers | Matches the component's intended scenario |
| DO | Keep all labels short and uniform in length | The segmented capsule depends on visual rhythm |
| DO | Use one option layout consistently (all label-only, or all label+sub-value, or all icon) | Mixing layouts breaks the segmented rhythm |
| DO | Place the dropdown caret on at most one option | Two carets create ambiguous hierarchy |
| DO | Use color tokens (`color.interaction.hover`, `color.button.black.default`, `color.button.black.text.default`) for all states | Ensures theme consistency |
| DO | Let the component handle overflow (truncate / shrink-then-More on Web; More ▼ on mobile) | Overflow visuals are authoritative |
| DO | Use the circular selected state for icon-only variants | Visual convention for icon switchers |
| DON'T | Use segment-tabs as page-level primary navigation | Use line-tabs — segment-tabs is module-scoped |
| DON'T | Mix short labels with long-form labels inside one segment-tabs | Causes uneven widths and forced wrapping |
| DON'T | Wrap segment-tabs onto two lines | The control must stay on a single line |
| DON'T | Use segment-tabs when options are not parallel slices of the same data | Use pill-tabs or line-tabs instead |
| DON'T | Redesign the "More" overflow visual per page | The component's default behavior is authoritative |
| DON'T | Use raw hex colors or custom palettes for hover / selected states | All states MUST use defined color tokens |
| DON'T | Allow zero selected options | segment-tabs is single-select — always one active |
