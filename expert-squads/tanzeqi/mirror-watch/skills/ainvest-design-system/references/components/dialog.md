# Guidelines — Dialog (弹窗 / Modal Dialog)

## 0. Document Role

This document covers **when and how to use** the Dialog component. Visual details (spacing, typography, border-radius, scroll behavior, text alignment) are handled automatically by the component — this doc focuses on decisions a developer or AI must make explicitly.

<!-- - Component import: `@ainvest/dialog`,`@ainvest/marketing-dialog` -->

---

## 1. Definition

A **Dialog** is a modal window that blocks all background interaction until dismissed. Use it only for content or actions that require the user's immediate attention.

---

## 2. When to Use

Use a Dialog when **all** of the following are true:

- The user must acknowledge or act before continuing.
- The content is critical, time-sensitive, or involves an irreversible action (e.g., confirm deletion, payment, permission request).
- The message cannot be handled by a non-modal pattern (Toast, inline error, Banner).
- No more than **3 action buttons** are needed.

---

## 3. When NOT to Use

| Situation | Use Instead |
|---|---|
| Simple status feedback that needs no action | Toast |
| Large forms or multi-step flows | Drawer (底部弹窗) or a new page |
| Passive informational notices | Banner / Notification |

> If the user does not *need* to respond right now, do not use a Dialog.

---

## 4. Anatomy

### Required
- **`DialogBody` + `DialogText`** — content body is always required.
- **At least one button in `DialogFooter`** — always required.

### Optional
- **`DialogHeader` + `DialogTitle`** — add when body text exceeds 3 lines, or for Marketing Dialogs. The close icon is hidden by default on `variant="app"`.
- **Secondary / Tertiary buttons** — add based on action hierarchy (see §5).
- **Image area** — Marketing Dialog only, placed above title and content.

---

## 5. Variants & Configuration

### `variant` — Choose Platform Style

| Value | When to Use |
|---|---|
| `"web"` (default) | Desktop/web — includes close (×) button, supports `size` and `fullscreen` props |
| `"app"` | Mobile — centered layout, no close button, full-width buttons |

### `size` — Web Only

| Value | Width | When to Use |
|---|---|---|
| `"sm"` | `420px` | Short confirmations, simple yes/no, rename inputs |
| `"md"` (default) | `630px` | Most standard dialogs |
| `"lg"` | `850px` | Rich content: long text, option lists, dual-column layouts |

### `fullscreen` — Web Only

| Value | Behavior |
|---|---|
| `"never"` (default) | Always a centered floating card. Width follows the responsive formula in §5.1. |
| `"sm"` | Centered card on large screens → **full-screen on small screens (≤ 500px)**. The §5.1 width formula is **bypassed** when fullscreen is active (≤ 500px). |

Use `fullscreen="sm"` for **functional dialogs** that require sustained interaction (e.g., Add Symbol, Add Indicators, Settings). Do **not** use for simple text confirmations or marketing dialogs.

---

## 5.1 Responsive Width Rule (Web)

A standard Web Dialog **MUST always remain a centered floating card** at every viewport width. It MUST NOT auto-degrade to a Bottom Sheet — Bottom Sheet (`drawer.md`) is a separate component and must be chosen explicitly by the developer.

> **Exceptions to this rule:**
> - `fullscreen="sm"` at viewport ≤ 500px → full-screen (see §5 fullscreen table)
> - **Marketing Dialog** at viewport ≤ 500px → bottom-sheet form (see §5.2)
>
> All other dialog scenarios (Simple Confirmation, Standard, Destructive, Trading, Rename, etc.) follow the centered-card formula below at every viewport.

### Content-area side margin (viewport-bound)

| Viewport width | Side margin (each side) |
|---|---|
| ≥ 1440px | `40px` |
| 500px – 1440px | `24px` |
| < 500px | `16px` |

### Width formula

```
available_width = viewport_width − 2 × side_margin
dialog_width    = min(size_default_width, available_width)
```

Where `size_default_width` = `420px` (sm) / `630px` (md) / `850px` (lg).

The dialog uses its `size` default width whenever the viewport is wide enough to fit it plus the side margins. As the viewport shrinks past that threshold, the dialog width contracts to `100vw − 2 × side_margin`, keeping the side margins fixed.

