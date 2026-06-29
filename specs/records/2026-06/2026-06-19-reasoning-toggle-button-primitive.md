# Reasoning Toggle Button Primitive

Date: 2026-06-19

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model. SSE means Server-Sent Events, the streaming transport
used for task updates.

## Problem

Independent GUI review found `ReasoningPart` renders its collapse toggle as a
raw `<button class="reasoning-label">`. `messages.css` then implements a
private button shell and explicitly removes the focus outline on
`:focus-visible`. This makes the reasoning toggle diverge from the shared
`Button` primitive, even though the toggle is part of every transcript that
contains reasoning.

## Recall

| Source                                                  | Relevant constraint                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-June overlay streaming text main-thread plan | `ReasoningPart` is part of the streaming transcript path; streaming text must remain synchronous and not reparse markdown while running. |
| `2026-06-18-chat-composer-button-primitive-owner.md`    | Operation buttons route through shared `Button` semantics; local classes should not own button chrome.                                   |
| `2026-06-18-connection-banner-button-primitive.md`      | Shared `.oc-button` owns keyboard focus, hover policy, and density for action controls.                                                  |
| `packages/overlay/src/components/ui/Button.tsx`         | `Button` emits the canonical `.oc-button` and `data-variant`, `data-size`, `data-tone` attributes.                                       |
| `packages/overlay/src/styles/primitives/button.css`     | `.oc-button:focus-visible` owns the shared accent outline.                                                                               |

## Evidence Sweep

| Sweep                                                                                                                                 | Result                                                                                                                                                                     | Decision                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `rg -n -e "ReasoningPart" -e "reasoning-label" -e "reasoning-toggle" packages/overlay/src packages/overlay/test specs` | Production owner is `ReasoningPart.tsx`; all rendered transcript reasoning enters through `CardParts.tsx`. Tests still pin `.reasoning-label` as a legitimate tier-3 pill. | Replace the component and retire the old selector from tests.                                   |
| `messages.css` inspection                                                                                                             | `.reasoning-label:hover, .reasoning-label:focus-visible` sets `outline: none`.                                                                                             | Delete `.reasoning-label`; keep pill geometry only on `.oc-button[data-ui="reasoning-toggle"]`. |
| `reasoning-part.test.ts` inspection                                                                                                   | The test locks raw `type="button"` but not `Button`, and still expects an obsolete streaming expression.                                                                   | Update it to assert primitive ownership and current streaming model.                            |
| Typography tests inspection                                                                                                           | Three tests list `.reasoning-label` as a valid uppercase pill.                                                                                                             | Switch the negative-control selector to `.oc-button[data-ui="reasoning-toggle"]`.               |

## Fix Plan

1. Import `Button` in `ReasoningPart`.
2. Replace the raw toggle with `Button variant="ghost" size="mini"
tone="accent" data-ui="reasoning-toggle"`.
3. Preserve `aria-expanded`, `event.stopPropagation()`, and collapse behavior.
4. Remove `.reasoning-label` from `messages.css` and add only
   `.oc-button[data-ui="reasoning-toggle"]` geometry/typography/icon sizing.
   Do not suppress `.oc-button:focus-visible`.
5. Update static tests so the old selector is no longer part of the contract.
6. Add Node/Playwright visual coverage for the focused reasoning toggle in
   light and dark themes.

## Acceptance

- `ReasoningPart.tsx` contains no raw `<button>` for the toggle.
- Runtime toggle is `.oc-button[data-ui="reasoning-toggle"]`.
- `messages.css` no longer defines `.reasoning-label` or removes focus outline
  for the reasoning toggle.
- Typography tests keep uppercase pill coverage through the new Button selector.
- Browser screenshots show visible focus rings in light and dark themes.
- Expanding/collapsing still hides and shows `.reasoning-text`.
