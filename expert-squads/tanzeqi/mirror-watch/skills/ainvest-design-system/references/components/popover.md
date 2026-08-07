# Guidelines — Popover (引导气泡)

<!-- > Component import: `@ainvest/popover` -->
> Component Spec: `ainvest-design-system/references/components/popover.md`
>

---

## 0. Document Role

This file defines **when, where, and how** to use the Popover (引导气泡) component — it is the **usage guideline** (使用规范).


### AI Resolution Rules

- When generating Popover UI, MUST read **both** documents
- **Component style / structure / API / code** → follow `ainvest-design-system/references/components/popover.md`
- **Usage decision (when / where / how / which variant)** → follow this file
- If rules conflict: **component spec takes priority** for visual/structural details; **this guideline takes priority** for usage decisions and scenario logic
- MUST NOT invent styles or structures absent from `ainvest-design-system/references/components/popover.md`
- MUST NOT ignore usage constraints defined in this guideline

---

## 1. Definition

Popover (引导气泡) is a **non-modal, card-style overlay** that appears near a trigger element to guide the user through features, provide rich contextual information, or facilitate onboarding flows. It supports title, description, image, action buttons, step indicators, and interactive content.

It is the **rich** variant of the bubble system — for simple single-line text tips, use Tooltip instead.

---

## 2. When to Use

| Condition | Use Popover? |
|-----------|-------------|
| New feature launch — guide the user to discover and try it | YES |
| Complex feature that needs step-by-step onboarding | YES |
| User may encounter difficulty — point to help or FAQ | YES |
| First-time user interface — "快速了解如何开始使用此功能" | YES |
| Rich content with image + description needs to be shown contextually | YES |
| Interactive content (buttons, forms) within a floating card | YES |

### MUST

- MUST use Popover (not Tooltip) when the content has a title + body structure
- MUST use Popover when the content includes action buttons or images
- MUST anchor Popover to a specific trigger element — arrow points to that element
- MUST allow only **one** Popover visible at a time

### SHOULD

- SHOULD keep description to 2 lines maximum
- SHOULD use Popover sparingly — do not overwhelm the user with frequent guidance

---

## 3. When NOT to Use

| Condition | Use Popover? | Alternative |
|-----------|-------------|-------------|
| Simple single-line text explanation on hover | NO | Tooltip |
| User must make a decision before proceeding (e.g. confirm delete) | NO | Dialog / Modal |
| Critical system error that requires user action | NO | Dialog / Error Page |
| Permanent, persistent status information | NO | Inline status banner |
| Form field validation error | NO | Inline field error |
| Action feedback (success/fail) | NO | Toast / Notification |

### MUST NOT

- MUST NOT use Popover for simple term definitions that Tooltip can handle — Popover is for richer content
- MUST NOT use Popover for operations that require user confirmation — use Dialog
- MUST NOT show multiple Popovers simultaneously
- MUST NOT use Popover for content so long that it requires scrolling — keep content concise

---

## 4. Anatomy

```
       ┌─────────────────────────────────────┐
       │  ┌─────────────────────────────┐    │
       │  │        [ Image ]            │    │
       │  └─────────────────────────────┘    │
       │  Notification title                 │
       │  Content, not recommended to        │
       │  exceed 2 lines                     │
       │                                     │
       │  ● ○ ○          [Button] [Button]   │
       └─────────────────────────────────────┘
                    ▼  (arrow)
              [ Trigger Element ]
```

| Part | Required | Description |
|------|----------|-------------|
| Bubble container | MUST | Card-style container with rounded corners |
| Title | Optional | Heading text (e.g. "Notification title") |
| Description / body | MUST | Explanatory text — NOT recommended to exceed 2 lines |
| Image | Optional | Preview image or illustration above the text content area |
| Buttons | Optional | Up to 2 action buttons (primary + secondary) at the bottom |
| Step indicator (● ○ ○) | Optional | Dot indicator for multi-step guidance; shows current step |
| Step counter (1/2) | Optional | Text counter as an alternative to dot indicator |
| Arrow | MUST | Triangular pointer indicating the trigger element |

### Arrow Rules

- Arrow indicates the trigger element's location — center-aligned with the trigger by default
- Arrow position adapts based on the bubble's placement direction
- Arrow MUST maintain a minimum **6px** safe distance from the bubble's corner edge

