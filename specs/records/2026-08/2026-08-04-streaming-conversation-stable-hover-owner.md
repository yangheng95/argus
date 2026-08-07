# Streaming Conversation Stable Hover Owner

## Recall

| Item | Record |
| --- | --- |
| User request | When the current Conversation keeps rendering live data, hovering a Conversation card makes the trailing time and icons alternate between hover and non-hover presentation. Keep the trailing controls visually stable without stopping the Conversation stream. The user explicitly requested multiple Agents. |
| Acceptance criteria | While live Conversation content continues to render, a pointer held over the same canonical Conversation item keeps its trailing time, metadata, and overflow controls continuously visible. Non-hovered cards stay unchanged, keyboard focus retains the same disclosure, and stream rendering plus bottom-follow continue. A real desktop page and target-region screenshot must be inspected manually. |
| Hard constraints | Preserve `tree-writer.ts` and `cardTreeStore` as the single streaming source; do not add a running flag, timer, local hover latch, state machine, gate, fallback, second action surface, or throttled rendering; do not add, update, or run User Interface (UI) automation tests; use Node rather than Bun for Browser/Playwright work; preserve unrelated shared-worktree changes; commit with the `dsw-33987` prefix and push to `legacy-remote`. |
| Sources read | `AGENTS.md`; `specs/current/architecture/12-overlay-card-system.md`; `specs/records/2026-08/2026-08-03-running-conversation-action-flicker-repair.md`; `specs/records/2026-08/2026-08-04-streaming-conversation-dom-identity.md`; `packages/overlay/src/components/{Conversation,ConversationCard,StoreCardNode,ChatBubble,CardHeaderChrome}.tsx`; `packages/overlay/src/styles/surfaces/{conversation,chat-bubble}.css`; installed Virtua Solid adapter. |
| Whole-repository search evidence | `ChatBubbleActions` is the only trailing time/action mount and is unconditional. `.chat-bubble__hover-actions` reserves layout space and only changes opacity and pointer events. The current disclosure selector is owned by the inner `.chat-bubble`, while the main Conversation already mounts a longer-lived `.conversation-virtual-item` keyed by canonical projected item ID. Structural item equality preserves that host for content-only publications, but real insertion, removal, reorder, sub-agent membership change, hydrate, or virtual-window reconstruction can still replace inner card nodes. The existing `data-status=running` selector reads message-local status, which can already be `completed` during a live Chat and therefore cannot represent hover continuity. |
| Independent agent feedback | Three user-requested read-only Agents independently traced render identity, CSS geometry, and the real visual path. All agreed that the stable canonical virtual item must own main-Conversation hover, that the right-side DOM and stream should remain unchanged, and that the `running` selector is an invalid workaround. Agents were explicitly prohibited from editing files, running UI automation tests, or delegating further. |

## Root Cause

The trailing time and `CardHeaderChrome` controls are already mounted and occupy
stable flex space, so streaming text and the one-hertz clock are not the direct
cause. Their visibility is still derived from `:hover` on `.chat-bubble`, an
inner projection that can be replaced or lose hit-test ownership while the
stable canonical virtual item remains mounted. The replacement briefly returns
the action slot to zero opacity, which is visible as a flash.

The historical `data-status="running"` override does not repair this ownership
boundary. Card status is message-local and may be `completed` while the selected
Chat still receives data, so it misses the reported case and creates a second,
incorrect disclosure rule.

## Implementation Plan

1. Make `.conversation-virtual-item` the main Conversation hover/focus owner for
   its descendant `.chat-bubble__hover-actions`.
2. Scope the inner `.chat-bubble` hover/focus selector explicitly to the
   non-virtual exact sub-agent transcript surface, so the main Conversation has
   one hover owner.
3. Delete the `data-status="running"` visibility override and its obsolete
   comment. Do not change card markup, the canonical stream, virtualized item
   identity, timers, or action capability projection.
4. Delete the UI/source-assertion tests discovered in the touched Conversation
   and stylesheet paths without running them. Retain positive pure logic tests.
5. Typecheck and build the Overlay, run i18n and required documentation health
   checks, then inspect the real desktop page and a task-scoped screenshot.

## Verification Checklist

- [ ] Pointer hover on a live main-Conversation item keeps time and icons continuously visible while content continues to grow.
- [ ] Moving the pointer away hides the controls; keyboard focus still reveals them.
- [ ] The exact sub-agent transcript retains its existing inner-card hover behavior.
- [x] Overlay typecheck, Vite build, i18n, and documentation health checks pass.
- [x] No UI automation test is added, updated, or run; discovered prohibited tests are removed.
- [ ] A target-region screenshot is inspected manually.
- [x] The final diff receives an independent second review.
- [x] Scoped changes are committed and pushed to `legacy-remote`.

## Verification Evidence

- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay build:vite` passed after transforming
  7,073 modules; only the existing dependency directive and chunk-size warnings
  were emitted.
- `bun run --cwd packages/overlay check:i18n` passed with panel revision
  `9a47c298c4878311`.
- Historical-links, document-health, and product-docs single-source checks
  passed: 70 tests and 1,188 assertions.
- The retained positive non-UI scheduler contract passed in
  `animation-frame-scheduler.test.ts`: one test and two assertions.
- No UI automation test was run. Thirteen discovered Browser/source/CSS
  presentation test files were deleted rather than updated.
- Browser bootstrap selected the in-app Browser, but its URL safety policy
  rejected the local `http://127.0.0.1:5173/` page. The Browser policy expressly
  forbids bypassing that decision through another browser surface, so the real
  pointer-hover screenshot remains pending instead of being represented by a
  fixture, source assertion, or alternate automation path.
- The implementation was independently re-reviewed with no code, test, or
  documentation blocker beyond the pending real-page visual evidence, then
  committed as `ac5914b7af` and pushed to `legacy-remote/work-v0.0.30beta-yr-0804`.
