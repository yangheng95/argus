# Guidelines — Notification (通知提醒框)


## 0. Document Role

This file defines **when, where, and how** to use the Notification component — it is the **usage guideline** (使用规范).

<!-- - Component import: `@ainvest/notification` -->
- Component Spec: `ainvest-design-system/references/components/notification.md`

### How AI Should Use These Two Documents

| Document | Role | Contains |
|----------|------|----------|
| `ainvest-design-system/references/components/notification.md` | **Component Style Spec** (组件样式) | Component definition, features, API props, methods, code examples |
| `ainvest-design-system/references/rules/Notification.md` *(this file)* | **Usage Guideline** (使用规范) | When to use, when NOT to use, anatomy, behavior, layout, stacking rules, platform differences, Do/Don't |

### AI Resolution Rules

- When generating Notification UI, MUST read **both** documents
- **Component style / structure / API / code** → follow `components/notification.md`
- **Usage decision (when / where / how / position / stacking / duration)** → follow this file
- If rules conflict: **component spec takes priority** for visual/structural details; **this guideline takes priority** for usage decisions and scenario logic
- MUST NOT invent styles or structures that are absent from `components/notification.md`
- MUST NOT ignore usage constraints defined in this guideline

---

## 1. Definition

Notification is a **non-modal, auto-dismissing notification card** that appears at the page corner (typically top-right on Web, top-center on Mobile) to inform the user of system events, push messages, or important updates. It supports rich content including title, description, image, action buttons, and close icon.

It is the **rich** variant of the Toast family — for simple single-line operation feedback, use Toast (Snackbar) instead.

---

## 2. When to Use

| Condition | Use Notification? |
|-----------|-------------------|
| System needs to push a rich notification with title + description (e.g. "Aime New inspiration available") | YES |
| Notification needs action buttons (e.g. "View", "Dismiss") | YES |
| Notification includes a preview image | YES |
| Multiple simultaneous notifications need to stack | YES |
| Message requires more than a single-line display | YES |
| Providing contextual information with title + body | YES |

### MUST

- MUST use Notification (not Toast) when the message has a title + body structure
- MUST use Notification when the message includes action buttons or image
- MUST include a close button (✕) on every Notification

### SHOULD

- SHOULD keep description to 2 lines maximum
- SHOULD use Notification sparingly — do not overwhelm the user with frequent notifications

---

## 3. When NOT to Use

| Condition | Use Notification? | Alternative |
|-----------|-------------------|-------------|
| Simple single-line operation feedback (e.g. "Save succeeded") | NO | Toast (Snackbar) |
| User must make a decision before proceeding (e.g. confirm delete) | NO | Dialog / Modal |
| Critical system error that requires user action to continue | NO | Dialog / Error Page |
| Permanent, persistent status information | NO | Inline status banner |
| Form field validation error messages | NO | Inline field error |

### MUST NOT

- MUST NOT use Notification for simple feedback that Toast (Snackbar) can handle — Notification is for richer content
- MUST NOT use Notification for operations that require user confirmation — use Dialog
- MUST NOT use Notification to display form field validation errors — use inline error messages
- MUST NOT omit the close button (✕) — user must always be able to dismiss manually

---

## 4. Anatomy

### Standard Notification

```
┌───────────────────────────────────────────┐
│  [Icon]  Notification title           ✕   │
│          Content, not recommended to      │
│          exceed 2 lines                   │
│                                           │
│                          [Button] [Button] │
└───────────────────────────────────────────┘
```

| Part | Required | Description |
|------|----------|-------------|
| Status icon (left) | Optional | Colored dot/icon indicating notification type (info, success, error, warning, custom) |
| Title | MUST | Notification heading — concise, descriptive |
| Close button (✕) | MUST | Allows user to manually dismiss |
| Description | Optional | Body text — NOT recommended to exceed 2 lines |
| Action buttons | Optional | Up to 2 buttons (primary + secondary) at the bottom |
| Image | Optional | Preview image above the text content area |

### Left Side Icon

- 6 icon types: success (✅), error (❌), warning (⚠️), info (ℹ️), loading (⏳), custom
- Icon size: **48px**
- Custom icon can be any React node

### Right Side Action Items

- Action items in the right slot can include: navigation chevron (`>`), action text link, icon buttons
- Multiple icons can be combined in the right slot

### Buttons

- Up to 2 buttons: primary (filled) + secondary (outlined/text)
- Buttons appear at the bottom of the notification card

---

## 5. Variants Overview

### 5a. Content Variants

