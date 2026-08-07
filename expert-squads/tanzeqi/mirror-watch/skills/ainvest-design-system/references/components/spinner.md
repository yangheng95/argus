# Guidelines — spinner

> **Component Spec:** `ainvest-design-system/references/components/spinner.md`

---

## 0. Document Role

This document covers **when and how to use** the spinner (加载指示器) component. It focuses on decisions a designer must make explicitly — visual details handled automatically by the component are omitted.

<!-- - Component import: `@ainvest/spinner` -->

---

## 1. Definition

spinner is a **feedback component** that communicates to the user that the system is currently performing a data fetch, processing, or other time-consuming operation. Its presence alleviates wait anxiety and confirms the system is still responsive.

The component exposes three visual **variants** (`default` / `circle` / `circle-filled`) and three **sizes** (`sm` / `md` / `lg`). Variant and size are designer decisions — see §5.

spinner covers two primary loading scenarios and their associated sub-patterns:

| Scenario | Description |
|----------|-------------|
| **Page Loading** | Full-page or section-level loading when fetching primary content |
| **New Content Loading** | Incremental content updates (new stories badge, pull-to-refresh, scroll load-more) |

---

## 2. When to Use

| Condition | Use spinner? |
|-----------|--------------|
| Page is fetching primary content after navigation or tab switch | YES — Page Loading (centered spinner + skeleton) |
| User pulls down to refresh a scrollable list | YES — Pull-to-Refresh indicator |
| User scrolls to bottom of a paginated list | YES — Bottom Load-More spinner |
| New content is available but user has not scrolled to top | YES — New Content Badge ("↑ N new stories") |
| Inline button triggers an async action (e.g. form submit) | YES — embed `size="sm"` spinner inside the Button |
| Content is already loaded and static | NO |
| Very short operations (< 300ms) | NO — avoid flicker |
| Skeleton screen is shown as placeholder | Separate pattern (skeleton, not spinner) — see §8 |

### MUST

- MUST set `variant` and `size` explicitly based on the scenario (see §5)
- MUST show the spinner as soon as the async operation starts, and remove it as soon as data arrives
- MUST keep at most one spinner per content zone

### SHOULD

- SHOULD use the default variant for the standard loading scenario unless a specific context requires `circle` or `circle-filled`
- SHOULD pair page-level spinners with skeleton placeholders so layout stays stable

---

## 3. When NOT to Use

| Condition | Use Instead |
|-----------|-------------|
| Binary toggle waiting for API response | Switch's own inline loading state |
| File upload with measurable progress | Progress Bar component |
| Background sync that does not block the UI | No indicator needed |
| Search is being performed | search-input loading state |
| Very short operations (< 300ms) | No indicator — avoid flicker |
| Content is ready and does not depend on async data | No indicator |

### MUST NOT

- MUST NOT use spinner as a progress bar — it is indeterminate only
- MUST NOT display multiple spinners simultaneously in the same content zone
- MUST NOT block the entire page for a section-level load — only the affected area should show the spinner
- MUST NOT use vague wait messages like "Please wait" alongside the spinner — show a specific state or stay silent

---

## 4. Anatomy

### 4a. Page Loading Spinner

```
┌──────────────────────────────────────────┐
│  [Content area — skeleton or blank]      │
│                                          │
│           ✻  (spinner icon)              │
│                                          │
│  (optional: "No More Data" text below)   │
└──────────────────────────────────────────┘
```

- **Spinner icon**: `variant="default"` (叶片型), centered in the content area
- **Position**: Vertically and horizontally centered within the loading zone
- **Text**: Optional end-of-data text ("No More Data") appears below spinner when all data is loaded

### 4b. Pull-to-Refresh Indicator (Mobile / Responsive)

```
┌────────────────────────┐
│  ↓ (pull gesture)      │
│  ──────────────────    │
│  ✻ ✻ ✻  (3 icons)     │  ← Appears above content during pull
│  ──────────────────    │
│  [Content list...]     │
└────────────────────────┘
```

- **Icon cluster**: 3 spinner icons in a horizontal row
- **Behavior**: Icons fade in proportionally to pull distance, then animate (rotate) once threshold is reached

### 4c. New Content Badge

```
┌────────────────────────┐
│   ┌─────────────────┐  │
│   │ ↑ 2 new stories │  │  ← Floating pill badge
│   └─────────────────┘  │
│  [Content list...]     │
└────────────────────────┘
```

