# Guidelines — link

> **Component Spec:** `ainvest-design-system/references/components/link.md`

---

## 0. Document Role

This document covers **when and how to use** the link (超链接) component. It focuses on decisions a designer must make explicitly — visual details handled automatically by the component are omitted.

<!-- - Component import: `@ainvest/link` -->

---

## 1. Definition

Link is an **inline interactive text element** that creates clickable connections in the interface, guiding users to other pages or triggering specific actions.

It provides two visual types — **Default** and **Emphasis** — and supports optional left icon, right icon, and underline to enhance visual recognition and information delivery.

---

## 2. When to Use

| Condition                                                                       | Use Link? |
| ------------------------------------------------------------------------------- | --------- |
| Navigate to another page within the same site (internal link)                   | YES       |
| Navigate to an external URL (external link)                                     | YES       |
| Inline text needs to be clickable within a sentence or paragraph                | YES       |
| Legal / policy text needs clickable references (e.g. "Privacy Policy", "Terms") | YES       |
| Notification bar needs a call-to-action (e.g. "To Action >")                    | YES       |
| News article references an external source with a URL                           | YES       |

### MUST

- MUST use Link when text should navigate the user to another page or resource
- MUST use Link (not Button) for inline text navigation within body copy

### SHOULD

- SHOULD use Link with underline for legal / policy / disclaimer contexts to reinforce clickability
- SHOULD use Link with right arrow icon (`>`) when it leads to a list page or "see more" action

---

## 3. When NOT to Use

| Condition                                                    | Use Link? | Alternative           |
| ------------------------------------------------------------ | --------- | --------------------- |
| Action triggers a state change (submit, save, delete)        | NO        | Button                |
| Action is the primary CTA on the page                        | NO        | Button (primary)      |
| Navigation between top-level sections                        | NO        | Tab / Nav bar         |
| Link is standalone and visually prominent as a block element | NO        | Button (text variant) |

### MUST NOT

- MUST NOT use Link for actions that mutate data — use Button instead
- MUST NOT use Link as a replacement for Button when the action is the primary CTA
- MUST NOT use Link for navigation that is already handled by Tab or Nav components

---

## 4. Anatomy

```
[ Left Icon ]  [ Link Label ]  [ Right Icon ]
  (optional)     (required)      (optional)
       ────────────────────────
              underline (optional)
```

| Part              | Required | Description                                                                                               |
| ----------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| Link Label (text) | MUST     | The clickable text content; supports custom string or slot                                                |
| Left Icon         | Optional | Icon displayed before the text; used to reinforce link type (e.g. chain icon `🔗` for external links)     |
| Right Icon        | Optional | Icon displayed after the text; commonly a right arrow (`>`) indicating navigation direction               |
| Underline         | Optional | A line below the text to reinforce clickability; default is OFF; commonly used in legal / policy contexts |

### Rules

- Link Label is the only required part — all other elements are optional
- Left Icon and Right Icon MUST NOT both be used simultaneously unless there is a strong design reason
- Underline defaults to `false` — enable only when clarity demands it (e.g. legal text, disclaimers)

### Slot × Variant Configuration Matrix

Each Slot (content type) works across all three style variants. The table below defines the exact behavior:

| Slot           | Props                                      | Default                                                                                                          | Emphasis                                                                   | Custom Color                                           | Platform Adaptation                                  |
| -------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------- |
| **Link Label** | Type: String / Slot; Default: "Link Label" | Regular weight; e.g. `By continuing, you agree to Ainvest's Third-Party Brokerage Disclaimer and Privacy Policy` | Bold / semibold weight; same text; e.g. `Third-Party Brokerage Disclaimer` | Custom color applied to text; e.g. red `delete`        | No difference between Web and Mobile — unified style |
| **Left Icon**  | Type: Icon Slot; Default: none             | Icon inherits link color; e.g. `🔗 Facebook.com...and 5 more links`                                              | Icon + bold text; same color                                               | Icon uses custom color; e.g. custom-colored chain icon | No difference between Web and Mobile — unified style |
| **Right Icon** | Type: Icon Slot; Default: none             | Right arrow `>` or external `↗`; e.g. `Harris Catches Up to Trump in Poll Surge as Bi... >`                     | Bold text + right icon; border/card variant possible                       | Custom-colored text + icon                             | No difference between Web and Mobile — unified style |
| **Underline**  | Type: Boolean; Default: false              | Underline below text; e.g. `AI Tools Risk Disclosure                                                             | Privacy Policy`                                                            | Bold + underline                                       | Custom-colored underline matching text color         | No difference between Web and Mobile — unified style |

### Slot Detail — Link Label

- Description: The primary text content of the link. Communicates the destination or action to the user.
- Type: String / Slot (supports plain text or custom content)
- Default value: `"Link Label"`
- MUST be present on every Link instance
- Text length is flexible — short inline labels or long article titles are both valid

### Slot Detail — Left Icon