### Worked examples

| Viewport | size | Margin | Default fits? | Final width |
|---|---|---|---|---|
| 1560px | `md` | 40px | 630 + 80 ≤ 1560 → yes | `630px` |
| 1200px | `md` | 24px | 630 + 48 ≤ 1200 → yes | `630px` |
| 600px | `md` | 24px | 630 + 48 > 600 → no | `552px` (`100vw − 48px`) |
| 375px | `sm` | 16px | 420 + 32 > 375 → no | `343px` (`100vw − 32px`) |
| 375px | `lg` | 16px | 850 + 32 > 375 → no | `343px` (`100vw − 32px`) |

### MUST

- MUST keep the dialog centered at every viewport — no docking to bottom, no full-bleed
- MUST follow the side-margin table above; do not introduce other margin values
- MUST contract the dialog width when the viewport is narrower than `size_default_width + 2 × side_margin`
- MUST keep all internal typography, spacing, padding, and footer button height identical across viewports — only the outer dialog width changes

### MUST NOT

- MUST NOT switch to a Bottom Sheet style on ≤ 500px (that is `drawer.md` territory and requires explicit developer opt-in)
- MUST NOT add custom side margins (e.g., 12px, 20px, 32px) outside the table
- MUST NOT shrink internal padding / font size / button height to "fit" — only the outer width adapts

### Exception — `fullscreen="sm"`

When `fullscreen="sm"` is set AND viewport ≤ 500px, the dialog becomes full-screen (`100vw × 100vh`, `border-radius: 0`). The §5.1 width formula does not apply in that case.

---

## 5.2 Marketing Dialog Responsive Rule (Web)

Marketing Dialog is the **only** Dialog scenario that auto-switches form based on viewport. This exception exists because marketing content is image-heavy and benefits from the full-width bottom-sheet canvas on mobile.

### Responsive behavior

| Viewport | Form | Notes |
|---|---|---|
| > 500px | Centered card (Dialog form) | 16:9 image on top, content below; follows §5.1 width formula |
| ≤ 500px | **Bottom sheet form** (docked to bottom) | Full-width; see rules below |

### ≤ 500px — Bottom Sheet Form Rules

| Aspect | Rule |
|---|---|
| Docking | Dock to viewport bottom (`align-items: flex-end`); no side margin |
| Width | `100vw` (full-bleed horizontally) |
| Border radius | `24px` top-left + top-right; `0` bottom-left + bottom-right |
| Image | 16:9 image stays on top, spans full width, scales proportionally |
| Close button | Right-top `×`, same token as Dialog close |
| Height | Content-driven; no minimum height (per `drawer.md §8`); max ≈ `90vh` |
| Footer buttons | MUST use `lg` (44px) — same as Dialog rule §8 |
| Footer button layout | **Horizontal, equal-width (`flex: 1`)** — this is Bottom Sheet territory, the Web "no stretch" rule (§8) does NOT apply here |
| Content padding | Header/body/footer horizontal padding stays `24px` (unchanged from Dialog form) |

### MUST

- MUST dock to bottom edge at ≤ 500px — do not keep it centered
- MUST stretch horizontal footer buttons with `flex: 1` in bottom-sheet form (App-equivalent pattern)
- MUST keep the 16:9 image aspect ratio; scale proportionally to fill full width
- MUST preserve internal typography and token values — only the outer shell form changes

### MUST NOT

- MUST NOT apply the §5.1 side-margin formula in bottom-sheet form — margins are `0` on the left/right edges
- MUST NOT add bottom border radius — bottom corners stay square to meet the viewport edge
- MUST NOT shrink internal typography (dialog-internal rules continue to apply)
- MUST NOT apply this exception to non-marketing dialogs — Simple/Standard/Destructive/Trading/Functional dialogs stay centered per §5.1

### Decision flow

```
Is this a Marketing Dialog?
├─ No  → §5.1 centered-card formula at every viewport (except fullscreen="sm")
└─ Yes
   ├─ Viewport > 500px → centered card (Dialog form) — §5.1 width formula
   └─ Viewport ≤ 500px → bottom sheet form — rules above
```

### `preventInteractOutside` — on `DialogContent`

Set to `true` when the user **must not** dismiss the dialog by clicking the overlay (e.g., mid-transaction flow, mandatory onboarding step). Defaults to `false`.

