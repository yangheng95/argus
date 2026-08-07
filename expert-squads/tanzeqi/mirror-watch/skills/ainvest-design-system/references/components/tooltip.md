# Guidelines — Tooltip (提示气泡)


## 0. Document Role

This file defines **when, where, and how** to use the Tooltip (提示气泡) component — it is the **usage guideline** (使用规范).

<!-- - Component import: `@ainvest/tooltip` -->
- Component Spec: `ainvest-design-system/references/components/tooltip.md`
- Related: `popover.`, `toast.md`, `notification.md`, `color.md`


### AI Resolution Rules

- When generating Tooltip UI, MUST read this file
- **Component style / structure / API / code** → follow `ainvest-design-system/references/components/tooltip.md`
- **Usage decision (when / where / how / which variant)** → follow
- If rules conflict: **component spec takes priority** for visual/structural details; **this guideline takes priority** for usage decisions and scenario logic
- MUST NOT invent styles or structures absent from `ainvest-design-system/references/components/tooltip.md`
- MUST NOT ignore usage constraints defined in this guideline

---

## 1. Definition

Tooltip (提示气泡) is a **non-modal, lightweight text overlay** that appears near a trigger element to provide brief supplementary information. It does NOT interrupt the user's primary workflow and typically auto-dismisses when the user moves away.

It is the **lightweight** variant of the bubble system — for richer guidance content with title, description, image, and buttons, use Popover instead.

---

## 2. When to Use

| Condition | Use Tooltip? |
|-----------|-------------|
| Explaining an icon, abbreviation, or UI element on hover | YES |
| Showing a brief definition or supplementary note for a label (e.g. "ROE: 净资产收益率 = 净利润 / 净资产") | YES |
| Displaying a short description for a setting or toggle (e.g. "自动同步可确保数据在多个设备间保持一致") | YES |
| Describing chart axis units or data terms (e.g. "单位为百万美元") | YES |
| New feature callout — proactive tip (single line, primary variant) | YES |
| Explaining a button's disabled reason | YES |
| Text/icon is self-explanatory and needs no additional info | NO |

### MUST

- MUST have a clear trigger target — Tooltip must be anchored to a specific element
- MUST limit proactively triggered tips to appear **only once** (per user / per session)
- MUST allow only **one** Tooltip visible at a time
- MUST NOT use Tooltip for critical actions that require user confirmation — use Dialog

### SHOULD

- SHOULD keep content to 1–2 lines maximum
- SHOULD use Tooltip as the default choice for brief explanations; escalate to Popover only when richer content is needed

---

## 3. When NOT to Use

| Condition | Use Tooltip? | Alternative |
|-----------|-------------|-------------|
| Content requires title + description, image, or action buttons | NO | Popover |
| User must confirm or make a decision | NO | Dialog / Modal |
| Content is long-form (paragraphs, lists) | NO | Popover / Drawer / dedicated page |
| Persistent status or system message | NO | Inline banner / Toast |
| Form validation error | NO | Inline field error |
| Action feedback (success/fail) | NO | Toast / Notification |
| Content is essential and must always be visible | NO | Inline text / label |
| Complex multi-step onboarding guidance | NO | Popover (multi-step) |

### MUST NOT

- MUST NOT use Tooltip to display critical information that the user must see — Tooltip is supplementary
- MUST NOT use Tooltip for actions or navigation — use Button / Link
- MUST NOT allow Tooltip to obscure the trigger element or core content
- MUST NOT show multiple Tooltips simultaneously

---

## 4. Anatomy

```
       ┌──────────────────────────┐
       │  Longest Text Longest    │
       │  Text Longest Text Text  │
       └────────────┬─────────────┘
                    ▼  (arrow)
              [ Trigger Element ]
```

| Part | Required | Description |
|------|----------|-------------|
| Bubble container | MUST | Rounded rectangle background (primary / neutral variant) |
| Text content | MUST | Brief text — 1 or 2 lines; centered for single line, left-aligned for multi-line |
| Close button (✕) | Optional | Shown when `closable: true`; allows manual dismiss |
| Arrow | Default shown | Triangular pointer indicating the trigger element; can be hidden via `showArrow: false` |

### Text Layout Rules

| Style | Description |
|-------|-------------|
| One-line text | Min width 120px, max width 200px; text **center-aligned** |
| Two-line text | Left-right padding 16px; text **left-aligned** |
| With close button | Left padding 16px, icon-to-text gap 12px, icon-to-right-edge gap 8px |

