# Guidelines — search-input

> **Component Spec:** `ainvest-design-system/references/components/search-input.md`

---

## 0. Document Role

This document covers **when and how to use** the search-input (搜索输入框) component. It focuses on decisions a designer must make explicitly — visual details handled automatically by the component are omitted.

<!-- - Component import: `@ainvest/search-input` -->

---

## 1. Definition

search-input is a **search-specific input field** with a capsule shape, search icon, optional clear button, and optional suggestion dropdown. It is the dedicated component for search and query input — distinct from general-purpose form inputs.

It provides two platform variants — **Web** (40px height, with dropdown) and **App** (36px height, with Cancel label, no dropdown) — each with Default and Active (Focus) states.

---

## 2. When to Use

| Condition | Use search-input? |
|-----------|---------------|
| Global navigation search entry point | YES |
| Module-level search / filter within a page section | YES |
| Standalone search page input | YES |
| Top-of-page search on mobile | YES |
| User needs to query for stocks, news, people, topics | YES |

### MUST

- MUST use search-input when the interaction is search / query input
- MUST use search-input (not Input) for any search functionality in the product

### SHOULD

- SHOULD place search-input in a prominent, easily discoverable position (nav bar, top of content area)
- SHOULD show recent searches when focused with empty input (if feature is enabled)

---

## 3. When NOT to Use

| Condition | Use search-input? | Alternative |
|-----------|---------------|-------------|
| General form field (name, email, password) | NO | Input component |
| Filtering a table by column value | NO | Input component with filter icon |
| Date picker / number input | NO | Specialized input component |
| Command palette / keyboard shortcut trigger | NO | Command component |

### MUST NOT

- MUST NOT use search-input for general form fields — use Input component instead
- MUST NOT use search-input as a replacement for structured form inputs (date, number, select)
- MUST NOT use search-input without the search icon — the icon is a required visual cue

---

## 4. Anatomy

### Web search-input

```
┌─────────────────────────────────────────────┐
│  🔍  [ Placeholder / Input text ]      ✕   │
└─────────────────────────────────────────────┘
                    ↓ 4px gap
┌─────────────────────────────────────────────┐
│  Section Header                              │
│  ┌─────────────────────────────────────────┐│
│  │ Result item (hover / click / selected)  ││
│  ├─────────────────────────────────────────┤│
│  │ Result item                             ││
│  └─────────────────────────────────────────┘│
│  ─────────── divider ───────────            │
│  Section Header                              │
│  ┌─────────────────────────────────────────┐│
│  │ Result item                             ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

### App search-input

```
┌─────────────────────────────────┐
│  🔍  [ Placeholder / Input ]  ✕ │  Cancel
└─────────────────────────────────┘
```

| Part | Required | Platform | Description |
|------|----------|----------|-------------|
| Container | MUST | Web + App | Filled capsule, NO border; background `color.bg.weak` |
| Search icon (left) | MUST | Web + App | 16px icon; `color.text.tertiary` (default) → `color.text.primary` (hover / focus) |
| Placeholder text | MUST | Web + App | Shown when input is empty; `color.text.tertiary` (default) → `color.text.primary` (hover / focus) |
| Input text | Conditional | Web + App | User-entered text; `color.text.primary` |
| Caret | MUST | Web + App | Visible ONLY in focus state; color `color.brand.primary` |
| Clear icon (right) | Conditional | Web + App | 16px icon; visible ONLY when input has content; tap target ≥ 24×24px |
| Suggestion dropdown | Conditional | Web ONLY | Appears below input when results are available; uses `shadow.md` |
| Cancel label | Conditional | App ONLY | Text button to the right of input during focus state |

### Rules

- Container MUST be filled (no border) — background `color.bg.weak`; MUST NOT apply any `border` / stroke to the input container in any state (Default / Hover / Focus / Typing). Error state is the only exception (error border, see §8).
- Search icon MUST be visible at all times (default and focus states)
- Clear icon MUST only appear when `input.value.length > 0`
- Clear icon MUST NOT appear when input is empty
- Caret MUST use `color.brand.primary` in focus state (NOT `color.text.primary`, NOT browser default)
- On Web: dropdown appears below the input with a 4px gap
- On App: MUST NOT use dropdown — navigate to a full search results page instead
- On App: "Cancel" label MUST appear to the right when focused

---

## 5. Variants Overview

### Platform Variants

| Platform | Height | Icon–Text Gap | Dropdown | Cancel Label |
|----------|--------|--------------|----------|-------------|
| Web | 40px | 8px (`web-spacing-gap2`) | YES — `shadow.md` | NO |
| App | 36px | 6px (`app-spacing-gap2`) | NO — full page results | YES — on focus |

### State Variants

| State | Trigger | Container | Icon + Placeholder | Caret | Notes |
|-------|---------|-----------|--------------------|-------|-------|
| Default | No interaction | `color.bg.weak` fill, NO border | `color.text.tertiary` | Hidden | Resting state |
| Hover | Pointer over input | `color.bg.weak` fill, NO border | `color.text.primary` | Hidden | Web only; text/icon lift to primary |
| Focus / Active | Click or Tab into input | `color.bg.weak` fill, NO border | `color.text.primary` | Visible, `color.brand.primary` | Cursor blinks in brand blue |
| Typing | User enters text | `color.bg.weak` fill, NO border | input text `color.text.primary` | Visible, `color.brand.primary` | Clear icon appears |
| Disabled | Interaction blocked | `color.bg.weak` fill (lower opacity if available) | `color.text.quaternary` | Hidden | Input blocked |
| Error | Invalid query / no results | `color.bg.weak` fill + `color.status.error` 1px border | unchanged | Visible on focus | Helper text required |

### State Priority (highest to lowest)

1. Disabled
2. Error
3. Focus / Active
4. Hover
5. Default

### Decision Logic

```
if state == disabled:
    apply disabled styles (highest priority, ignore all others)

