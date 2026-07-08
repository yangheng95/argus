# 2026-07-08 Overlay Finished Message Collapse And Scroll Bottom

## Recall

User request:

- In overlay, collapse message cards after execution finishes.
- Add a floating scroll-to-bottom button at the bottom of the message box.

Acceptance criteria:

- Running message and agent cards stay expanded so live output remains visible.
- Finished agent/message cards default to collapsed through the existing
  `defaultExpandedForNode` and `conversation-ui` fold store, not through a
  second local state source.
- User-authored message cards remain expanded so the operator's original input
  is not hidden.
- The scroll-to-bottom control appears only when the user has scrolled away
  from the tail, and clicking it uses the existing auto-scroll controller to
  re-arm bottom tracking.
- The control is visually floating near the bottom of the conversation pane and
  does not overlap the composer as an external window or fake overlay.
- Targeted unit/browser tests and visual screenshot review prove the behavior.

Hard constraints:

- No fallback, compatibility branch, gate, or dual-source rendered tree.
- Do not restart, refresh, or kill the user's running OpenCorvus / overlay
  process.
- Use Node, not Bun, for Playwright browser execution on Windows.
- Preserve this Recall so context compaction cannot shrink the task.

Sources read before implementation:

- `specs/artifacts/长程编排测试.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/records/2026-07/2026-07-05-overlay-build-card-sse-teardown-verification.md`
- `specs/records/2026-07/2026-07-05-agent-rail-build-hydrate-live-retention.md`
- `packages/overlay/src/components/Conversation.tsx`
- `packages/overlay/src/components/Card.tsx`
- `packages/overlay/src/components/ChatBubble.tsx`
- `packages/overlay/src/components/CardHeader.tsx`
- `packages/overlay/src/store/conversation-ui.ts`
- `packages/overlay/src/store/card-tree.ts`
- `packages/overlay/src/utils/card-tree.ts`
- `packages/overlay/src/utils/chat-bubble.ts`
- `packages/overlay/src/utils/dom-utils.ts`
- `packages/overlay/src/styles/surfaces/conversation.css`
- `packages/overlay/src/styles/surfaces/chat-bubble.css`
- `packages/overlay/src/styles/surfaces/card.css`
- `packages/overlay/test/card-fold-store.test.ts`
- `packages/overlay/test/card-expand-collapse-contract.test.ts`
- `packages/overlay/test/card-collapsed-preview.test.ts`
- `packages/overlay/test/dom-utils-autoscroll.test.ts`
- `packages/overlay/test/browser/long-transcript-scroll.test.ts`
- `packages/overlay/package.json`

Whole-repository search evidence:

- `rg --files packages/overlay/src packages/overlay/test | rg "(Message|message|Chat|chat|Transcript|transcript|Conversation|conversation|Timeline|timeline|Composer|composer|scroll|Scroll|Card|card)"`
- `rg -n "defaultExpandedForNode\\(" packages/overlay/src packages/overlay/test -S`
- `rg -n "defaultExpanded|setCardExpanded|cardExpanded|expandedCards|oc_card_expand" packages/overlay/src packages/overlay/test -S`
- `rg -n "chatScroll|chat-scroll|Conversation\\(|<Conversation|ChatComposer|composer" packages/overlay/src/main.tsx packages/overlay/src/dom.ts packages/overlay/src/styles -S`
- `rg -n "status.*idle|CardStatus|kind.*message|kind.*agent|role.*user" packages/overlay/src packages/overlay/test -S`

Diagnosis:

- The overlay already has a single fold source: `defaultExpandedForNode` decides
  default expansion, while `conversation-ui` stores explicit user overrides with
  status stamps.
- `ChatBubble` renders both `kind="message"` and `kind="agent"`. User messages
  are identified by role and aligned right; hiding them by default would reduce
  transcript readability.
- The existing auto-scroll owner lives in `setupAutoScroll` and is already
  wired by `Conversation.tsx`. The bottom button should call that controller
  instead of writing a parallel scroll policy.

Implementation plan:

1. Add a small render-side terminal predicate for finished cards and use it in
   `defaultExpandedForNode`.
2. Keep running agent/message cards expanded and user messages expanded.
3. Add a floating bottom button in `Conversation.tsx` that is driven by the
   existing `tracking` signal and `scrollController.scrollToBottom()`.
4. Add CSS in the conversation surface using existing button primitives and
   icons.
5. Add targeted tests for default fold policy and the scroll-bottom control,
   then run overlay typecheck/build and browser screenshot review.

