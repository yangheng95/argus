# Conversation Turn Toolbar Unification

Date: 2026-08-07

UI means User Interface. USD means United States dollars.

## Recall

| Item                       | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request               | The toolbars at the lower-left of message cards have inconsistent styling and visibility, misuse icons, and need end-to-end testing plus refinement to a modern design standard.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Acceptance criteria        | User and Agent turns share one coherent footer-toolbar grammar; capability differences do not change the shell, control geometry, icon language, metadata treatment, or disclosure behavior. Copy feedback, overflow commands, exact usage details, timestamp semantics, pointer use, and keyboard access remain functional. The real desktop Overlay is exercised in representative user, completed Agent, hover/focus, menu, and usage states; task-bound screenshots are personally reviewed and corrected before delivery.                                                                              |
| Hard constraints           | Keep `ConversationTurnControl` as the sole ordinary-turn toolbar and `CardOverflowMenu` as the sole command menu. Reuse the existing Button, Icon, DropdownMenu, Popover, and SegmentedControl primitives. Preserve truthful capability and usage projection; do not manufacture unavailable actions or usage, add a second toolbar, fallback, compatibility branch, gate, state machine, hard-coded palette, mobile scope, or UI automated test. Use Node for browser work. Preserve unrelated working-tree changes and push only task-owned changes to legacy remote.                                          |
| Sources read               | Root `AGENTS.md`; Browser-control skill; `specs/current/architecture/12-overlay-card-system.md`; the 2026-08-06 Conversation turn-control implementation and refinement record; the 2026-08-03 running-action flicker record; the 2026-07-11 Agent action-icon record; current `ConversationTurnControl.tsx`, `CardOverflowMenu.tsx`, `ChatBubble.tsx`, `Icon.tsx`, `Icon.lucide.ts`, and `chat-bubble.css`; and the accepted 2026-08-06 toolbar screenshots.                                                                                                                                               |
| Whole-repository search    | `ChatBubble.tsx` has the only `ConversationTurnControl` mount. `ConversationTurnControl.tsx` is the only ordinary-turn copy, usage, and time renderer. `CardOverflowMenu.tsx` owns the only shared three-dot command menu. `chat-bubble.css` owns all footer layout and disclosure styling. The Icon registry currently maps turn usage to `Sparkles`, which is also used for Assistant/avatar/mission identity and therefore does not communicate measurement. No production duplicate bottom toolbar was found. No direct `ConversationTurnControl` UI test was found in the searched Overlay test paths. |
| Independent agent feedback | Not delegated. The user did not request multiple independent agents, and the active delegation boundary does not authorize a child agent for this bounded component repair.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Git baseline               | `v0.0.33beta` starts at `1b6dc2ad8f`, equal to `legacy-remote/v0.0.33beta`. Existing modified and untracked files belong to other work and remain outside this task.                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Root Cause

The implementation has one component but not one visual language. It places
icon-only copy and overflow controls beside a link-like usage control with a
dashed underline and a sparkle identity glyph, then reveals an unrelated text
timestamp only while hovering the entire row. Capability-driven omission is
correct, but the remaining controls do not retain a stable grouping hierarchy;
a user turn becomes a lone copy glyph while an Agent turn becomes a sequence of
unrelated button, ellipsis, label, icon, value, and delayed time fragments.

The root problem is presentation semantics, not missing capability data. The
toolbar needs two stable groups: actions and facts. Actions use one icon-button
primitive and one geometry; facts use one compact text-disclosure primitive and
one typographic hierarchy. Timestamp visibility must follow the same rule for
every eligible turn. The usage glyph must represent measurement rather than
Agent identity.

## Implementation Plan

1. Refactor the sole toolbar markup into explicit action and fact groups without
   changing callback or capability ownership.
2. Replace the usage sparkle with a Lucide measurement glyph registered through
   the existing `Icon` primitive; remove the decorative label/underline mixture
   and retain the full accessible name plus exact Popover details.
3. Make the timestamp a consistently visible quiet fact for every eligible turn,
   eliminating row-hover-only discovery and transition logic.
4. Give action and fact controls one compact height, radius, spacing, icon size,
   hover/focus treatment, and token-derived color hierarchy. Do not render empty
   groups or placeholders for unavailable capabilities.
5. Update the current card-system architecture, run formatting, typecheck,
   internationalization, Vite build, documentation health, and diff checks.