| Variant | Components | Use Case |
|---------|-----------|----------|
| No icon | Title + Close | Minimal notification, no status context needed |
| With icon | Icon + Title + Close | Standard notification with status indicator |
| With buttons | Icon + Title + Description + Close + Buttons | Actionable notification requiring user response |
| Custom icon | Custom status icon + Title + Close | Branded or specialized notification |
| Custom width | Same as above, configurable width | Layout-specific needs |
| Custom background | Full custom background with image/color | Promotional or branded notification |
| Image + title + description | Image + Icon + Title + Description | Rich content notification (e.g. article preview) |
| Image + title + description + buttons | Image + Icon + Title + Description + Buttons | Rich actionable notification |
| Image + title | Image + Icon + Title | Compact image notification |

### 5b. Size Variants

| Size | Description |
|------|-------------|
| One-line | Title only, single line |
| Multi-line | Title + description, 2–3 lines |
| Fixed | Fixed height container |

### 5c. Variants Decision Logic

| Need image? | Need buttons? | Need description? | Use Variant |
|-------------|--------------|-------------------|-------------|
| No | No | No | No icon / With icon |
| No | No | Yes | With icon + description |
| No | Yes | Yes | With buttons |
| Yes | No | Yes | Image + title + description |
| Yes | Yes | Yes | Image + title + description + buttons |
| Yes | No | No | Image + title |

### 5d. Responsive — Page Width < 480

- Web and Mobile share the **same** Notification style — **no distinction** between web and mobile

---

## 6. Content Guidelines

### Title

- MUST be a clear, concise heading (e.g. "Notification title", "Bullish & Bearish Signals Updated")
- SHOULD be a noun phrase or short statement
- MUST NOT be excessively long — keep to one line

### Description

- NOT recommended to exceed 2 lines
- Should provide supplementary context to the title
- MUST NOT duplicate the title content

### Buttons

- Action button label: short verb or verb phrase (e.g. "View", "Confirm", "Learn More")
- Cancel button label: "Cancel", "Dismiss", or similar
- Maximum 2 buttons per Notification

### Icon Usage

- Icon type SHOULD match the semantic status of the message
- Custom icons are allowed and not strictly bound to a specific status or color

---

## 7. Layout & Composition

### Position

| Platform | Default Position | Other Options |
|----------|-----------------|---------------|
| Web | **Top-right** (右上角) | topLeft, top (center), bottomLeft, bottomRight — chosen by designer based on business content and layout |
| Mobile | **Top center** (上方居中) | topLeft, topRight — chosen by designer |

- Notification appears overlaying the content, does NOT push page content
- Position is configurable via `position` prop on the Notification container

### Spacing

| Property | Value | Note |
|----------|-------|------|
| Distance from page edge | **24px** default | Customizable via `offset` prop |
| Gap between stacked items | **16px** | Customizable via `gap` prop |

### Multi-language Support

- Notification supports RTL (right-to-left) layout for Arabic and similar languages
- Content and icon positions mirror accordingly

---

## 8. Behavior

### Animation — Enter (example: top-right position)

- Initial state: fully transparent (`opacity: 0`), offset 24px to the right (`translateX: 24px`)
- Animation: Slide Left + Fade In, duration **250ms**
- Easing: `ease-out` (starts fast, decelerates — smooth appearance)

### Animation — Exit (example: top-right position)

- Target state: offset 24px to the right, fully transparent (`opacity: 0`)
- Animation: Slide Right + Fade Out, duration **200ms**
- Easing: `ease-in` (starts slow, accelerates — natural disappearance)

### Auto-Dismiss

- Default duration: **5 seconds** when user does not interact (hover, pause, etc.)
- Click the close button (✕) to dismiss immediately
- Dismiss time is configurable via `duration` option
- When user hovers over a Notification, the auto-dismiss timer pauses

### Stacking

#### Maximum Count

- Maximum visible at once: **3 items** (`visibleToasts` prop, default 3)
- When more than 3 Notifications arrive, they automatically stack (堆叠)
- New Notification appears on top of existing ones

#### Default (Collapsed) State

- Only the topmost Notification is fully displayed
- Remaining Notifications are shown as stacked cards behind it, saving screen space
- Images and rich content from below cards are NOT visible in collapsed state — only current status is allowed

#### Mouse Hover (Expanded) State

- When user hovers over the stacked Notification area, all cards expand (展开) downward, showing each one individually
- Background: **Gaussian blur** (高斯模糊) behind the expanded stack
- When mouse leaves, the stack collapses back to the default stacked state

#### Expand Animation

- All Notification cards slide down from above
  - Initial state: fully transparent (`opacity: 0`), offset 24px downward (`translateY: 24px`)
  - Animation: Slide Down + Fade In, duration **250ms**
  - Easing: `ease-out`

