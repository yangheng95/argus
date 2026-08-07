# Guidelines — Switch


## 0. Document Role

This file defines **when, where, and how** to use the Switch component — it is the **usage guideline** (使用规范).

<!-- - Component import: `@ainvest/switch` -->
- Component Spec: `ainvest-design-system/references/components/switch.md`
- Related: `checkbox-group.md`, `button.md`, `color.md`, `spacing.md`

### AI Resolution Rules

- When generating Switch UI, MUST read this document together with `ainvest-design-system/references/components/switch.md`
- **Component style / structure / API / code** → follow `ainvest-design-system/references/components/switch.md`
- **Usage decision (when / where / how / which size)** → follow this file
- MUST NOT invent styles or structures that are absent from `ainvest-design-system/references/components/switch.md`
- MUST NOT ignore usage constraints defined in this guideline

---

## 1. Definition

Switch is a **binary toggle control** with two mutually exclusive states: On and Off. It represents a setting or preference that takes effect **immediately** upon interaction — no confirmation step is required in standard use.

It expresses states such as on/off, yes/no, enabled/disabled. It does NOT express actions or commands.

---

## 2. When to Use

| Condition | Use Switch? |
|-----------|-------------|
| Toggle a single setting on or off (e.g. notifications, dark mode) | YES |
| Enable or disable a feature independently | YES |
| Binary preference in a settings list | YES |
| Toggle takes effect immediately without extra confirmation | YES |

### MUST

- MUST use Switch when the interaction is a binary on/off toggle with immediate effect
- MUST use Switch (not Checkbox) when the setting takes effect immediately on toggle — Checkbox requires a separate submit step
- MUST pair Switch with a label that describes **what is being controlled**, not the action of toggling

### SHOULD

- SHOULD use the 32px size (default) in standard list settings
- SHOULD use the 24px or 16px sizes only in space-constrained special contexts

---

## 3. When NOT to Use

| Condition | Use Switch? | Alternative |
|-----------|-------------|-------------|
| Selection in a form that requires Submit to take effect | NO | Checkbox |
| Selecting one from multiple options | NO | Radio / Tab |
| Triggering an action (execute, submit, delete) | NO | Button |
| Navigating to another view | NO | Link / Tab |
| Dangerous operation that should NOT execute immediately | NO | Button (with confirmation dialog) |

### MUST NOT

- MUST NOT use Switch for actions that change application state in a destructive or irreversible way without additional safeguards — if the operation after toggling is dangerous, add a confirmation dialog (二次确认流程)
- MUST NOT use Switch in place of a Checkbox inside a form that has a submit step
- MUST NOT use Switch for multi-select — Switch is strictly binary (one control, two states)
- MUST NOT add logical action language to the Switch label (e.g. "打开后执行...", "关闭以停止...") — the label only identifies what is being controlled

---

## 4. Anatomy

```
┌──────────────┐
│  ●✓          │   ← On state: thumb on right with check icon
└──────────────┘

┌──────────────┐
│          ○   │   ← Off state: thumb on left, no icon
└──────────────┘

┌──────────────┐
│  ●○          │   ← Loading state: thumb with spinner icon
└──────────────┘
```

| Part | Required | Description |
|------|----------|-------------|
| Track | MUST | The elongated pill-shaped background; color reflects On/Off state |
| Thumb | MUST | The circular handle that slides between positions |
| Check icon (✓) | On state only | Visible inside thumb when On; indicates confirmed active state |
| Spinner icon (○) | Loading state only | Replaces check icon during async state transition |
| Label | Context-dependent | External text identifying the controlled setting; NOT part of the Switch component itself |

### Rules

- Thumb MUST always be fully visible inside the track — MUST NOT clip or overflow
- Check icon MUST appear inside the thumb in On state
- Spinner MUST appear inside the thumb in Loading state (replaces check)
- Off state thumb has no icon
- Track color: On = `color.button.black.default` (dark fill); Off = `color.button.grey.default` (light grey fill)

---

## 5. Variants Overview

### 4 States