6. Start an isolated real Overlay with Node, inspect user and Agent toolbars plus
   copy feedback, overflow, usage Popover, pointer hover, and keyboard focus;
   capture and personally review fresh desktop screenshots, iterate, then perform
   a second diff and visual review.

## Progress

- [x] Inspect history, source ownership, icon registry, prior screenshots, and Git baseline.
- [x] Record Recall, root cause, acceptance criteria, and implementation plan.
- [x] Commit and push the pre-implementation plan.
- [x] Implement the unified toolbar and current-architecture update.
- [x] Complete non-UI verification and real-page visual acceptance.
- [x] Complete second review, commit only task-owned paths, and push `v0.0.33beta` to legacy remote.

## Implementation and Verification

- `ConversationTurnControl` now renders a compact action group and a quieter
  facts group inside one shared toolbar shell. Copy and overflow use identical
  icon-button geometry; total usage and the timestamp use one metadata rhythm.
- Every eligible turn exposes its timestamp at rest. Usage is represented by the
  Lucide chart-measurement glyph rather than the Sparkles identity glyph, while
  its accessible name and exact model-level Popover remain intact.
- `CardOverflowMenu` keeps one implementation but requires its caller to declare
  placement. The left-aligned Conversation toolbar opens toward message content;
  the structured-card header retains trailing-edge placement.
- The production Overlay was built and restarted against an isolated runtime at
  port `17881`. A real `openai/gpt-5.4-mini` Chat completed in session
  `ses_027b7ff22ffe3m6CmX87EUmpqx` with the exact response “Toolbar visual review
  complete.” and persisted 29,037 tokens (28,985 input, 52 output, 41 reasoning,
  zero cache read/write, and USD 0 cost).
- Manual desktop review covered user and completed-Agent rest states, persistent
  timestamps, copy feedback, the shared overflow menu, and the exact usage
  disclosure. The first menu screenshot exposed an old end-aligned placement
  that expanded over the sidebar; the caller-owned start placement was loaded
  through a production-server restart and the corrected menu was reviewed again.
- Accepted evidence:
  `specs/artifacts/2026-08-07-conversation-turn-toolbar-rest.png`,
  `specs/artifacts/2026-08-07-conversation-turn-toolbar-menu.png`, and
  `specs/artifacts/2026-08-07-conversation-turn-toolbar-usage.png`.
- No User Interface automated test was added, changed, or run. Verification used
  the real application and manual screenshots for presentation, with only
  non-User Interface static and contract checks used below.
- `bun run --cwd packages/overlay typecheck`,
  `bun run --cwd packages/overlay check:i18n`, `bun run --cwd packages/overlay build:vite`,
  `bun run docs:check`, and `git diff --check` passed. The final isolated server
  shut down cleanly and released port `17881`.

## Follow-up Recall: Direct Guidance Control

| Item                    | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User correction         | In the ordinary message toolbar, remove “Inspect AgentTrace for this session” and the disabled “Rewind is temporarily disabled” item. Promote “Add guidance” to a standalone control and remove the three-dot overflow trigger.                                                                                                                                                                                                                                          |
| Screenshot evidence     | The supplied screenshot shows the three current menu rows in order: AgentTrace, Add guidance, and disabled Rewind. Only the middle command remains useful in this surface.                                                                                                                                                                                                                                                                                               |
| Acceptance criteria     | A steerable completed Agent turn exposes one direct, labelled guidance icon button beside Copy. Activating it opens and closes the existing inline guidance form. Ordinary message toolbars expose no three-dot trigger, AgentTrace command, Rewind command, or related hidden panel. User turns and non-steerable Agent turns render no empty placeholder. Structured-card header menus remain unchanged.                                                               |
| Root cause              | Reusing the structured-card overflow menu on ordinary conversational turns leaked diagnostic and unavailable recovery commands into a lightweight message surface. The useful guidance action was hidden one interaction level deeper than its frequency and importance justified.                                                                                                                                                                                       |
| Implementation boundary | Remove the ordinary-turn dependency on `CardOverflowMenu` and delete the now-unreachable ChatBubble trace/rewind/cancel wiring. Render the existing guidance toggle directly through the shared Button and Icon primitives. Collapse `CardOverflowMenu` placement back to its single structured-card owner. Update the card-system architecture and repeat production-build plus real-page screenshot review without creating or running User Interface automated tests. |

## Follow-up Implementation and Verification