#### Collapse Animation

- Expanded cards slide up and fade away, returning to stacked form
  - Target state: fully transparent (`opacity: 0`), offset 24px upward (`translateY: 24px`)
  - Animation: Slide Up + Fade Out, duration **200ms**
  - Easing: `ease-in`

### Multiple Notification Entry Order

- When a new Notification (B) enters while an existing one (A) is visible, B pushes A downward
- A moves down simultaneously to make room for B

### Swipe to Dismiss

- Web: horizontal swipe/drag to dismiss (can be disabled via `disableSwipeDismiss`)
- Mobile: swipe dismiss is always disabled (`disableSwipeDismiss` forced)

### Keyboard Behavior

- Close button (✕) MUST be focusable via Tab
- Pressing Enter on a focused close button SHOULD dismiss the Notification
- Action buttons within Notification MUST be keyboard accessible

---

## 9. Platform Differences

| Aspect | Web (>= 480px) | Mobile (< 480px) |
|--------|----------------|-------------------|
| Default position | **Top-right** | **Top center** |
| Style | Same | Same — **no distinction** between web and mobile |
| Stacking | Supported (max 3, collapsed/expanded on hover) | Supported (same behavior) |
| Swipe dismiss | Supported (can be disabled) | Always disabled |
| Edge distance | 24px default | 24px default (customizable via `mobileOffset`) |
| Item gap | 16px | 16px |
| Collapse on outside click | Not applicable | Supported (can be disabled via `disableMobileCollapse`) |

---

## 10. Do / Don't

| | Practice | Reason |
|---|---------|--------|
| DO | Use Notification when message requires title + description or buttons | Provides richer context without blocking |
| DO | Keep description to 2 lines max | Prevents information overload |
| DO | Always include a close button (✕) | User must be able to dismiss manually |
| DO | Use appropriate status icons to match notification type | Instant visual recognition |
| DO | Respect the 3-item visible limit with stacking | Avoids visual clutter |
| DO | Show Gaussian blur background when stack is expanded | Clear visual separation from page content |
| DO | Use confirmation Dialog for dangerous/irreversible operations | Notification cannot capture user decision |
| DON'T | Use Notification for simple "success/fail" feedback | Use Toast (Snackbar) — Notification is overkill |
| DON'T | Use Notification for operations requiring user confirmation | Use Dialog / Modal instead |
| DON'T | Display more than 3 Notifications simultaneously without stacking | Creates visual clutter |
| DON'T | Use excessively long descriptions (> 2 lines) | Defeats the purpose of concise notification |
| DON'T | Omit the close button (✕) | User must always be able to dismiss |
| DON'T | Show images in stacked (collapsed) Notification | Only topmost card is fully visible |
| DON'T | Fire Notifications too frequently | Overwhelms the user, causes notification fatigue |

---

## 11. Decision Table

### Notification vs Toast Decision

| Scenario | Component | Reason |
|----------|-----------|--------|
| Simple success/fail/warning feedback | Toast (Snackbar) | Single-line, auto-dismiss |
| System push with title + description | **Notification** | Rich content needs structured layout |
| Message with action buttons (e.g. "View offer") | **Notification** | Buttons require Notification layout |
| Message with preview image | **Notification** | Image requires Notification layout |
| Promotional notification with custom background | **Notification** | Custom background only supported here |
| Critical error requiring user action | Neither — use Dialog | Must block workflow |

### Position Selection

| Platform | Context | Recommended Position |
|----------|---------|---------------------|
| Web | Default / general use | **top-right** |
| Web | Content-heavy right side, avoid overlap | top-left |
| Web | Centered layout, high-priority notification | top-center |
| Web | Bottom interaction context | bottom-left / bottom-right |
| Mobile | Default / general use | **top-center** |
| Mobile | Special layout needs | top-left / top-right |

### Content Variant Selection

| Has Image? | Has Buttons? | Has Description? | Recommended Variant |
|------------|-------------|-----------------|---------------------|
| No | No | No | No icon / With icon |
| No | No | Yes | With icon + description |
| No | Yes | Yes | With buttons |
| Yes | No | Yes | Image + title + description |
| Yes | Yes | Yes | Image + title + description + buttons |
| Yes | No | No | Image + title |

---

## 12. Related Documents

- `ainvest-design-system/references/components/notification.md`
- `ainvest-design-system/references/components/toast.md`
- `ainvest-design-system/references/components/button.md`
- `ainvest-design-system/SKILL.md`
- `ainvest-design-system/references/tokens/color.md`
- `ainvest-design-system/references/tokens/spacing.md`
