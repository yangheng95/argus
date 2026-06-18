# Conversation Agent Rail Button Primitive

Date: 2026-06-18

## Problem

`ConversationAgentRail` renders its avatar navigation controls as raw icon-only
buttons. The controls duplicate button chrome in `conversation.css`, depend on
`title` for the accessible name, and do not share the `Button` primitive focus
contract. Because `Avatar` is intentionally `aria-hidden`, the clickable control
has no explicit accessible label source.

## Recall

| Source | Existing decision |
| --- | --- |
| `2026-06-03-overlay-workbench-page-prd.md` QUALITY-001 | Every icon-only button must have `aria-label`. |
| `2026-06-18-workspace-split-launcher-button-primitive.md` | Operation buttons route through `Button`; local CSS may tune geometry through `.oc-button[data-ui]`. |
| `2026-06-18-chat-composer-button-primitive-owner.md` | Icon actions use shared `Button` semantics rather than local raw button shells. |
| `button.css` | `.oc-button:focus-visible` owns the shared focus ring. |

## Evidence Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "ConversationAgentRail|conversation-agent-rail__avatar-button" packages/overlay/src packages/overlay/test specs/new-arch` | The only live avatar navigation button is in `ConversationAgentRail.tsx`; tests currently lock layout, not primitive ownership. | Replace only that control; preserve rail projection and drag-to-scroll. |
| `Avatar.tsx` inspection | `Avatar` is decorative and `aria-hidden="true"`. | Put the accessible name on the button with `aria-label={compactLabel(record())}`. |
| `conversation.css` inspection | `.conversation-agent-rail__avatar-button` defines `appearance`, `border`, `background`, hover, and geometry. | Retire the private button shell and move rail-specific dimensions to `.oc-button[data-ui="conversation-agent-rail-locate"]`. |

## Fix

- Import and use `Button` in `ConversationAgentRail`.
- Render avatar navigation with `variant="ghost"`, `size="icon"`,
  `tone="neutral"`, `data-ui="conversation-agent-rail-locate"`, and
  `aria-label={compactLabel(record())}`.
- Keep `title` as the pointer tooltip, but make `aria-label` the explicit
  accessibility source.
- Replace private `.conversation-agent-rail__avatar-button` shell rules with
  `.conversation-agent-rail .oc-button[data-ui="conversation-agent-rail-locate"]`
  geometry and hover/focus token overrides.
- Add static and browser coverage for primitive ownership, accessible name, and
  focus-visible screenshot evidence.

## Acceptance

- `ConversationAgentRail` contains no raw `<button>` for avatar navigation.
- Avatar locate controls render with `.oc-button`.
- Icon-only controls have non-empty `aria-label` matching `compactLabel`.
- Keyboard focus uses the shared `.oc-button:focus-visible` outline.
- Browser screenshot evidence confirms the focused rail control is visible and
  nonblank.
