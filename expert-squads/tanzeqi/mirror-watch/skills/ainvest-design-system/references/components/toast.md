# Guidelines — Toast (Snackbar)


## 0. Document Role

This file defines **when, where, and how** to use the Toast (Snackbar) component — it is the **usage guideline** (使用规范).

<!-- - Component import: `@ainvest/toast` -->
- Component Spec: `ainvest-design-system/references/components/toast.md`
- Related: `notification.md`, `dialog.md`, `color.md`


### AI Resolution Rules

- When generating Toast (Snackbar) UI, MUST read this file
- **Component style / structure / API / code** → follow `ainvest-design-system/references/components/toast.md`
- **Usage decision (when / where / how / position / duration)** → follow this file
- If rules conflict: **component spec takes priority** for visual/structural details; **this guideline takes priority** for usage decisions and scenario logic
- MUST NOT invent styles or structures that are absent from `ainvest-design-system/references/components/toast.md`
- MUST NOT ignore usage constraints defined in this guideline

---

## 1. Definition

Toast (Snackbar) is a **non-modal, auto-dismissing feedback component** that briefly displays operation results (success, error, warning, info, loading) at the page edge and disappears automatically. It does NOT interrupt the user's current workflow.

It is the **lightweight** variant of the Toast family — for richer notifications with title + description + buttons, use Notification instead.

---

## 2. When to Use

| Condition | Use Toast? |
|-----------|------------|
| User completes an action and needs brief confirmation (e.g. "Added to Notification") | YES |
| User needs to be informed of a warning or error after an operation | YES |
| Async operation in progress, need to show loading state | YES |
| Page has new content and user can choose to refresh | YES (Refresh variant) |
| Simple, single-line feedback that auto-dismisses | YES |

### MUST

- MUST use Toast (not Dialog/Modal) when the feedback is informational and does NOT require user decision to proceed
- MUST use Toast (not Notification) for simple, single-line operation feedback
- MUST choose appropriate status type icon to match the feedback semantics

### SHOULD

- SHOULD keep content to a single line when possible
- SHOULD use Toast as the default feedback mechanism; escalate to Notification only when richer content is needed

---

## 3. When NOT to Use

| Condition | Use Toast? | Alternative |
|-----------|------------|-------------|
| User must make a decision before proceeding (e.g. confirm delete) | NO | Dialog / Modal |
| Message needs title + description, image, or action buttons | NO | Notification |
| Critical system error that requires user action | NO | Dialog / Error Page |
| Permanent, persistent status information | NO | Inline status banner |
| Form field validation error messages | NO | Inline field error |
| Complex multi-step feedback | NO | Full-page / inline UI |

### MUST NOT

- MUST NOT use Toast for operations that require user confirmation — use Dialog
- MUST NOT use Toast to display form field validation errors — use inline error messages
- MUST NOT use Toast as the sole feedback channel for critical failures that prevent further operation
- MUST NOT use Toast when the message requires title + description or action buttons — use Notification

---

## 4. Anatomy

### Standard Snackbar

```
┌─────────────────────────────────────────────────┐
│  [Icon]   Added to Notification          Action │
└─────────────────────────────────────────────────┘
```

| Part | Required | Description |
|------|----------|-------------|
| Status icon (left) | Conditional | Status type icon: ✅ success, ❌ error, ⚠️ warning, ℹ️ info, ⏳ loading; omitted for pure-text variant |
| Content text | MUST | Single-line or multi-line text describing the feedback |
| Action link (right) | Optional | Text button for follow-up action (e.g. "Action", "Undo"); placed at the right end |
| Custom right icon | Optional | Custom icon (e.g. chevron `>`) replacing the action text position |

### Layout Variants

| Variant | Left Slot | Content | Right Slot |
|---------|-----------|---------|------------|
| Icon + Link | Status icon | Text | Action link |
| Icon only | Status icon | Text | — |
| Link only | — | Text | Action link |
| Custom icon | — | Text | Custom icon (e.g. `>`) |

### Refresh Snackbar (Sub-Variant)

A specialized Snackbar that appears when the page has new content available, prompting the user to refresh:

