---
type: web-interactions
last-updated: 2026-06-25
scope: web-only
canonical: ./DESIGN.md (tokens), this file (behaviors)
tech-stack:
  - Radix UI primitives (Dropdown, Popover, Toast, Accordion, Tabs, Dialog)
  - Vaul (bottom sheet / drawer — mobile-friendly, snap-point-aware)
  - tailwindcss-animate (enter/exit, fade, accordion, spin, pulse)
  - Sonner (toast notifications)
  - Embla Carousel (news card horizontal carousel)
  - Hightouch Charts (hkv-* — K-line, indicators, chart toolbar)
  - Termly (cookie consent management)
  - CSS transitions with cubic-bezier easings
  - Module Federation (#module-federation scope for micro-frontend CSS isolation)
---

# Web Interaction Patterns — ainvest.com

> **Scope:** Web site only (ainvest.com). Mobile app interactions are out of scope.
> **Relationship to DESIGN.md:** DESIGN.md defines the *tokens* (colors, spacing, shadows). This file defines the *behaviors* — how components respond to user input (hover, click, focus, scroll, transitions, loading, error states).
> **Source:** Interaction data extracted via Playwright on 2026-06-25. Screenshots stored in `/tmp/opencode/ainvest-interactions/`.

---

## 0. Tech Stack & Animation Foundation

| Libraries | Purpose | Key classes/keyframes |
|---------|---------|----------------------|
| **Radix UI** | Headless accessible primitives | `data-[state=open]:animate-in`, `data-[state=closed]:animate-out` |
| **Vaul** | Mobile-friendly bottom sheet drawer | `[data-vaul-drawer]`, `[data-vaul-handle]`, snap points, slideFromBottom/slideToBottom |
| **tailwindcss-animate** | Tailwind animation plugin | `animate-in`, `animate-out`, `fade-in-0`, `fade-out-0`, `zoom-in-95`, `slide-in-from-*` |
| **Sonner** | Toast notifications | `sonner-fade-in`, `sonner-fade-out`, `sonner-spin`, `sonner-loader` |
| **Embla Carousel** | Carousel/slider (news card scroll) | CSS-based transitions, "Scroll right" arrow button |
| **Highcharts** (`hkv-*`) | Charting library (K-line, indicators) | `hkv-select-trigger`, `hkv-dropdown`, `hkv-btn`, `hkv-draw-line-toolbar` |
| **Termly** | Cookie consent | `termly-styles-root-*`, `termly-styles-buttons-*` |
| **Module Federation** | Micro-frontend CSS isolation | `#module-federation` scope, `.mf-scope` scope |

### Master animation keyframes

| Keyframe | Duration | Easing | Purpose |
|----------|----------|--------|---------|
| `enter` | 150ms | default | Radix enter animation (opacity + transform) |
| `exit` | 150ms | default | Radix exit animation |
| `accordion-up` | 200ms | ease-out | Collapsing accordion content |
| `accordion-down` | 200ms | ease-out | Expanding accordion content |
| `fade-in-0` / `fade-out-0` | 150ms | default | Backdrop fade |
| `zoom-in-95` | 150ms | default | Modal/dialog scale-in |
| `slide-in-from-top-*` | 150ms | default | Dropdown slide-in from top |
| `slide-in-from-bottom-*` | 150ms | default | Toast slide-in from bottom |
| `spin` | 1s | linear | Loading spinner (continuous) |
| `pulse` | 2s | cubic-bezier(0.4,0,0.6,1) | Skeleton pulse |
| `spinner-leaf-fade` | 0.8s | linear | Multi-leaf spinner |
| `scroll` | 8–35s | linear | Marquee/ticker scroll |
| `loading-primary` | 1.5s | linear | Progress bar (continuous) |
| `loading-circle` | 1s | linear | Circular progress indicator |
| `dot-flashing` | variable | — | 3-dot staggered opacity |
| `sonner-fade-in` / `sonner-fade-out` | 300ms | ease | Toast enter/exit |
| `sonner-spin` | — | — | Sonner loader inside toast |
| `homeNavMarquee` | variable | linear | Nav promo badge text rotation |
| `fadeIn` / `fadeOut` | 500ms | cubic-bezier(0.32, 0.72, 0, 1) | Vaul drawer overlay |
| `slideFromBottom` / `slideToBottom` | 500ms | cubic-bezier(0.32, 0.72, 0, 1) | Vaul drawer enter/exit |
| `slideFromTop` / `slideToTop` | 500ms | cubic-bezier(0.32, 0.72, 0, 1) | Vaul drawer (top direction) |
| `slideFromLeft` / `slideToLeft` | 500ms | cubic-bezier(0.32, 0.72, 0, 1) | Vaul drawer (left direction) |
| `slideFromRight` / `slideToRight` | 500ms | cubic-bezier(0.32, 0.72, 0, 1) | Vaul drawer (right direction) |
| `termly-styles-module-rotate-f68cf1` | 2s | linear | Cookie consent loading |
| `termly-styles-module-dash-e05a10` | 1.5s | ease-in-out | Cookie consent loading |

### Master transition durations

| Duration | Use case |
|----------|----------|
| `0.01s` | Near-instant (used for `top` property to avoid layout shift) |
| `0.1s` | Micro-interactions (chip toggle, small state changes) |
| `0.15s` | **Default** — hover, focus, button press, tab switch, input border |
| `0.2s` | Accordion expand/collapse, toast slide |
| `0.25s` | Card hover (subtle) |
| `0.3s` | Image opacity transitions, card content fade |
| `0.4s` | Section-level transitions |
| `0.5s` | Dropdown arrow rotate (back-out easing) |
| `1s` | Loading spinner (linear) |

### Master easing curves

| Curve | Name | Use case |
|-------|------|----------|
| `cubic-bezier(0.4, 0, 0.2, 1)` | **Standard ease** (Material) | **Default** for all UI transitions |
| `cubic-bezier(0.175, 0.885, 0.32, 1.275)` | **Back-out** (slight overshoot) | Dropdown arrow rotate |
| `cubic-bezier(0.32, 0.72, 0, 1)` | Ease-out (smooth) | Hightouch chart elements + Vaul drawer |
| `cubic-bezier(0, 0, 0.2, 1)` | Ease-out (decelerate) | Content reveal |
| `cubic-bezier(0.645, 0.045, 0.355, 1)` | Ease-in-out | Hightouch chart elements |
| `cubic-bezier(0.34, 0.69, 0.1, 1)` | Custom ease | Hightouch chart elements |
| `ease` | CSS default | Fallback |
| `linear` | Constant speed | Spinner, marquee, progress bars |

---

## 1. Interaction Inventory

### 1.1 Navigation Bar (sticky top)

**Trigger:** Always visible, fixed at top (`position: fixed`, `z-index: 50`+).
**Height:** 54px (`--atom-spacing-navbar`).

| Element | Selector / class | Default style | Hover style | Active/pressed | Focus | Click behavior |
|---------|-----------------|---------------|-------------|-----------------|-------|----------------|
| **Logo** | `<img alt="logo">` | Static | Opacity 0.8 | — | Ring | Navigate to `/` |
| **Nav link** (Aime, AI Charts, etc.) | `link` child of `generic` with `padding: 6px 12px; border-radius: 60px` | `bg: transparent` | `bg: rgba(255,255,255,0.2)` (pill bg) | `bg: rgba(255,255,255,0.2)` (same as hover, white text) | Ring | Navigate to page |
| **Active nav link** | `link` on current page | **Filled black pill** with white text | Same | Same | Ring | — |
| **Promo badge** (right) | `bg-gradient-to-br from-[#001b4e] to-[#0020df]` | Gradient pill, auto-rotating text | `linear-gradient(140deg,#013AA6,#014AE1)` | — | — | Navigate to promo |
| **Log In button** | `button` with `border: 2px solid white` | Dark bg, white text, 32px radius | Border contrast shift | `bg: button-brand-press` | Ring | Open login modal |
| **Download button** | `<a>` with icon | White outline | Fill shift | — | Ring | Navigate to `/download/` |
| **User icon** | `<button>` with avatar | Outlined | Fill shift | — | Ring | Open account menu |

**Transition spec:** `transition: color, background-color, border-color, text-decoration-color, fill, stroke; duration: 0.15s; default easing` (per computed style on `Log In`).

**Promo badge marquee animation:** The promo badge text auto-rotates via `homeNavMarquee` keyframe. The text is clipped via `overflow: hidden` on the container, and the inner text scrolls horizontally.

### 1.2 Search Modal (Command Palette style)

**Trigger:** Click magnifier icon in nav bar, or `/` keyboard shortcut (implied).
**Type:** Centered modal with `background-mask-level2` (60% black) backdrop.

| Element | Behavior |
|---------|----------|
| **Backdrop** | Fade-in 150ms (`fade-in-0`). Click to close. |
| **Modal container** | `border-radius: 24px`, `animation: 0.15s enter` (scale + opacity). `box-shadow: 0 8px 32px rgba(0,0,0,0.2)`. |
| **Search input** | `font-size: 16px`, `caret-color: brand-primary`, transparent bg, no border. Placeholder: "Search for symbols, news or questions". |
| **Quick links** (AI Screener, Option Discovery, etc.) | 2×3 grid of icon+label links. Click navigates. |
| **Tablist** (All Symbols / Stocks / ETFs / Cryptos) | Radix Tabs. Active tab: white underline `::after` pseudo-element (`height: 3px`, `position: absolute`, `bottom: 0`). |
| **Result rows** | Click navigates to asset detail. Hover: `bg-foreground-layer1_2`. |
| **Star toggle** (watchlist) | Click toggles state. No animation specified (instant). |
| **Close** | `×` button top-right + Escape key + backdrop click. |

**Animation:** `animation: 0.15s enter` on the modal (Radix enter keyframe — opacity 0→1, scale 0.95→1, translateY →0).

### 1.3 Login / Signup Modal

**Trigger:** Click `Log In` button in nav bar.
**Type:** Large centered modal (1164×672px), `border-radius: 24px`.

| Element | Style spec |
|---------|-----------|
| **Backdrop** | `bg: background-mask-level2` (60% black), `z-index: 100`, `animation: 0.15s enter` |
| **Modal** | `bg: background-nav-dark` (#171717), `border-radius: 24px`, `box-shadow: 0 8px 32px rgba(0,0,0,0.2)`, `animation: 0.15s enter`, `transition: 0.2s` |
| **Left panel** | Brand illustration (Aime robot) |
| **Right panel** | Form area |
| **Title** | "Let's get started!" (signup) ↔ "Log in to AInvest" (login) — toggles via `Log in` button at bottom |
| **Google button** | White bg, Google logo, full-width. Marked with "Recent" label (first option). |
| **Apple / Facebook buttons** | Dark bg, white icon, 2-column grid below Google. |
| **`or` divider** | Thin grey line with "or" text in center. |
| **Email input** | Container: `bg: foreground-layer1` (#171717), `border: 1px solid border-level2` (rgba(255,255,255,0.12)), `border-radius: 10px`, `height: 54px`. Inner input: transparent, `font-size: 16px`, `padding: 0 16px`. |
| **"Sign up with Phone" / "Log in with Phone"** | Toggle link next to "Email" label. Click switches input mode (phone number format). |
| **Verification Code input** | Same container style as Email. |
| **"Send code" button** | Right-aligned inside verification code container. Click triggers code send. |
| **`Log in with Password`** | Toggle link below verification code (login mode only). Click reveals password field. |
| **Submit button** (`Log in` / `Sign up`) | `disabled` state by default (greyed). Enabled when form is valid. |
| **QR Code section** | Right side of modal. "Login with QR Code" label + "How to scan" help link. |
| **Close button** | `×` icon, top-right, 24×24px. Hover: opacity shift. |

**Mode toggle animation:** When clicking the "Log in" / "Sign up" link at the bottom, the form switches mode. The title text changes and additional fields (password) appear. No explicit slide animation observed — content swaps in place.

### 1.4 Buttons (all variants)

| Variant | Default | Hover | Press/active | Disabled |
|---------|---------|-------|-------------|----------|
| **Primary (brand)** | `bg: button-brand-default` (#165DFF), white text, pill (50%) | `bg: button-brand-press` (#1454E5) | Slightly darker | `bg: button-brand-disabled` (30% opacity) |
| **Default (black)** | `bg: button-black-default` (#000), white text | `opacity: 0.85` | Same | `bg: button-black-disabled` (5% opacity) |
| **Secondary (grey)** | `bg: button-grey-default` (5% black), primary text | `bg: button-grey-press` (15% black) | Same | `bg: button-grey-disabled` |
| **Text** | Transparent, primary text | `bg: hover-5` | `bg: click` | — |
| **Link** | Transparent, link-color text | Underline appears | — | — |
| **Outline** | `border: 1px border-bt`, transparent bg | `bg: hover-5`, `border: transparent` | — | — |
| **Toggle button** (Monthly/Yearly) | `bg: button-black-default` (active) / `bg: transparent` (inactive) | `bg: background-weak` (inactive) | — | — |

**Computed transition (toggle button):** `transition: 0.15s cubic-bezier(0.4, 0, 0.2, 1)`.
**Computed transition (Log In):** `transition: color 0.15s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.15s cubic-bezier(0.4, 0, 0.6, 1)`.

**Sizes:** `xs` (24px), `sm` (28px), `base` (36px), `lg` (44px). All pill-shaped (`border-radius: 50%` / `9999px`).

### 1.5 Cards

| Card type | Default | Hover | Press/active |
|-----------|---------|-------|---------------|
| **News card** (`.hoverCard`) | Transparent bg, no shadow | `::after` pseudo-element expands 12px beyond card bounds, `bg: background-weak`. Dark mode: `opacity: 0.4`. | — |
| **KB card** (`.kb-resource-card`) | `bg: transparent-blue` (10% brand blue), `border-radius: 16px`, `padding: 20px 24px` | `bg: transparent-blue1` (15% brand blue) | — |
| **KB card arrow button** (32×32 circle) | `border: 2px solid text-primary`, transparent bg | `bg: text-primary`, `color: background-layer1` (inverts). `transition: 0.15s cubic-bezier(0.4, 0, 0.2, 1)`. | — |
| **Watchlist summary card** | `bg: #F2F2F2`, `border: 1px solid #F2F2F2`, `border-radius: 10px`, `box-shadow: 0 1px 2px rgba(0,0,0,0.05)` | `bg: foreground-layer1_2`, `border: foreground-layer1_2` | — |
| **Prediction market card** | `bg: foreground-layer1`, `border: 1px solid divider-level2`, `border-radius: 16px` | `bg: var(--atom-color-hover-5)`, `transition: color 0.15s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.15s cubic-bezier(0.4, 0, 0.2, 1)` | — |
| **Tier card** (pricing) | Dark bg, rounded, feature list | `transform: translateY(-4px)`, `box-shadow: elevation-large` (subtle lift) | — |

**KB card arrow hover computed:** `transition: 0.15s cubic-bezier(0.4, 0, 0.2, 1)` with `group-hover:bg-text-primary` and `group-hover:text-background-layer1`.

### 1.6 Data Tables (Watchlist)

| Row state | Style |
|-----------|-------|
| **Default** | White/light bg, price-colored text (`price-up` green / `price-down` red) |
| **Hover** | `bg: list-hover` (#F2F2F2 light / #454545 dark) |
| **Active hover** | `bg: list-active-hover` (#E6E6E6 light / #6A6A6A dark) |

**Column sorting:** Click header to sort. Arrow indicator (▲/▼) appears.
**Watchlist star:** Click toggles. No animation specified.
**Horizontal scroll:** Native browser scrollbar, 5px width, `divider-level2` thumb.

### 1.7 Tabs (Prediction Markets category tabs)

| State | Style |
|-------|-------|
| **Default** | `color: rgba(255,255,255,0.75)`, `font-weight: 600`, `font-size: 16px`, `padding: 6px 0 8px` |
| **Hover** | `color: rgba(255,255,255,0.9)` (lighter) |
| **Active (selected)** | `color: rgb(255,255,255)` + `::after` pseudo-element: `position: absolute`, `bottom: 0`, `left: 0`, `width: 100%`, `height: 3px`, `bg: white`, `border-radius: 0` |
| **Transition** | `transition: all` (color/background shifts) |

**Tab switching:** URL updates with `?tab=Sports` query param. Content area replaces with skeleton/loading then new data.

### 1.8 Segmented Controls (Monthly/Yearly toggle)

| State | Style |
|-------|-------|
| **Active** | `bg: button-black-default` (#000), `color: button-black-text-default` (white), `border-radius: 9999px`, `padding: 8px 16px`, `height: 34px`, `font-weight: 600` |
| **Inactive** | `bg: transparent`, `color: text-secondary` (60% opacity), `hover: bg-background-weak` |
| **Transition** | `0.15s cubic-bezier(0.4, 0, 0.2, 1)` |

**Toggle behavior:** The active pill background slides between the two options (visually animated, not a hard cut). All tier card prices update simultaneously.

### 1.9 Dropdowns (Radix DropdownMenu + Hightouch Select)

**Radix DropdownMenu** (e.g., Newswire "Important" filter):
- Trigger: Click to open.
- Animation: `data-[state=open]:animate-in` (slide + fade), `data-[state=closed]:animate-out`.
- Max height: `min(var(--radix-dropdown-menu-content-available-height), 400px)`.
- Close: Click outside, Escape, or select item.

**Hightouch Select** (chart toolbar dropdowns):
- Arrow icon: `transition: transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)` (back-out easing).
- On open: `transform: translateX(4px) rotate(180deg)`.
- Items: `font-size: 12px`, `font-weight: 400`, `color: var(--hkv-text-3)`.

### 1.10 Date Selector (Prediction Markets)

| State | Style |
|-------|-------|
| **Default** | Dark/unfilled pill, light text |
| **Selected/active** | Blue filled pill, white text |
| **Disabled** | `opacity: 0.4`, `cursor: not-allowed` (past dates) |
| **Hover** | `bg: hover-5` |

**Behavior:** Click filters match cards below. Strip is horizontally scrollable.

### 1.11 Probability Bars

| Property | Value |
|----------|-------|
| **Height** | 8px |
| **Border radius** | 4px (pill) |
| **Colors** | Green (underdog) / orange (mid) / red (favorite) |
| **Animation** | Width transitions on load (CSS `transition: width 0.5s ease-out`) |
| **Interaction** | Informational only (not clickable) |

### 1.12 Accordion (FAQ on pricing page, feature lists in tier cards)

**Trigger:** Click header button to expand/collapse.
**Animation:** `animation: 0.2s ease-out accordion-up` (collapse) or `accordion-down` (expand).
**Behavior:** Uses Radix Accordion with `height` animation. Only one item open at a time on pricing FAQ (single mode).

### 1.13 Cookie Consent Banner (Termly)

**Provider:** Termly (`termly-styles-*` CSS prefix).
**Role:** `alertdialog "Cookie Consent Prompt"`.
**Trigger:** First visit (no cookie preference stored).
**Position:** Bottom of viewport (fixed).
**Elements:**
- Description text with "Cookie Policy" and "Preferences" inline links.
- Two buttons: "Preferences" (secondary) and "Accept" (primary).
- No explicit close/dismiss button — must accept or set preferences.
**Compact mode** (mobile, ≤36.5em): Buttons stack vertically (`flex-direction: column-reverse`).
**Animation:** Fade-in on first load, no transition on dismiss.

**Interaction:** Click "Accept" to dismiss. Click "Preferences" to open cookie settings dialog (Radix Dialog).

### 1.14 Right-Side Floating Toolbar

**Position:** `position: fixed; right: 0; bottom: 0; height: 100%` (full-height vertical rail on right edge).
**Items (top to bottom):** Aime assistant, calendar, lightning (quick trade?), chat bubbles, clock/refresh, chart, bell (notifications), help (?).

| Item | Style |
|------|-------|
| **Container** | `32×32px`, `flex items-center justify-center`, `cursor: pointer`, `border-radius: 4px` |
| **Hover** | `bg: hover-5` (via `transition-colors`) |
| **Active** | Selected icon may have persistent bg tint |
| **Z-index** | Above page content, below modals |

### 1.15 Toasts (Sonner)

**Position:** Bottom-center (Sonner default).
**Style:** `bg: toast-background` (#383838), white text, rounded.
**Animation:** `sonner-fade-in` (300ms ease) on enter, `sonner-fade-out` on exit.
**Auto-dismiss:** ~3–5 seconds (Sonner default).
**Stacking:** Multiple toasts stack vertically.

### 1.16 Forms & Inputs

| Input type | Container style | Focus style | Validation |
|------------|----------------|-------------|------------|
| **Text input** (email, password, code) | `bg: foreground-layer1`, `border: 1px solid border-level2`, `border-radius: 10px`, `height: 54px` | `border-color: border-bt` emphasis or ring | `disabled` submit until valid |
| **Search input** | Transparent bg, no border, `font-size: 16px`, `caret-color: brand-primary` | — | Real-time filtering |
| **Numeric input** (amount in trade panel) | Same as text input | — | Min/max validation |

**Focus ring:** Uses Tailwind `ring-*` utilities. `focus:ring-2` applies `box-shadow: var(--tw-ring-offset-shadow), var(--tw-ring-shadow)`.

### 1.17 Focus States (Accessibility)

| Element | Focus style |
|---------|-------------|
| **Buttons** | `focus-visible:ring-2` with `--tw-ring-color: hsl(var(--ring))` |
| **Links** | Browser default outline (2px solid transparent, offset 2px via `focus:outline-none` reset) |
| **Inputs** | `focus:ring-1` or `focus:ring-2` with border emphasis |
| **Tabs** | Radix `focus-visible` ring |

**Keyboard navigation:**
- `Tab` / `Shift+Tab` — move through interactive elements in DOM order.
- `Enter` / `Space` — activate buttons, links, toggles.
- `Escape` — close modals, dropdowns, popovers.
- Arrow keys — navigate within tab groups, dropdown menus.
- `/` — focus search (implied, common pattern).

### 1.18 Loading States

| Pattern | Style | Duration |
|---------|-------|----------|
| **Skeleton** | Grey rounded rectangles matching layout. `animation: 2s cubic-bezier(0.4,0,0.6,1) infinite pulse` (opacity 0.5 oscillation). | Indefinite until data loads |
| **Spinner** | SVG with `animation: 1s linear infinite spin` (full rotation) or `spinner-leaf-fade` (0.8s multi-leaf). | Indefinite |
| **Progress dots** | `dot-flashing` keyframe (3 dots, staggered opacity). | Indefinite |
| **Progress bar** | `loading-primary` (0.9s linear infinite) or `loading-circle` (1s linear infinite). | Indefinite |

### 1.19 Error States

| Pattern | Implementation |
|---------|----------------|
| **404 page** | Centered layout: large "404" graphic with blue bull illustration, "Page Not Found." title, helper text, black "Return Home" button. |
| **Data load failure** | Centered icon (broken network) + "Failed to load [content]" + "Please check your network and try again." + black "Refresh" button. Category sidebar remains functional. |
| **Form validation** | Submit button stays `disabled` until form is valid. No inline error text observed in login modal. |
| **Disabled actions** | Date pills (past dates), submit buttons (invalid forms) — `opacity: 0.4`, `cursor: not-allowed`. |

### 1.20 Scroll Behaviors

| Pattern | Implementation |
|---------|----------------|
| **Sticky navbar** | `position: fixed; top: 0; z-index: 50+` — always visible during page scroll. |
| **Internal scroll containers** | Newswire feed, prediction category sidebar, screener table — independent scroll, native browser scrollbar. |
| **Horizontal card carousel** | Embla Carousel with "Scroll right" arrow button. CSS-based smooth scroll. |
| **Marquee/ticker** | `animation: 8s linear infinite scroll` or `35s linear infinite scroll` — continuous horizontal text scroll. |
| **Smooth scroll** | CSS `scroll-behavior: smooth` on anchor links (not globally observed). |

---

## 2. Interaction State Flow Diagrams

### 2.1 Login Modal State Machine

```
                    ┌─────────────────┐
                    │   Page Default   │
                    │  (user browsing) │
                    └────────┬────────┘
                             │
                    [Click Log In button]
                             │
                             ▼
                    ┌─────────────────┐
              ┌────│  Modal Opening    │────┐
              │    │  (animation: 0.15s│    │
              │    │   enter, fade-in)  │    │
              │    └────────┬────────┘    │
              │             │             │
    [Close: ×, Escape,    [Content     [Backdrop
     backdrop click]      loads]      click]
              │             │             │
              ▼             ▼             ▼
     ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
     │ Modal Closed  │  │ Signup Mode  │  │ Modal Closed │
     │ (exit anim)  │  │ "Let's get   │  │ (exit anim)  │
     └──────────────┘  │  started!"   │  └──────────────┘
                       └──────┬───────┘
                              │
                     [Click "Log in" link at bottom]
                              │
                              ▼
                     ┌──────────────┐
                     │  Login Mode   │
                     │ "Log in to    │
                     │  AInvest"     │
                     │ + Password    │
                     │   toggle      │
                     └──────┬───────┘
                            │
                   [Fill email + code/password]
                            │
                            ▼
                     ┌──────────────┐
                     │ Submit Enabled│
                     │ (button      │
                     │  activates)  │
                     └──────┬───────┘
                            │
                   [Click Log in / Sign up]
                            │
                            ▼
                     ┌──────────────┐
                     │  API Request  │──[Error]──▶ Inline error /
                     │  (loading)   │             stay on modal
                     └──────┬───────┘
                            │
                       [Success]
                            │
                            ▼
                     ┌──────────────┐
                     │ Authenticated│
                     │ Modal closes │
                     │ Page reloads │
                     │ with user    │
                     │ state        │
                     └──────────────┘
```

**Transitions:**
- Modal open: `0.15s enter` (Radix keyframe — opacity 0→1, scale 0.95→1)
- Modal close: `0.15s exit` (reverse)
- Backdrop: `fade-in-0` / `fade-out-0` (150ms)
- Mode toggle (signup ↔ login): Instant text swap, no slide animation

### 2.2 Search Modal State Machine

```
                    ┌─────────────────┐
                    │  Nav Bar Default │
                    │  (search icon    │
                    │   visible)       │
                    └────────┬────────┘
                             │
                    [Click magnifier icon or press /]
                             │
                             ▼
                    ┌─────────────────┐
                    │  Modal Opening   │
                    │  (backdrop fade- │
                    │   in, modal      │
                    │   scale-in)      │
                    └────────┬────────┘
                             │
                    [Content loads: quick links + trending symbols]
                             │
                             ▼
                    ┌─────────────────┐
                    │  Search Ready    │
                    │  (input focused, │
                    │   results shown) │
                    └────────┬────────┘
                             │
                    [User types query]
                             │
                             ▼
                    ┌─────────────────┐
                    │  Filtering       │
                    │  (real-time,     │
                    │   no debounce    │
                    │   observed)      │
                    └────────┬────────┘
                             │
                    [Results update as user types]
                             │
                             ▼
                    ┌─────────────────┐
                    │  Result Selected │──▶ Navigate to asset detail
                    │  (click row)    │    Modal closes (exit anim)
                    └─────────────────┘

                    [Click tab: Stocks/ETFs/Cryptos]
                             │
                             ▼
                    ┌─────────────────┐
                    │  Filter by Type  │
                    │  (active tab:    │
                    │   white underline│
                    │   via ::after)   │
                    └─────────────────┘
```

**Transitions:**
- Modal open/close: `0.15s enter` / `exit`
- Tab switch: Instant content swap, active tab underline slides to new position
- Result row hover: `bg: foreground-layer1_2` (instant)

### 2.3 Prediction Markets Tab Switching

```
                    ┌─────────────────┐
                    │  Default Tab     │
                    │  "FIFA World Cup │
                    │   2026" [active] │
                    │  (white underline│
                    │   ::after)       │
                    └────────┬────────┘
                             │
                    [Click another tab: Sports/Politics/etc.]
                             │
                             ▼
                    ┌─────────────────┐
                    │  URL Updates     │
                    │  ?tab=Sports     │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Content Area    │
                    │  Shows Skeleton  │──▶ [animation: pulse, 2s]
                    │  (grey blocks)   │
                    └────────┬────────┘
                             │
                    [Data loads from API]
                             │
                             ▼
                    ┌─────────────────┐
                    │  New Content     │
                    │  (market cards   │
                    │   rendered)      │
                    └────────┬────────┘
                             │
                    [Error: API failure]
                             │
                             ▼
                    ┌─────────────────┐
                    │  Error State     │
                    │  "Failed to load │
                    │   markets"       │
                    │  + Refresh button│
                    └─────────────────┘
```

**Transitions:**
- Active tab underline: Slides horizontally to new tab (CSS `transition: all` on `::after`)
- Content swap: Instant (no fade transition between old and new content)
- Skeleton: `animation: 2s pulse` (opacity 0.5 oscillation)
- Tab hover: `color: rgba(255,255,255,0.75 → 0.9)` (instant)

### 2.4 Pricing Toggle State Machine

```
                    ┌─────────────────┐
                    │  Default: Yearly  │
                    │  [active: black  │
                    │   pill, white    │
                    │   text]          │
                    │  Monthly [inactive│
                    │  : transparent]  │
                    └────────┬────────┘
                             │
                    [Click Monthly button]
                             │
                             ▼
                    ┌─────────────────┐
                    │  Pill Slides     │
                    │  (animated       │
                    │   background     │
                    │   shift, 0.15s)  │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Monthly Active  │
                    │  [active: black  │
                    │   pill]          │
                    │  Yearly [inactive│
                    │  : transparent + │
                    │  hover bg]       │
                    └────────┬────────┘
                             │
                    [All 4 tier card prices update simultaneously]
                             │
                             ▼
                    ┌─────────────────┐
                    │  Prices Updated  │
                    │  (instant text   │
                    │   swap, no       │
                    │   animation on   │
                    │   price text)    │
                    └─────────────────┘
```

**Transitions:**
- Pill background: `0.15s cubic-bezier(0.4, 0, 0.2, 1)` — slides between positions
- Price text: Instant (no transition specified)

### 2.5 News Card Hover State Machine

```
                    ┌─────────────────┐
                    │  Card Default    │
                    │  (transparent    │
                    │   bg, no shadow) │
                    │  ::after: hidden │
                    └────────┬────────┘
                             │
                    [Mouse enters card bounds]
                             │
                             ▼
                    ┌─────────────────┐
                    │  ::after Reveal  │
                    │  (pseudo-element│
                    │   expands 12px   │
                    │   beyond card,   │
                    │   bg:            │
                    │   background-weak│
                    │   )              │
                    └────────┬────────┘
                             │
                    [Mouse leaves card bounds]
                             │
                             ▼
                    ┌─────────────────┐
                    │  ::after Hide    │
                    │  (instant, no    │
                    │   transition)    │
                    └─────────────────┘
```

**Transitions:** The `::after` pseudo-element has no explicit transition — it appears/disappears instantly on hover enter/leave. This is a deliberate design choice for a subtle "glow" effect without distraction.

---

## 3. Key User Flow Diagrams

### 3.1 Happy Path: User browses News → reads article

| Step | Trigger | Interface state | Animation |
|------|---------|-----------------|-----------|
| 1 | User lands on `/news/` | Top news hero card visible (large image + headline). Trending News + Newswire on right. News cards below hero. | Page loads with fade-in. |
| 2 | User hovers over a secondary news card | `::after` pseudo-element reveals 12px glow around card. `bg: background-weak`. | Instant (no transition). |
| 3 | User clicks headline or image | Navigates to `/news/[slug]/`. New page loads. | Page transition (client-side route change, ~200ms). |
| 4 | Article page loads | Article header, author byline, body text, related articles. | Content fade-in. |
| 5 | User scrolls down | Related articles section reveals. | Sticky navbar remains at top. |
| 6 | User clicks author name | Navigates to `/news/author/[name]/`. Author profile page. | Page transition. |

**Error path:** If article slug is invalid → 404 page with "Return Home" button. If network fails → error state with "Refresh" button.

### 3.2 Happy Path: User searches for a stock → adds to watchlist

| Step | Trigger | Interface state | Animation |
|------|---------|-----------------|-----------|
| 1 | User on any page clicks magnifier icon in nav | Search modal opens. Backdrop fades in. Modal scales in. | `0.15s enter` (opacity + scale). |
| 2 | User types "AAPL" in search input | Results filter in real-time. AAPL row appears. | Instant (no debounce). |
| 3 | User hovers over AAPL result row | Row bg changes to `foreground-layer1_2`. | Instant. |
| 4 | User clicks star icon on AAPL row | Star fills. AAPL added to watchlist. | Instant toggle. |
| 5 | User presses Escape or clicks backdrop | Modal closes. | `0.15s exit` (opacity + scale). |
| 6 | User navigates to `/watchlist/` | Watchlist page loads with AAPL in the list. | Page transition. |

**Error path:** If search returns no results → empty state with "No results" message. If watchlist add fails → toast notification with error.

### 3.3 Happy Path: User switches pricing to Monthly → subscribes

| Step | Trigger | Interface state | Animation |
|------|---------|-----------------|-----------|
| 1 | User on `/pricing/` (Yearly is default) | 4 tier cards visible (Basic, Pro, Premium, Ultra). Yearly toggle active. | Page loaded. |
| 2 | User clicks "Monthly" toggle button | Pill slides from Yearly to Monthly position. All 4 card prices update to monthly rates. | `0.15s cubic-bezier(0.4, 0, 0.2, 1)` on pill. Price text: instant. |
| 3 | User hovers over Pro tier card | Card lifts slightly (`translateY(-4px)`), shadow increases. | `0.15s cubic-bezier(0.4, 0, 0.2, 1)`. |
| 4 | User clicks "Upgrade to Pro" button | Navigates to checkout/payment flow (external or modal). | Button press feedback. |
| 5 | User completes payment | Redirected back to `/pricing/` with success toast. | Toast: `sonner-fade-in` 300ms. |

**Error path:** If payment fails → error toast, stay on pricing page. If user not logged in → login modal opens first.

### 3.4 Error Path: User hits 404 page

| Step | Trigger | Interface state | Animation |
|------|---------|-----------------|-----------|
| 1 | User navigates to invalid URL | 404 page loads. Large "404" graphic, blue bull illustration, "Page Not Found." title. | Page loads. |
| 2 | User sees helper text | "Don't worry, it happens! Click below to go back to the homepage." | Static. |
| 3 | User clicks "Return Home" button | Navigates to `/`. Homepage loads. | Page transition. |

**Alternative:** User uses nav bar search or navigation links to find correct page.

### 3.5 Error Path: Prediction markets data load failure

| Step | Trigger | Interface state | Animation |
|------|---------|-----------------|-----------|
| 1 | User clicks "Sports" tab on `/prediction/` | URL updates to `?tab=Sports`. Content area shows skeleton. | `2s pulse` on skeleton blocks. |
| 2 | API request fails | Error state replaces skeleton: broken network icon, "Failed to load markets" text, helper text, "Refresh" button. | Instant swap. |
| 3 | Category sidebar remains functional | User can click another category to retry. | — |
| 4 | User clicks "Refresh" button | Retries the API request. Skeleton reappears. | `2s pulse` on skeleton. |
| 5 | If retry succeeds | Sports market cards render. | Instant. |
| 6 | If retry fails again | Error state persists. | — |

---

## 4. UX Risk Points

### 4.1 Accessibility Risks

| Risk | Description | Severity | Recommendation |
|------|-------------|----------|----------------|
| **Hover-only interactions** | News card `::after` glow appears on mouse hover only. On touch devices, this effect never triggers. The card is still clickable, but the visual feedback is missing. | Medium | Add `:focus-visible` state to match hover appearance for keyboard/touch users. |
| **Low-contrast promo badge** | The rotating promo badge has small text (10–14px) on a gradient background. May fail WCAG AA contrast in some gradient zones. | Medium | Increase font size or simplify gradient to ensure 4.5:1 contrast. |
| **Auto-rotating text in nav** | The promo badge text auto-scrolls. Users with cognitive disabilities may find this distracting. Screen readers may not announce the rotating content. | Low | Add `aria-live="off"` or `aria-hidden` to the rotating element. Provide static fallback text. |
| **Cookie consent as blocking** | Cookie banner has no "Reject all" option — only "Accept" or "Preferences". This may violate GDPR/ePrivacy in EU jurisdictions. | High | Add "Reject all" or "Decline non-essential" button. |
| **Focus management in modals** | Radix Dialog handles focus trapping, but custom modals (e.g., search modal) should verify focus is properly trapped and restored on close. | Low | Test with screen reader (NVDA/VoiceOver) to confirm focus management. |
| **Tab order in prediction markets** | The date strip and category tabs are separate focus groups. Users may not realize they're separate. | Low | Add `role="tablist"` and `aria-controls` to link tabs to content panels. |
| **Probability bars not accessible** | The colored probability bars are purely visual. Screen reader users won't know the percentages. | Medium | Add `aria-label="Ecuador 17%, Draw 18%, Germany 65%"` to the bar container. |

### 4.2 Performance Risks

| Risk | Description | Severity | Recommendation |
|------|-------------|----------|----------------|
| **Newswire auto-refresh** | The Newswire panel polls for new content every 1–2 minutes. This creates continuous network requests and potential DOM thrashing. | Medium | Implement WebSocket or Server-Sent Events for push-based updates. Throttle when tab is not visible. |
| **Embla carousel on news page** | The horizontal news card carousel may lazy-load images, but if not, it could block initial render. | Low | Verify `loading="lazy"` on carousel images. |
| **Skeleton pulse animation** | The `pulse` keyframe runs at 2s infinite. Multiple skeleton elements compound GPU usage. | Low | Use CSS `will-change: opacity` or limit to viewport-visible skeletons. |
| **Marquee animation on promo badge** | Continuous text rotation consumes CPU even when not visible. | Low | Pause animation when badge is off-screen (`IntersectionObserver`). |
| **Large CSS bundle** | The site uses Tailwind + Radix + tailwindcss-animate + Sonner + Hightouch Charts. The CSS bundle is likely >100KB. | Medium | Purge unused Tailwind classes. Code-split chart library. |

### 4.3 UX Consistency Risks

| Risk | Description | Severity | Recommendation |
|------|-------------|----------|----------------|
| **Inconsistent border-radius** | Cards use 8px, 10px, 12px, 16px, 24px depending on context. No single "card" radius. | Low | Define a card radius scale: `card-sm: 8px`, `card-md: 12px`, `card-lg: 16px`. |
| **Mixed transition durations** | 0.15s is the default, but 0.2s, 0.3s, 0.5s are used in different components (accordion, carousel, chart). | Low | Document the transition scale (micro: 0.15s, standard: 0.2s, emphasis: 0.3s). |
| **Hover effects differ by card type** | News card uses `::after` glow, KB card uses bg darken, market card uses bg tint, watchlist card uses bg+border change. Three different hover patterns for "card" components. | Medium | Standardize: one hover effect for all data cards, one for content cards. |
| **Active state missing on some buttons** | The Monthly/Yearly toggle has a clear active state (black pill), but the category tabs use an underline indicator. Mixed affordance patterns for "selected" state. | Low | Document the selected-state patterns: filled (toggle), underlined (tabs), checkmark (checkboxes). |
| **404 page CTA only** | The 404 page has a single "Return Home" button. Users who want to search or navigate must use the nav bar. | Low | Add a search input directly on the 404 page for quick recovery. |

### 4.4 Error Handling Risks

| Risk | Description | Severity | Recommendation |
|------|-------------|----------|----------------|
| **No retry on login form** | If login API fails, the modal stays open but no error message is shown. User must guess what went wrong. | High | Show inline error message below the submit button with retry option. |
| **No offline state** | No service worker or offline fallback. Users on flaky connections see broken UI. | Medium | Implement basic offline detection with a banner: "You're offline. Some features may not work." |
| **Silent watchlist add/remove** | The star toggle gives no feedback (no toast, no animation). Users may not be sure if the action succeeded. | Low | Add a subtle toast or checkmark animation on toggle. |
| **Form validation timing** | The login submit button is `disabled` until form is valid, but no inline feedback explains what's missing. | Medium | Show real-time validation hints (e.g., "Email format invalid" below input). |
| **Broken chart links** | Some chart URLs (e.g., `/chart?symbol=AAPL`) return 404. The link is in the nav and may be a dead route. | High | Fix routing or add redirect from `/chart?symbol=X` to `chart.ainvest.com/[exchange]-[symbol]/`. |

### 4.5 Dark Mode Risks

| Risk | Description | Severity | Recommendation |
|------|-------------|----------|----------------|
| **Shadows in dark mode** | DESIGN.md states "don't use shadows in dark mode" but some card components still apply `box-shadow`. The watchlist card has `box-shadow: 0 1px 2px rgba(0,0,0,0.05)` which is barely visible in dark mode. | Low | Use `background-layer3`/`layer4` layering for elevation in dark mode, not shadows. |
| **Hover bg in dark mode** | `hover-5` uses `rgba(0,0,0,0.05)` which is invisible in dark mode. `hover-dark` uses `rgba(255,255,255,0.2)` which is correct. Verify the dark variant is used. | Medium | Audit all `hover-5` usages in dark mode. Add `dark:hover:bg-foreground-layer1_2` overrides. |
| **Price colors in dark mode** | `price-up` dark variant (#00A36D) and `price-down` dark variant (#FF4A2E) are defined but may not be applied consistently. | Low | Use `dark:text-price-up-dark` and `dark:text-price-down-dark` in all price display components. |

---

## 5. Source Site Screenshots (Playwright captures)

All screenshots captured on 2026-06-25 via Playwright. Stored in `/tmp/opencode/ainvest-interactions/`.

| # | File | Description | Key interaction captured |
|---|------|-------------|---------------------------|
| 01 | `01-homepage-default.png` | Homepage default state | Nav bar, hero section, promo banner |
| 02 | `02-nav-hover-Aime.png` | Nav bar with Aime link hovered | `bg: rgba(255,255,255,0.2)` pill |
| 03 | `03-nav-hover-WorldCup.png` | Nav bar with 🏆World Cup hovered | Pill bg + trophy icon |
| 04 | `04-login-modal-open.png` | Login modal opened | Backdrop + modal scale-in |
| 05 | `05-login-modal-hover-login-btn.png` | Login modal with "Log in" link hovered | Link color shift |
| 06 | `06-login-modal-switch-to-login.png` | After clicking "Log in" toggle | Form switched to login mode |
| 07 | `07-modal-closed.png` | Modal closed (Escape pressed) | Exit animation completed |
| 08 | `08-news-page-default.png` | News page default | Hero card + trending + newswire |
| 09 | `09-news-card-hover.png` | News card hovered | `::after` glow visible |
| 10 | `10-newswire-important-dropdown.png` | Newswire "Important" dropdown opened | Dropdown menu visible |
| 11 | `11-prediction-markets-default.png` | Prediction markets default | FIFA World Cup 2026 tab active |
| 12 | `12-prediction-tab-hover-sports.png` | Sports tab hovered | Color lightens |
| 13 | `13-prediction-tab-sports-active.png` | Sports tab active | White underline + URL `?tab=Sports` |
| 14 | `14-prediction-card-hover.png` | Market card hovered | `bg: hover-5` tint |
| 15 | `15-watchlist-page.png` | Watchlist page default | Summary cards + table |
| 16 | `16-watchlist-card-hover.png` | Watchlist card hovered | `bg: foreground-layer1_2` |
| 17 | `17-pricing-monthly.png` | Pricing page (Yearly default) | 4 tier cards visible |
| 18 | `18-pricing-monthly-active.png` | After clicking Monthly | Pill slid, prices updated |
| 19 | `19-kb-page.png` | Knowledge Base page default | 10 module cards in grid |
| 20 | `20-kb-card-hover.png` | KB card hovered | `bg: transparent-blue1` + arrow inverted |
| 21 | `21-homepage-cookie-banner.png` | Homepage with cookie consent | Bottom banner visible |
| 22 | `22-search-modal-open.png` | Search modal opened | Quick links + trending symbols |
| 23 | `23-search-modal-typing.png` | Search modal with "AAPL" typed | Real-time filter results |

### v2 Screenshots (2026-06-25), stored in `/tmp/opencode/ainvest-interactions-v2/`

| # | File | Description | Key interaction captured |
|---|------|-------------|---------------------------|
| 24 | `01-market-page.png` | Market overview page | Tracker tabs, market data |
| 25 | `02-brokers-page.png` | Broker comparison page | Broker cards grid |
| 26 | `04-news-article.png` | Individual news article page | Article layout, author byline |
| 27 | `05-download-page.png` | App download page | Platform download CTAs |
| 28 | `06-chat-page.png` | Aime AI chat page (redirects from /chat/ to /aime/) | Chat interface |
| 29 | `08-compare-page.png` | ETF comparison page | ETF comparison tool |

---

## 6. Page Layout & Responsive System

### 6.1 Container Breakpoints

| Breakpoint | Max-width | Usage |
|------------|-----------|-------|
| `sm` | 501px | Mobile-first base |
| | 662px | Sidebar trigger |
| | 746px | Layout medium |
| `md` | 769px | Tablet |
| `lg` | 991px | Desktop |
| | 1047px | Wide tablet |
| | 1348px | Large desktop |
| `xl` | 1411px | Extra large (adds `padding: 1.5rem`) |
| `2xl` | 1921px | Ultra wide (adds `padding: 1rem`) |

**Reverse breakpoints:**
- `max-500px` — Mobile only (hides chart date header, full-width modals)
- `max-768px` — Tablet and below (hides certain chart UI elements)

### 6.2 Body Typography & Global Styles

| Property | Value |
|----------|-------|
| **Font family** | `-apple-system, BlinkMacSystemFont, "PingFang SC", Robot, "Source Han Sans", sans-serif` |
| **Font size** | 16px |
| **Line height** | 24px (1.5) |
| **Color (dark mode)** | `rgb(250, 250, 250)` (near-white) |
| **Background (dark mode)** | `rgb(9, 9, 11)` (near-black) |
| **`scroll-behavior`** | `smooth` (applied on `<html>`) |
| **`-webkit-font-smoothing`** | `auto` |
| **`color-scheme`** | Not set (dark mode handled via CSS only, no browser-native dark mode hint) |

### 6.3 No Footer Pattern

The site does **not** use a `<footer>` element. This is notable for a financial platform. The only persistent bottom elements are:
- Cookie consent bar (until dismissed, via Termly)
- Right-side floating toolbar (`.fixed bottom-0`)
- Occasionally "Our Story" link → `/about/` and "CONTACT US" link → `contact.ainvest.com/`

This means all legal/compliance links must appear elsewhere: login/signup modal (Terms of Use, Privacy Policy), article pages, and inline within content.

### 6.4 Page-Specific URL Observations

| Nav link | Effective URL | Notes |
|----------|--------------|-------|
| "AI Charts" in nav | `chart.ainvest.com/NASDAQ-AAPL/` | Separate subdomain |
| "Markets" in nav | `/market/` | Market overview dashboard |
| `/chat/` | Redirects to `/aime/` | Aime AI chat |
| `/chart?symbol=AAPL` | Returns 404 | Use `chart.ainvest.com` subdomain instead |
| `/stock/AAPL/` | Returns 404 | Use search modal to find stock detail page |
| `/markets/` vs `/market/` | `/market/` works, `/markets/` is 404 | Use singular form |
| Crypto | `crypto.ainvest.com/` | Separate subdomain |
| Stocks | `/stocks/` | Linked from market page |
| ETFs | `/etfs/` | Linked from market page |
| Options | `/options/` | Linked from market page (may redirect) |

---

## 7. Additional Interaction Patterns (from v2 exploration)

### 7.1 Market Tracker Tabs (Market Overview Page)

The market page has a multi-level tab system:

**Level 1: Asset class tabs** (`Market Trackers` bar)
- Options: `Market Trackers` | `Stocks` | `Crypto` | `ETFs` | `Options`
- Style: `inline-block text-[16px] px-[16px] py-[7px] cursor-pointer`
- Hover transition: `color 0.2s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1)` (note: **200ms**, not 150ms default)
- Hover state: `bg: rgb(242, 242, 242)` (line-grey)

**Note:** These tabs use **200ms** transitions, not the **150ms** default used by prediction market tabs (see §1.7). Two different tab transition speeds coexist on the same site.

**Level 2: Time range tabs** (`Intraday` | `Date Range`)
- Click switches chart data range.
- "Supercharts" link opens `chart.ainvest.com` with current symbol.

**Summary cards:** Shows key indices (SPY, QQQ, etc.) with clickable cards linking to detail pages.

### 7.2 Disabled State Patterns (CSS Tokens)

Three disabled button variants use atom tokens:

| Variant | Background token | Text color token |
|---------|-----------------|------------------|
| **Black disabled** | `--atom-color-button-black-disabled` | `--atom-color-button-black-text-disabled` |
| **Brand disabled** | `--atom-color-button-brand-disabled` | `--atom-color-button-brand-disabled` (same for text) |
| **Grey disabled** | `--atom-color-button-grey-disabled` | `--atom-color-button-grey-text-disabled` |

Applied via CSS: `.disabled:bg-button-black-disabled:disabled`, `.disabled:text-button-black-text-disabled:disabled`.
Important: `disabled:hover:bg-button-black-press` exists to prevent hover on disabled state.

### 7.3 Motion & Performance

| Feature | Implementation |
|---------|----------------|
| **`prefers-reduced-motion`** | Respected! Hightouch Charts disables transitions entirely. Sonner toasts set `transition: none !important; animation: auto ease`. |
| **`will-change`** | Used on `[data-vaul-drawer]`: `will-change: transform`. Optimizes drawer GPU rendering. |
| **`backdrop-filter`** | Used at multiple blur levels: `8px`, `10px`, `15px`, `30px`, `50px`. Applied to modals, dropdowns, navigation overlays. Via `backdrop-blur` + `backdrop-blur-sm`. |
| **Scroll behavior** | `html { scroll-behavior: smooth }` — native smooth scrolling on all anchor/scroll-to links. |
| **Auto-rotating promo CS** | `animation: homeNavMarquee` — continuous horizontal text scroll in nav badge. |
| **Vaul Drawer (bottom sheet)** | `transition: transform 0.5s cubic-bezier(0.32, 0.72, 0, 1)` with snap points. Has drag handle (`height: 4px, border-radius: 2px, opacity: 0.7 → 1 on hover/active`). Overlay fades in/out in sync. |
| **Loading bar** | `animation: 1.5s linear infinite loading-primary` for progress bars. |
| **Loading circle** | `animation: 1s linear infinite loading-circle` for circular progress. |
| **Fade-in animation** | Custom `fadeIn` keyframe (opacity 0→1) used by Vaul overlay. |

### 7.4 Vaul Drawer (Bottom Sheet)

The site uses **Vaul** for mobile-friendly bottom sheet drawers.

| Property | Value |
|----------|-------|
| **Transition** | `transform 0.5s cubic-bezier(0.32, 0.72, 0, 1)` |
| **will-change** | `transform` (GPU-layered) |
| **Touch action** | `none` (prevents scroll interference) |
| **Status open** (no snap points) | `animation-name: slideFromBottom` |
| **Status closed** (no snap points) | `animation-name: slideToBottom` |
| **With snap points (bottom)** | `transform: translate3d(0, var(--initial-transform, calc(100% - var(--snap-point-height))), 0)` |
| **With snap points (top/left/right)** | Similar translate3d with respective snap axes |
| **Drag handle** | `width: 32-48px, height: 4px, border-radius: 2px, bg: rgb(226, 226, 228), opacity: 0.7`, center-left, `margin: 16px 0` |
| **Drag handle hit area** | `40×40px` minimum, extends beyond visual handle |
| **Overlay** | `bg: black`, fade in/out synchronized with drawer animation |

---

## 8. Cross-references

- **Design tokens (colors, spacing, shadows):** `./DESIGN.md`
- **Component specs (button sizes, card padding):** `./DESIGN.md` → `components` section
- **Price color rules:** `./markets.md` + `./DESIGN.md` → `colors.price-*`
- **Dark mode layering:** `./DESIGN.md` → `colors.background-layer*`
- **Button hover naming convention:** `./DESIGN.md` → `components.button-*` (siblings, not nested)
- **Radix UI docs:** https://www.radix-ui.com/primitives
- **Vaul (drawer) docs:** https://vaul.emilkowal.ski/
- **tailwindcss-animate docs:** https://github.com/jamiebuilds/tailwindcss-animate
- **Sonner (toast) docs:** https://sonner.emilkowal.ski/
- **Termly (cookie consent):** https://termly.io/