- Description: Optional icon displayed before the link text. Used to reinforce the link type and add visual identification (e.g. chain icon for external links).
- Type: Icon component / Slot (supports icon components or custom content)
- Default: none (hidden)
- When present, icon color MUST match the link text color
- Common usage: chain/link icon (`🔗`) for external source attribution

### Slot Detail — Right Icon

- Description: Optional icon displayed after the link text. Commonly used to indicate navigation direction or interaction behavior (e.g. right arrow for "next page").
- Type: Icon component / Slot (supports icon components or custom content)
- Default: none (hidden)
- When present, icon color MUST match the link text color
- Common usage: right arrow (`>`) for "see more", external arrow (`↗`) for opening external sites

### Slot Detail — Underline

- Description: Optional underline decoration below the link text. Used to reinforce the clickable nature of the link.
- Type: Boolean
- Default: `false` (no underline)
- SHOULD be enabled in legal / policy / disclaimer contexts
- Underline color MUST match the link text color and persist across all states (default, hover)

---

## 5. Variants Overview

### Type Variants

| Type     | Description                              | Usage                                               |
| -------- | ---------------------------------------- | --------------------------------------------------- |
| Default  | Standard link style; regular font weight | General in-page navigation, inline content links    |
| Emphasis | Bold / visually prominent link style     | Important links that need to attract user attention |

### Color Variants

| Color               | Default State Token                             | Hover Behavior                              | Usage                                                |
| ------------------- | ----------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| Default (neutral)   | `color.text.primary`                            | hover → `color.text.secondary`              | Standard content links; blends with body text        |
| Brand color         | `color.brand.primary` (blue)                    | hover → one shade darker (基础色阶-06 → 05) | Links that represent brand actions, CTAs within text |
| Neutral (secondary) | `color.text.secondary`                          | hover → `color.text.primary` (升一档)       | De-emphasized links, secondary navigation            |
| Underline variant   | Same as above + underline decoration            | Same + underline persists                   | Legal text, policy links, disclaimers                |
| Custom color        | Any defined color token (e.g. red for "delete") | hover → adjust per color system             | Special semantic use cases (danger, warning, etc.)   |

### Hover Color Logic

```
if link_color == primary_level_color (e.g. brand primary, 基础色阶-06):
    hover → one shade darker (降一档, e.g. 基础色阶-05)
    (If the color does not exist in the scale, the link token is invalid and must be corrected before rendering.)

if link_color == secondary_level_color (e.g. color.text.secondary):
    hover → one shade lighter / more prominent (升一档, e.g. color.text.primary)
```

### Decision Logic

```
if context == inline_body_text AND navigation:
    use Default type + Default color (text.primary)

if context == legal_disclaimer OR policy_reference:
    use Default type + Brand color + Underline ON

if context == call_to_action_in_notification_bar:
    use Emphasis type + Brand color + Right arrow icon

if context == external_url_reference:
    use Default type + Brand color + Left chain icon OR Right external icon

if context == danger_action (e.g. "delete"):
    use Custom color (red) — but prefer Button for destructive actions
```

---

## 6. Content Guidelines

### Link Label

- MUST be descriptive — the link text alone should convey the destination or action
- MUST NOT use generic labels like "Click here" or "Read more" without surrounding context
- SHOULD keep link text concise — typically 1–5 words for inline links
- Longer link text is acceptable for article titles or news headlines (with text truncation via ellipsis)

### Icons

- Left Icon: commonly used for link-type indicators (e.g. chain icon `🔗` for external links)
- Right Icon: commonly used for navigation direction (e.g. right arrow `>` for "see more")
- MUST NOT use decorative icons that do not add meaning

### Underline

- Default: OFF
- Turn ON when the link appears in legal / policy / disclaimer contexts
- Turn ON when the link appears in body text and needs extra visual distinction from surrounding copy

---

## 7. Layout & Composition

### Inline Usage

- Link is an inline element — it flows within text and does NOT break to a new line by itself
- When used within a paragraph, Link inherits the surrounding text's font size and line height
- Link MUST maintain sufficient contrast against surrounding non-link text (via color difference)

### Notification Bar

- Link with right arrow icon sits at the end of the notification message
- Notification bar: full-width, left-aligned message text + right-aligned or inline Link

### Standalone Usage (e.g. below a form or CTA)

- When Link appears below a Button or form, it is typically center-aligned with the content block
- Example: `By continuing, you agree to Ainvest's Third-Party Brokerage Disclaimer and Privacy Policy`

### External Link in Article / News

- Link appears at the end of the content block
- Text is bold + external icon (↗) to indicate it opens an external site
- Example: `Harris Catches Up to Trump in Poll Surge as Bid... ↗`

### Spacing

- Follow `ainvest-design-system/references/spacing.md` for gap between icon and label
- Icon-to-label gap: typically `spacing.gap1` (4px)

---

## 8. Behavior

### Color States

