# Button

<!-- > Component import: `@ainvest/button` -->
> Related: `landing-button.md`, `text-button.md`, `color.md`, `radius.md`

> Covers **Full Rounded (胶囊按钮)**, **Rect (方形按钮)**, and **Circle (圆形按钮)** button types only.
> For Landing Page buttons → see `landing-button.md`
> For Text buttons → see `text-button.md`

---

## Critical Rules

- MUST use Full Rounded (胶囊按钮) by default.
- MUST use Rect (方形按钮) only in special cases.
- MUST use Circle (圆形按钮) only for icon buttons or action entry points (图标按钮或操作入口).
- MUST use blue button only in trading-related UI or paid-product-related UI.
- Button must be a single-layer button. Do not place a pill button inside another rounded container. Avoid double-rounded nested shapes. Use one background layer only.

---

## ⚠️ Style Isolation (CRITICAL)

**A button's intrinsic radius, stroke, and shadow rules have highest priority — global tokens MUST NOT override them.**

- Button radius is defined in §Size Rules and `radius.md §5` — global `radius.md` values MUST NOT be applied to buttons when this doc specifies them
- Button stroke is defined in §Size Rules — global `stroke.md` values MUST NOT override button stroke widths
- **Buttons MUST NOT have shadow in any state** (Default / Hover / Click / Disabled) — this overrides any shadow token
- Disabled state MUST use `opacity: 0.4`; do NOT substitute a custom gray
- Hover / Click states use semi-transparent black overlay; do NOT use other techniques
- Hover MUST NOT apply `transform`, translate, or scale

---

## 1. Type Rules

### Full Rounded (胶囊按钮)
- Default button type — highest priority shape
- **Radius token:** `radius.pill` — capsule ends with straight top/bottom; do **not** implement with `border-radius: 50%` on wide rectangles (that yields an ellipse, not a pill)
- Use in all normal product UI
- Use for: primary CTA, form actions, dialog actions, card actions, list actions, module actions, page actions

### Rect (方形按钮)
- Special-use only — non-essential cases MUST NOT use Rect
- Use only when:
  - Container space is limited AND multiple short-text options need to appear together
  - The action is icon-only
- MUST NOT use Rect as a normal alternative to Full Rounded (胶囊按钮)
- MUST NOT use Rect on Mobile
- If Full Rounded (胶囊按钮) can be used reasonably, MUST use Full Rounded (胶囊按钮) instead

### Circle (圆形按钮)
- Use for icon buttons or action entry points (图标按钮或操作入口)
- Shape is a perfect circle — width and height MUST be equal
- **Radius token:** `radius.full` (`border-radius: 50%`) — applied to a square hit target
- Content MUST be a single icon; do NOT place text inside a Circle button
- MUST NOT use Circle for actions that require a text label

---

## 2. Hierarchy Rules

### Primary
- Strongest action in the section
- MAX one strong primary button per section

### Secondary
- Neutral or supporting action
- Must be weaker than primary

### Tertiary
- Weak supporting action
- Use for cancel / skip / later / dismiss
- Must be weaker than primary and secondary

---

## 3. Size Rules

### Full Rounded (胶囊按钮)

| Size           | Prop  | Height | Min-width | Text              | Gap   | Stroke |
|----------------|-------|--------|-----------|-------------------|-------|--------|
| Large          | `lg`  | 44px   | 80px      | 16px Semibold     | 20px  | 1.5px  |
| Medium         | `base`| 36px   | 70px      | 14px Semibold     | 16px  | 1.5px  |
| Small          | `sm`  | 28px   | 60px      | 12px Semibold     | 12px  | 1px    |
| XSmall         | `xs`  | 24px   | 50px      | 11px Semibold     | 8px   | 1px    |

- Radius: `radius.pill` — do not use `radius.full` / `50%` unless the hit target is square

### Rect (方形按钮)

| Size           | Prop  | Height | Width | Radius | Text          | Gap   | Stroke |
|----------------|-------|--------|-------|--------|---------------|-------|--------|
| Large          | `lg`  | 44px   | auto  | 10px   | 16px Semibold | 20px  | 1.5px  |
| Medium         | `base`| 36px   | auto  | 6px    | 14px Semibold | 16px  | 1.5px  |
| Small          | `sm`  | 28px   | auto  | 6px    | 12px Semibold | 12px  | 1px    |

