---
name: ainvest-design-system
description: Ainvest financial product design system. Use this skill whenever the user asks to 生成/generate, 设计/design, 优化/enhance, 调整/adjust, or 添加/add anything for the Ainvest platform — including pages, dashboards, components, restyles, or any UI work for Ainvest products. Use this skill even if the user does not explicitly say "design system." Provides the only sanctioned tokens, components, layouts, and assets for Ainvest UI.
---

# Ainvest Design System

Generate and modify UI for Ainvest financial products using ONLY the assets, components, layouts, and tokens defined in this system.

## Closed-System Rule (read first)

This is a **closed system**. During any generation, restyle, or adjustment task you may only use:

- Tokens from `ainvest-design-system/references/tokens/` (values from `ainvest-design-system/assets/tokens/color.json`)
- Components from `ainvest-design-system/references/components/`
- Layouts/rules from `ainvest-design-system/references/rules/`
- Assets from `assets/` and the CDN patterns listed below

Do NOT invent new tokens, components, styles, or layout patterns. If a Page Spec describes something this system does not cover, use the closest existing pattern and flag the gap to the user — do not improvise.

Generic UI knowledge is not a second authority. If a rule exists in this system, that rule wins over any generic habit.

---

## When to Use

Trigger on these verbs (English or Chinese) directed at Ainvest UI:

| Verb | Chinese | Mode |
|------|---------|------|
| generate / build / create | 生成 / 帮我做一个 | Mode A — Generate from scratch |
| design | 设计 | Mode A |
| enhance / improve / refine | 优化 | Mode B — Modify existing |
| adjust / tweak | 调整 / 改一下 / 修一下 | Mode B |
| add (a section/component) | 添加 | Mode B (extend existing) |
| restyle / reskin | apply design system to | Mode B |

If intent is ambiguous, ask one question: "你是要基于现有文件修改，还是从头生成一个新页面？" Do not proceed without a mode.

Out of scope: non-Ainvest UI, internal tooling with no brand constraints.

---

## Inputs

You need exactly two:

1. **Page Spec** — what to build (structure, sections, states, interactions)
2. **This design system** — how to style it

When they conflict, **Page Spec wins on structure, design system wins on style**.

---

## Workflow

### Step 1 — Pre-flight (mandatory before any code)

Output this block before writing any HTML/CSS/JSX. It is a commitment to load every file you list, not a summary written after the fact.

```
<pre-flight>
Mode:               [A: Generate | B: Modify]
Page type:          [dashboard | detail | list | landing | form | modal | other]
Layout:             [fixed-width 1560 / 1164 / 768 | adaptive-limited | adaptive-unlimited] + [single-col | multi-col ratio]

Tokens to load (in order): spacing → typography → color.md + color.json → radius → shadow → stroke

Rules to load:
  - ainvest-design-system/references/rules/layout-grid.md         ← always
  - ainvest-design-system/references/rules/image-asset-usage.md   ← if any <img>
  - ainvest-design-system/references/rules/card.md                ← if any card surface
  - ainvest-design-system/references/rules/list-table-pattern.md  ← if any list-of-items
  - ainvest-design-system/references/rules/component-selection.md ← always (disambiguation)
  - [other rules matched from Trigger Phrases — see ainvest-design-system/references/rules/component-selection.md §Trigger-Phrases]

Components to use (every one, with file path):
  - <name> → ainvest-design-system/references/components/<file>.md
  - ...

Images on this page: [none | list each: ticker / avatar / news thumbnail / flag / broker logo]

Open questions before coding: [list or "none"]
</pre-flight>
```

If you list a file in pre-flight, you must actually open and read it before writing code that uses it. Listed-but-unread = not listed.

Re-emit this block whenever scope grows mid-task.

### Step 2 — Mode A: Generate from scratch

