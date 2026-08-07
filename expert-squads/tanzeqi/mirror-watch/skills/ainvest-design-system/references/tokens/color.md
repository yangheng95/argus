# Design System — Color Tokens

All UI MUST follow this specification.

---

# 0. Source of Truth

**本文件不含任何色值，只定义 token 名称、用途、分类和使用规则。**

**所有色值的唯一来源是** `assets/tokens/color.json`。

## 0.1 Reading Rules

- AI / 工具 / 代码生成器 MUST 从 `assets/tokens/color.json` 读取色值
- MUST NOT 在 `.md` 文件或代码中写裸 hex / rgba 色值
- 遇到未在 `color.json` 定义的 token → 回到本文件核对 token 名，如确实缺失则在 `PENDING.md` 登记，不自创色值

## 0.2 CSS Variable Generation

将 `color.json` 转为 CSS 变量的规则：

1. Token 名 `color.button.brand.default` → CSS 变量 `--color-button-brand-default`（`.` 全部替换为 `-`，加 `--` 前缀）
2. `light` 模式所有值写入 `:root { }`
3. `dark` 模式所有值写入 `[data-theme="dark"] { }`
4. 只有单值的 token（`value` 字段）同时生效于 light 和 dark，只写一次进 `:root { }`

示例：
```css
:root {
  --color-brand-primary: #165DFF;
  --color-bg-page: #FFFFFF;
  --color-gray-50: #808080;
}
[data-theme="dark"] {
  --color-brand-primary: #3371FF;
  --color-bg-page: #0D0D0D;
}
```

---

# 1. Core Principles

- MUST use semantic tokens
- MUST NOT use raw hex values in UI
- MUST follow color priority
- MUST NOT mix color systems
- MUST use component-specific tokens when a component token is defined
- MUST use global semantic tokens when no component token is defined

---

# 2. Color Usage Priority

1. brand
2. button
3. price
4. status
5. text
6. structure
7. auxiliary
8. chart

---

# 3. Brand

### color.brand.primary

### Rules

- MUST be used for brand-level primary emphasis
- MUST be used for brand-related key actions when no button-specific token is defined
- MUST NOT be used for secondary actions
- MAX one primary button per section
- MUST NOT be used as large background

---

# 4. Button

Button tokens are component-specific semantic tokens.
All buttons MUST use button tokens instead of raw brand / text / structure colors.

## 4.1 Brand Button

- color.button.brand.default
- color.button.brand.press
- color.button.brand.disabled
- color.button.brand.text.default
- color.button.brand.text.press
- color.button.brand.text.disabled

## 4.2 Black Button

- color.button.black.default
- color.button.black.press
- color.button.black.disabled
- color.button.black.text.default
- color.button.black.text.press
- color.button.black.text.disabled

## 4.3 Grey Button

- color.button.grey.default
- color.button.grey.press
- color.button.grey.disabled
- color.button.grey.text.default
- color.button.grey.text.press
- color.button.grey.text.disabled

## 4.4 Button Semantic Aliases

- color.button.text.white.brand
- color.button.text.white.black
- color.button.text.black
- color.button.bg.brand
- color.button.bg.black
- color.button.bg.grey
- color.button.bg.black.press.overlay

## 4.5 Button State Mapping

### Brand Primary Button
- background.default: color.button.brand.default
- background.press: color.button.brand.press
- background.disabled: color.button.brand.disabled
- text.default: color.button.brand.text.default
- text.press: color.button.brand.text.press
- text.disabled: color.button.brand.text.disabled

### Black Primary Button
- background.default: color.button.black.default
- background.press: color.button.black.press
- background.disabled: color.button.black.disabled
- text.default: color.button.black.text.default
- text.press: color.button.black.text.press
- text.disabled: color.button.black.text.disabled

### Grey Secondary Button
- background.default: color.button.grey.default
- background.press: color.button.grey.press
- background.disabled: color.button.grey.disabled
- text.default: color.button.grey.text.default
- text.press: color.button.grey.text.press
- text.disabled: color.button.grey.text.disabled

## 4.6 Button Rules

- MUST use `color.button.brand.*` for paid, trading, AI, and Aime-related primary actions
- MUST use `color.button.black.*` for standard critical actions
- MUST use `color.button.grey.*` for secondary or neutral actions
- MUST NOT create custom hover, press, or disabled colors
- MUST use the corresponding text token within the same button group
- MUST switch light and dark mode by token, not by hard-coded values
- MUST prefer button tokens over global brand/text/background tokens for all button components

