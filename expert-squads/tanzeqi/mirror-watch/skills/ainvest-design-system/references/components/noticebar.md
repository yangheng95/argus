# Guidelines — Notice Bar (通知栏)

<!-- > Component import: `@ainvest/notice-bar` -->
> Component Spec: `ainvest-design-system/references/components/noticebar.md`

---

## 0. Document Role

This file defines **when, where, and how** to use the Notice Bar component — it is the **usage guideline** (使用规范).

Notice Bar is a persistent, non-blocking message bar that sits at the top of a page or inside a module. It displays system messages, event notifications, and promotional content. It is meant to be **visible and attention-drawing without interrupting the user's current task**.

### How AI Should Use These Two Documents

| Document | Role | Contains |
|----------|------|----------|
| `ainvest-design-system/references/components/noticebar.md` | **Component Style Spec** (组件样式) | Component definition, variants, API props, code examples |
| `ainvest-design-system/references/rules/NoticeBar.md` *(this file)* | **Usage Guideline** (使用规范) | When to use, when NOT to use, anatomy, hierarchy selection, layout, responsive behavior, Do/Don't |

### AI Resolution Rules

- When generating Notice Bar UI, MUST read **both** documents
- **Component style / structure / API / code** → follow `components/noticebar.md`
- **Usage decision (when / where / which hierarchy / which background / which configuration)** → follow this file
- If rules conflict: **component spec takes priority** for visual/structural details; **this guideline takes priority** for usage decisions and scenario logic
- MUST NOT invent styles or structures that are absent from `components/noticebar.md`
- MUST NOT ignore usage constraints defined in this guideline

---

## 1. Definition

Notice Bar (通知栏) is a component for displaying **system messages and event notifications**. It is placed directly below the navigation bar (or at the top of a module) and is designed to be **both non-intrusive and consistently visible** — it does not interrupt the user's current task while remaining prominent enough to continuously draw attention.

Compared with the other feedback components:

| Component | Layer | Dismisses | Purpose |
|-----------|-------|-----------|---------|
| Notice Bar | Page / module top, inline | Persistent until closed / auto-hide | System-level broadcast, ongoing state, promotion |
| Notification | Floating (corner overlay) | Auto-dismiss, stackable | Push messages, event-driven alerts |
| Toast (Snackbar) | Floating (bottom) | Short auto-dismiss | Single-line operation feedback |

---

## 2. When to Use

| Condition | Use Notice Bar? |
|-----------|----------------|
| Need to broadcast a system-wide status (e.g. trading-hour change, policy update, market closure) | YES |
| Need to display a persistent message at the top of a page or module | YES |
| Need to promote an upgrade / paid feature with a call-to-action | YES |
| Module-level filter/category-style announcement | YES (use 二级 Notice Bar) |
| Message must remain visible while the user keeps browsing | YES |
| Low-interference, low-density static information (homepage, module header) | YES |

### MUST

- MUST place the Notice Bar directly **below the navigation bar** for page-level messages (一级 Notice Bar)
- MUST place it **at the top of the module container** for module-level messages (二级 Notice Bar)
- MUST choose the hierarchy (`level`) based on scope: page-wide → `primary`, module-wide → `secondary`
- MUST choose the background color based on semantic importance (see §5b)
- MUST ensure long content is handled correctly on narrow viewports (see §5c)

### SHOULD

- SHOULD include a left icon to convey the nature of the message (bell, security, news, etc.)
- SHOULD use the closeable (`closeable`) configuration when the message is not strictly persistent
- SHOULD use a right-side action (chevron, "To Action" link, or button) when the message links to more detail

---

## 3. When NOT to Use

| Condition | Use Notice Bar? | Alternative |
|-----------|----------------|-------------|
| Short transient operation feedback ("Saved", "Copied") | NO | Toast (Snackbar) |
| System push requiring rich content (title + description + image + buttons) | NO | Notification |
| Critical decision requiring user confirmation | NO | Dialog / Modal |
| Persistent navigation or status that belongs in the header/footer | NO | Header / Footer region |
| Inline form field validation | NO | Inline field error |
| Messages that must not be dismissed and must block interaction | NO | Full-page banner or modal |

### MUST NOT