if state == error:
    apply error border + helper text (overrides focus/hover)

if state == focus:
    apply focus styles (overrides hover)

if state == hover AND NOT focus:
    apply hover border only

default:
    apply default styles
```

---

## 6. Content Guidelines

### Placeholder Text

- MUST be descriptive of what can be searched (e.g. "Search stocks, news, people...")
- MUST NOT be generic ("Search..." alone is acceptable but less helpful)
- SHOULD hint at available content types when space allows
- Typography: 14px Medium, `color.text.tertiary`

### Error Helper Text

- MUST explain the cause (e.g. "No results found. Try a different ticker or keyword.")
- MUST NOT show error state for empty input — error is for invalid / failed queries only
- MUST NOT show error border without accompanying helper text

### Result Items

- Primary text: `color.text.primary`, 14px Medium
- Secondary text (category / source): `color.text.secondary`, 12px Regular
- Match highlight: `color.text.primary`, 14px SemiBold
- Section headers: `color.text.tertiary`, 12px Medium

---

## 7. Layout & Composition

### Web — Navigation Bar

- search-input sits within the global nav bar
- Follow `layout-grid-skill.md` for nav layout constraints
- search-input expands with its container; min-width 200px

### Web — Module-Level

- search-input placed at the top of a content module
- Spacing below search-input to content: `web-spacing-gap4` (24px)

### Web — Dropdown Positioning

- Dropdown MUST be positioned directly below the input, left-aligned
- Dropdown width MUST match or exceed the input width
- Top offset from input: 4px (`web-spacing-gap1`) — MUST NOT be 0px (flush)
- Dropdown item padding: 10px vertical, 12px horizontal

### App — Top-of-Page

- search-input placed at the top of the screen
- Spacing below search-input to content: `app-spacing-gap6` (16px)
- Horizontal page padding applies to search-input

### Inside a Card

| Container Width | Horizontal Padding | Vertical Padding |
|----------------|-------------------|-----------------|
| > 500px | 20px | 24px |
| ≤ 500px | 12px | 16px |

---

## 8. Behavior

### Color States

| Element | State | Token |
|---------|-------|-------|
| Container background | Default / Hover / Focus / Typing | `color.bg.weak` |
| Container background | Disabled | `color.bg.weak` |
| Container background | Error | `color.bg.weak` |
| Container border | Default / Hover / Focus / Typing / Disabled | NONE (0 border) |
| Container border | Error | `color.status.error`, 1px |
| Search icon | Default | `color.text.tertiary` |
| Search icon | Hover / Focus | `color.text.primary` |
| Placeholder text | Default | `color.text.tertiary` |
| Placeholder text | Hover / Focus | `color.text.primary` |
| Input text | Typing | `color.text.primary` |
| Caret | Focus / Typing | `color.brand.primary` |
| Clear icon | Has content | `color.text.tertiary` |
| All text / icons | Disabled | `color.text.quaternary` |

### Dropdown Result Item States

| State | Visual | Notes |
|-------|--------|-------|
| Default | Transparent background | — |
| Hover | Stacked `color.interaction.hover` overlay | MUST NOT use solid fill |
| Click / Press | Stacked `color.interaction.active` overlay | Navigate on release |
| Selected (keyboard) | `color.button.grey.default` solid fill | Keyboard selection highlight |

### Clear Icon Behavior

- Tap / click: clears input text, input remains focused
- Clear icon hover: circular `color.interaction.hover` swatch behind icon (border-radius 50%)
- Clear icon tap target: minimum 24×24px achieved via padding (MUST NOT enlarge icon)

### App Cancel Behavior

- "Cancel" tap: clears input AND dismisses keyboard AND returns to default (unfocused) state
- Cancel label: `color.text.primary`, 14px Medium

### Keyboard Behavior

- `↓` / `↑`: navigate suggestion options
- `Enter`: select highlighted option / submit query
- `Escape`: close dropdown and return focus to input
- `Tab`: move focus to next element (close dropdown)

---

## 9. Platform Differences

### Web

| Property | Value |
|----------|-------|
| Height | 40px |
| Horizontal padding | 12px each side |
| Icon–text gap | 8px (`web-spacing-gap2`) |
| Radius | `radius.pill` (capsule) |
| Dropdown | YES — `shadow.md`, `color.background.layer4`, `radius.md` |
| Hover state | YES — border changes to `color.divider.level1` |
| Cancel label | NO |

### App

| Property | Value |
|----------|-------|
| Height | 36px |
| Horizontal padding | 12px (`app-spacing-gap5`) |
| Icon–text gap | 6px (`app-spacing-gap2`) |
| Radius | `radius.pill` (capsule) |
| Dropdown | NO — navigate to full results page |
| Hover state | N/A (touch interface) |
| Cancel label | YES — shown on focus, 8px gap from input (`app-spacing-gap4`) |

### Key Differences

- Web uses dropdown for suggestions; App navigates to a full search results page
- App shows "Cancel" text label on focus; Web does not
- Hover state is Web-only (mouse interaction)
- App has slightly smaller height (36px vs 40px) and tighter icon–text gap (6px vs 8px)

---

## 10. Do / Don't

| | Practice | Reason |
|---|---------|--------|
| DO | Use search-input exclusively for search / query input | Clear component semantics |
| DO | Show clear icon only when input has content | Reduces visual noise when empty |
| DO | Use `shadow.md` for dropdown (Web) | Correct visual weight for anchored panel |
| DO | Show "Cancel" label on mobile when focused | Provides clear dismissal path for touch users |
| DO | Use `radius.pill` for all search-input instances | Design system consistency |
| DO | Maintain 4px gap between input and dropdown | Prevents visual crowding |
| DON'T | Use search-input for general form fields | Use Input component instead |
| DON'T | Show dropdown on mobile | Navigate to full results page |
| DON'T | Use `box-shadow` on the input container itself | Only the dropdown gets shadow |
| DON'T | Use brand blue for focus border | Use `color.text.primary` — not brand color |
| DON'T | Use solid fill for dropdown hover | Must use stacked overlay (`color.interaction.hover`) |
| DON'T | Use `shadow.lg` for dropdown | Too heavy — use `shadow.md` |
| DON'T | Make clear icon tap target < 24×24px | Accessibility / touch target requirement |
| DON'T | Show error border without helper text | Error state requires explanation |
| DON'T | Use square corners on search-input | Always `radius.pill` |

---

## 11. Decision Table

| Context | Platform | Height | Dropdown | Cancel | Icon–Text Gap | Notes |
|---------|----------|--------|----------|--------|--------------|-------|
| Global nav search | Web | 40px | YES | NO | 8px | Primary search entry point |
| Module filter search | Web | 40px | YES | NO | 8px | Filter within a content section |
| Standalone search page | Web | 40px | YES | NO | 8px | Dedicated search page |
| Top-of-page search | App | 36px | NO | YES | 6px | Navigate to results page |
| In-module filter | App | 36px | NO | YES | 6px | Filter within a module |

| State | Border | Background | Icon + Placeholder | Caret | Clear | Dropdown |
|-------|--------|-----------|--------------------|-------|-------|----------|
| Default | NONE | `bg.weak` | `text.tertiary` | Hidden | Hidden | Hidden |
| Hover | NONE | `bg.weak` | `text.primary` | Hidden | Hidden | Hidden |
| Focus (empty) | NONE | `bg.weak` | `text.primary` | `brand.primary` | Hidden | Optional (recent) |
| Focus (typing) | NONE | `bg.weak` | input `text.primary` | `brand.primary` | Visible | Visible (if results) |
| Disabled | NONE | `bg.weak` | `text.quaternary` | Hidden | Hidden | Hidden |
| Error | `status.error` | `bg.weak` | unchanged | `brand.primary` (on focus) | Visible | Hidden |

---

## 12. Related Documents

- `ainvest-design-system/references/components/search-input.md`
- `ainvest-design-system/references/components/button.md`
- `ainvest-design-system/SKILL.md`
- `ainvest-design-system/references/tokens/color.md`
- `ainvest-design-system/references/tokens/typography.md`
- `ainvest-design-system/references/tokens/spacing.md`
- `ainvest-design-system/references/tokens/shadow.md`
- `ainvest-design-system/references/tokens/radius.md`