1. **Read the full Page Spec.** Confirm you can list every distinct UI element before continuing.
2. **Determine layout.** Load `ainvest-design-system/references/rules/layout-grid.md`. Pick fixed (1560/1164/768) or adaptive; single-col or multi-col.
3. **Apply tokens** in this order: spacing → typography → color → radius → shadow → stroke. Load each file from `ainvest-design-system/references/tokens/`. Read color hex values from `ainvest-design-system/assets/tokens/color.json` only — never copy hex from `color.md`, never hardcode hex into output.
4. **Load image rules** (`ainvest-design-system/references/rules/image-asset-usage.md`) if the page has any `<img>`. See [Images](#images) below for the short version.
5. **Run perceptual heuristics check.** Load `ainvest-design-system/references/rules/perceptual-ux-heuristics.md` and run its self-audit against the planned layout *before* building components. Common triggers: ≥3 sections, ≥3 data types in one card, mixed semantic categories in a row.
6. **Build components.** For each component the Spec calls for, open its `.md` file in `ainvest-design-system/references/components/` and follow it exactly. If a card surface appears, also load `ainvest-design-system/references/rules/card.md` (it is the single source for card bg/border/radius/padding/states — do not consult `shadow.md` for card shadow).
7. **Cross-page consistency review.** Check shared elements (AI Score, ticker block, person identity, return tags, section titles, filter bars) against `spec-conventions/cross-page-rules.md` and existing pages in `temp/html/`.
8. **Validation.** See [Validation](#validation) below.

### Step 3 — Mode B: Modify existing

1. **Pre-edit audit.** Read the existing file completely. Catalog: interactive functions, layout structure, every data field, component groupings. Screenshot to `temp/screenshots/` to lock the baseline.
2. **Classify each change** as either:
   - **Pure Style** — token swap only; no DOM change, no flow change, no interaction change. Apply directly.
   - **Structural** — anything else (moving/adding/removing DOM, regrouping, layout-flow changes, interaction changes). State the problem, recommend a fix, **wait for explicit user confirmation** before applying.
3. **If user is unsure** about a structural fix, generate two or three side-by-side files: `{name}-Va.html` (style-only), `{name}-Vb.html` (recommended structural fix), optional `-Vc.html` (alternative). Never overwrite the original or any previous version — increment `-V2`, `-V3`, etc.
4. **Post-generation review** against the audit catalog: every function, layout element, and data value still present (unless an approved structural change removed it). All visual properties now use semantic tokens — zero raw hex.
5. **Modification report** — every output ends with a table:

| Area | Change Type | Before | After |
|------|-------------|--------|-------|
| Button shape | Pure Style | `border-radius: 4px` | `var(--radius-full)` |
| Up Next card | Structural (approved) | thumbnail floating outside text | unified flex unit |

Use real token names in "After." No raw hex. Mark each change `Pure Style` or `Structural (approved)`.

---

## Key Parameters

| Parameter | Value |
|-----------|-------|
| Font | Plus Jakarta Sans |
| Spacing base | 8px (scale: 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48) |
| Breakpoints | XL ≥1410 / LG 900–1410 / MD 500–900 / SM <500 |
| Fixed-width presets | 1560 (default) / 1164 (medium) / 768 (reading) |
| Adaptive max | 2530px (limited adaptive only) |
| Default button shape | Full Rounded (pill, `border-radius: 9999px`) |
| Button sizes | XS 24 / S 28 / M 36 / L 44 |
| Two-column gap | 48px |
| Two-column ratio | 8:4 default |
| Default font-size whitelist | 10, 11, 12, 14, 16, 18, 20, 24, 26, 32, 40, 56 |
| Default radius whitelist | 4, 6, 16, 24, 9999 (pill) |

---

## Reference Files

Load only what the current page needs. The component-selection rules and trigger-phrase table live alongside the rule files so they can grow without bloating SKILL.md.

### Tokens (`references/tokens/`)

| File | Contains | Load when |
|------|----------|-----------|
| `spacing.md` | 8px scale, usage rules | Always |
| `typography.md` | Font scale, weights, line heights | Always |
| `color.md` | Color token names, categories, usage rules (no hex values) | Always |
| `assets/tokens/color.json` | All color hex values (light + dark). Single source of truth for color values. | Always when applying color |
| `radius.md` | Corner radius tokens per component type | Any shaped component |
| `shadow.md` | Elevation tokens (web + app) | Overlays, dropdowns, modals — NOT cards |
| `stroke.md` | Border widths/colors, web/app split | Any border or divider |

### Rules (`references/rules/`)

| File | Contains | Load when |
|------|----------|-----------|
| `layout-grid.md` | Breakpoints, grid, fixed/adaptive width | Always |
| `component-selection.md` | Ainvest-specific component-choice rules + Trigger-Phrase table (Spec keyword → required `.md`) | Always |
| `card.md` | Card bg, border, radius, padding, hover/active/selected states; carousel card counts by breakpoint | Any card or carousel |
| `color-opacity-on-overlap.md` | Solid-fill rule for floating elements over borders or content | Carousel arrows, dropdowns, tooltips over content |
| `list-table-pattern.md` | List/table containers, row hover, header, column alignment | Any data list or table |
| `image-asset-usage.md` | Exact local source, shape, dimensions, and `object-fit` rules | Any `<img>` |
| `perceptual-ux-heuristics.md` | Visual hierarchy, grouping, contrast, consistency self-audit | Always — once per page, plus when design feels off |

### Components (`references/components/`)

One `.md` per component. Load the file for every component the Page Spec calls for, and follow it exactly — if a doc specifies a semantic element (`<a>` for links, `<button>` for buttons), use that exact element. Do not invent component variants beyond what the file defines.

| File | Contains | Load when the page has |
|------|----------|------------------------|
| `breadcrumb.md` | Hierarchy rules, collapse behavior, node states, platform breakpoints | Any breadcrumb navigation |
| `button.md` | Types (Full Rounded / Rect / Circle), hierarchy, sizes, colors, states | Any standard product button |
| `carousel.md` | Indicator types (dot / free-scroll / arrow), sizes, animation, overflow | Any carousel or horizontal card slider |
| `checkbox-group.md` | Variants (Basic / Binary / Filter / Special), positioning, spacing, states | Any multi-select control |
| `collapse.md` | Variants (full-hide / half-hide / text / list), trigger rules, panel mode | Any expandable/collapsible section |
| `date-picker.md` | Props, view modes, navigation, action bar | Single-date selector |
| `date-range-picker.md` | Props, range selection rules, action bar | Date range selector |
| `dialog.md` | Variants, sizes, button layout, platform differences | Any modal dialog / popup / 弹窗 |
| `drawer.md` | Bottom sheet types, header styles, height rules, responsive switching | Any bottom sheet, drawer, or side panel |
| `dropdown-menu.md` | Trigger rules, single/multi-select, grouping, responsive switching | Any dropdown or contextual menu |
| `empty.md` | Empty-state levels, icon types, content configs, container setup | Any empty / "no data" / error state |
| `floor-title.md` | Levels (page / group / section), action-bar slot, collapse mode | Any page-level title + subtitle, or section heading |
| `input.md` | Variants (text / number / range / textarea / OTP), props, validation | Any input or form field |
| `landing-button.md` | Sizes, colors, states for Landing Page CTAs | A landing-page CTA button (NOT product pages) |
| `line-tabs.md` | Spacing variants, overflow patterns, sticky, responsive | Primary page-level tab navigation / 顶级标签 |
| `link.md` | Types (default / emphasis), icon usage, underline rules, color states | Any inline text link, including "View all →" / "查看全部" |
| `noticebar.md` | Hierarchy, background emphasis, right-slot config, responsive | Any persistent notice bar or announcement banner |
| `notification.md` | Variants, stacking rules, position, auto-dismiss | Any floating notification card |
| `pagination.md` | Variants, page-number display logic, page-size selector, platform constraints | Any paginated list or table |
| `pill-tabs.md` | `level` prop, content variants, right-side action icon, overflow | Secondary or module-level tab switcher |
| `popover.md` | Variants, step indicators, positioning, trigger behavior | Guided onboarding bubbles or rich hover content with title/image/buttons |
| `radio-group.md` | Variants (Basic / Filter / Special Selection), positioning, spacing, states | Any single-select control |
| `search-input.md` | Platform variants, states, dropdown rules, Cancel behavior | Any search or query input |
| `segment-tabs.md` | Label layout, dropdown caret rules, overflow strategies | Chart timeframe (1D/1W/1M/1Y/All) or any dense module-level switcher |
| `spinner.md` | Variants, sizes, scenarios (page / pull-to-refresh / load-more / inline) | Any loading indicator |
| `switch.md` | States, sizes, label rules, loading and confirmation behavior | Any binary toggle |
| `table.md` | Sort / pin / sticky / virtualization, Event Calendar variant, responsive | Any data table or event calendar |
| `tag.md` | Categories (通用 / 业务 / 文字 / 自定义), sizes, colors, stroke, interaction states | Any tag, label, chip, or category pill |
| `text-button.md` | Usage, colors, states for text-only buttons | Text-only button on a landing page (NOT product pages) |
| `toast.md` | Status types, position rules, auto-dismiss, stacking | Transient single-line operation feedback |
| `tooltip.md` | Variants (Primary / Neutral), trigger modes, icon-type rules, text layout | 1–2 line hover/click explanation bubble |

**Picking between siblings.** When two components could fit, open `ainvest-design-system/references/rules/component-selection.md` first. Common confusions: line-tabs vs pill-tabs vs segment-tabs; Toast vs Notification vs NoticeBar; Tooltip vs Popover; Dialog vs Drawer; Button vs Tag vs Link.

---

## Images

If the page contains any `<img>`, load `ainvest-design-system/references/rules/image-asset-usage.md`. The non-negotiables:

| Image type | Source | Shape |
|------------|--------|-------|
| Stock / ETF / crypto logo | `https://cdn.ainvest.com/icon/us/{SYMBOL}.png` (or `/etf/`, `/crypto/`) — **`.png` only, never `.svg`** | Circular: `border-radius: 50%` + `overflow: hidden` on the **container** |
| Person avatar | Same circular treatment | Circular |
| News thumbnail | — | `border-radius: var(--radius-sm)` (6px) — NOT circular |
| National flag | `https://cdn.ainvest.com/icon/national-flag/{CODE}.png` | Per spec |
| Broker logo | `https://cdn.ainvest.com/icon/brokers/{NAME}.png` | Per spec |
| Politician avatar (in-repo) | `ainvest-design-system/assets/avatars/politicians/{Firstname_Lastname}.png`. See `ainvest-design-system/references/rules/image-asset-usage.md` for the exact available filenames. A required person without a declared local file is an incomplete-delivery error. | Circular |

Every `<img>`: explicit `width` + `height`, `display: block`, and contract-appropriate `object-fit`; resolve the one exact local asset before rendering.

CDN `.svg` files for stocks/crypto/ETFs render as solid color blobs — that is why `.png` is mandatory.

---

## Brand & Logo

The Ainvest logo in global navigation:

- **Source**: `ainvest-design-system/assets/logos/ainvest-logo.svg`
- **Render**: inline `<svg>` (paste full SVG markup; do not use `<img src=...>`)
- **Size**: `height: 24px; width: auto`
- **Color**: do not override `fill` — the SVG already uses Brand Blue `#165DFF`
- **Never** recreate the logo with text, custom shapes, icon fonts, or the letter "A"

Inlining is required so the logo renders at any DPI without network requests.

---

## Global Constraints

**Always:**
- Semantic tokens for every visual property (color, type, spacing, radius, shadow, border)
- Full Rounded (pill) as default button shape
- Black Primary as default standard product action button
- Spacing (not borders) to express hierarchy and grouping
- Light/dark mode supported via token switching
- Dense interfaces remain clean and scannable

**Never:**
- Raw hex/rgb in output (always tokens)
- Invent new tokens (font sizes, weights, spacing, radius, shadow, colors)
- Square button as default, or any square button on Mobile
- Brand Blue button outside trading / paid-product / landing contexts
- Text Button or Landing Page Button on standard product pages
- Multiple equally-strong primary solid buttons in one section
- Mixing price/status/chart colors with UI action colors
- Shadow on cards (cards use border per `card.md`)
- Custom modal/tab/pagination/link styles when a component doc exists

**Design philosophy:** clarity over decoration; scan efficiency over novelty; structure over card stacking; professional trust over emotional hype.

---

## Validation

Before delivering output, emit a `<validation>` block that pastes the relevant checklist lines from each component you used (the per-component checklists live at the top of each `ainvest-design-system/references/components/<file>.md`) and marks each ✅ verified / ❌ violated / ⚠️ uncertain with evidence.

```
<validation>
=== Components used ===
[Component A] — checklist from ainvest-design-system/references/components/<file>.md
  - <line>  → ✅ <evidence>
  - <line>  → ❌ <reason>; will fix by <action>

=== Global checks ===
  - Color from color.json only, no raw hex     → ✅ / ❌ / ⚠️
  - Font-size whitelist                         → ✅ / ❌ / ⚠️
  - Radius whitelist                            → ✅ / ❌ / ⚠️
  - Spacing on 8px base                         → ✅ / ❌ / ⚠️
  - Image rules (source, shape, w/h, object-fit) → ✅ / ❌ / ⚠️
  - Card rules (no shadow, border instead)     → ✅ / ❌ / ⚠️
  - Cross-page consistency vs temp/html/       → ✅ / ❌ / ⚠️

=== Summary ===
  Total ❌:  <count>     ← must be 0 before delivery, or each must have a fix-or-defer note
  Total ⚠️:  <count>     ← each must include a verifiable next-step
</validation>
```

If any check fails: stop, re-read the relevant file, fix, re-validate. Do not deliver with unresolved ❌.

---

## Preview & Delivery

Generated pages in `temp/` are mock demos with hardcoded data. **Open the file directly in browser (`file://`)** — do not start an HTTP server.

Start a server only when one of these is true:
- The page makes `fetch()` / XHR calls
- The page uses `<script type="module">`
- The page registers a Service Worker
- A preview link must be shared with someone else

For pure static mocks, `python3 -m http.server` (or any dev server) is unnecessary overhead.

---

## Editing This System

When extending or editing files in this skill:
- Only write rules the model does not already know. Generic UI knowledge ("use Button for actions") must be omitted; every rule must be Ainvest-specific or counter-intuitive.
- Use MUST / MUST NOT / FAILURE structure inside rule files
- Never put raw values in rules — define a token, reference the token
- One rule lives in one place — no duplication across files
- New tokens go in the right token file; new components in `ainvest-design-system/references/components/`; new rules in `ainvest-design-system/references/rules/`