---

## 5. Variants Overview

### 5a. Variant Types

| Variant | Content | Use Case |
|---------|---------|----------|
| **Single (单条)** | Body text + buttons | Single-step explanation or guidance |
| **Multiple — Indicator (多条·指示器)** | Body text + dot indicators (● ○ ○) + buttons | Multi-step guidance with dot progress; use for ≤ 5 steps |
| **Multiple — Counter (多条·数器)** | Body text + "1/2" counter + buttons | Multi-step guidance with page counter; clear when steps are numbered |
| **Custom (自定义)** | Image + body text OR any custom content | Rich visual guidance; supports Notification-like layout with image, title, description |
| **Custom — White background (自定义·白底)** | White background + body + buttons | Light-themed guidance; suitable for dark UI contexts; border visible |

### 5b. Body Only vs Title + Body

Each variant above exists in two modes:

| Mode | Description |
|------|-------------|
| **Body only (正文)** | Description text + buttons; no title — more compact |
| **Title + Body (正文+标题)** | Title heading + description text + buttons; richer layout similar to Notification |

### 5c. Responsive — Page Width < 480

- Web and Mobile share the **same** Popover style — **no distinction** between web and mobile

---

## 6. Content Guidelines

### Title

- Optional but recommended for complex guidance
- MUST be a short heading (e.g. "Notification title", "Step 1: Basic Setup")
- MUST NOT be excessively long — keep to one line

### Description / Body

- NOT recommended to exceed 2 lines
- Should provide clear, actionable guidance
- MUST NOT duplicate the title content

### Buttons

- Button labels: short verb phrases (e.g. "Next", "Got it", "Skip", "Learn More")
- Maximum 2 buttons per Popover
- Multi-step flows: typically "Skip" (secondary) + "Next" / "Got it" (primary)

### Step Indicator vs Counter

- Use **dot indicator** (● ○ ○) for ≤ 5 steps — visual and compact
- Use **counter** ("1/2") when steps need clear numbering

### Tools Bar

Some Popover variants include a tools bar with:
- Multiple button pairs arranged vertically
- Used for step-by-step guidance through a complex feature area (e.g. toolbar walkthrough)

---

## 7. Layout & Composition

### Positioning Rules

The Popover's position relative to the trigger element follows this priority logic:

| Position | Arrow Location | Content Position | Priority Rule |
|----------|---------------|-----------------|---------------|
| **Top center** (上方居中) | Bottom of bubble | Above trigger, centered | Default when space permits above |
| **Bottom center** (下方居中) | Top of bubble | Below trigger, centered | When no space above |
| **Left center** (左侧居中) | Right of bubble | Left of trigger, centered | When horizontal layout preferred |
| **Right center** (右侧居中) | Left of bubble | Right of trigger, centered | When horizontal layout preferred |

Position selection is based on available viewport space — the bubble MUST NOT overflow the visible area.

### Popover in Page Context

| Platform | Position Behavior |
|----------|-------------------|
| Web (>= 480px) | Popover appears near the trigger element; position auto-adjusts to stay within viewport |
| Mobile (< 480px) | Same behavior — Popover appears near trigger, auto-adjusts |

### Multi-language Support

- Popover supports RTL (right-to-left) layout for Arabic and similar languages
- Content and icon positions mirror accordingly

---

## 8. Behavior

### Display Trigger

- **System-initiated**: appears automatically when the user reaches a relevant feature for the first time
- **User-initiated**: appears when user clicks a help icon, "?" button, or guidance entry point

### Interaction — Single Step

- User reads the content and clicks "Got it" / action button to dismiss
- Clicking outside the bubble dismisses by default (configurable via `closeOnClickOutside`)

### Interaction — Multi-Step

- User clicks "Next" to advance to the next step; Popover transitions to the next guidance bubble
- Step indicator (dots or counter) updates to reflect current position
- User can click "Skip" to dismiss the entire guidance flow
- On the last step, the action button changes to "Got it" or "Finish"

### Interaction — Custom (with image / rich content)

- Content follows Notification-like layout — image above, title, description, buttons below
- The Popover is NOT scrollable within — content must fit within the visible card

### Common Behavior