| State | Description |
|-------|-------------|
| Default | Shows refresh label (e.g. "Added") |
| Maximum value | Shows full text (e.g. "Added to Notification...") |
| Loading | Shows loading icon indicating content is being refreshed |

### Size Constraints

- Default width: auto-fit content
- Minimum width: component fits text and icon without excessive padding
- Maximum width: limited by `maxWidth` prop (default 320px); text exceeding max width is truncated with ellipsis
- Maximum lines: controlled by `maxLine` prop (default 1); text exceeding max lines is truncated

### Icon + Text Layout

**常规文本 + 图标 (With Icon)**

| Status Type | Example Text | Icon | Suggested Color | Purpose |
|-------------|-------------|------|-----------------|---------|
| Success (成功) | 保存成功 | ✅ or ✓ | Green | Operation completed successfully |
| Warning (警告) | 网络不稳定 | ⚠️ or ⚠ | Orange / Yellow | Risk exists but not a failure |
| Error (错误) | 保存失败 | ❌ or ✕ | Red | Operation failed or error occurred |
| Info (信息) | 更新完成 | ℹ️ | Blue | General informational feedback, not a status |
| Loading (加载中) | 正在提交 | Spinner | Grey | Async operation in progress; optionally not recommended for Toast usage |

**纯文字 (Pure Text)**

| Status Type | Example Text | Icon | Suggested Color | Purpose |
|-------------|-------------|------|-----------------|---------|
| Pure text (一段文字) | Added to Notification | — | Grey | Simple status prompt |

### Icon Customization

The left icon can be replaced with any custom icon (e.g. ✅, ⚠️, ❌, ℹ️, ⏳ etc.) — the icon is not strictly bound to a specific status type.

---

## 5. Variants Overview

### 5a. Status Types

6 status types are available: **success**, **error**, **warning**, **info**, **loading**, **none** (pure text).

Each type has a corresponding icon and suggested color (see §4 Icon + Text Layout).

### 5b. Layout Variants by Right Slot

| Right Slot | Description |
|------------|-------------|
| Action link | Text button (e.g. "Action") — most common |
| No right slot | Icon + text only |
| Custom icon | Custom icon in right position (e.g. chevron `>`) |

### 5c. Row Count

| Row | Description |
|-----|-------------|
| One-line | Default — single-line text |
| Multi-line | Text wraps to multiple lines when content is long |

### 5d. Refresh Snackbar

| State | Visual |
|-------|--------|
| Default | Short label |
| Maximum value | Full-length text |
| Loading | Loading icon + text |

### 5e. Responsive — Page Width < 480

- Web and Mobile share the **same** Snackbar style — **no distinction** between web and mobile

---

## 6. Content Guidelines

### Content Text

- MUST be concise — aim for single line; multi-line only when necessary
- MUST use neutral, objective language describing the result (e.g. "Added to Notification", "Save failed")
- MUST NOT use long paragraphs or multi-sentence descriptions
- Maximum width: 320px by default; text exceeding this is truncated with ellipsis
- Maximum lines: 1 by default; configurable via `maxLine`

### Action Text (Right Slot)

- MUST be a short verb or verb phrase (e.g. "Action", "Undo", "View")
- MUST NOT be longer than 2–3 words

### Icon Usage

- Icon type SHOULD match the semantic status of the message (success = green check, error = red cross, etc.)
- Custom icons are allowed; the icon is not strictly bound to color or status type

---

## 7. Layout & Composition

### Position

| Platform | Default Position | Alignment |
|----------|-----------------|-----------|
| Web | **Top center** of the page (页面上方水平居中) | Horizontal center |
| Mobile | **Bottom center** of the page (页面底部水平居中) | Horizontal center |

- Toast appears overlaying the content, does NOT push page content down
- When Toast position is at the top: enters from above (top → down)
- When Toast position is at the bottom: enters from below (bottom → up)

### Spacing

- Toast distance from page edge: default **24px**, customizable
- Toast does NOT stack — only one Snackbar is visible at a time

### Multi-language Support