---

## 6. Content Guidelines

### Title (`DialogTitle`)
- **Required** when body text exceeds 3 lines.
- **Required** in all Marketing Dialogs.
- Otherwise optional. Keep to a short noun phrase or clear imperative.

### Body Text (`DialogText`)
- Keep copy concise — users are interrupted.
- Do not use bullet lists or sub-headings inside the dialog body.
- Text alignment (center ↔ left) adjusts automatically based on line count — no implementation needed.

### Button Labels
- Use clear action verbs: "Confirm", "Cancel", "Delete", "Learn More".
- Avoid vague labels like "OK" or "Yes" for destructive or irreversible actions.
- The primary button label should reinforce the dialog's core intent.

### Image (Marketing Dialog only)
- Recommended aspect ratio: `16:9` (adjustable per scene).
- Do not add images to standard dialogs.
- **Web marketing dialog:** image appears on the **top**, content on the below.
- **App marketing dialog:** image appears at the **top**, content below.

### Marketing Dialog Content Limits (App)
- Title: max 2 lines, ≤ 45 characters.
- Body: max 3 lines, ≤ 50 characters.

---

## 7. Layout & Composition

The component handles all spacing, sizing, and responsive layout automatically. The only layout decisions left to the implementer are:

- **Web:** Which `size` preset to use (`sm` / `md` / `lg`).
- **Web:** Whether to enable `fullscreen="sm"` for functional dialogs.
- **Button arrangement in `DialogFooter`:** horizontal (default) or vertical. See §8.

---

## 8. Behavior

### Closing
- **Web standard dialog:** dismissed via × button, ESC key, or overlay click (unless `preventInteractOutside` is set).
- **App standard dialog:** dismissed only via a button tap — no close icon, no overlay dismiss.
- **Marketing dialog (both platforms):** always has a × close button.

### Scrollable Content
Handled automatically. When content exceeds max height, `DialogBody` scrolls internally while `DialogFooter` stays sticky.

### Button Size (MANDATORY)

**Footer buttons in a Dialog MUST use `lg` size (44px height / 16px Semibold / 20px gap / 1.5px stroke) on BOTH Web and App.**

- MUST NOT use `base` (36px), `sm` (28px), or `xs` (24px) for dialog footer buttons
- Applies to all variants (`web` / `app`), all sizes (`sm` / `md` / `lg`), and all button types (Primary / Secondary / Danger / Ghost / Brand)
- Rationale: 44px is the minimum comfortable touch target and provides the visual weight required for a modal action

### Button Layout in `DialogFooter`

Button layout is not auto-managed — the implementer chooses:

#### Web (`variant="web"`)

| Layout | When to Use | Implementation |
|---|---|---|
| Horizontal, right-aligned (default) | 2 buttons with short labels | `DialogFooter` right-aligned; buttons keep their natural width (`min-width: 80px`) |
| Vertical stack | 2–3 buttons, or labels too long for side-by-side | `<DialogFooter className="flex-col gap-2">`, buttons full-width |
| Single full-width | 1 primary action only | `<Button className="w-full">` |

**Web horizontal layout — MUST NOT:**

- MUST NOT apply `flex: 1` / equal-width stretching to horizontal footer buttons
- MUST NOT make buttons span the full dialog width on Web — they anchor to the bottom-right corner with a gap between them
- Equal-width stretched buttons are an **App-only** pattern (see below)

#### App (`variant="app"`)

| Layout | When to Use | Implementation |
|---|---|---|
| Horizontal, equal-width | 2 buttons with short labels | Each button `flex: 1`, footer spans full dialog width |
| Vertical stack | 2–3 buttons, or labels too long | `flex-col gap-2`, buttons full-width |
| Single full-width | 1 primary action only | Button `w-full` |

**Button hierarchy rule:** primary (filled) button goes **last** (rightmost) in horizontal layout, **first** (topmost) in vertical layout.

---

## 9. Platform Differences

| Aspect | App (`variant="app"`) | Web (`variant="web"`) |
|---|---|---|
| Close button | None by default | Always shown (×), top-right |
| Dismiss on overlay click | No | Yes (unless `preventInteractOutside`) |
| Size control | Not applicable | `size="sm/md/lg"` |
| Full-screen mode | Not applicable | `fullscreen="sm"` |
| Button width | Full-width by default | Side-by-side by default |
| Image position (marketing) | Top of card | Top of card |

