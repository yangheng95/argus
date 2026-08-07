# Guidelines — TextCollapse (文字折叠)

> **Component Spec:** `ainvest-design-system/references/components/text-collapse.md`

---

## 0. Document Role

This document covers **when and how to use** the TextCollapse (文字折叠) component. It focuses on decisions a designer must make explicitly — visual details handled automatically by the component are omitted.

<!-- - Component import: `@ainvest/text-collapse` -->

---

## 1. Definition

TextCollapse (文字折叠) is a **paragraph-level** collapse pattern: when a long text paragraph exceeds a line limit (default 3 lines), the trailing text is truncated with an ellipsis (`…`) and an inline `See more` link reveals the full content in place. Its goal is to preserve reading flow and screen efficiency for long copy, without taking the user off the current context.

Compared with the other Collapse patterns:

| Pattern | Purpose |
|---------|---------|
| **TextCollapse** (文字折叠) | Truncates a long **paragraph of text** at N lines; expand grows the container inline (向下平铺) |
| Collapse — 全隐藏 (Panel) | Hides an entire grouped/FAQ module behind a header + arrow |
| Collapse — 半隐藏 (List) | Shows first N list rows with a gradient mask over the tail; one-way expand |

TextCollapse is NOT a Popover, NOT a Tooltip, NOT a Modal — it always expands **inline, pushing content below downward**.

---

## 2. When to Use

| Condition | Use TextCollapse? |
|-----------|-------------------|
| A long paragraph exceeds 3 lines and blocks content below it | YES |
| News / article summary shown inline above a structured list | YES |
| Description / bio / disclaimer text whose full length is secondary | YES |
| Comment or review body that may run long | YES |
| User needs full text occasionally but usually scans the first few lines | YES |

### MUST

- MUST truncate at the configured line limit (default 3) and end the visible text with an ellipsis (`…`)
- MUST place the `See more` link **inline** at the end of the truncated text by default; switch to line-break placement only when a §4b trigger applies (technical constraint or explicit business requirement)
- MUST expand in place (向下平铺) — NEVER use a floating layer, popover, or modal to reveal the full text
- MUST respect the responsive width rules on Web (see §5b)

### SHOULD

- SHOULD cap the paragraph width at **756px** on Web for readability (see §5c)
- SHOULD omit `See less` when the expanded module is short enough that a collapse control adds no screen-efficiency value (see §5d)
- SHOULD prefer the inline placement of `See more` / `See less`; switch to line-break placement only when there is a technical constraint or an explicit business requirement (see §4b)

---

## 3. When NOT to Use

| Condition | Use TextCollapse? | Alternative |
|-----------|-------------------|-------------|
| Paragraph is essential and must be read fully on first view | NO | Flatten the text, do not truncate |
| Structured list of rows (news, stocks, FAQ) | NO | `Collapse.List` (半隐藏) or `Collapse.Panel` (全隐藏) |
| Grouped sections where each group has its own header | NO | `Collapse.Panel` (全隐藏) |
| Critical alerts, errors, or disclosures required by compliance | NO | Notice Bar / Notification |
| Long-form article with its own reading flow | NO | Scroll / Pagination |
| Short text that already fits in ≤ 3 lines | NO | Plain text (no collapse needed) |

### MUST NOT

- MUST NOT hide primary decision-making copy behind TextCollapse
- MUST NOT use TextCollapse to fold structured rows or grouped sections — use `Collapse.List` or `Collapse.Panel`
- MUST NOT open the full text in a floating layer, popover, or modal
- MUST NOT exceed **756px** paragraph width on Web
- MUST NOT render a `See more` link when the text does not actually overflow the line limit

---

## 4. Anatomy

### 4a. Standard (inline See more / See less)