- MUST NOT use Notice Bar for transient feedback — it is persistent by nature
- MUST NOT place Notice Bar in the middle of content — it belongs at the top of a page or module
- MUST NOT stack multiple Notice Bars of the same hierarchy on the same page
- MUST NOT use a Notice Bar to block user actions — it is non-modal by design
- MUST NOT omit a way to dismiss when the message is operational (e.g. upgrade prompts) — provide either a close icon, auto-hide, or action button

---

## 4. Anatomy

### Standard Notice Bar

```
┌──────────────────────────────────────────────────────────────┐
│  [Icon]  Get big news & event Notification first.     [>] [✕] │
└──────────────────────────────────────────────────────────────┘
```

| Part | Required | Description |
|------|----------|-------------|
| Left icon | Optional | Conveys message nature — bell, security, close, news, custom |
| Content (text) | MUST | Main message text |
| Right slot — chevron | Optional | Indicates the bar links to more detail |
| Right slot — action | Optional | "To Action" link, `Upgrade` button, etc. |
| Right slot — close icon (✕) | Optional | Dismisses the bar manually (requires `closeable`) |

### Special case — close icon on the left

When the right slot already contains an action button or chevron, the close icon is moved to the **left** side of the bar to avoid interaction conflict. This applies to both 一级 and 二级 Notice Bars.

### Hierarchy (Level)

| Level | Height | Corner | Primary Use |
|-------|--------|--------|-------------|
| **一级 (primary)** | **52px** | No corner radius (full-width top bar) | Page-top / global notification — homepage, official-site top bar |
| **二级 (secondary)** | **42px** | Rounded corners | Module-level — filter categories inside a module |

Minimum safe side margin for both levels: **16px**.

---

## 5. Variants Overview

### 5a. Hierarchy Decision

| Scope | Use |
|-------|-----|
| Global — shown at the top of the whole page (e.g. homepage, official site) | **一级 Notice Bar** (`level="primary"`) |
| Module — shown inside a specific module / section | **二级 Notice Bar** (`level="secondary"`) |

### 5b. Visual Emphasis (Background Color)

Three emphasis levels are supported via the `background` prop. Pick based on how much attention the message should attract.

| Emphasis | Background | Use Case | Example |
|----------|-----------|----------|---------|
| **Strong — Prominent / Warning** (醒目、警示) | Blue (`blue`) | Critical announcements: policy changes, market closures, warnings. E.g. new registration rules cause trading-rule changes | "Federal Reserve announces new interest rate policy…" |
| **Secondary — Easy to notice** (易于察觉) | Weak Blue (`weakBlue`, default) | Regular business notifications, non-mandatory rule changes, upsell / navigation prompts | "Breaking: Stock market reaches all-time high" |
| **Weak — Visible but quiet** (可以看到) | Grey (`grey`) | Long-lived messages inside pages/modules that must not be remembered-closed but should stay low-interference | "System maintenance scheduled for this weekend" |
| **Promotional — Gradient** | Gradient (蓝→青) | Paid-plan / upgrade / monetization scenarios | "Quotes are delayed by 15 mins — Upgrade for real-time" |

### 5c. Right-Slot Configuration

Right-side content is selected by the message's interactivity:

| Right slot config | When to use |
|-------------------|-------------|
| Chevron (`>`) only | Bar is tappable and links to a detail page |
| "To Action" text link | Bar triggers a specific action with a clear verb |
| Close icon (✕) only | Message is informational; user may dismiss |
| Chevron + Close | Tappable detail + optional dismiss |
| Button (e.g. `Upgrade`) | Promotional / conversion scenarios |
| Button + Close | Promotional scenario where user may decline |

**Special rule:** when the **right slot has an action/chevron button**, the close icon MUST move to the **left**.

### 5d. Background Color — Rule Summary

- **Default (weakBlue)**: strong notifications for policy, market-closure, warning types
- **Grey**: low-interference persistent messages inside pages/modules that must not be remembered-closed
- **Blue / Gradient**: paid-feature, monetization, operational promotions

### 5e. Responsive / Multi-Device Adaptation

Width adapts fluidly to the container.

| Viewport | Behavior | Side Margin | Text Overflow |
|----------|---------|-------------|---------------|
| Web, container width **> 500** | Fully displayed; if container is too narrow, text truncates or wraps | **40px** left/right | Single-line truncate (…) by default; `maxLine` not allowed here |
| Web, container width **≤ 500** / Mobile | Text truncates or wraps directly; narrower margins | **16px** left/right | Up to **3 lines** (`maxLine` 1–3) |

When container width ≤ 500, max text lines = **3**.

