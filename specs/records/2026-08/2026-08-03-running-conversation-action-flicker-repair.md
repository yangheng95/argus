# Running Conversation Action Flicker Repair

## Recall

| Item | Record |
| --- | --- |
| User request | The trailing time, metadata, and overflow-action area of a Conversation Agent card flashes continuously while the Agent is executing. |
| Acceptance criteria | A running Agent card keeps the existing trailing action group visually stable throughout live streaming and bottom-follow movement. Completed and inactive cards retain the existing hover/focus disclosure. The change is reviewed on a real isolated page with a region-bound screenshot. |
| Hard constraints | Use the canonical `CardNode.status` projection; keep `CardHeaderChrome` as the only metadata/action renderer; do not add a timer, local status, fallback, second action surface, state machine, or UI automation test; use Node for Playwright/browser work; desktop-only scope; commit with the `dsw-33987` prefix and push to `myhexin`. |
| Sources read | `specs/current/architecture/07-panel-reactivity.md`; `specs/records/2026-07/2026-07-16-work-ledger-pin-and-agent-header-order.md`; `specs/records/2026-07/2026-07-30-overlay-close-and-conversation-chrome-repair.md`; `packages/overlay/src/components/{Conversation,ConversationCard,ChatBubble,CardHeaderChrome}.tsx`; `packages/overlay/src/{services/clock,utils/card-timing,utils/chat-bubble}.ts`; `packages/overlay/src/styles/surfaces/chat-bubble.css`. |
| Whole-repository search evidence | `ChatBubbleActions` has one production mount. `.chat-bubble__hover-actions` has one presentation owner and is hidden by default, then revealed only by `.chat-bubble:hover` or `:focus-within`. `CardDurationChip` is the only `useNowTick()` consumer and Solid updates only its duration text. `Conversation` owns bottom-follow during every published live tree update. The visible flash therefore comes from pointer hover repeatedly changing as the streaming card moves, not from a second timer or action renderer. |
| Independent agent feedback | None. The user did not request independent agents, and the active collaboration policy does not authorize delegation for this task. |

## Root Cause

The trailing timestamp and `CardHeaderChrome` controls are mounted inside
`.chat-bubble__hover-actions`. That container transitions from hidden to visible
only while the whole bubble owns pointer hover or keyboard focus. During live
output, canonical Conversation publication triggers bottom-follow corrections,
so the running card moves underneath a stationary pointer. Browser hit testing
then alternates the bubble's hover state and repeatedly runs the opacity
transition. The controls themselves remain canonically mounted; tying their
visibility to pointer ownership on a moving surface creates the flicker.

The shared one-hertz clock is not the cause. It has one subscriber path through
`CardDurationChip`, and Solid's fine-grained reactivity replaces only the
duration text node.

## Implementation

1. Extend the existing action-disclosure selector so a canonical running Agent
   row keeps `.chat-bubble__hover-actions` fully visible and interactive.
2. Preserve the existing hover/focus contract for every non-running row and do
   not change markup, action capability projection, timers, or streaming data.
3. Delete the directly discovered UI source-string tests for ChatBubble
   presentation. Retain `chat-bubble-routing.test.ts`, which validates only the
   positive pure routing contract.
4. Build and typecheck the Overlay, run documentation health checks required by
   the added record, then use a real isolated page and Browser/Node to inspect
   the running and completed states and capture a task-scoped screenshot.

## Verification Checklist

- [x] Overlay typecheck passes.
- [x] Vite production build passes.
- [x] Historical-links, document-health, and product-docs single-source checks pass.
- [x] Real running Agent card shows a continuously visible trailing action group.
- [x] Completed/inactive Agent card keeps the actions hidden at rest and the unchanged hover/focus selector remains its disclosure owner.
- [x] Region screenshot is inspected manually and shows no layout regression.
- [x] Final diff is reviewed and committed; the amended delivery commit is pushed to `myhexin` below.

## Verification Evidence

- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay build:vite` passed. Vite reported only its
  existing module-directive and large-chunk warnings.
- The retained positive non-UI checks passed: seven assertions across
  `chat-bubble-routing.test.ts`, `card-tree-reachability.test.ts`, and
  `use-card-head-actions.test.ts`.
- The three required documentation suites passed with an explicit 30-second
  per-test timeout: 70 tests and 1,188 assertions.
- A real Vite Overlay at `http://127.0.0.1:5173/` connected read-only to the
  running local service and rendered the live Orchestrator Agent card. Five
  observations across two seconds reported the same trailing action geometry
  (`x=1089.9197`, `y=170.2768`, `width=136.6518`) with `opacity=1` and
  `pointer-events=auto`, while the elapsed text continued from 1m37s to 1m58s.
- Manual screenshot review confirmed the running timestamp, metadata icon, and
  overflow action remained aligned at the upper-right edge without flashing or
  reserving new space. The completed card rendered the same header at rest with
  `opacity=0` and no trailing-action layout shift.
- The isolated Vite listener was stopped and port 5173 was verified released;
  the backend and the user's native Overlay process were not restarted or
  mutated.