```
Collapsed (default, truncated at 3 lines):
┌────────────────────────────────────────────────┐
│ This legislation would provide pathways for    │
│ cannabis-related businesses to access banking  │
│ services and financing, This legis…  See more  │ ← inline after ellipsis
└────────────────────────────────────────────────┘

Expanded:
┌────────────────────────────────────────────────┐
│ [full paragraph text, all lines shown]         │
│                                                │
│ See less                                       │ ← only when screen efficiency requires it
└────────────────────────────────────────────────┘
```

| Part | Required | Description |
|------|----------|-------------|
| Text body | MUST | Paragraph text that may exceed the row limit |
| Ellipsis (`…`) | MUST (when overflowed) | Marks the truncation point at the end of the last visible line |
| `See more` link | MUST (when overflowed) | Inline at the end of the truncated text; triggers inline expansion |
| `See less` link | Conditional | Shown after expansion **only when the content module is long enough that a collapse control is useful for screen efficiency (屏效考虑)**. When there is enough vertical space after expansion, `See less` is NOT shown |
| Expand behavior | MUST | Clicking `See more` grows the container height inline (向下平铺) to fit the full text — NO floating layer, NO modal |

### 4b. Special Style Row — Line-break placement (特殊样式罗列 / 换行展示)

In specific cases, the action link is placed on **its own row directly below the text** instead of inline at the end of the truncated text. This is a **complete declared style for the entire TextCollapse**, not a runtime substitution.

**Triggers (use line-break placement when ANY of the following is true):**

| Trigger | Description |
|---------|-------------|
| Technical constraint | The current rendering environment cannot place `See more` / `See less` inline after the truncated text (e.g., layout engine limitation, mixed content rendering pipeline) |
| Business-specific requirement | The product team explicitly requires the action link to be on its own row (e.g., visual hierarchy / brand requirement for a particular module) |

**Anatomy:**

```
Collapsed state (line-break placement):
┌────────────────────────────────────────────────┐
│ AAPL Earnings Call Summary for Q4/2024  >      │ ← optional preceding content (title etc.)
│ This legislation would provide pathways for    │
│ cannabis-related businesses to access banking  │
│ services and financing, This legis…            │
│ See more                                       │ ← own row, directly below the text
└────────────────────────────────────────────────┘

Expanded state (line-break placement):
┌────────────────────────────────────────────────┐
│ AAPL Earnings Call Summary for Q4/2024  >      │
│ [full paragraph text, all lines shown]         │
│ See less                                       │ ← own row, directly below the text
└────────────────────────────────────────────────┘
```

**Rules:**

- MUST apply line-break placement to **both `See more` and `See less` together** within the same TextCollapse instance — never mix inline `See more` with line-break `See less`, or vice versa
- MUST place the action link **directly below the text body**, with no extra divider or unrelated content between them
- The trigger MUST be a documented technical constraint or an explicit business requirement; do NOT use line-break placement as a default styling preference
- Whether `See less` is shown still follows §5d (screen-efficiency rule) — line-break placement does NOT change that decision
- Applies to **both Web and Mobile**
- Inline placement (§4a) remains the preferred default; switch to line-break only when a trigger applies

---

## 5. Variants & Responsive Rules

### 5a. Default State

| Property | Default |
|----------|---------|
| Collapsed | `defaultExpanded: false` (component default) |
| Row limit | `rows: 3` |
| Truncation suffix | `…` |
| Expand label | `See more` (or custom via `expandLabel`) |
| Collapse label | `See less` (or custom via `collapseLabel`; omit the prop to disable collapse) |

### 5b. Responsive Rules — Web Paragraph Width

The TextCollapse paragraph width **follows the module's inner content area** below it. "内容区" here means the **module container's own inner content area**, NOT the whole viewport and NOT the main page content area.