---

## 5. Variants Overview

### 5a. Visual Variants

| Variant | Background | Text Color | Use Case |
|---------|-----------|------------|----------|
| **Primary** (品牌色 / 蓝色) | Brand blue (`primary`) | White | New feature guidance, proactive tips, important callouts |
| **Neutral** (中性色 / 黑色) | Black / dark neutral | White | Passive hover explanations, icon/term definitions |

### 5b. Trigger Modes

| Trigger Mode | Description | Typical Scenario |
|-------------|-------------|------------------|
| **Hover** (default) | Tooltip appears on mouse hover, disappears on mouse leave | Icon/text explanations, data term definitions |
| **Click** | Tooltip appears on click, dismissed by close button or outside click | Proactively triggered tips, important guidance |
| **Focus** | Tooltip appears when trigger element receives keyboard focus | Accessibility, form field hints |

### 5c. Size Constraints

| Property | Value |
|----------|-------|
| Minimum width | 120px |
| Maximum width | 200px |
| Text padding (left/right) | 16px |
| Text alignment (1 line) | Center |
| Text alignment (2+ lines) | Left |

### 5d. Responsive — Page Width < 480

- Web and Mobile share the **same** Tooltip style — **no distinction** between web and mobile

---

## 6. Content Guidelines

### Tooltip Text

- MUST be concise — 1 line preferred, 2 lines maximum
- MUST provide genuinely useful supplementary information, not repeat the label text
- MUST NOT use long paragraphs or complete sentences when a phrase suffices

### Icon Type Guidelines — Info vs Help

When using icons to trigger Tooltip, designers MUST distinguish between two icon types:

| Icon | Name | Meaning | Use Case | Trigger | Example Content |
|------|------|---------|----------|---------|-----------------|
| ① | **Info icon** | "Information" — neutral, supplementary | Show detailed definition or usage note for a term | Hover → Tooltip | "ROE: 净资产收益率 = 净利润 / 净资产" |
| ② | **Help icon** | "Help / Support" — user may be confused | Point user to help resources, FAQ, or guidance | Click → link to help | "点击获取此功能的操作指南" |

#### Info Icon Use Cases

| Scenario | Tooltip Content |
|----------|-----------------|
| Financial report page — metric row | "ROE: 净资产收益率 = 净利润 / 净资产" |
| Settings page — "Auto Sync" toggle row | "自动同步可确保数据在多个设备间保持一致" |
| Chart axis label | "单位为百万美元" |

#### Help Icon Use Cases

| Scenario | Tooltip Content |
|----------|-----------------|
| Complex feature button row | "点击获取此功能的操作指南" |
| Form field (top of page) | "不确定怎么填写？点此查看示例" |
| New user interface | "快速了解如何开始使用此功能" |

#### Icons in Data-Dense Modules

- When icons appear **multiple times in the same module** (e.g. a data table with many metric labels), use a **lighter, surface-style icon** (面性图标) with subtle color so they do not dominate visually
- Default state: light/subtle icon color
- Hover state: icon color deepens to indicate interactivity
- Both light theme and dark theme versions should be supported

---

## 7. Layout & Composition

### Arrow & Positioning

- Arrow indicates the trigger element's position — priority: **center-aligned with the trigger**
- Arrow position is NOT fixed — it adapts based on the bubble's position relative to the trigger
- Arrow MUST maintain a minimum **6px** safe distance from the bubble's corner edge
- Tooltip placement supports: `top` (default), `bottom`, `left`, `right`

### Tooltip in Page Context

- Tooltip appears overlaying the page content, does NOT push content
- Position auto-adjusts to stay within the viewport — if no space above, falls to below, etc.

### Multi-language Support

- Tooltip supports RTL (right-to-left) layout for Arabic and similar languages
- Content and icon positions mirror accordingly

---

## 8. Behavior

### Hover-Triggered (default)

- Appears after a short delay (default `200ms`) when user hovers over the trigger
- Disappears after a short delay (default `200ms`) when user moves the mouse away
- MUST NOT appear instantly — the delay prevents flickering during casual mouse movement

### Click-Triggered

- Appears on click; remains visible until dismissed
- Dismissed by: clicking the close button (✕), clicking outside the bubble, or auto-close timer

### Auto-Close

- When `autoCloseDelayDuration` is set, the Tooltip auto-dismisses after the specified time
- Default: `0` (no auto-close — manual dismiss or mouse leave only)
- When used for proactive guidance: auto-close after **5 seconds** if user does not interact