- `ConversationTurnControl` no longer mounts `CardOverflowMenu`. A steerable
  completed Agent turn renders the existing guidance action directly beside Copy
  with the shared Button and message Icon primitives; user and non-steerable
  turns do not reserve an empty action slot.
- `ChatBubble` no longer owns ordinary-turn AgentTrace, Rewind, or cancellation
  menu wiring. The direct guidance control expands a collapsed turn when needed
  and toggles the canonical inline `OperatorSteerForm`; submission remains owned
  by the existing operator-steer controller.
- `CardOverflowMenu` returned to one structured-card-header owner and one fixed
  trailing-edge placement. No parallel ordinary-message command surface remains.
- The production Overlay was rebuilt and served from the isolated runtime on port
  `17881`. Manual desktop inspection of the persisted real Chat showed one
  labelled Add guidance button, zero ordinary-message overflow triggers, zero
  AgentTrace commands, and zero Rewind commands. Activating the button exposed
  the scoped-guidance textbox and Steer action; activating it again closed the
  form.
- Accepted follow-up evidence:
  `specs/artifacts/2026-08-07-conversation-turn-direct-guidance-rest.png` and
  `specs/artifacts/2026-08-07-conversation-turn-direct-guidance-open.png`.
- No User Interface automated test was added, changed, or run. The follow-up used
  the real application plus manual screenshot review. Non-User Interface checks
  were `bun run --cwd packages/overlay typecheck`,
  `bun run --cwd packages/overlay check:i18n`,
  `bun run --cwd packages/overlay build:vite`, `bun run docs:check`, and
  `git diff --check`. The isolated server shut down cleanly and released port
  `17881`.

## Follow-up Recall: Hover Disclosure

| Item                | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User correction     | “改成hover到卡片才显示”: the ordinary-message toolbar must be absent at rest and appear when the pointer enters its owning message card.                                                                                                                                                                                                                                 |
| Acceptance criteria | Resting user and completed-Agent cards do not visibly expose their toolbar. Hovering either card reveals the complete toolbar without moving card content. Moving from the card into the revealed toolbar keeps it interactive. Keyboard focus within the card or toolbar also reveals it, and the toolbar stays available while guidance or usage disclosure is active. |
| Hard constraints    | Reuse the current toolbar and shared primitives; do not add another control surface, JavaScript hover state, fallback rendering path, or User Interface automated test. Validate through production build, real-page pointer interaction, screenshots, and manual visual review.                                                                                         |
| Read evidence       | `ConversationTurnControl` is the single ordinary-turn toolbar. It is a direct child of `.chat-bubble-shell`, following the owning `.chat-bubble`; the shell already spans the card width and contains the guidance form. The current toolbar CSS has no disclosure rule.                                                                                                 |
| Repository search   | Focused search found the toolbar ownership only in `ChatBubble.tsx` and `chat-bubble.css`; no component-level hover state is needed. Existing shared opacity and motion tokens are preferred over hard-coded values.                                                                                                                                                     |

## Hover Disclosure Implementation and Verification

- The existing `.conversation-turn-control` stays mounted in layout but is
  transparent, hidden from interaction, and offset slightly at rest. Hover or
  keyboard focus within `.chat-bubble-shell` reveals it with the shared fast
  duration and standard timing tokens. An expanded toolbar control also retains
  disclosure.
- The rule is CSS-only and applies equally to user and completed-Agent cards. It
  adds no component hover state, alternate renderer, or duplicated command
  ownership.
- The production Overlay was rebuilt and served from the isolated runtime on port
  `17881`. Real-page pointer inspection reported the direct guidance control
  hidden at rest and visible after entering the completed-Agent card. Moving from
  the card into the toolbar kept the button interactive; clicking it opened the
  canonical scoped-guidance form.
- Manual desktop review confirmed that disclosure does not move either card or
  surrounding conversation content and that the compact toolbar remains visually
  aligned with its owning card.
- Accepted evidence:
  `specs/artifacts/2026-08-07-conversation-turn-toolbar-hover-rest.png` and
  `specs/artifacts/2026-08-07-conversation-turn-toolbar-hover-visible.png`.
- No User Interface automated test was added, changed, or run. Verification used
  the real application and manual screenshots for presentation, with
  `bun run --cwd packages/overlay typecheck`,
  `bun run --cwd packages/overlay check:i18n`,
  `bun run --cwd packages/overlay build:vite`, `bun run docs:check`, and
  `git diff --check` as non-User Interface checks. The isolated server shut down
  cleanly and released port `17881`.
