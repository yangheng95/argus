# Chat Bubble Disclosure Button Scope

Date: 2026-06-19

DOM means Document Object Model. UI means User Interface.

## Problem

Independent GUI review found `ChatBubble` renders the collapsed preview and TODO
summary outside `.chat-bubble__head-main`. A collapsed bubble visibly presents
those rows as part of the header, but a single click on the preview/TODO text
does not activate the disclosure button. `CardHeader` already keeps those rows
inside `.card__head-main`, so the two card families have diverged.

The same sweep also showed `.card__head-main` and `.chat-bubble__head-main`
remain raw `<button>` elements while other overlay action controls have moved
to the shared `Button` primitive. The current `Button` API blocks this migration
because it omits `class` and `classList`, preventing layout-specific shell
classes from being composed with `.oc-button`.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-18-card-header-nested-interactions.md` | `.card__head-main` and `.chat-bubble__head-main` are the native disclosure buttons and must wrap identity/title, collapsed preview, and TODO summary. Action chrome stays as a sibling. |
| `2026-06-19-goal-workflow-button-primitive.md` | Disclosure-like header controls should use the shared `Button` primitive when they are real buttons. |
| `packages/overlay/test/button-primitive.test.ts` | `Button` owns the canonical `.oc-button` data-attribute contract and focus ring. |
| `packages/overlay/src/styles/primitives/button.css` | `Button` supports surface-specific sizing through CSS variables; consumers should override variables rather than hand-roll a parallel primitive. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n 'card__head-main|chat-bubble__head-main|card__collapsed-preview|CardTodoSummary' packages/overlay/src packages/overlay/test specs/new-arch` | `CardHeader.tsx` and `ChatBubble.tsx` are the live disclosure owners. Browser tests query these classes. Static tests pin the old raw-button structure. | Fix both owners together so structured cards and chat bubbles share the same primitive contract. |
| `rg -n '<Button[^>]*(class=|classList=)|ButtonProps|class="oc-button"' packages/overlay/src/components packages/overlay/test` | `ButtonProps` currently omits `class/classList`; tests explicitly assert that omission. Existing consumers do not rely on passing custom classes. | Extend `Button` to compose optional `class` with `oc-button`, preserving data attributes and existing consumers. Add tests for this composition. |
| `rg -n '<button|</button>|<Button|</Button>' packages/overlay/src/components/CardHeader.tsx packages/overlay/src/components/ChatBubble.tsx packages/overlay/src/components/GoalWorkflowGroup.tsx` | `GoalWorkflowGroup` already uses `Button`; `CardHeader` and `ChatBubble` are the remaining raw disclosure buttons in this family. | Convert both to `Button` with `data-ui="card-head-main"` and `data-ui="chat-bubble-head-main"`. |
| `packages/overlay/src/styles/surfaces/card.css` and `packages/overlay/src/styles/surfaces/chat-bubble.css` | The header controls already have token-based focus/spacing rules, but `.oc-button` adds height, padding, and hover variables by default. | Keep the existing shell classes as layout owners and override `--oc-button-*` variables there. Do not introduce raw colors or a second token family. |

## Fix Plan

- Update `Button` so optional `class` composes with `oc-button` while `classList`
  remains pass-through.
- Convert `.card__head-main` and `.chat-bubble__head-main` to `Button`.
- Add `data-ui` identities for both disclosure buttons.
- Move `ChatBubble` collapsed preview and TODO summary inside
  `.chat-bubble__head-main`.
- Keep `CardHeaderChrome` as the sibling action rail outside the disclosure
  buttons.
- Update CSS to preserve current geometry while adopting `.oc-button`.

## Acceptance

- `CardHeader.tsx` and `ChatBubble.tsx` import and render `Button` for their
  disclosure controls.
- `ChatBubble` preview and TODO summary are descendants of
  `.chat-bubble__head-main`.
- `CardHeaderChrome` remains outside both disclosure buttons.
- `Button` composes caller classes with `.oc-button` and keeps the canonical
  data attributes.
- Focus and hover states use existing token-derived CSS variables.
- Browser evidence shows clicking collapsed preview text toggles the disclosure
  and the focused header remains visually coherent.