| Viewport | Rule |
|----------|------|
| `宽度 > 1890` | Paragraph width = **50% of the module content area**, **max 756px** |
| `990 < 宽度 ≤ 1890` | Paragraph width = **50% of the module content area**, **max 756px** |
| `500 < 宽度 ≤ 990` | If module content area > 756px → paragraph width = 756px. If ≤ 756px → paragraph width follows the module content area |
| `宽度 ≤ 500` | Paragraph width follows the module content area. **TextCollapse paragraph font size shrinks from 20px to 18px** (this font-size rule applies to the TextCollapse paragraph only, not to other 20px text on the page). Max **3 lines** (same as default), overflow truncated with ellipsis (`…`) |

Global constraints:
- At any viewport **> 1890**, the behavior is the same as `990 < 宽度 ≤ 1890` — paragraph width = 50% of the module content area, capped at 756px.
- At viewport **≤ 500**, paragraph width always follows the module content area width.

### 5c. Paragraph Width Cap

For readability, the TextCollapse **paragraph width is capped at 756px on Web**. Beyond that width, the text wraps to the next line.

### 5d. `See less` Visibility

| Content length | After expand |
|----------------|--------------|
| Module is long enough that screen efficiency matters | Show `See less` below the content |
| There is enough vertical space after expansion; collapse control adds no value | Do NOT show `See less` |

Controlled via the `collapseLabel` prop: providing a label enables the collapse action; omitting it makes the expansion one-way.

---

## 6. Content Guidelines

### Paragraph Text

- Default visible **3 lines max** before truncation (override via `rows` if the scenario requires a different limit)
- Truncation MUST end with ellipsis (`…`)
- The first 3 lines SHOULD give enough context for the user to decide whether to expand
- MUST NOT front-load critical information after the truncation point

### Action Labels

| Action | Default Label | Notes |
|--------|---------------|-------|
| Expand | `See more` | Required. Custom labels allowed via `expandLabel` |
| Collapse | `See less` | Optional. Only shown when screen efficiency warrants it |

- Labels MUST be verbs or verb phrases ("See more", "Show more", "Read more")
- MUST NOT mix TextCollapse's `See more` with `View All` (the half-hidden list label) in the same page unless they mean semantically different things
- Keep custom labels consistent with the product's voice and the surrounding module

---

## 7. Layout & Composition

### Placement

- TextCollapse sits **inline inside a module container** — it does not float
- Width follows the module's inner content area, subject to the 756px cap on Web (see §5b)
- The text body occupies the full available paragraph width; the `See more` link either trails the last line inline (default) or sits on its own row directly below the text (line-break placement, see §4b)

### Vertical Spacing

- Space between the paragraph and any content below (e.g., a news list): follow the host module's vertical gap
- When `See less` is shown on its own row after expansion, leave at least **8px** between the paragraph end and the link

### Width Rules

- Respect the responsive rules at all breakpoints (see §5b)
- Never hardcode a width that exceeds **756px** on Web
- On Mobile (`≤ 500`), width always follows the container and font size shrinks to 18px

---

## 8. Behavior

### Expansion

- Click `See more` → the container height grows inline (向下平铺) to fit the full text
- NO floating layer, NO popover, NO modal
- The state can be controlled externally via `defaultExpanded` and observed via `onExpandChange`

### Collapse

- `See less` appears only when the expanded module is long enough that a collapse control is useful for screen efficiency
- If there is enough vertical space after expansion (no screen-efficiency concern), `See less` is NOT shown (omit `collapseLabel`)
- Collapsing returns the container to the original `rows`-line state

### Hover (Web only)

- The `See more` / `See less` link uses the standard link hover style
- The paragraph body itself is NOT a hover target — only the action link is clickable

### Keyboard Behavior

- The `See more` / `See less` link MUST be focusable via Tab
- `Enter` or `Space` on the focused link MUST toggle the expansion
- After expansion, focus SHOULD remain on the action link so the user can re-collapse (when `See less` is available)

### Click Target

- Mobile: the `See more` / `See less` link MUST provide at least a **44×44px** hit area (pad if necessary)
- Web: the link's text hit area is sufficient for pointer devices

---

## 9. Platform Differences