### Circle (圆形按钮)

| Size           | Prop  | Diameter | Icon Size | Stroke |
|----------------|-------|----------|-----------|--------|
| Large          | `lg`  | 44px     | 24px      | 1.5px  |
| Medium         | `base`| 36px     | 20px      | 1.5px  |
| Small          | `sm`  | 28px     | 16px      | 1px    |
| XSmall         | `xs`  | 24px     | 14px      | 1px    |

- Width and height MUST be equal to maintain a perfect circle
- Radius: `radius.full` (`border-radius: 50%`) applied to a square hit target

---

## 4. Color Rules

- Buttons MUST use button tokens from `color.md`
- Buttons MUST NOT use generic interaction tokens when button tokens exist
- Button text and background MUST come from the same semantic group
- Light / Dark mode MUST switch by token

### Brand Blue Button
Use only for trading-related interfaces or paid-product-related interfaces.

Tokens:
- `color.button.brand.default` / `.press` / `.disabled`
- `color.button.brand.text.default` / `.press` / `.disabled`

Rules:
- MUST NOT use blue for normal product actions
- MUST NOT use blue for neutral actions
- MUST NOT use blue outside trading / paid product scenarios

### Black Primary Button
Use for standard critical actions and normal product primary actions.

Tokens:
- `color.button.black.default` / `.press` / `.disabled`
- `color.button.black.text.default` / `.press` / `.disabled`

### Grey Secondary Button
Use for neutral, supporting, or secondary actions.

Tokens:
- `color.button.grey.default` / `.press` / `.disabled`
- `color.button.grey.text.default` / `.press` / `.disabled`

### Weak / Tertiary
- Must be weaker than primary and secondary
- MUST NOT use strong blue or black solid styles

---

## 5. State Rules

### Platform Scope
- **App:** Default, Click, Disabled only — Hover and Selected MUST NOT be implemented
- **Web:** Default, Hover, Click, Disabled

### Supported States — App
Default → Click → Disabled

### Supported States — Web
Default → Hover → Click → Disabled

### Default
- Actionable and clearly clickable

### Hover (Web only)
- Provides hover feedback; must not change hierarchy
- Must use button state tokens
- MUST NOT apply `transform`, translate, or scale

### Click
- Provides click feedback using button press tokens

### Disabled
- Non-clickable; must use button disabled tokens
- Must not invent custom disabled styles

### State Priority
1. Disabled
2. Hover (Web only)
3. Default

---

## 6. Scenario Rules

### Standard Product UI
- Use Full Rounded (胶囊按钮) by default
- Use Black Primary for normal key actions
- Use Grey Secondary for supporting actions
- Do not use blue button unless the page is trading-related or paid-product-related

### Trading UI
- Full Rounded (胶囊按钮) still has highest shape priority
- Blue button can be used for trading-related primary actions

### Paid Product UI
- Full Rounded (胶囊按钮) still has highest shape priority
- Blue button can be used for paid product related actions

### Icon Button / Action Entry (图标按钮或操作入口)
- Use Circle (圆形按钮) when the action is represented by a standalone icon with no text label
- Use Full Rounded (胶囊按钮) with icon + text if a label is needed

### Special Compact Web UI
- Use Rect (方形按钮) only when container is limited and multiple short-text options must appear together, or action is icon-only
- Otherwise use Full Rounded (胶囊按钮)

---

## 7. Prohibited

- MUST NOT create custom button types
- MUST NOT use Rect (方形按钮) in normal cases or as a normal alternative to Full Rounded (胶囊按钮)
- MUST NOT use Rect (方形按钮) on Mobile
- MUST NOT use Circle (圆形按钮) with a text label
- MUST NOT use blue button in normal non-trading, non-paid-product product UI
- MUST NOT guess hover / click / disabled colors
- MUST NOT use raw hex in button UI
- MUST NOT place multiple equally strong primary solid buttons in one section

---

## 8. Failure

If violated:
- Regenerate button
- Use Full Rounded (胶囊按钮) first
- Use Rect (方形按钮) only if the special conditions are met
- Use Circle (圆形按钮) only for icon-only entry points with no text label
- Use correct semantic tokens
- Restore correct hierarchy and state behavior
