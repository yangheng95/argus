# Text Button

<!-- Component import: `@ainvest/text-button` -->
> Related: `button.md`, `landing-button.md`, `color.md`

> Covers **Text Button** type only.
> For Full Rounded and Square buttons → see `ainvest-design-system/references/components/button.md`
> For Landing Page buttons → see `ainvest-design-system/references/components/landing-button.md`

---

## Critical Rules

- Text Button is **Web only** and **Landing Page only**.
- Use for lightweight marketing CTA or supporting action.
- MUST NOT use Text Button in standard product pages or App UI.

---

## ⚠️ Style Isolation (CRITICAL)

**A button's intrinsic radius, stroke, and shadow rules have highest priority — global tokens MUST NOT override them.**

- **Buttons MUST NOT have shadow in any state** (Default / Hover / Click / Disabled) — this overrides any shadow token
- Disabled state MUST use `opacity: 0.4`; do NOT substitute a custom gray
- Hover MUST NOT apply `transform`, translate, or scale

---

## 1. Type Rules

### Text Button
- Web only — MUST NOT appear in App UI
- Landing Page only — MUST NOT be used in dashboards, settings, or any product page
- Use for lightweight marketing CTA or supporting action alongside a Landing Page Button
- No background, no border — text only
- Blue Text Button can be used for paid product / trading / landing page CTA contexts

---

## 2. Hierarchy Rules

### Supporting / Tertiary
- Text Button is always weaker than Landing Page Button
- Use as a secondary or tertiary option on a landing page — never as the sole primary CTA
- Must not compete visually with the primary Landing Page Button

---

## 3. Size Rules

### Text Button

- No fixed height or width
- Font size follows the surrounding layout typography rhythm; align with the typographic scale in use on the page
- No padding rules enforced — spacing is governed by layout context

| Size  | Prop   | Font Size | Line Height |
|-------|--------|-----------|-------------|
| Large | `lg`   | 16px      | 22px        |
| Base  | `base` | 14px      | 18px        |
| Small | `sm`   | 12px      | 16px        |

---

## 4. Color Rules

- Buttons MUST use button tokens from `color.md`
- Buttons MUST NOT use generic interaction tokens when button tokens exist
- Button text color MUST come from the correct semantic token group
- Light / Dark mode MUST switch by token

### Brand Blue Text Button
Use for:
- Trading-related landing page actions
- Paid product related landing page actions
- General landing page lightweight CTA

Tokens:
- `color.button.brand.text.default` / `.press` / `.disabled`

Rules:
- MUST NOT use blue Text Button in normal product UI
- MUST NOT use blue Text Button outside landing page / trading / paid product contexts

### Black Text Button
Use for standard lightweight CTA where brand blue is not appropriate.

Tokens:
- `color.button.black.text.default` / `.press` / `.disabled`

### Grey Text Button
Use for weakest supporting actions or dismiss-level interactions.

Tokens:
- `color.button.grey.text.default` / `.press` / `.disabled`

### Weak / Tertiary
- Must be weaker than primary and secondary
- MUST NOT use strong blue or black solid styles

---

## 5. State Rules

### Platform Scope
- **App:** Not applicable — Text Button is Web / Landing Page only
- **Web:** Default, Hover, Click, Disabled

### Supported States — Web
Default → Hover → Click → Disabled

### Default
- Actionable; clearly readable as an interactive text element

### Hover (Web only)
- Provides hover feedback (e.g. underline or opacity shift) using button state tokens
- Must not change hierarchy
- MUST NOT apply `transform`, translate, or scale
- MUST NOT add background or border on hover — text button stays text-only

### Click
- Provides click feedback using button press tokens

### Disabled
- Non-clickable; must use button disabled tokens
- Must not invent custom disabled styles — MUST use `opacity: 0.4`

### State Priority
1. Disabled
2. Hover
3. Default

---

## 6. Scenario Rules

### Landing Page
- Use Text Button for lightweight or supporting CTA
- Pair with Landing Page Button when a primary + secondary CTA pair is needed
- Blue Text Button can be used for trading-related or paid-product-related landing page actions

---

## 7. Prohibited

- MUST NOT use Text Button in standard product pages
- MUST NOT use Text Button in App UI
- MUST NOT add background, border, or fill to a Text Button
- MUST NOT use Text Button as the sole primary CTA — always pair with or subordinate to a stronger button
- MUST NOT guess hover / click / disabled colors
- MUST NOT use raw hex in button UI

---

## 8. Failure

If violated:
- Remove Text Button from non-landing page contexts
- Replace with the correct button type for the context (`button.md`)
- Use correct semantic tokens
- Restore correct hierarchy — Text Button must always be subordinate to Landing Page Button
