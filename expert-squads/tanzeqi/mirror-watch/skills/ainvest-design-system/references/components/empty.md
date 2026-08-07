# Guidelines — Empty State (空状态)

## 0. Document Role

This document covers **when and how to use** the Empty State component. It focuses on decisions a developer or AI must make explicitly — visual details handled automatically by the component are omitted.

<!-- - Component import: `@ainvest/empty` -->
- Enums: `EmptyLevel`, `EmptyType`

---

## 1. Definition

An **Empty State** is displayed when there is no data or content to show. Its purpose is to inform the user why the state occurred and to help them continue using the product with confidence — for example, notifying them of a network error, an empty search result, or a missing page.

---

## 2. When to Use

Use an Empty State when:

- A page, section, or list has no data to display.
- A network error, loading failure, or system error has occurred.
- A user's search or filter returns no results.
- A page does not exist (404).

---

## 3. When NOT to Use

| Situation | Use Instead |
|---|---|
| Data is loading but not yet available | Skeleton screen (骨架屏) |
| A brief transient error that resolves automatically | Toast |
| A critical error requiring user decision | Dialog |

---

## 4. Component Types

The Empty State has two scopes. Choose based on what is empty:

### `EmptyLevel.Page` — 页面缺省图 (Page-level Empty State)

Used when the **entire page** has no content or has failed to load. Renders with a large icon, primary button style, and responsive layout.

### `EmptyLevel.Module` — 模块缺省图 (Module-level Empty State)

Used when a **single section, list, card, or widget** within a page has no content. Renders without an icon by default (`EmptyType.None`), uses a secondary button style, and is more compact.

> **Note:** The **404 page** (Page not found) is a separate design-only pattern using a full illustrated graphic. It is not part of the `@ainvest/empty` component — refer to the 404 page design token instead.

---

## 5. Anatomy

### Required
At minimum, either `title` or `description` must be present. An empty state with neither is not valid.

### Optional
| Prop | Notes |
|---|---|
| `iconType` | Defaults to `EmptyType.NoData`. Set to `EmptyType.None` to hide the icon (standard for `EmptyLevel.Module`). |
| `actionButtonText` + `onClickAction` | Add when a meaningful recovery action exists (e.g., "Refresh"). Omit by setting `showAction={false}`. |
| `customAction` | Replaces the default button with any custom React node. Takes priority over `actionButtonText` when both are set. |

### Critical Setup Requirement
The parent element **must** have `container-type: inline-size` set (or use the TailwindCSS `@container` class) — the component uses CSS container queries internally for responsive layout. Without this, responsive behavior will not work.

```tsx
// Required parent wrapper
<div className="@container">
  <Empty ... />
</div>
```

---

## 6. Variants — Content Configurations

Choose the configuration based on available context and recovery actions:

| Config | Props Used | When to Use |
|---|---|---|
| **完整内容** (Full) | `iconType` + `title` + `description` + `actionButtonText` | Default. Use whenever a recovery action exists (e.g., "Refresh") |
| **无按钮** (No Button) | `iconType` + `title` + `description` + `showAction={false}` | Use when no meaningful action can be offered |
| **无按钮 + 无正文** (Minimal) | `iconType` + `title` + `showAction={false}` | Use in constrained spaces where body text cannot fit |
| **无标题** (No Title — Module only) | `description` + `showAction={false}` | Use in compact module contexts; omit `title` prop entirely |

---

## 7. `iconType` — Icon Selection

Pass the appropriate `EmptyType` enum value via the `iconType` prop:

| `EmptyType` value | When to Use | Suggested Title |
|---|---|---|
| `EmptyType.NetworkError` | Network failure, connection error, request timeout | "Network error" |
| `EmptyType.NoData` | List or table has no data; nothing matches current context | "No data available" |
| `EmptyType.ServerError` | Server returned an error or is unavailable | "No data available" |
| `EmptyType.SearchEmpty` | Search or filter returned zero results | "Content is empty" |
| `EmptyType.None` | No icon needed (standard for `EmptyLevel.Module`) | Any |

> **Light vs Dark:** The component automatically applies the correct icon style based on the container theme. No manual icon variant switching is needed.