- Toast supports RTL (right-to-left) layout for Arabic and similar languages
- Content and icon positions mirror accordingly

---

## 8. Behavior

### Animation — Enter (Toast at top position)

- Initial state: fully transparent (`opacity: 0`), offset 24px upward (`translateY: -24px`)
- Animation: Slide Down + Fade In, duration **250ms**
- Easing: `ease-out` (starts fast, decelerates — smooth appearance)

### Animation — Exit (Toast at top position)

- Target state: offset 24px upward, fully transparent (`opacity: 0`)
- Animation: Slide Up + Fade Out, duration **200ms**
- Easing: `ease-in` (starts slow, accelerates — natural disappearance)

### Auto-Dismiss

- Default duration: **3000ms** (3 seconds), configurable via `duration` prop
- `duration: 0` means the Toast persists until manually dismissed
- Snackbar does NOT support manual close (✕ button) — it auto-dismisses only

### Stacking

- Snackbar does **NOT** support stacking — only one Snackbar is visible at a time
- A new Snackbar replaces the previous one

### Refresh Snackbar Behavior

- Appears when the page has new content available
- User clicks to trigger a refresh; loading icon appears during the refresh process
- Dismisses automatically after refresh completes or after timeout

### Keyboard Behavior

- If Snackbar contains an action link, the action MUST be keyboard accessible (Tab + Enter)

---

## 9. Platform Differences

| Aspect | Web (>= 480px) | Mobile (< 480px) |
|--------|----------------|-------------------|
| Default position | Top center | Bottom center |
| Style | Same | Same — **no distinction** between web and mobile |
| Animation direction (top position) | Top → Down (enter), Up (exit) | Bottom → Up (enter), Down (exit) |
| Stacking | Not supported | Not supported |
| Auto-dismiss duration | 3000ms default | 3000ms default |

---

## 10. Do / Don't

| | Practice | Reason |
|---|---------|--------|
| DO | Use Toast for brief, single-line operation feedback | Lightweight, non-intrusive |
| DO | Keep text to one line when possible | Easier to read at a glance |
| DO | Use appropriate status icons (✅ for success, ❌ for error, etc.) | Instant visual recognition |
| DO | Show loading icon in Refresh Snackbar while loading | Communicates progress to user |
| DO | Use confirmation Dialog for dangerous/irreversible operations | Toast cannot capture user decision |
| DON'T | Use Toast for operations requiring user confirmation | Use Dialog / Modal instead |
| DON'T | Use Toast for form field validation errors | Use inline error messages |
| DON'T | Use Toast when message needs title + description or buttons | Use Notification instead |
| DON'T | Use excessively long text in Toast | Defeats the purpose of lightweight feedback |
| DON'T | Attempt to show multiple Toasts simultaneously | Only one Toast visible at a time |

---

## 11. Decision Table

### Status Type Selection

| Scenario | Status Type | Icon | Color |
|----------|------------|------|-------|
| Operation succeeded | success | ✅ or ✓ | Green |
| Operation has risk / uncertain outcome | warning | ⚠️ | Orange / Yellow |
| Operation failed | error | ❌ | Red |
| General info / update complete | info | ℹ️ | Blue |
| Async operation in progress | loading | Spinner | Grey |
| Simple text prompt | none (pure text) | — | Grey |

### Toast vs Notification Decision

| Scenario | Component | Reason |
|----------|-----------|--------|
| Simple success/fail/warning feedback | Toast (this component) | Single-line, auto-dismiss |
| New page content, user can refresh | Toast (Refresh variant) | Lightweight refresh prompt |
| Rich message with title + description | Notification | Needs structured layout |
| Message with action buttons | Notification | Buttons require Notification |
| Message with preview image | Notification | Image requires Notification |
| Critical error requiring user action | Dialog | Must block workflow |

---

## 12. Related Documents

- `ainvest-design-system/references/components/toast.md`
- `ainvest-design-system/references/components/notification.md`
- `ainvest-design-system/references/components/button.md`
- `ainvest-design-system/SKILL.md`
- `ainvest-design-system/references/tokens/color.md`
- `ainvest-design-system/references/tokens/spacing.md`
