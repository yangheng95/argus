# Connection Banner Button Primitive

Date: 2026-06-18

UI means User Interface. SSE means Server-Sent Events, the browser stream used
for live task updates.

## Problem

Independent GUI review found `ConnectionBanner` renders two raw `<button>`
controls with `class="conn-banner__action"`. The component then duplicates
button chrome in `conn-banner.css`: border, background, padding, radius, hover,
and focus-visible rules.

The banner is a global diagnostic surface, so its actions should inherit the
same button density, focus ring, keyboard behavior, and hover policy as the
rest of the overlay through `Button`, not through a local parallel button
system.

## Recall

| Source                                                | Relevant constraint                                                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md` | Interactive overlay controls should route through mature/shared primitives instead of local hand-rolled controls. |
| `packages/overlay/src/components/ui/Button.tsx`       | `Button` is the overlay's single JSX button primitive and owns `variant`, `size`, and `tone` data attributes.     |
| `packages/overlay/src/styles/primitives/button.css`   | `.oc-button` owns padding, height, hover, focus-visible, border, and disabled semantics.                          |
| `packages/overlay/src/components/App.tsx`             | `ConnectionBanner` is mounted globally once; no second surface needs a compatibility branch.                      |

## Impact Sweep

| Sweep                                                                                       | Result                                                                                                                                                                 | Decision                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n "ConnectionBanner" packages/overlay/src packages/overlay/test specs`  | Only `App.tsx` mounts the component; `app-shell.test.ts` pins that ownership.                                                                                          | Keep the same component and mount point.                                                                                                |
| `rg -n "conn-banner" packages/overlay/src packages/overlay/test specs`       | `ConnectionBanner.tsx`, `conn-banner.css`, `controls.test.ts`, `titlebar-menubar.test.ts`, and `overlay-architecture-guards.test.ts` reference the local action class. | Remove the local action class and update tests to target stable `data-ui` button hooks.                                                 |
| `rg -n "connection-banner" packages/overlay/src packages/overlay/test specs` | Only `data-testid="connection-banner-setup"` exists.                                                                                                                   | Add semantic `data-ui="connection-banner-setup"` and `data-ui="connection-banner-reload"` while keeping the existing test id for setup. |

## Fix Plan

- Import `Button` in `ConnectionBanner.tsx`.
- Replace both raw action buttons with `Button variant="ghost" size="sm"
tone="neutral"`.
- Add stable `data-ui` hooks for setup and reload.
- Delete `.conn-banner__action` CSS rules; the banner CSS keeps only surface,
  dot, and text layout.
- Keep `.conn-banner` explicitly interactive with `pointer-events: auto`
  because it is mounted in the global overlay layer.
- Update static tests to reject the retired local button class and assert the
  shared primitive.
- Add browser coverage that forces the offline banner, verifies both actions are
  `.oc-button` elements, tabs between them, opens settings through setup, and
  saves a screenshot.

## Acceptance

- No `class="conn-banner__action"` remains.
- `conn-banner.css` no longer defines action button chrome.
- `ConnectionBanner` uses the shared `Button` primitive for setup and reload.
- Browser screenshot shows the offline banner actions aligned and readable.
- Browser validation proves setup can receive focus, Tab reaches reload, and
  setup still opens the settings dialog.
