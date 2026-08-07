# Guidelines — Drawer / Bottom Sheet (底部弹窗)

## 0. Document Role

This document covers **when and how to use** the Drawer (Bottom Sheet) component. It focuses on decisions a developer or AI must make explicitly — visual details handled automatically by the component are omitted.

<!-- - Component import: `@ainvest/drawer` (底部弹窗),'@ainvest/marketing-drawer' -->

---

## 1. Definition

A **Bottom Sheet** is a temporary container that slides up from the bottom of the screen. It displays supplementary content, selectable options, or task steps related to the current page — keeping the user in context while providing a lightweight interaction layer. It is primarily used on mobile and in responsive web layouts.

---

## 2. When to Use

Use a Bottom Sheet when:

- The content supplements the current page without requiring full navigation away.
- The user needs to select from a list of options, complete a focused sub-task, or view contextual detail.
- The interaction is temporary — the sheet dismisses and returns the user to where they were.
- The viewport is **≤ 500px** (web) or the platform is **App (mobile)**.

---

## 3. When NOT to Use

| Situation | Use Instead |
|---|---|
| Viewport width > 500px on web | Dropdown Menu (下拉菜单) for simple option lists; Dialog for confirmations |
| A brief confirmation or destructive action | Dialog |
| Simple status feedback requiring no action | Toast |
| Content requires full page context or persistent navigation | Navigate to a new page |

> On web at viewport > 500px, list-type bottom sheets switch to **Dropdown Menu** style. Marketing-type bottom sheets switch to **Dialog** style. See §9.

---

## 4. Component Types

The Bottom Sheet has two major types based on content:

### Type 1 — List Bottom Sheet (列表类底部弹窗)

Contains a header and a list of selectable options. Each list item can have an icon (left), a title, a description (one line recommended), and an optional right-side action (checkmark, toggle, etc.).

Sub-types by header configuration:

| Header Style | Left | Center | Right | When to Use |
|---|---|---|---|---|
| **Back + Title + Close** | `‹` back icon | Title (+ optional subtitle) | `×` close icon | Multi-level navigation within the sheet |
| **Title + Close** | — | Title (+ optional subtitle) | `×` close icon | Single-level sheet with no back navigation |
| **Cancel + Title + Button** | "Cancel" text | Title (+ optional subtitle) | Text action button | Sheet that confirms a selection (e.g., filter, sort) |
| **Drag handle only** | — | Drag handle indicator | — | Simple sheets where title is not needed |

> **Header icon note:** When the component auto-adapts its layout, the icon in the header may need to be removed. In that case, remove it directly in Appearance rather than replacing it — icon support is defined by the designer.

### Type 2 — Marketing Bottom Sheet (运营类底部弹窗)

Contains a marketing image, title, body text, and a bottom action area. Used for campaign promotions, broker/partner spotlights, feature announcements.

- Composed of: image → main title → body text → bottom action area.
- Title recommended to display on **2 lines**.
- Title: max 2 lines, ≤ 45 characters. Body: max 3 lines, ≤ 50 characters (consistent with Marketing Dialog limits).

---

## 5. Anatomy

### Required
- **Header** — always required; choose the appropriate header style from §4.
- **Content area** — list items (列表类) or image + text (运营类).

### Optional
- **Footer button** — add when a primary action is needed (e.g., "Confirm", "Learn More"). Sticky at the bottom.
- **Subtitle** in header — optional secondary label below the title.
- **Drag handle** — shown when the sheet height is user-adjustable or the header style is handle-only.

### Footer Button Size (MANDATORY)

**Footer buttons in a Bottom Sheet MUST use `lg` size (44px height / 16px Semibold / 20px gap / 1.5px stroke) on BOTH Web and App.**

- MUST NOT use `base` (36px), `sm` (28px), or `xs` (24px) for bottom-sheet footer buttons
- Applies to both Type 1 (列表类) and Type 2 (运营类) bottom sheets
- Rationale: bottom sheets are predominantly used on touch devices — 44px is the minimum comfortable touch target

### List Item Anatomy
- **Left icon** — optional, informational (e.g., info `ⓘ`). Do not use for purely decorative purposes.
- **Title** — required. One line; truncate if overflowing.
- **Description** — optional. Recommended max 1 line; truncate if overflowing. Font `16px`.
- **Right action** — optional: checkmark (selected state), toggle, or chevron (drill-down).

---

## 6. Content Guidelines

### Header Title
- Keep to a short noun phrase or clear imperative.
- Max 2 lines; truncate with ellipsis if overflowing — do not wrap to a third line.
- In extreme cases (long translated strings), title font scales down to `16px` and subtitle still shows max 2 lines.

### Subtitle
- Max 2 lines; truncate — do not show a third line.

### List Item Description
- Recommended: 1 line only.
- Font `16px`. Do not use sub-headings or nested lists inside the sheet content area.

### Footer Button Label
- Use clear action verbs: "Confirm", "Learn More", "View All".
- Match the button label to the sheet's primary intent.

### Marketing Content Limits
- Title: max 2 lines, ≤ 45 characters.
- Body text: max 3 lines, ≤ 50 characters.

---

## 7. Header Configuration

The header is the primary navigation control of the sheet. Choose based on the interaction model:

| Scenario | Header Style |
|---|---|
| Sheet has drill-down sub-levels | Back `‹` + Title + Close `×` |
| Single-level sheet, user just closes | Title + Close `×` |
| Sheet is a selection/filter that needs confirmation | Cancel + Title + Action Button |
| Sheet is very simple with no title needed | Drag handle only |

**Right-side icon in header (右侧icon):** supports reducing or switching content. When not needed, delete directly in Appearance — do not leave an empty placeholder.

