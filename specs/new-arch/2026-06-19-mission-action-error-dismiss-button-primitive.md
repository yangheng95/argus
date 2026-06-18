# Mission Action Error Dismiss Button Primitive

Date: 2026-06-19

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model.

## Problem

Independent GUI review found the Mission global action error alert dismiss
control is a raw `<button>` with a private `.mission-action-error-dismiss`
button shell. The rule only sets transparent background, text color, and
cursor, so keyboard focus, hover feedback, hit target, and icon sizing do not
come from the overlay's shared `Button` primitive.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-18-conversation-agent-rail-button-primitive.md` | Icon navigation actions use `Button`; local CSS may tune geometry through `.oc-button[data-ui]`. |
| `2026-06-18-chat-composer-button-primitive-owner.md` | Operation buttons route through shared `Button` semantics instead of raw local shells. |
| `2026-06-18-connection-banner-button-primitive.md` | Global diagnostic actions inherit shared button density, hover, and focus-visible behavior. |
| `packages/overlay/src/components/ui/Button.tsx` | `Button` owns the canonical `.oc-button` class and `variant`, `size`, `tone` attributes. |
| `packages/overlay/src/styles/primitives/button.css` | `.oc-button:focus-visible` owns the shared focus ring and icon-action hover contract. |

## Evidence Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n -e "mission-action-error-dismiss" -e "mission-global-action-error" packages/overlay/src packages/overlay/test specs specs/new-arch` | Production ownership is limited to `Mission.tsx` and `mission.css`. | Replace this one dismiss control; no compatibility branch. |
| `Select-String MissionList.tsx -Pattern "<button","Button"` | Mission row actions already use `Button`, but unrelated row/search raw buttons remain separate findings. | Do not expand this fix into MissionList. Keep scope to the independent agent finding. |
| `button.css` inspection | Icon actions have `data-chrome="icon-action"` hover/focus styling and `.oc-button:focus-visible`. | Use `Button variant="ghost" size="icon" tone="neutral" data-chrome="icon-action"`. |
| `mission-launcher-component.test.ts` inspection | The file is already dirty in the main worktree from unrelated Mission archive work. | Add a focused static test file instead of editing that dirty test. |

## Fix Plan

1. Import `Button` in `Mission.tsx`.
2. Replace the raw dismiss `<button>` with `Button` using stable
   `data-ui="mission-action-error-dismiss"` and `data-chrome="icon-action"`.
3. Add `title` matching the existing `aria-label` for pointer affordance.
4. Delete the private `.mission-action-error-dismiss` button shell and add only
   scoped `.mission-action-error .oc-button[data-ui="mission-action-error-dismiss"]`
   sizing/icon rules.
5. Add static coverage that rejects the old raw class and proves the primitive
   attributes.
6. Add Node/Playwright visual coverage for focus-visible and screenshot
   evidence.

## Acceptance

- `Mission.tsx` imports and uses the shared `Button` primitive for the global
  action error dismiss control.
- No `class="mission-action-error-dismiss"` raw button remains.
- `mission.css` no longer defines `.mission-action-error-dismiss` as a private
  button shell.
- Runtime DOM renders the dismiss control as `.oc-button` with
  `data-ui="mission-action-error-dismiss"` and `data-chrome="icon-action"`.
- Keyboard focus uses the shared `.oc-button:focus-visible` outline.
- Browser screenshot evidence confirms the focused dismiss control is visible
  and nonblank.