### 5f. Bar vs Non-Bar (通栏 vs 非通栏)

| Style | When | Visual |
|-------|------|--------|
| **通栏 (Full bar)** | Page-level global notification, runs edge-to-edge under the nav bar | No border radius, no side gap |
| **非通栏 (Contained)** | Inside a module / card; aligns with module padding | Rounded corners, inherits module's 16px gap |

### 5g. Marquee (跑马灯)

- Enabled via `enableMarquee` when text exceeds the container width
- Loop behavior: play once, pause **80px** gap, then play next round
- **Region-restricted: only used in markets-related contexts (行情场景). North-America-only usage.**

---

## 6. Content Guidelines

### Text

- Keep the text **short and scannable** — it is meant to be noticed at a glance
- On Web (container > 500): SHOULD fit in **one line**; truncate with ellipsis if too long
- On Mobile (container ≤ 500): max **3 lines** via `maxLine`
- MUST NOT duplicate what is already in the navigation or page title
- SHOULD start with the key information (event, subject, state) rather than filler words

### Icon

- Icon SHOULD match the semantic meaning of the message:
  - `bell` — general announcement
  - `security` — security / protection message
  - `new` — news / breaking updates
  - `close` — warning / issue notification (left icon is a close-style mark, not a dismiss button)
  - Custom icon allowed via `iconType` = ReactNode
- For the **weak** hierarchy or secondary emphasis, the icon **may be hidden** to reduce visual weight

### Action Text

- Use a short verb phrase: "To Action", "View", "Upgrade"
- Action text MUST match the button/link style of the component spec

---

## 7. Layout & Composition

### Position

| Notice Bar Level | Placement |
|------------------|-----------|
| 一级 (primary) | Directly below the top navigation bar, full width |
| 二级 (secondary) | At the top of the module it belongs to |

- Notice Bar **pushes** the content below it (unlike Notification, which overlays)
- Only **one 一级 Notice Bar** is allowed on a page at any time; if multiple global messages are needed, queue them or merge them into one

### Alignment

| Alignment | Reference | Example |
|-----------|----------|---------|
| `space-between` (两端对齐, default) | Aligned with page/module title that uses space-between | Inside a module |
| `center` (居中对齐) | Aligned with a page/module title that is centered | Homepage top |

### Spacing

| Property | Web (> 500) | Mobile / narrow (≤ 500) |
|----------|------------|--------------------------|
| Side margin (safe zone) | 40px | 16px |
| Height — 一级 | 52px | 52px |
| Height — 二级 | 42px | 42px |
| Grouptitle gap (non-bar variant) | 16px | 16px |

### Combined with Grouptitle

In the **non-bar (contained)** style, the Notice Bar sits inside a module that has a `Grouptitle`. There MUST be a **16px** vertical gap between the Grouptitle's description line and the Notice Bar.

---

## 8. Behavior

### Persistence

- Notice Bar is **persistent by default** — it stays until the user dismisses it (if `closeable`) or the configured `duration` expires
- Default `duration` = `'infinite'` (never auto-hides)
- If `duration` is set to a number, the bar auto-hides after that many milliseconds

### Dismiss Rules

- If `closeable` is `true`, a ✕ icon is shown; clicking it triggers `onClose`
- If the right slot already has an action/chevron, the ✕ moves to the **left side**
- If the Notice Bar is a **persistent status message** (e.g. "Quotes delayed"), `closeable` is usually `false` — user can only act on it (Upgrade) rather than dismiss

### Text Overflow

- Web (container > 500): text truncates with `…` to one line; no wrap
- Mobile / narrow: text may wrap up to the value of `maxLine` (1–3)
- When text is too long to fit even with wrapping, marquee (`enableMarquee`) may be used — **markets scenarios only**

### Marquee

- Text scrolls left-to-right when enabled
- Each loop pauses **80px** of blank space before starting the next pass
- MUST NOT be used outside of markets / trading contexts

### Click Behavior

- If the bar has a chevron, clicking any part of the bar triggers the linked navigation
- If the bar has a button, only the button is interactive — clicking the text area has no effect
- The close icon's click area MUST be large enough for touch targets on mobile (≥ 44px)

### Auto-hide

- When `duration` is set, the bar fades out after the duration elapses
- While the user hovers over the bar (Web), auto-hide pauses

---

## 9. Platform Differences

