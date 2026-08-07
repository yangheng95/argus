# Conversation Full-Height Scrollbar and Composer Alignment

Date: 2026-07-28
Status: Accepted
Owner: Codex

## Glossary

- CSS: Cascading Style Sheets, the browser presentation language.
- DOM: Document Object Model, the rendered browser element tree.
- UI: User Interface, the visible application surface.

## Recall

### User requirement

The supplied desktop screenshot shows the conversation scrollbar ending above
the Composer. The required result is:

- the one conversation scrollbar extends to the bottom of the conversation
  viewport instead of ending above the input;
- message-card borders never paint visibly in the Composer/input band while the
  transcript moves behind the fixed bottom surface;
- the Composer input and ordinary conversation cards share exactly the same
  left and right bounds.

### Acceptance criteria

- `#chatScroll` remains the sole native transcript overflow owner and fills the
  full height of `.conversation-scroll-shell`.
- The one real `#solidChatComposer` remains outside transcript flow, is anchored
  to the bottom of that shell, and excludes only the measured native scrollbar
  gutter from its paint and hit-test surface.
- `#chatScroll` bottom padding equals the rendered Composer layer height, so the
  final message remains completely above the input at the bottom position.
- The Composer layer paints the complete input band up to the scrollbar lane at
  every scroll position; no message-card border is visible there.
- Cards and `.chat-input` use the same start/end content insets, including the
  current Environment Information clearance projection.
- Wheel, keyboard, follow-to-bottom, Composer resize, empty-home layout, and
  conditional scrollbar visibility continue to work.
- Focused source tests, a Node-launched real Overlay browser test, task-scoped
  desktop screenshots, and a second visual review pass.

### Hard constraints

- Desktop-only scope.
- Do not create another scroll owner, custom scrollbar, guessed Composer height,
  mask, fallback, compatibility path, gate, state machine, iframe, query
  override, or hard-coded platform scrollbar width.
- Reuse the existing `ResizeObserver`, animation-frame scheduler,
  `--ui-chat-scrollbar-gutter-x`, conversation inset variables, and real
  Composer mount.
- Do not restart, refresh, close, or otherwise interfere with the user's running
  OpenCorvus or Overlay process. Browser verification uses an isolated service
  and Playwright launched through Node.js.
- Preserve unrelated staged and unstaged worktree changes; do not reset, restore,
  stash, or create another worktree.
- Commit subjects use `dsw-33987` and delivery pushes to `legacy-remote`.

### Material read before implementation

- Root `AGENTS.md`.
- Browser control skill.
- User screenshot
  `C:/Users/10132/AppData/Local/Temp/codex-clipboard-281e9f46-ac69-4e3a-b3e1-ab1f498439e4.png`.
- `specs/current/architecture/07-panel.md`.
- `2026-07-24-conversation-composer-scrollbar-occlusion.md`.
- `2026-07-28-conversation-scrollport-composer-boundary-repair.md`.
- `2026-07-28-conversation-fullscreen-scrollbar-repair.md`.
- `2026-07-28-environment-content-clearance-scrollbar-anchor.md`.
- `packages/overlay/src/components/App.tsx`.
- `packages/overlay/src/components/Conversation.tsx`.
- `packages/overlay/src/main.tsx`.
- `packages/overlay/src/styles/cascade/base.css`.
- `packages/overlay/src/styles/surfaces/conversation.css`.
- `packages/overlay/src/styles/surfaces/composer.css`.
- Focused source and headed-browser Composer/scrollbar tests.

### Whole-repository search

The pre-change search enumerated every `#chatScroll`, `.chat-scroll`,
`.conversation-scroll-shell`, `#solidChatComposer`,
`--conversation-composer-block-size`, `--ui-chat-scrollbar-gutter-x`,
conversation inset, scrollbar, Composer-resize, and bottom-control reference.