- **Anchor**: always anchored to a specific UI element; arrow points to that element
- **Dismiss**: via action button, skip button, outside click (configurable), Escape key, or navigation away
- **Overlay**: Popover floats above the page content; MAY dim the background for emphasis (configurable)
- **Trigger scope**: should only appear on relevant screen / context — do not show guidance for hidden features
- If guidance targets an element below the fold, scroll the page to bring the element into view before showing the Popover

### Close Behaviors (configurable)

| Config | Default | Description |
|--------|---------|-------------|
| `closeOnClickOutside` | `true` | Clicking outside the Popover dismisses it |
| `closeOnClickInside` | `false` | Clicking inside the Popover dismisses it (useful for simple acknowledgment) |
| Escape key | Yes | Pressing Escape dismisses the Popover |

### Keyboard Behavior

- Trigger element MUST be focusable via Tab
- Action buttons within Popover MUST be keyboard accessible
- Escape key SHOULD dismiss the Popover

---

## 9. Platform Differences

| Aspect | Web (>= 480px) | Mobile (< 480px) |
|--------|----------------|-------------------|
| Position | Auto-adjusts based on viewport space | Same |
| Style | Same | Same — **no distinction** between web and mobile |
| Multi-step navigation | Button-based | Same |
| Dismiss | Click outside / action button / Skip / Escape | Same (no Escape on mobile) |
| Trigger | Click / system-initiated | Same |

---

## 10. Do / Don't

| | Practice | Reason |
|---|---------|--------|
| DO | Use Popover for new feature onboarding and step-by-step guidance | Structured, rich content for complex features |
| DO | Keep description to 2 lines max | Prevents overwhelming the user |
| DO | Use dot indicator for ≤ 5 steps, counter for numbered steps | Clear progress indication |
| DO | Allow only one Popover visible at a time | Prevents visual clutter |
| DO | Anchor Popover to the relevant trigger element with arrow | Clear visual association |
| DO | Use "Skip" option in multi-step flows | Respects user's choice to skip guidance |
| DO | Use Custom variant with image for visually rich guidance | Engages user attention |
| DO | Use White background variant when Popover appears on dark UI | Ensures readability and contrast |
| DON'T | Use Popover for simple term definitions | Use Tooltip — Popover is overkill |
| DON'T | Use Popover for operations requiring user confirmation | Use Dialog / Modal instead |
| DON'T | Show multiple Popovers at the same time | Only one at a time |
| DON'T | Put scrollable content inside a Popover | Content must fit visible area |
| DON'T | Use excessively long descriptions (> 2 lines) | Defeats concise guidance purpose |
| DON'T | Trigger Popover guidance on every user visit | Once per user / per session is enough |
| DON'T | Show Popover for features not visible on the current screen | Only guide visible, relevant features |

---

## 11. Decision Table

### Variant Selection

| Steps | Has Image? | Background | Recommended Variant |
|-------|-----------|------------|---------------------|
| 1 | No | Dark (default) | **Single** |
| 2–5 | No | Dark (default) | **Multiple — Indicator** |
| 2+ | No | Dark (default) | **Multiple — Counter** |
| 1 | Yes | Dark (default) | **Custom** |
| Any | No | Light (white) | **Custom — White background** |

### Body Only vs Title + Body

| Complexity | Recommended Mode |
|-----------|-----------------|
| Simple, single-concept explanation | **Body only** |
| Feature with name + description, or Notification-like layout | **Title + Body** |

### Popover vs Tooltip vs Dialog

| Need | Component |
|------|-----------|
| 1–2 lines of text, no buttons needed | **Tooltip** |
| Rich content with title, description, image, or buttons | **Popover** |
| Multi-step guided walkthrough | **Popover** (multi-step) |
| User must confirm or decide before proceeding | **Dialog** |
| Brief operation feedback (success/error) | **Toast / Notification** |

---

## 12. Related Documents

- `ainvest-design-system/references/components/popover.md`
- `ainvest-design-system/references/components/tooltip.md`
- `ainvest-design-system/references/components/toast.md`
- `ainvest-design-system/references/components/notification.md`
- `ainvest-design-system/SKILL.md`
- `ainvest-design-system/references/tokens/color.md`
- `ainvest-design-system/references/tokens/spacing.md`