| State | Chinese | Trigger | Visual |
|-------|---------|---------|--------|
| **On — Normal** | 开/01on/01常规 | User toggled on; no pending operation | Dark track + thumb on right + check icon |
| **On — Disabled** | 开/01on/02禁用 | Switch is on but interaction is blocked | Faded dark track + thumb on right + faded check icon; `pointer-events: none` |
| **On — Loading** | 开/01on/03加载 | Switch is on; async operation in progress | Dark track + thumb on right + spinner icon |
| **Off — Normal** | 开/02off/01常规 | User toggled off; no pending operation | Light grey track + thumb on left; no icon |
| **Off — Disabled** | 开/02off/02禁用 | Switch is off but interaction is blocked | Faded grey track + thumb on left; `pointer-events: none` |
| **Off — Loading** | 开/02off/03加载 | Switch is off; async operation in progress | Light grey track + thumb on left + spinner icon |

### 3 Sizes

| Size | Track Height | Usage |
|------|-------------|-------|
| **32px** | 32px | **Default** — standard settings lists, single-unit rows |
| **24px** | 24px | Special / compact contexts |
| **16px** | 16px | Special / high-density contexts (use sparingly) |

> The 24px and 16px sizes are for special situations only. Default to 32px in all standard usage.

### State × Size Matrix

All 4 states (On-Normal, On-Disabled, On-Loading, Off-Normal, Off-Disabled, Off-Loading) are available at all 3 sizes.

### Color Tokens

| Element | State | Token |
|---------|-------|-------|
| Track background | On | `color.button.black.default` |
| Track background | Off | `color.button.grey.default` |
| Track background | Disabled (both) | Faded / reduced opacity of respective state color |
| Thumb | All states | White (`#fff` / `color.foreground.layer1`) |
| Check icon | On-Normal | `color.button.black.default` (dark) |
| Check icon | On-Disabled | Faded |
| Spinner icon | Loading | `color.button.black.default` or grey depending on track state |

---

## 6. Content Guidelines

### Label Text

- MUST describe what the Switch **controls**, not the toggle action itself
- MUST be a noun phrase or short descriptive phrase (e.g. "Price Alerts", "Customized Alerts", "Dark Mode")
- MUST NOT use verb phrases that describe the action (e.g. "Turn on notifications", "Enable dark mode")
- MUST NOT include logical consequence language in the label (e.g. "After enabling, we will send you alerts")
- SHOULD be concise — typically 1–4 words

### Good vs Bad Examples

| Good | Bad | Reason |
|------|-----|--------|
| "Price Alerts" | "Turn on Price Alerts" | Label is a noun, not an action |
| "Customized Alerts" | "Enable Customized Alerts" | MUST NOT add action verb |
| "Dark Mode" | "Switch to Dark Mode" | Label names the setting |
| "52 Week High/Low" | "Notify me on 52 Week High/Low" | No consequence language in label |

---

## 7. Layout & Composition

### Standard Settings List (32px)

- Switch is right-aligned in a row; label is left-aligned
- Row height follows standard list item height (typically 48–56px on Web, 44px on Mobile)
- Rows are separated by a 1px divider (`color.divider.level3`) or grouped inside a card

```
┌──────────────────────────────────────────┐
│  Customized Alerts              ●✓       │
├──────────────────────────────────────────┤
│  Significant Price Alerts       ●✓       │
├──────────────────────────────────────────┤
│  52 Week High/Low               ●✓       │
└──────────────────────────────────────────┘
```

### Switch with Secondary Info

- When a row has both a Switch and a disclosure (e.g. "All ›"), place the disclosure to the left of the Switch
- Example: `Price Alerts Scope    All ›   [no switch]` — this row uses a disclosure chevron, not a Switch

### Compact Sizes (24px / 16px)

- Used when space is constrained — e.g. inside a dense card, a collapsed module, or an inline control
- MUST NOT use 16px size where 24px or 32px would fit
- Maintain adequate touch target around small switches (minimum 44×44px tap area regardless of visual size)

---

## 8. Behavior

### Immediate Effect

- Toggling Switch MUST take effect **immediately** — no Submit button needed
- The state change is reflected visually at once (track + thumb animate to new position)
- Loading state MUST be shown if the toggle triggers an async operation (e.g. API call to update server-side preference)

### Loading State