### Dismiss Methods

1. Click the Tooltip itself (close button)
2. Perform the action the tip is guiding toward
3. Navigate away from the current page or close the App
4. User performs other interactions (click, scroll, etc.) — tips auto-dismiss; on mobile, determined by finger lift
5. User does not interact for **5 seconds** — tips auto-dismiss

### Proactive Tips Rules

- Proactively triggered tips (e.g. new feature callout) MUST appear **only once** per user
- Only **one** tip can be visible at any time — new tip replaces previous
- Can be triggered proactively by the system, or manually by user click/hover on `?` / `!` / `""` icons

### Black Tooltip (Neutral) — Passive Scenarios

- For text and icon explanations, use neutral (black) Tooltip with hover trigger
- Standard icons paired with hover-triggered Tooltip is the default pattern — no special configuration needed

### Keyboard Behavior

- Trigger element MUST be focusable via Tab
- Focus trigger → Tooltip appears (if `trigger: 'focus'`)
- Escape key SHOULD dismiss the Tooltip

---

## 9. Platform Differences

| Aspect | Web (>= 480px) | Mobile (< 480px) |
|--------|----------------|-------------------|
| Default trigger | Hover | Click (no hover on touch devices) |
| Style | Same | Same — **no distinction** between web and mobile |
| Arrow | Shown by default | Shown by default |
| Dismiss | Mouse leave / close button | Tap outside / close button / auto-dismiss after 5s |
| Proactive tips | Same behavior | Same behavior |

---

## 10. Do / Don't

| | Practice | Reason |
|---|---------|--------|
| DO | Use Tooltip for brief, supplementary hover explanations | Non-intrusive, contextual |
| DO | Keep text to 1–2 lines max | Readability; Tooltip is for quick glances |
| DO | Limit proactive tips to appear once per user | Avoids annoyance |
| DO | Allow only one Tooltip visible at a time | Prevents visual clutter |
| DO | Use Info icon (①) for static definitions; Help icon (②) for interactive help | Clear semantic distinction |
| DO | Use subtle/surface-style icons when icons repeat in a data table | Prevents visual noise |
| DO | Use Primary (blue) variant for proactive new-feature tips | Visually distinct from passive explanations |
| DO | Use Neutral (black) variant for hover-triggered term definitions | Standard, non-intrusive |
| DON'T | Use Tooltip for critical information the user must see | Tooltip is optional and easy to miss |
| DON'T | Use Tooltip to trigger actions or navigation | Use Button / Link |
| DON'T | Allow Tooltip to cover the trigger element or core UI | Frustrates interaction |
| DON'T | Show multiple Tooltips at the same time | Only one at a time |
| DON'T | Use Tooltip when content needs title + description + buttons | Use Popover instead |
| DON'T | Use excessively long text (> 2 lines) | Defeats the lightweight purpose |
| DON'T | Trigger proactive tips on every visit | Once per user is enough |

---

## 11. Decision Table

### Tooltip Variant Selection

| Background | Trigger | Use Case |
|-----------|---------|----------|
| **Primary** (blue) | Click / System proactive | New feature callout, important tip, proactive guidance |
| **Neutral** (black) | Hover | Static explanation, term definition, icon label |

### Tooltip vs Popover vs Dialog

| Need | Component |
|------|-----------|
| 1–2 lines of text, no buttons needed | **Tooltip** |
| Rich content with title, description, image, or buttons | **Popover** |
| Multi-step guided walkthrough | **Popover** (multi-step) |
| User must confirm or decide before proceeding | **Dialog** |
| Brief operation feedback (success/error) | **Toast / Notification** |

### Icon Selection for Tooltip Triggers

| Icon | When to Use | Tooltip Content Type |
|------|------------|---------------------|
| **Info ①** | Term definition, metric explanation, setting description | Static, passive explanation |
| **Help ②** | Feature may confuse user, links to FAQ/help | Interactive, links to resources |
| **Light surface icon** | Icon appears many times in same module (e.g. data table) | Same as Info, but visually subdued |

---

## 12. Related Documents

- `ainvest-design-system/references/components/tooltip.md`
- `ainvest-design-system/references/components/popover.md`
- `ainvest-design-system/references/components/toast.md`
- `ainvest-design-system/references/components/notification.md`
- `ainvest-design-system/SKILL.md`
- `ainvest-design-system/references/tokens/color.md`
- `ainvest-design-system/references/tokens/spacing.md`