| Owner / consumer | Disposition |
| --- | --- |
| `App.tsx` | Keep the one scroll element followed by the one Composer mount in the existing positioning shell. |
| `conversation.css` | Restore full-height scrolling and bottom-anchored Composer geometry; consume the current start/end inset variables and measured scrollbar gutter. |
| `Conversation.tsx` | Project the Composer's actual rendered height into the scroll owner's bottom-clearance variable and notify the existing auto-follow controller in the same scheduled measurement. |
| `main.tsx` | Keep native scrollbar-gutter measurement as the only horizontal scrollbar-width source. |
| `base.css` | Keep the one native scrollbar paint owner and content-driven `overflow-y: auto` behavior. |
| `workspace-composer-density.test.ts` | Replace the superseded normal-flow contract with full-height, measured-clearance, and shared-axis assertions. |
| `conversation-scroll-bottom-button.test.ts` | Require measured Composer clearance and the bottom-anchored overlay surface. |
| `chat-default-assistant-browser.test.ts` | Prove sparse real-Overlay full-height scrollbar geometry, bottom clearance, and fixed Composer bounds. |
| `conversation-scroll-bottom-button-browser.test.ts` | Prove the scrollbar reaches the shell bottom and the button remains above the input. |
| `conversation-agent-rail-scroll-browser.test.ts` | Prove long-transcript card/input alignment, full-height scrollbar ownership, Composer-band occlusion, and resize behavior. |
| `specs/current/architecture/07-panel.md` | Supersede the prior “scrollbar ends above Composer” clause with the user-requested full-height contract. |

No backend route, API schema, database model, task identity, right-dock model,
localization key, or additional responsive target participates in this repair.

### Independent-agent feedback

None. The user did not request delegation, and the active collaboration policy
forbids unsolicited sub-agents.

## Causal analysis

1. **Observable symptom:** the scrollbar thumb/track stops at the top of the
   Composer instead of reaching the conversation viewport bottom.
2. **Direct trigger:** `.conversation-scroll-shell` is a flex column where
   `#chatScroll` is `flex: 1 1 0` and `#solidChatComposer` is a normal-flow,
   non-shrinking sibling.
3. **Root cause:** the preceding boundary repair encoded Composer exclusion by
   shortening the scrollport itself. That solved paint overlap structurally but
   also shortened the native scrollbar, contradicting the newly supplied
   visual requirement.
4. **Root correction:** preserve one full-height scrollport and move only the
   Composer into the shell's bottom positioning layer. Measure that real layer
   and use its height as transcript bottom padding. The same layer paints the
   input band. Its full-width grid consumes the exact card inset variables and
   adds the measured native scrollbar gutter only to the trailing track; its
   opaque paint and hit surface stop at that gutter.

## Implementation plan

1. Update focused source and browser expectations to the new full-height
   contract.
2. Restore measured Composer clearance and bottom positioning using the current
   asymmetric Environment-aware insets.
3. Run focused source tests, Overlay typecheck/build, and Node-launched headed
   browser scenarios.
4. Inspect task-scoped screenshots at original resolution, correct visual
   discrepancies, and rerun.
5. Update architecture/index records, run document health, perform a second
   diff and visual review, then stage only task-owned changes, commit, fetch,
   reconcile, and push to `legacy-remote`.

## Status

- [x] Recall, conflict with the prior layout decision, causal chain, call-site
      audit, and pre-change remote verification recorded.
- [x] Focused regressions and implementation complete.
- [x] Type/build/browser verification and screenshot review complete.
- [x] Architecture/index updates and second review complete; the accepted
      implementation is ready for its traceable commit and `legacy-remote` push.

## Verification evidence

- `bun test packages/overlay/test/workspace-composer-density.test.ts
  packages/overlay/test/conversation-scroll-bottom-button.test.ts
  packages/overlay/test/conversation-agent-rail.test.ts
  packages/overlay/test/task-cwd-row-layout.test.ts`: 37 passed, 0 failed.
- `bun test packages/overlay/test/overlay-architecture-guards.test.ts
  --test-name-pattern "chat scroll layout is canonical"`: passed.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build:vite`: passed, 7,057 modules
  transformed.
- Node-launched headed Chromium:
  - `conversation-scroll-bottom-button-browser.test.ts`: passed; the native
    scrollbar reaches the shell bottom and the card/input alignment probe is
    exact after Agent Rail clearance is applied.
  - `conversation-agent-rail-scroll-browser.test.ts`: passed; it covers
    1902-pixel and 1120-pixel desktop widths, wheel and PageUp motion, four
    scroll positions, direct scrollbar-lane hit testing, Composer resize,
    card/input bounds, and the opaque input band.
  - `chat-default-assistant-browser.test.ts`: passed against the built Overlay
    sparse Chat path.
- Original-resolution screenshots reviewed:
  - `.scratch/conversation-agent-rail-scroll-browser/composer-message-card-1902x1110.png`
  - `.scratch/conversation-agent-rail-scroll-browser/fixed-composer-bottom-1120x760.png`
  - `.scratch/short-chat-composer-bottom/sparse-populated-chat-1902x1314.png`
  - `packages/overlay/.scratch/conversation-scroll-bottom-button/scrollbar-overflowing.png`