| Aspect | Web (> 500) | Mobile (≤ 500) |
|--------|-------------|-----------------|
| Paragraph font size | 20px | 18px (auto-shrunk at ≤ 500) |
| Max paragraph width | 756px | Follows module content area |
| Max collapsed lines | 3 (default `rows`) | 3 (default `rows`) |
| Action link placement | Inline by default; line-break when triggered (§4b) | Inline by default; line-break when triggered (§4b) |
| Hover on action link | Supported | N/A (tap only) |
| Click hit area | Link text area | Whole link row, ≥ 44×44px |

---

## 10. Do / Don't

| | Practice | Reason |
|---|---------|--------|
| DO | Use TextCollapse for long paragraph copy | Preserves reading flow while saving vertical space |
| DO | Truncate at 3 lines by default | Provides enough context without blocking content below |
| DO | Place `See more` inline at the end of the truncated text | Keeps the action visually tied to the text |
| DO | Use line-break placement only when there is a technical constraint or an explicit business requirement | Inline is the preferred default (see §4b) |
| DO | Cap paragraph width at 756px on Web | Readability + responsive consistency |
| DO | Shrink font to 18px and keep 3 lines at ≤ 500 viewport | Mobile legibility |
| DO | Show `See less` only when screen efficiency requires it | Avoids redundant controls in short content |
| DON'T | Use a floating layer, popover, or modal to reveal the full text | TextCollapse must expand 向下平铺 (inline push) |
| DON'T | Use TextCollapse to fold structured rows or grouped sections | Use `Collapse.List` or `Collapse.Panel` instead |
| DON'T | Exceed 756px paragraph width on Web | Breaks the responsive system and reading comfort |
| DON'T | Hide critical information past the truncation point | Users may never expand and will miss it |
| DON'T | Render `See more` when the text does not actually overflow | Creates confusing dead controls |
| DON'T | Mix `See more` and `View All` interchangeably in the same module | `View All` belongs to the half-hidden list pattern |

---

## 11. Decision Table

### When to Use TextCollapse vs Other Collapse Patterns

| Need | Pattern | Implementation |
|------|---------|----------------|
| Long paragraph of running text | **TextCollapse** | `@ainvest/text-collapse` |
| Fold an entire module (FAQ, secondary section) | Collapse — 全隐藏 | `Collapse` (Panel) |
| Show top N rows of a structured list | Collapse — List mode | `Collapse.List` with `visibleCount` |
| List with unpredictable child height (text + images) | Collapse — 半隐藏 | `Collapse.List` + gradient mask |

### Responsive Paragraph Width (Web)

| Viewport | Paragraph width rule |
|----------|----------------------|
| > 1890 | 50% of module content area, max 756px |
| 990 < 宽度 ≤ 1890 | 50% of module content area, max 756px |
| 500 < 宽度 ≤ 990 | If module content > 756px → 756px; else follow content |
| ≤ 500 | Follow module content, paragraph font 20 → 18, max 3 lines |

### `See less` Visibility

| Content length after expand | `See less` |
|-----------------------------|------------|
| Expanded content is long; collapse aids screen efficiency | Show (pass `collapseLabel`) |
| Expanded content is short; collapse control adds no value | Hide (omit `collapseLabel`) |

### Action Link Placement

| Situation | Placement |
|-----------|-----------|
| Default — no triggers apply | Inline at the end of the truncated text |
| Technical constraint (cannot place inline after the text) | Line-break row directly below the text |
| Explicit business / product requirement | Line-break row directly below the text |

---

## 12. Related Documents

- `ainvest-design-system/references/components/text-collapse.md`
- `ainvest-design-system/references/components/collapse.md`
- `ainvest-design-system/references/components/button.md`
- `ainvest-design-system/references/components/link.md`
- `ainvest-design-system/SKILL.md`
- `ainvest-design-system/references/tokens/typography.md`
- `ainvest-design-system/references/tokens/spacing.md`