---

## 8. Content Guidelines

### `title`
- State what happened clearly: "Network error", "No data available", "Content is empty".
- Keep to one line where possible.

### `description`
- Guide the user on what to do: "Related content is empty. You are advised to perform the operation again."
- One to two sentences maximum.

### `actionButtonText`
- Use a clear recovery verb: "Refresh", "Return home", "Try again".
- Always pair with `onClickAction` to wire up the actual recovery handler.

### `customAction`
- Use when the recovery flow needs more than one button, or a non-standard control.
- When `customAction` is set, `actionButtonText` is ignored.

---

## 9. Platform & Responsive Behavior

Handled automatically by the component via CSS container queries. Requirements:

- Parent must have `@container` / `container-type: inline-size` (see §5).
- `EmptyLevel.Page` (页面缺省图): content centers within the page; max content width `570px`; font and button sizes scale down on mobile.
- `EmptyLevel.Module` (模块缺省图): compact layout, no icon by default, secondary button style.

---

## 10. Multi-language (RTL & Long Strings)

### Long Translated Strings
- Text wraps automatically when it exceeds the max content width (`570px`). No font changes needed.

### Arabic / RTL Languages
- All content must be **mirrored** — layout direction switches to R → L.
- Icon directions must be updated to match the RTL reading direction.

---

## 11. Do / Don't

| ✅ Do | ❌ Don't | Reason |
|---|---|---|
| Always include at least `title` or `description` | Render an icon with no text | Users need to understand why the state occurred |
| Use `EmptyType.None` for `EmptyLevel.Module` (模块缺省图) by default | Show a large icon inside a small module | Icons at module level overwhelm the surrounding content |
| Use `showAction={false}` when no recovery action exists | Leave `actionButtonText` empty or render a no-op button | A button that does nothing erodes trust |
| Use `customAction` when multiple recovery options are needed | Stack multiple `<Empty>` components for different actions | `customAction` is the correct extension point |
| Always wire `onClickAction` when using `actionButtonText` | Set `actionButtonText` without `onClickAction` | An unlabelled or unhandled button confuses users |
| Wrap the component in `@container` | Skip the container query parent setup | Without it, responsive layout breaks silently |
| Use `EmptyLevel.Page` (页面缺省图) for full-page states only | Use `EmptyLevel.Page` inside a card or small widget | Page-level sizing is visually overwhelming inside small containers |
| Mirror layout and icons for RTL languages | Reuse the LTR layout for Arabic | Unmirrored layouts break RTL reading comprehension |

---

## 12. Decision Table

| Scenario | `level` | `iconType` | Config | `showAction` | `actionButtonText` |
|---|---|---|---|---|---|
| Network request failed | `EmptyLevel.Page` | `EmptyType.NetworkError` | 完整内容 | `true` (default) | "Refresh" |
| Server error | `EmptyLevel.Page` | `EmptyType.ServerError` | 完整内容 | `true` (default) | "Refresh" |
| Search / filter returns no results | `EmptyLevel.Page` or `Module` | `EmptyType.SearchEmpty` | 完整内容 | `true` (default) | "Refresh" or omit |
| List / table has no data | `EmptyLevel.Module` | `EmptyType.None` | 完整内容 | `true` (default) | "Refresh" or omit |
| Section empty, no recovery action | `EmptyLevel.Module` | `EmptyType.None` | 无按钮 | `false` | — |
| Constrained space, title only | `EmptyLevel.Page` or `Module` | Appropriate type | 无按钮+无正文 | `false` | — |
| Compact module, description only | `EmptyLevel.Module` | `EmptyType.None` | 无标题 | `false` | — |
| Multiple recovery options needed | Either | Appropriate type | 完整内容 | `true` (default) | Use `customAction` instead |
| Data still loading | ❌ Use Skeleton | — | — | — | — |
| Transient auto-resolving error | ❌ Use Toast | — | — | — | — |

---

## 13. Related Documents

- `ainvest-design-system/references/components/dialog.md`
- `ainvest-design-system/references/components/drawer.md`
- `ainvest-design-system/references/components/toast.md`
- `ainvest-design-system/SKILL.md`