---

## 10. Do / Don't

| ✅ Do | ❌ Don't | Reason |
|---|---|---|
| Use Dialog only when the user must act immediately | Use for passive notifications or status feedback | Dialogs interrupt — overuse erodes trust |
| Add `DialogTitle` when body text exceeds 3 lines | Leave long text without a title | Long text without a title has no visual anchor |
| Use Marketing Dialog variant for promotions | Add images to standard dialogs | Images dilute urgency in standard dialogs |
| Use `16:9` image ratio in Marketing Dialogs | Use arbitrary image ratios | Inconsistent ratios break the layout |
| Use clear action verbs on buttons | Use "OK" / "Yes" for destructive actions | Vague labels increase error rates |
| Use `fullscreen="sm"` for functional/operation dialogs | Use `fullscreen="sm"` for simple confirmations or marketing dialogs | Full-screen is for sustained interaction, not brief prompts |
| Set `preventInteractOutside` only for mandatory flows | Apply it broadly as a default | Unnecessarily trapping users creates frustration |
| Limit to a maximum of 3 buttons | Add 4 or more buttons | More than 3 actions belong in an Action Sheet or new page |
| Place primary button last (horizontal) or first (vertical) | Mix button order between layouts | Inconsistent placement breaks user muscle memory |
| Use `lg` (44px) for all dialog footer buttons on both Web and App | Use `base` / `sm` / `xs` for dialog footer buttons | Smaller sizes break the touch-target floor and weaken the modal action's visual weight |
| Anchor Web horizontal footer buttons to the bottom-right corner | Stretch Web horizontal buttons with `flex: 1` so they span the full dialog width | Equal-width stretched buttons are an App-only pattern; on Web they violate the right-aligned anchor convention |
| Keep Web Dialog as a centered floating card at every viewport | Auto-degrade Web Dialog to a Bottom Sheet on ≤ 500px | Bottom Sheet is the `drawer.md` component and requires explicit developer opt-in |
| Switch Marketing Dialog to bottom-sheet form at ≤ 500px (per §5.2) | Keep Marketing Dialog as a centered card at ≤ 500px | Marketing content is image-heavy and benefits from the full-width bottom canvas on mobile |

---

## 11. Decision Table

### App (`variant="app"`)

| Scenario | Title | Buttons | Notes |
|---|---|---|---|
| Confirm irreversible action | Optional | 1 primary (full-width) | `showCloseIcon={false}` on `DialogHeader` |
| Main action + one alternative | Optional | 2 horizontal | |
| Button labels too long for horizontal | Optional | 2 vertical | `DialogFooter className="flex-col gap-2"` |
| Main action + 2 lower-priority alternatives | Optional | 3 vertical (filled → outlined → ghost) | |
| Body text > 3 lines | **Required** | Any config above | Component handles left-align automatically |
| Promotional / reward / campaign | **Required** | Primary (+ optional secondary) | Marketing Dialog; image required (16:9) |
| Simple status feedback | ❌ | — | Use Toast instead |
| Selectable option list | ❌ | — | Use Action Sheet instead |

### Web (`variant="web"`)

| Scenario | Size | `fullscreen` | Notes |
|---|---|---|---|
| Simple confirmation / destructive action | `sm` | `"never"` | |
| Text input (rename, entry) | `sm` | `"never"` | |
| Standard confirmation with more content | `md` | `"never"` | |
| Single-column functional list (e.g., Add Symbol) | `lg` | `"sm"` | Full-screen on mobile |
| Dual-column operation (e.g., Add Indicators) | `lg` | `"sm"` | Dual-col auto-collapses; full-screen on mobile |
| Multi-panel / settings-style dialog | `lg` | `"sm"` | Full-screen on mobile |
| Campaign / news / editorial promotion | `md` | `"never"` | Image on top, content below |
| Reward / gift / immersive brand promotion | Pure Marketing Dialog | `"never"` | Full branded card |

---

## 12. Related Documents

- `ainvest-design-system/references/components/drawer.md`
- `ainvest-design-system/references/components/toast.md`
- `ainvest-design-system/SKILL.md`