---

## 8. Height Rules

Height rules apply to both **Marketing** and **List** type bottom sheets. Height is designer-controlled within a min-to-standard range, and can expand up to a maximum.

| Height | Value | Notes |
|---|---|---|
| **Minimum** | `240px` (≈ screen 30%) | Smallest usable height |
| **Standard** | `480px` (≈ screen 60%) | Default for most use cases |
| **Maximum** | ≈ screen 90% | Content beyond max height is clipped; button stays fixed at bottom |

- Height adapts based on content between minimum and standard range.
- When content exceeds the standard height, the sheet expands up to the maximum (≈ 90% of screen height).
- Content that exceeds the maximum height is **clipped** — the footer button always stays fixed at the bottom.
- There is **no minimum height** defined for Marketing Bottom Sheets — height is always content-driven.

---

## 9. Platform & Responsive Behavior

### App (Mobile)
- Bottom Sheet is always used as-is on mobile.
- No responsive switching — the component renders as a bottom sheet regardless of content type.

### Web — Component Selection (not auto-degradation)

The Bottom Sheet is a **distinct component** chosen explicitly by the developer. A Dialog does **NOT** auto-degrade into a Bottom Sheet on narrow viewports — Web Dialog stays a centered card at every viewport (see `dialog.md §5.1`).

Use this table to decide **which component to reach for** based on viewport width and content type:

| Content Type | Viewport > 500px | Viewport ≤ 500px |
|---|---|---|
| **List type** (option selection, filters) | Use **Dropdown Menu** (下拉菜单) | Use **Bottom Sheet** (`@ainvest/drawer`); width adapts |
| **Marketing type** (promotions, campaigns) | Use **Dialog** (marketing style) | Use **Bottom Sheet** (`@ainvest/marketing-drawer`); images scale proportionally |
| **Confirmation / destructive action** | Use **Dialog** | Use **Dialog** (stays centered, width adapts per `dialog.md §5.1`) |

> **Rule:** the developer picks `@ainvest/dialog` or `@ainvest/drawer` at the API level. Neither component morphs into the other based on viewport.

#### Web ≤ 500px — Additional Behavior (when Bottom Sheet is the chosen component)
- Left/right text margin: `16px`.
- Images scale proportionally.
- Title font scales down from `24px` → `20px`.
- Body text font scales down from `16px` → `14px`.
- Content width adapts to viewport.

---

## 10. Multi-language (RTL & Long Strings)

### Long Translated Strings
- When the title exceeds available space (e.g., in German or other long-string languages), title font size reduces to `16px`.
- Title still shows max 2 lines; subtitle shows max 2 lines. Neither truncates to a third line.
- Marketing-type sheets do not require font size changes — display without switching, truncate if needed.

### Arabic / RTL Languages
- All content must be **mirrored** (镜像处理).
- Icon directions must be updated according to the language's reading direction (R → L).
- Marketing-type sheets: no font changes required; display direction is mirrored only.

---

## 11. Do / Don't

| ✅ Do | ❌ Don't | Reason |
|---|---|---|
| Use Bottom Sheet for mobile option lists and sub-tasks | Use Bottom Sheet for brief confirmations or destructive actions | Confirmations belong in a Dialog |
| Switch to Dropdown Menu on web viewport > 500px for list-type content | Force a Bottom Sheet on wide web viewports | Wide viewports have space for inline or popover patterns |
| Switch to Dialog style on web viewport > 500px for marketing content | Keep a bottom sheet style on wide web viewports for marketing | Dialog style is better suited to the spatial context of wide screens |
| Keep header title to 2 lines max; truncate beyond that | Let the title wrap to 3+ lines | Overflow title pushes content out of the sheet unexpectedly |
| Fix the footer button at the bottom always | Let the button scroll with content | Users lose access to the primary action when it scrolls out of view |
| Use "Cancel + Title + Button" header when the sheet is a filter/selection | Use a close-only header for confirmation sheets | Users need a clear discard path separate from the confirm action |
| Mirror all icons and layout for RTL languages | Use the same LTR layout for Arabic | RTL languages read right-to-left; misaligned icons break comprehension |
| Limit list item descriptions to 1 line | Write multi-line descriptions in list items | Long descriptions overwhelm the list and slow scanning |

---

## 12. Decision Table

| Scenario | Platform | Viewport | Component to Use | Header Style | Footer Button |
|---|---|---|---|---|---|
| Select from option list (e.g., sort, filter) | App | — | Bottom Sheet (列表类) | Cancel + Title + Button | Optional confirm |
| Multi-level option drill-down | App | — | Bottom Sheet (列表类) | Back + Title + Close | Optional |
| Single-level list, dismiss only | App | — | Bottom Sheet (列表类) | Title + Close | Optional |
| Campaign / broker / feature promotion | App | — | Bottom Sheet (运营类) | Close `×` top-right | Required ("Learn More" / CTA) |
| Select from option list | Web | > 500px | Dropdown Menu | — | — |
| Campaign / promotion | Web | > 500px | Dialog (marketing style) | — | Required |
| Select from option list | Web | ≤ 500px | Bottom Sheet (列表类) | Title + Close | Optional |
| Campaign / promotion | Web | ≤ 500px | Bottom Sheet (运营类) | Close `×` | Required |
| Brief confirmation / destructive action | Any | Any | ❌ Use Dialog | — | — |
| Simple status feedback | Any | Any | ❌ Use Toast | — | — |

---

## 13. Related Documents

- `ainvest-design-system/references/components/dialog.md`
- `ainvest-design-system/references/components/toast.md`
- `ainvest-design-system/SKILL.md`