## Follow-up Visual Adjustment

### Recall

User request:

- Change the scroll-to-bottom button from the visible rounded square treatment
  to a translucent circular downward arrow.

Acceptance criteria:

- Keep the existing scroll-to-bottom behavior and auto-scroll owner.
- The button remains a real button with the existing localized label.
- The visual treatment is a circular translucent control with a downward arrow,
  not a solid rounded-square chip.
- CSS uses existing overlay tokens and remains scoped to the scroll-bottom
  affordance.

Hard constraints:

- No fallback, compatibility branch, or second scroll source.
- Do not restart, refresh, or kill the user's running OpenCorvus / overlay
  process.
- Use Node, not Bun, for Playwright browser execution on Windows.

Sources read before implementation:

- `AGENTS.md`
- `specs/artifacts/tv2ainvest.md`
- `specs/records/2026-07/2026-07-08-overlay-finished-message-collapse-scroll-bottom.md`
- `packages/overlay/src/components/Conversation.tsx`
- `packages/overlay/src/styles/surfaces/conversation.css`
- `packages/overlay/src/components/Icon.tsx`
- `packages/overlay/test/conversation-scroll-bottom-button.test.ts`
- `packages/overlay/test/browser/conversation-scroll-bottom-button-browser.test.ts`
- `packages/overlay/src/index.html`

Whole-repository search evidence:

- `rg -n "scroll.*bottom|bottom.*scroll|scrollToBottom|scroll-to-bottom|to bottom|jump.*bottom|ArrowDown|ChevronDown|chevron.*down|data-ui=.*bottom|down.*arrow|scroll" packages/overlay/src specs/current specs/records/2026-07 specs/artifacts -S`
- `rg -n "conversation-scroll-bottom|chat.scroll_bottom|scroll-bottom|scrollToBottom|setupAutoScroll|tracking|follow-lock" packages/overlay/src packages/overlay/test -S`
- `rg -n "chevron-down|arrow-down|scroll|IconName|icons|lucide" packages/overlay/src/components/Icon.tsx packages/overlay/src -S`

Plan:

1. Keep `Conversation.tsx` on the existing `Button` primitive and `chevron-down`
   icon, but use the ghost variant so the component semantics match a
   translucent floating affordance.
2. Update the conversation surface CSS for
   `conversation-scroll-bottom` to define a token-driven circular translucent
   background, border, hover/focus state, and icon size.
3. Update focused unit/browser tests to verify the circular translucent
   treatment and run the existing scroll-bottom test set plus Node browser
   screenshot verification.

## Initial Validation

Commands:

- `bun test packages/overlay/test/card-collapsed-preview.test.ts packages/overlay/test/conversation-scroll-bottom-button.test.ts packages/overlay/test/dom-utils-autoscroll.test.ts`
  - Result: `38 pass / 0 fail`.
- `bun run --cwd packages/overlay typecheck`
  - Result: pass.
- `bun run --cwd packages/overlay check:i18n`
  - Result: pass.
- `bun run --cwd packages/overlay build:vite`
  - Result: pass. Vite emitted only existing chunk-size / dynamic-import
    warnings.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-scroll-bottom-button-browser.test.ts`
  - Result: `1 pass / 0 fail`.

Browser artifacts reviewed:

- `packages/overlay/.scratch/conversation-scroll-bottom-button/scroll-button-visible.png`
- `packages/overlay/.scratch/conversation-scroll-bottom-button/after-scroll-bottom.png`

Visual conclusion:

- Finished assistant message cards render collapsed with a compact preview row.
- The user-authored message card remains expanded in the fixture contract.
- The scroll-to-bottom button floats centered near the bottom of the message
  pane and stays above the composer.
- After clicking the button, the transcript is pinned to the bottom and the
  button is no longer visible.

## Follow-up Validation

Commands:

- `bun test packages/overlay/test/conversation-scroll-bottom-button.test.ts packages/overlay/test/dom-utils-autoscroll.test.ts`
  - Result: `16 pass / 0 fail`.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-scroll-bottom-button-browser.test.ts`
  - Result: `1 pass / 0 fail`.
- `bun run --cwd packages/overlay typecheck`
  - Result: pass.

Browser artifact reviewed:

- `packages/overlay/.scratch/conversation-scroll-bottom-button/scroll-button-visible.png`

Visual conclusion:

- The scroll-to-bottom control renders as a circular translucent
  downward-chevron button centered inside the conversation scroll shell.
- The button remains above the composer and disappears after it re-pins the
  transcript to the bottom.