- When the toggle triggers an async operation, Switch enters Loading state immediately on click
- Loading state shows spinner icon in the thumb
- Switch MUST be non-interactive during loading (`pointer-events: none` or equivalent)
- On success: transition to new state (On or Off Normal)
- On failure: revert to previous state and show error feedback (toast / inline message)

### Dangerous Operations — Confirmation Required

- If toggling On would immediately trigger a **dangerous or irreversible operation** (e.g. deleting data, executing a trade, sending a payment), MUST add a confirmation dialog before executing
- The Switch should remain in its current state until the user confirms in the dialog
- On dialog cancel: Switch reverts to previous state; no action taken
- MUST NOT execute dangerous operations immediately on toggle without confirmation

### Transition Animation

- Thumb slides smoothly between left (Off) and right (On) positions
- Track background transitions between dark and light fill
- Duration: ~200ms, ease-in-out

### Disabled State

- Disabled Switch MUST NOT respond to any interaction (`pointer-events: none`)
- Disabled MUST visually communicate non-interactivity (reduced opacity / faded colors)
- Disabled state can occur in both On and Off positions (a setting that is on but cannot currently be changed)

### Keyboard Behavior

- Switch MUST be focusable via Tab key
- Space or Enter on a focused Switch MUST toggle the state
- Focus state MUST be visually indicated (system focus ring or custom outline)

---

## 9. Platform Differences

### Web

- Default size: 32px
- Hover state: cursor changes to pointer; subtle visual feedback acceptable
- All 3 sizes available

### Mobile (App)

- Default size: 32px (matches touch target requirements)
- Touch interaction — no hover state
- 24px and 16px sizes available for special compact contexts; MUST maintain minimum 44×44px tap target

### Dark Mode

- Track On: inverted — in dark mode, "black" becomes white (follows `color.button.black.default` dark token)
- Track Off: grey fill adjusts to dark mode grey (`color.button.grey.default` dark token)
- Thumb: remains white in light mode; adjusts per dark mode token
- All 4 states adapt to dark mode via the token system — MUST NOT hard-code colors

---

## 10. Do / Don't

| | Practice | Reason |
|---|---------|--------|
| DO | Use Switch for immediate binary toggles | Correct semantic use |
| DO | Label with noun phrases ("Price Alerts") | Label names what is controlled, not the action |
| DO | Show Loading state during async operations | Communicates that action is in progress |
| DO | Add confirmation dialog for dangerous toggles | Prevents accidental irreversible actions |
| DO | Default to 32px size | Standard for settings lists |
| DO | Maintain minimum 44×44px tap area for all sizes on mobile | Touch target requirement |
| DON'T | Use Switch for actions (submit, delete, execute) | Use Button — Switch is for settings, not actions |
| DON'T | Use Switch inside forms that require Submit | Use Checkbox |
| DON'T | Add action verbs to the Switch label | "Turn on X" — label should be "X" only |
| DON'T | Execute dangerous operations immediately on toggle | Add confirmation dialog |
| DON'T | Use 16px Switch in standard settings lists | Too small; use 32px default |
| DON'T | Leave Loading state without success/error resolution | Always resolve async state |
| DON'T | Allow interaction during Loading state | `pointer-events: none` during loading |

---

## 11. Decision Table

| Context | State on Load | Size | Confirmation Needed? | Example |
|---------|--------------|------|----------------------|---------|
| Settings toggle (preference) | Per user setting | 32px | NO | "Price Alerts", "Dark Mode" |
| Feature enable/disable (safe) | Per server state | 32px | NO | "Customized Alerts", "Notifications" |
| Feature enable (async API call) | Off → Loading → On | 32px | NO (loading handles async) | Any remote setting save |
| Dangerous feature toggle | Current state | 32px | YES — show confirmation dialog | "Delete all data on disable" |
| Compact inline toggle | Per state | 24px | Depends on operation | Dense card interior control |
| High-density area toggle | Per state | 16px | Depends on operation | Chip-level or table cell |

---

## 12. Related Documents

- `ainvest-design-system/references/components/switch.md`
- `ainvest-design-system/references/components/button.md`
- `ainvest-design-system/SKILL.md`
- `ainvest-design-system/references/tokens/color.md`
- `ainvest-design-system/references/tokens/spacing.md`