- **Shape**: Pill-shaped badge (full-rounded)
- **Icon**: Up-arrow (↑) before count text
- **Position**: Centered horizontally, fixed at top of scrollable content area

### 4d. Bottom Load-More Spinner

```
┌────────────────────────┐
│  [Content list...]     │
│  ──────────────────    │
│       ✻  (spinner)     │  ← Appears at bottom of list
│  ──────────────────    │
│  "No More Data"        │  ← When all data loaded
└────────────────────────┘
```

---

## 5. Variants Overview

### 5a. Visual Variant — `variant`

| `variant` | Visual | Typical Scenario |
|-----------|--------|------------------|
| `default` (叶片型) | Radial blade-style icon, fade animation | **Default** — most loading scenarios, best compatibility |
| `circle` (线圈型) | Clean ring stroke | Refined designs, small-size contexts |
| `circle-filled` (填充线圈型) | Ring stroke with background fill | Contexts needing stronger visibility (low-contrast backgrounds, floating layers) |

Rules:

- MUST use **one** variant consistently within a single product / surface
- SHOULD use `default` unless there is a specific visibility or aesthetic reason to pick `circle` / `circle-filled`

### 5b. Size — `size`

| `size` | Dimensions | Typical Scenario |
|--------|-----------|------------------|
| `sm` | 20 × 20 | Inside a Button, table cell, or other compact slot (form submit, row refresh) |
| `md` | 28 × 28 | **Default** — list / card loading, general in-content loading |
| `lg` | 32 × 32 | Page-level loading, important full-area loading (initial load, data import) |

Rules:

- MUST match `size` to the container: `sm` for inline slots, `md` for module-level loading, `lg` for page-level loading
- MUST NOT mix sizes within a single loading zone (e.g. do not place `md` and `lg` in the same list)

### 5c. Loading Pattern Variants

spinner powers these higher-level loading patterns:

| Pattern | Platform | Trigger | Visual Form | Duration |
|---------|----------|---------|-------------|----------|
| **Tab / Page Refresh** | Web + Mobile | Click/Tap tab | Full-area spinner + skeleton placeholders | ~1s then auto-dismiss |
| **Pull-to-Refresh** | Mobile + Web (<480px) | Pull-down gesture | 3-icon cluster above content | Until data loaded, then auto-collapse |
| **Scroll Load-More** | Web + Mobile | Scroll to bottom | Bottom spinner | Until data loaded or "No More Data" |
| **New Content Badge** | Web + Mobile | Server push / polling | Floating pill at top | Until user taps or scrolls to top |
| **Cached Data + Error** | Web + Mobile | Load failure with cache | No indicator — retain existing data | N/A |
| **No Cache + Error** | Web + Mobile | Load failure, no cache | Error empty state + "Refresh" button | Until user taps Refresh |
| **No More Data** | Web + Mobile | All data loaded | "No More Data" text at list bottom | Persistent |
| **Inline Button Loading** | Web + Mobile | Async button action | `size="sm"` spinner inside the button | Until the action resolves |

---

## 6. Content Guidelines

### Text Labels

| State | Text | Notes |
|-------|------|-------|
| New content available | `"↑ {n} new stories"` | MUST include count; MUST use up-arrow icon |
| All data loaded | `"No More Data"` | Centered below last item |
| Network error (no cache) | `"Network error"` + `"Related content is empty. You are advised to perform the operation again."` | Paired with Refresh button |
| Refresh button | `"Refresh"` | Standard grey stroke button |

### MUST

- Loading text MUST be concise and informational, not conversational
- New content badge MUST show the actual count of new items
- Error state MUST provide a clear recovery action (Refresh button)

### MUST NOT

- MUST NOT show spinner for operations < 300ms (avoid flicker)
- MUST NOT use vague messages like "Please wait" — either show the spinner silently or show a specific state
- MUST NOT display multiple spinners simultaneously in the same content zone

---

## 7. Layout & Composition

### Page Loading (Tab Refresh)

| Property | Value (>=480px) | Value (<480px) |
|----------|----------------|----------------|
| Spinner position | Center of content area | Center of content area |
| Spinner `size` | `lg` | `lg` |
| Skeleton placeholders | Full card grid (3-col or 2-col) | Full card grid (1-col or 2-col) |
| Loading duration target | ~1s | ~1s |
| Transition | Fade in content, auto-dismiss spinner | Same |

