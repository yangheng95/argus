# Titlebar Brand Guide Open State And Contrast Coverage

Date: 2026-06-20

CSS means Cascading Style Sheets. GUI means Graphical User Interface. DOM means
Document Object Model. ARIA means Accessible Rich Internet Applications.

## Recall

| Source                                                   | Relevant constraint                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                              | UI work must avoid double sources and include visual/browser evidence.                                        |
| `2026-06-18-titlebar-brand-guide-popover-primitive.md`   | Brand Guide is a Kobalte Popover, not a CSS-only hover card.                                                  |
| `2026-06-18-popup-contrast-light-palette.md`             | Non-Select popup readability belongs in `popup-contrast-matrix`.                                              |
| `2026-06-20-kobalte-trigger-open-state-single-source.md` | Kobalte triggers must use emitted `[data-expanded]` for open-state chrome while keeping ARIA semantic checks. |

## Problem

Independent GUI review found `TitlebarBrandGuide` was missed by the Kobalte
trigger open-state sweep:

- `TitlebarBrandGuide.tsx` uses `Popover.Root`, `Popover.Trigger`, and
  `Popover.Content`.
- `titlebar.css` still styles open trigger chrome through
  `.brand-guide[aria-expanded="true"]`.
- `owner-surface-consistency.test.ts` pins that ARIA selector.
- `titlebar-brand-guide-popover.test.ts` verifies `aria-expanded` but not the
  Kobalte `data-expanded` runtime attribute.
- `popup-contrast-matrix.test.ts` samples titlebar menu popups but not the
  Brand Guide popover card.

Using ARIA as visual state makes accessibility metadata a parallel styling
source beside Kobalte's runtime state attributes. The missing popup matrix
sample also leaves Brand Guide text outside the light-theme popup contrast
guard.

## Evidence Sweep

| Sweep                                                                                                                                  | Result                                                                                                                                 | Decision                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `rg -n -e 'brand-guide' -e '\[aria-expanded="true"\]' -e 'data-expanded' packages/overlay/src packages/overlay/test specs -S` | The remaining Brand Guide open selector is isolated to `titlebar.css` and tests. Other Kobalte triggers already use `[data-expanded]`. | Migrate only Brand Guide open chrome.                                     |
| `TitlebarBrandGuide.tsx` review                                                                                                        | Popover Trigger is a Kobalte trigger and already receives Kobalte runtime attributes.                                                  | Do not add local `data-open` or `data-active`; rely on `[data-expanded]`. |
| `popup-contrast-matrix.test.ts` review                                                                                                 | Existing matrix samples executor, worktree, recent directory, workspace launcher, titlebar menu, and command palette.                  | Add a Brand Guide card sample.                                            |
| Independent explorer audit                                                                                                             | Confirmed the 6/20 open-state sweep missed Brand Guide.                                                                                | Proceed with targeted CSS/test coverage.                                  |

## Fix Plan

1. Replace `.brand-guide[aria-expanded="true"]` with
   `.brand-guide[data-expanded]` in `titlebar.css`.
2. Update static tests to require the `[data-expanded]` selector and reject the
   retired ARIA visual selector.
3. Extend the Brand Guide browser test to assert open triggers expose both
   `aria-expanded="true"` and `data-expanded`, then lose `data-expanded` after
   Escape.
4. Add `.brand-guide-card` to the non-Select popup contrast matrix, sampling
   kicker, titles, body copy, step indices, and step copy.
5. Do not add component-local colors or local open-state mirror attributes.

## Acceptance

- Brand Guide visual open chrome uses Kobalte `[data-expanded]`.
- `aria-expanded` remains a semantic/browser assertion, not a CSS selector.
- Popup contrast matrix includes the Brand Guide card and still passes on the
  light opaque popup surface.
- Real browser screenshots verify Brand Guide popover geometry and state.
