# Landing Button

<!-- > Component import: `@ainvest/landing-button` -->
> Related: `button.md`, `text-button.md`, `color.md`, `radius.md`

> Covers **Landing Page Button** type only.
> For Full Rounded and Square buttons → see `button.md`
> For Text buttons → see `text-button.md`

---

## Critical Rules

- Landing Page Button is **Web only** and **Landing Page only**.
- Use for strong marketing CTA.
- Blue button can be used in landing page CTA.
- MUST NOT use Landing Page Button in standard product pages.

---

## ⚠️ Style Isolation (CRITICAL)

**A button's intrinsic radius, stroke, and shadow rules have highest priority — global tokens MUST NOT override them.**

- Button radius is defined in §Size Rules and `radius.md §5` — global `radius.md` values MUST NOT be applied to buttons when this doc specifies them
- Button stroke is defined in §Size Rules — global `stroke.md` values MUST NOT override button stroke widths
- **Buttons MUST NOT have shadow in any state** (Default / Hover / Click / Disabled / Selected) — this overrides any shadow token
- Disabled state MUST use `opacity: 0.4`; do NOT substitute a custom gray
- Hover / Click states use semi-transparent black overlay; do NOT use other techniques
- Hover MUST NOT apply `transform`, translate, or scale

---

## 1. Type Rules

### Landing Page Button
- Web only — MUST NOT appear in App or standard product UI
- Landing Page only — MUST NOT be used in dashboards, settings, or any product page
- Use for strong, prominent marketing CTA
- Full rounded shape only (`radius.pill`)

---

## 2. Hierarchy Rules

### Primary
- Strongest action on the landing page section
- MAX one strong primary button per section

### Secondary
- Supporting or alternative action
- Must be weaker than primary

### Tertiary
- Weak supporting action
- Must be weaker than primary and secondary

---

## 3. Size Rules

### Landing Page Button

| Size  | Prop   | Height | Width    | Min H-Padding | Radius        | Text          | Stroke |
|-------|--------|--------|----------|---------------|---------------|---------------|--------|
| Large | `lg`   | 80px   | flexible | 40px          | `radius.pill` | 20px Semibold | none   |
| Small | `base` | 56px   | flexible | 32px          | `radius.pill` | 20px Semibold | 1px    |

- Width is flexible — can be content-fit or container-stretch depending on layout
- Radius is always full rounded (`radius.pill`); do NOT use square or partially rounded corners

---

## 4. Color Rules

- Buttons MUST use button tokens from `color.md`
- Buttons MUST NOT use generic interaction tokens when button tokens exist
- Button text and background MUST come from the same semantic group
- Light / Dark mode MUST switch by token

### Brand Blue Button
Permitted on Landing Page for primary CTA.

Tokens:
- `color.button.brand.default` / `.press` / `.disabled`
- `color.button.brand.text.default` / `.press` / `.disabled`

### Black Primary Button
Use for strong CTA when brand blue is not appropriate.

Tokens:
- `color.button.black.default` / `.press` / `.disabled`
- `color.button.black.text.default` / `.press` / `.disabled`

### Grey Secondary Button
Use for supporting or alternative CTA.

Tokens:
- `color.button.grey.default` / `.press` / `.disabled`
- `color.button.grey.text.default` / `.press` / `.disabled`

### Weak / Tertiary
- Must be weaker than primary and secondary
- MUST NOT use strong blue or black solid styles

---

## 5. State Rules

### Platform Scope
- **App:** Default, Click, Disabled only — Hover MUST NOT be implemented
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
- Must not invent custom disabled styles — MUST use `opacity: 0.4`

### State Priority
1. Disabled
2. Hover (Web only)
3. Default

---

## 6. Scenario Rules

### Landing Page
- Use Landing Page Button for strong CTA
- Blue button can be used in landing page primary CTA
- Use Black Primary when blue is not suitable
- Use Grey Secondary for supporting actions alongside the primary CTA

---

## 7. Prohibited

- MUST NOT use Landing Page Button in standard product pages
- MUST NOT use Landing Page Button in App UI
- MUST NOT use square or custom radius on Landing Page Button
- MUST NOT guess hover / click / disabled colors
- MUST NOT use raw hex in button UI
- MUST NOT place multiple equally strong primary solid buttons in one section

---

## 8. Failure

If violated:
- Remove Landing Page Button from non-landing page contexts
- Replace with the correct button type for the context (`button.md`)
- Use correct semantic tokens
- Restore correct hierarchy and state behavior