---

# 5. Price

- color.price.up
- color.price.down
- color.price.neutral

### Rules

- MUST be used ONLY for financial data
- MUST NOT be used for UI actions
- MUST NOT be used for feedback

---

# 6. Status

- color.status.success
- color.status.error
- color.status.warning
- color.status.info

### Rules

- MUST represent system feedback
- MUST NOT represent market data
- MUST NOT be used in primary actions

---

# 7. Text

- color.text.primary
- color.text.secondary
- color.text.tertiary
- color.text.quaternary
- color.text.special
- color.text.inverse
- color.text.link
- color.text.aime

### Rules

- MUST use hierarchy
- MUST NOT use primary everywhere
- MUST NOT replace hierarchy with font size

---

# 8. Structure

## 8.1 Mask

- color.mask.level1
- color.mask.level2
- color.mask.level3

## 8.2 Background

### color.bg.page
- **NOTE:** Page background. MUST be white (#FFFFFF) in light mode. MUST NOT be rendered as gray. Equal to `color.bg.surface` — both are white. AI models must map this token to `#FFFFFF`, never to any gray value.
- **CRITICAL — CSS Variable:** When writing the CSS `:root` block, ALWAYS declare `--color-bg-page: #FFFFFF`. NEVER write `--color-bg-page: #F7F7F7` or any gray hex. `#F7F7F7` is NOT a valid value for this token.

### color.bg.surface
- **NOTE:** Component surface (cards, panels). Same white as `color.bg.page` in light mode.

### color.bg.weak
### color.bg.nav

## 8.3 Divider

- color.divider.level1
- color.divider.level2
- color.divider.level3

## 8.4 Border

- color.border.default

### Rules

- MUST use divider for structure
- MUST use mask for overlay
- MUST NOT overuse borders

## 8.5 Pattern

### color.pattern.zebra.web
- **PURPOSE:** Alternating row background for **full-width single-container data tables** on web surfaces. Applies to even rows; odd rows remain on `color.bg.surface`.
- **NOTE:** Dedicated zebra token. MUST NOT substitute with `color.bg.weak` (too strong — 5 % opacity overlay) or `color.gray.97` (not semantic). Value is a specific `#FAFAFA` / `#1A1A1A` pair tuned for low-contrast but perceptible row banding.
- **Scope:** Applies ONLY to tables that span the full width of the page content container (see `references/rules/list-table-pattern.md` §Zebra Stripe). MUST NOT be applied to tables nested inside cards, panels, modals, or secondary containers.

---

# 9. Neutral

- color.gray.0
- color.gray.20
- color.gray.40
- color.gray.50
- color.gray.60
- color.gray.70
- color.gray.80
- color.gray.90
- color.gray.95
- color.gray.97
- color.gray.100

### Rules

- MUST NOT be used directly

---

# 10. Auxiliary

- color.aux.blue
- color.aux.green
- color.aux.red
- color.aux.orange
- color.aux.yellow
- color.aux.cyan
- color.aux.indigo
- color.aux.purple
- color.aux.gold

### Rules

- MUST be used for tags only
- MUST NOT be used for actions

---

# 11. Transparent

- color.alpha.blue
- color.alpha.green
- color.alpha.red

### Rules

- MUST be used for background only
- MUST NOT be used for text

---

# 12. Chart

- color.chart.primary
- color.chart.01
- color.chart.02
- color.chart.03
- color.chart.04
- color.chart.05
- color.chart.06
- color.chart.07
- color.chart.08

### Rules

- MUST be used ONLY in charts
- MUST NOT be used in UI

---

# 13. Interaction

Global interaction tokens are for non-button surfaces only.
Buttons MUST use button-specific state tokens.

- color.interaction.hover
- color.interaction.active

### Rules

- hover < active
- MUST be used for non-button containers, list rows, cards, and generic interactive surfaces
- MUST NOT replace button press tokens

---

# 14. Global Rules

### MUST

- follow priority
- use semantic tokens
- maintain hierarchy
- use button tokens for buttons
- use text tokens for text
- use structure tokens for borders, dividers, masks, and generic backgrounds
- 色值必须从 `assets/tokens/color.json` 读取

### MUST NOT

- use raw hex in UI
- 在 `.md` 或代码中手写色值
- mix systems
- overuse brand color
- use global interaction tokens on button components when button-specific state tokens exist

---

### FAILURE

If violated → regenerate UI