| Element                      | State           | Token                                               |
| ---------------------------- | --------------- | --------------------------------------------------- |
| Default color link           | Default         | `color.text.primary`                                |
| Default color link           | Hover           | `color.text.secondary`                              |
| Brand color link             | Default         | `color.brand.primary` (基础色阶-06)                 |
| Brand color link             | Hover           | One shade darker (基础色阶-05)                      |
| Neutral color link           | Default         | `color.text.secondary`                              |
| Neutral color link           | Hover           | `color.text.primary` (升一档)                       |
| Custom color link (e.g. red) | Default         | Custom token (e.g. `color.status.error`)            |
| Custom color link            | Hover           | Adjusted per color scale                            |
| Underline                    | Default / Hover | Same color as the link text; persists across states |

### Click Behavior

- Clicking a Link MUST navigate to the target page or URL
- Internal links: navigate within the same tab (same-window)
- External links: SHOULD open in a new tab (`target="_blank"`) with `rel="noopener noreferrer"`
- Links within legal / policy text MAY open in a new tab or modal depending on context

### Keyboard Behavior

- Link MUST be focusable via Tab key
- Enter on a focused Link MUST trigger navigation
- Focus state MUST be visually indicated (browser default outline or custom focus ring)

---

## 9. Platform Differences

### Web & App — Unified Style

- Link shares the **same visual style across Web and Mobile** — no platform-specific variants
- All slot/prop configurations (label, left icon, right icon, underline) work identically on both platforms
- Page width >= 480px and < 480px may affect surrounding layout but NOT the Link component itself

### Context-Specific Layout

| Context                        | Width >= 480px                     | Width < 480px                                            |
| ------------------------------ | ---------------------------------- | -------------------------------------------------------- |
| Notification bar               | Full-width bar; Link inline at end | Multi-line text; Link wraps to next line or stays inline |
| Internal link (legal / policy) | Underline text below CTA           | Same — underline text below CTA                          |
| External link (news article)   | Bold text + external icon (↗)     | Same                                                     |
| Personal center links          | /                                  | /                                                        |

---

## 10. Do / Don't

|       | Practice                                                    | Reason                                                                           |
| ----- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| DO    | Use descriptive link text ("View Privacy Policy")           | Users and screen readers understand the destination                              |
| DO    | Use underline for legal / policy links                      | Reinforces clickability in text-heavy contexts                                   |
| DO    | Use brand color for important inline CTAs                   | Draws attention without using a full Button                                      |
| DO    | Use right arrow (`>`) for "see more" / navigation links     | Indicates direction and action                                                   |
| DO    | Open external links in a new tab                            | Prevents users from losing their current page                                    |
| DON'T | Use "Click here" as link text                               | Non-descriptive; bad for accessibility                                           |
| DON'T | Use Link for primary page actions                           | Use Button — Link is for navigation, not actions                                 |
| DON'T | Use both left and right icons simultaneously without reason | Visual clutter; pick the one that adds the most meaning                          |
| DON'T | Style Link to look like a Button                            | Confuses the component's semantic role                                           |
| DON'T | Use Link for destructive actions (delete, remove)           | Use Button with danger styling instead                                           |
| DON'T | Mix link colors arbitrarily                                 | Follow the color variant system — default, brand, neutral, or custom with intent |

---

## 11. Decision Table

| Context                            | Type     | Color                    | Left Icon  | Right Icon    | Underline | Example                              |
| ---------------------------------- | -------- | ------------------------ | ---------- | ------------- | --------- | ------------------------------------ |
| Inline body text navigation        | Default  | Default (text.primary)   | —          | —             | OFF       | "Learn more about our features"      |
| Legal / policy disclaimer          | Default  | Brand (blue)             | —          | —             | ON        | "Privacy Policy", "Terms of Service" |
| Notification bar CTA               | Emphasis | Brand (blue)             | —          | `>` arrow     | OFF       | "To Action >"                        |
| External news source link          | Emphasis | Brand (blue)             | —          | `↗` external | OFF       | "Harris Catches Up to Trump... ↗"   |
| Source attribution with chain icon | Default  | Brand (blue)             | `🔗` chain | —             | OFF       | "🔗 Facebook.com...and 5 more links" |
| "See more" / list navigation       | Default  | Default / Brand          | —          | `>` arrow     | OFF       | "Link Label >"                       |
| Danger / delete action in text     | Default  | Custom (red)             | —          | —             | OFF       | "delete" (prefer Button if possible) |
| Neutral secondary link             | Default  | Neutral (text.secondary) | —          | —             | OFF       | De-emphasized supporting links       |

---

## 12. Related Documents

- `ainvest-design-system/references/components/link.md`
- `ainvest-design-system/references/components/Breadcrumb.md`
- `ainvest-design-system/SKILL.md`
- `ainvest-design-system/references/tokens/color.md`
- `ainvest-design-system/references/tokens/typography.md`
- `ainvest-design-system/references/tokens/spacing.md`