### Pull-to-Refresh

| Property | Value |
|----------|-------|
| Pull threshold | System default (typically ~80px pull distance) |
| Icon cluster position | Centered above content, within pull-down reveal area |
| Icon opacity | 0% → 100% proportional to pull distance before threshold |
| Icon animation | Continuous rotation after threshold reached |
| Collapse | Auto-collapse upward after data loads |

### New Content Badge

| Property | Value |
|----------|-------|
| Position | Fixed at top of scrollable area, centered horizontally |
| Z-index | Above content, below nav |
| Badge height | ~32px pill |
| Dismiss | Tap badge → scroll to top + load; or auto-dismiss after scroll |

### Bottom Load-More

| Property | Value |
|----------|-------|
| Spinner `size` | `md` |
| Spinner position | Centered below last list item |
| Spacing above spinner | 16px |
| "No More Data" text | Centered, tertiary text color, 12px |

### Inline Button Loading

| Property | Value |
|----------|-------|
| Spinner `size` | `sm` |
| Position | Before the button label, inside the same button |
| Button state | Disabled while spinner is visible |

---

## 8. Behavior

### 8a. Tab / Page Refresh Flow (Web — Click Tab to Refresh)

```
Step 1: User clicks a Tab (or refresh trigger)
  → if page has Tab: Tab switches to "loading" visual (underline state)
  → Content area: show skeleton placeholders + centered spinner (size="lg")

Step 2: Loading in progress (~1s target)
  → Skeleton placeholders remain visible
  → Spinner animates
  → User CANNOT interact with loading content area
  → Other page areas (nav, sidebar) remain interactive

Step 3: Loading complete
  → Spinner auto-dismisses
  → Content fades in / replaces skeleton
  → Tab returns to normal active state
```

### 8b. Pull-to-Refresh Flow (Mobile + Web <480px)

| State | Pull Distance | Icon Display | Icon Animation | Icon Opacity | Trigger Refresh | Icon Disappear |
|-------|--------------|-------------|----------------|-------------|----------------|----------------|
| Initial | 0 | Not shown | None | — | No | — |
| Pulling | < threshold, not released | Gradually appears | Continuous rotation after fully shown | 0%–100% | No | — |
| Released | >= threshold | Fully shown | Continuous rotation | 100% | On release | — |
| Loading | — | Fully shown | Continuous rotation animation | 100% | Yes | Auto after load |
| Complete | Collapses up | — | — | 100%→0% | — | — |

### 8c. Scroll Load-More Flow

```
Step 1: User scrolls to bottom of list
  → Bottom spinner appears (size="md")

Step 2: Data loading
  → Spinner animates
  → New items append below existing content

Step 3: Complete
  → if more data: spinner disappears, new items visible
  → if no more data: spinner replaced with "No More Data" text
```

### 8d. New Content Badge Flow

```
Step 1: Server detects new content available
  → Badge slides down from top: "↑ {n} new stories"

Step 2: User interaction options:
  → Option A: Tap badge → scroll to top + load new content + badge dismisses
  → Option B: User manually scrolls to top → new content loads + badge dismisses
  → Option C: User ignores → badge persists until interacted with

Badge MUST NOT auto-dismiss without user action (content would be missed).
```

### 8e. Inline Button Loading Flow

```
Step 1: User clicks an async action button
  → Button becomes disabled
  → size="sm" spinner appears before the button label

Step 2: Action in progress
  → Spinner animates inside the button
  → Button remains disabled

Step 3: Action completes
  → Spinner removed
  → Button returns to enabled state (or UI navigates away)
```

### 8f. Error Handling

| Scenario | Has Cached Data? | Behavior |
|----------|-----------------|----------|
| Load failure | YES | Retain existing cached content; do NOT show error state; do NOT show spinner |
| Load failure | NO | Show empty state: illustration + "Network error" title + description + "Refresh" button |
| Refresh tapped | — | Re-trigger loading flow from Step 1 |

### 8g. Timing Rules

| Rule | Value |
|------|-------|
| Minimum display time for spinner | 300ms (prevent flicker for fast loads) |
| Target loading indication | ~1s for tab refresh |
| Auto-dismiss delay after complete | 0ms (immediate transition to content) |
| Pull-to-refresh collapse animation | ~300ms ease-out |

---