| Aspect | Web (container > 500) | Web (container ≤ 500) / Mobile |
|--------|----------------------|---------------------------------|
| Side margin | 40px | 16px |
| Max text lines | 1 (truncate) | Up to 3 (`maxLine`) |
| Marquee | Supported (markets only) | Supported (markets only) |
| Auto-hide pause on hover | Yes | N/A |
| Close button hit area | Standard | ≥ 44×44px touch target |
| Height (一级 / 二级) | 52 / 42 | 52 / 42 |

---

## 10. Do / Don't

| | Practice | Reason |
|---|---------|--------|
| DO | Place 一级 Notice Bar directly under the nav bar | It belongs to the global page layer |
| DO | Use 二级 Notice Bar inside modules for module-level announcements | Keeps scope visually clear |
| DO | Pick background emphasis based on message importance (strong / secondary / weak) | Prevents "alert fatigue" |
| DO | Move the close icon to the left when the right side has an action | Avoids interaction conflict |
| DO | Truncate long text on Web and allow up to 3 lines on Mobile | Preserves layout integrity |
| DO | Use gradient background for upgrade / monetization bars | Matches brand promotion style |
| DO | Combine with `Grouptitle` with a 16px gap in the non-bar variant | Matches module composition spec |
| DO | Keep only one 一级 Notice Bar per page | Prevents stacking top-level banners |
| DON'T | Use Notice Bar for transient operation feedback | Use Toast (Snackbar) — it auto-dismisses |
| DON'T | Use Notice Bar for rich push notifications with buttons + image | Use Notification — it supports stacking and rich content |
| DON'T | Stack multiple 一级 Notice Bars | Only one global bar at a time |
| DON'T | Use marquee outside of markets scenarios | Region-restricted; creates distraction elsewhere |
| DON'T | Omit a dismiss path for messages that should not be permanent | User must be able to clear informational bars |
| DON'T | Put the close icon on the right when the right slot has an action | Interaction conflict — move it to the left |
| DON'T | Exceed 3 lines on narrow screens | Layout breaks; message overwhelms context |

---

## 11. Decision Table

### Notice Bar vs Notification vs Toast

| Scenario | Component | Reason |
|----------|-----------|--------|
| Global market-hour change broadcast | **Notice Bar (一级)** | Persistent, page-level |
| Module-level filter announcement | **Notice Bar (二级)** | Persistent, module-level |
| Paid-feature upgrade prompt | **Notice Bar (gradient + button)** | Persistent CTA |
| "Saved successfully" feedback | Toast | Single-line, transient |
| System push with title + description + image | Notification | Rich floating card |
| Critical decision requiring confirmation | Dialog | Blocking by design |

### Level Selection

| Scope | Level |
|-------|-------|
| Global (page top, homepage, official site) | **一级 primary** (52px, full-width) |
| Module (filter, category, section) | **二级 secondary** (42px, rounded) |

### Background Selection

| Need | Background |
|------|-----------|
| Warning / policy / market closure | **Blue** (strong) |
| Regular business notification / upsell | **Weak Blue** (default, secondary) |
| Long-lived quiet background info | **Grey** (weak) |
| Paid-feature / promotion / monetization | **Gradient (blue→cyan)** |

### Right-Slot Selection

| Need | Right slot config |
|------|------------------|
| Links to a detail page | Chevron only |
| User can explicitly dismiss | Close icon only |
| User takes a specific action | Text link ("To Action") or Button (`Upgrade`) |
| Action + dismiss | Button + Close (close moves to left) |
| Navigation + dismiss | Chevron + Close (close moves to left) |

### Alignment Selection

| Page / module title uses | Notice Bar alignment |
|--------------------------|----------------------|
| Two-end alignment (space-between) | `space-between` (default) |
| Centered title (e.g. homepage top) | `center` |

### Responsive Selection

| Container width | Side margin | Max lines |
|----------------|-------------|-----------|
| > 500 | 40px | 1 (truncate) |
| ≤ 500 | 16px | 1–3 via `maxLine` |

---

## 12. Related Documents

- `ainvest-design-system/references/components/noticebar.md`
- `ainvest-design-system/references/components/notification.md`
- `ainvest-design-system/references/components/toast.md`
- `ainvest-design-system/references/components/Button.md`
- `ainvest-design-system/SKILL.md`
- `ainvest-design-system/references/tokens/color.md`
- `ainvest-design-system/references/tokens/spacing.md`
