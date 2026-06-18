# Titlebar Brand Guide Popover Primitive

Date: 2026-06-18

CSS means Cascading Style Sheets.

## Problem

The titlebar brand guide is still a static HTML hover/focus card:

- `index.html` owns both the trigger and the full guide content.
- `titlebar.css` owns the open/closed state with descendant hover/focus selectors.
- The guide card is marked `aria-hidden="true"` even when visually shown.
- The fourth usage line still mentions the removed `Tools` menu.

This creates a second titlebar interaction implementation beside the Kobalte
menubar and popover primitives already used by the overlay.

## Recall

| Source | Existing decision |
| --- | --- |
| `2026-06-17-titlebar-menu-order-tools-removal.md` | Top-level titlebar menus are exactly Workspace, Provider, Run, View, Settings, Help; `Tools` is retired. |
| `2026-06-18-retire-titlebar-nav-residue.md` | Dead static titlebar selector families must stay retired while Kobalte-owned titlebar surfaces remain live. |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md` | Popover interactions should use mature primitives; `ExecutorSelector` already uses `@kobalte/core/popover`. |

## Impact Sweep

| Sweep | Result |
| --- | --- |
| `rg -n "brand-guide|brand\\.guide|solidTitlebarBrandGuide|guide_usage_4" packages/overlay/src packages/overlay/test specs/new-arch` | Brand guide is limited to static HTML, i18n strings, `titlebar.css`, titlebar browser geometry checks, and architecture/surface guards. |
| `rg -n "@kobalte/core/popover|Popover\\.Root|Popover\\.Trigger|Popover\\.Content|anchorRef" packages/overlay/src/components packages/overlay/test` | `ExecutorSelector.tsx` is the existing Kobalte Popover pattern. |
| `rg -n "tools|Tools|工具" packages/overlay/src/i18n packages/overlay/src/index.html packages/overlay/src/components/titlebar` | `brand.guide_usage_4` is the stale user-facing titlebar copy that still mentions the removed Tools menu. |

## Fix

- Replace the static brand guide markup in `index.html` with a Solid mount.
- Add `TitlebarBrandGuide.tsx` using Kobalte Popover for trigger/content semantics.
- Resolve the brand SVG through the Vite asset graph from `TitlebarBrandGuide.tsx`
  so dev, browser tests, and `dist-vite` all load one bundled resource path.
- Keep `titlebar.css` as the visual owner only; remove CSS-only card reveal logic.
- Move compact brand media rules after the base brand rules so the hidden
  copyblock and narrow card width apply at small breakpoints.
- Remove the old absolute CSS positioning from the card; Kobalte Popover owns
  placement, while mobile CSS only adds a visual downward transform so the card
  clears the wrapped titlebar.
- Update guide copy so it matches the current menu set and does not mention Tools.
- Add source guards proving the brand guide has one owner and one popover primitive.

## Acceptance

- Static HTML no longer owns `.brand-guide` or `.brand-guide-card` content.
- `TitlebarBrandGuide.tsx` owns the trigger/card and uses `Popover.Root`,
  `Popover.Trigger`, and `Popover.Content`.
- The card is not `aria-hidden` and Escape/outside click behavior is delegated to
  Kobalte Popover.
- The brand logo request succeeds in the real browser page and is not a bare
  runtime-relative string that can fall out of `dist-vite`.
- The stale `Tools` wording is gone from brand guide copy.
- At compact width, the Project menu does not cover the brand trigger hit area.
- Targeted tests, overlay typecheck, docs check, real browser screenshots, and
  a second review pass succeed before commit and push.