## 9. Platform Differences

| Aspect | Web (>=480px) | Web (<480px) / Mobile |
|--------|--------------|----------------------|
| Tab refresh | Click tab → skeleton + spinner (`lg`) | Same visual, responsive grid |
| Pull-to-refresh | Supported (less common) | Primary refresh mechanism |
| Scroll load-more | Bottom spinner (`md`) | Bottom spinner (`md`) |
| New content badge | Pill badge at top | Pill badge at top |
| Skeleton grid | 3×N card grid | 1–2 col card grid |
| Error empty state | Centered illustration + text + button | Same, full-width |
| "No More Data" | Text at list bottom | Text at list bottom |

---

## 10. Configurable Options

The following decisions should be made explicitly by the designer; other visual details are handled by the component.

| Option | Purpose | Typical Values |
|--------|---------|----------------|
| `variant` | Visual style of the spinner | `"default"` (叶片型, recommended) / `"circle"` / `"circle-filled"` |
| `size` | Spinner dimensions | `"sm"` (inline) / `"md"` (module, default) / `"lg"` (page-level) |
| Loading pattern | Which higher-level pattern applies (§5c) | Tab Refresh / Pull-to-Refresh / Scroll Load-More / New Content Badge / Inline Button / No More Data / Error |
| Pair with skeleton? | Whether to show skeleton placeholders behind a page-level spinner | YES for page-level / NO for inline |

Designers MUST decide explicitly:

- Which **variant** (§5a) — `default` unless there is a reason to choose otherwise
- Which **size** (§5b) — matched to the container (inline / module / page-level)
- Which **loading pattern** (§5c) applies for the trigger and context
- Whether the spinner should be paired with a **skeleton** (page-level) or shown alone (inline / load-more / button)

---

## 11. Do / Don't

| | Practice | Reason |
|---|---------|--------|
| DO | Use `variant="default"` for standard loading unless context demands otherwise | Best compatibility, standard visual |
| DO | Match `size` to the container (`sm` inline, `md` module, `lg` page) | Maintains visual rhythm |
| DO | Pair page-level spinner with skeleton placeholders | Preserves layout stability |
| DO | Auto-dismiss the spinner immediately when data arrives | Prevents perceived lag |
| DO | Retain cached data on load failure — do not flash an error if old data is available | Preserves user context |
| DO | Show actual count in new content badge ("↑ 2 new stories", not just "New content") | Concrete feedback |
| DO | Scale pull-to-refresh icon opacity proportionally with pull distance | Tactile response |
| DON'T | Show a spinner for operations under 300ms | Causes perceptible flicker |
| DON'T | Display multiple spinners in the same content zone simultaneously | Competing feedback |
| DON'T | Use spinner as a progress bar | It is indeterminate only — use Progress Bar for measurable progress |
| DON'T | Block the entire page for a section-level load | Only the affected area should show loading |
| DON'T | Auto-dismiss the new content badge without user action | Content would be missed |
| DON'T | Show "No More Data" while data is still loading | Conflicting states |
| DON'T | Replace cached content with an error state when refresh fails | Destroys user context |
| DON'T | Mix spinner sizes inside one loading zone | Breaks visual consistency |

---

## 12. Decision Table

### Which loading pattern to use?

| Trigger | Has Existing Content? | Data Source | → Use |
|---------|----------------------|-------------|-------|
| Tab click / page navigation | No | Server | Tab Refresh (skeleton + `lg` spinner) |
| Tab click / page navigation | Yes (cached) | Server | Tab Refresh (skeleton + `lg` spinner), retain cache on failure |
| User pull-down gesture | Yes | Server | Pull-to-Refresh (3-icon cluster) |
| Scroll reaches list bottom | Yes (partial) | Server (next page) | Scroll Load-More (bottom `md` spinner) |
| Server push / polling | Yes | Server | New Content Badge ("↑ N new stories") |
| Async button action | — | Server | Inline Button Loading (`sm` spinner inside the button) |
| Any load trigger | No | Server (failed) | Error Empty State + Refresh button |
| All pages loaded | Yes (complete) | — | "No More Data" text |

### Breakpoint adaptation

| Condition | → Layout |
|-----------|----------|
| Page width >= 480px | Desktop layout: 3-col skeleton grid, `lg` page spinner |
| Page width < 480px | Mobile layout: 1–2 col skeleton, pull-to-refresh primary |
