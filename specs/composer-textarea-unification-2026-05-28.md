# Composer textarea unification (goal dialog · mission launcher · chat)

Date: 2026-05-28
Branch: coding-assistant

## Problem (operator-reported)

1. **Goal dialog ("goal 浮窗")**: the acceptance-criteria textarea clips long
   content with **no visible scrollbar**, looking broken. Root cause is the
   global scrollbar-hide in `styles/cascade/base.css:123-129`
   (`* { scrollbar-width: none }` + `*::-webkit-scrollbar { width:0 }`) combined
   with fixed `rows={3}` / `min-height:60px` `.field-input` textareas
   (`styles/surfaces/field.css:107-111`). The content scrolls (wheel/keys) but
   there is no gutter affordance.
2. **Inconsistent inputs ("复用了消息框组件但没完全复用")**: three different text
   inputs across surfaces —
   - `ChatComposer` `.chat-textarea` (auto-grows, capped 10 lines) — the real
     "message box".
   - Goal dialog `.field-input` textareas (fixed, no auto-grow, hidden scrollbar).
   - Mission launcher `.mission-composer-textarea` (`Mission.tsx:960`, bespoke,
     fixed rows=10).

Operator decision (asked 2026-05-28): make goal dialog + mission launcher use the
same message-box input as the chat composer.

## Constraint: ChatComposer cannot be embedded wholesale

`ChatComposer` is a monolith coupled to:
- singleton DOM ids `chatForm` / `chatTextarea` / `chatSend` / `chatAttachments`
  (queried by `CommandPalette.tsx:85`, `main.tsx:980`),
- the global `messageStore.chatAttachments` store,
- `ExecutorSelector`, attachment strip, Send/Stop button, drag-drop/paste.

Dropping it into a goal *title* field would duplicate ids and bolt chat-only chrome
onto a save/cancel form — rule 8 (dual source) + rule 11 (abstraction) violation.

## Approach — extract the shared behaviour, not the monolith

The genuinely shared, reusable part is the **auto-growing textarea** behaviour
(`ChatComposer.autoResizeTextarea`, lines 245-260: `height:auto` →
`min(scrollHeight, maxLines·lineHeight + pad)`), plus message-box chrome with a
**visible** scrollbar once content passes the cap.

### 1. New primitive `src/components/primitives/AutoGrowTextarea.tsx`
- Behaviour-only: renders one `<textarea>`, runs the auto-grow effect on value
  change, caps at `maxLines` (default 10) then lets `overflow-y:auto` scroll.
- Props: `value`, `onInput`, `maxLines?`, `class?`, plus pass-through textarea
  attrs (`placeholder`, `disabled`, `rows`, `id`, `onKeyDown`, `onFocus`,
  `onBlur`, `onPaste`, `aria-*`) and a `ref` forwarder.
- No ids, no store, no chrome opinion beyond an optional default class.
- Single source for auto-grow (rule 8): ChatComposer stops owning its own copy.

### 2. Shared chrome `.composer-textarea` (in `styles/surfaces/field.css`)
- Message-box look (surface-inset bg, border, padding, line-height 1.45,
  `resize:none`).
- **Opts back into a visible scrollbar** (mirrors the `#chatScroll` opt-in in
  base.css) so overflow past the cap is reachable — fixes complaint #1.
- `.chat-textarea` keeps its layout specifics (flex, `--chat-textarea-height`
  floor, used inside `.chat-compose-row`) but composes the base look so there is
  one source for the chrome.

### 3. Call-site swaps
- `ChatComposer.tsx`: raw `<textarea class="chat-textarea">` → `<AutoGrowTextarea
  class="chat-textarea" id="chatTextarea" …>`; keep wrap + placeholder-float +
  resize handle around it; keep `#chatTextarea`. Density floor + command-palette
  query must still pass.
- `GoalDialogHost.tsx`: both fields (title `maxLines≈4`, acceptance `maxLines≈10`)
  → `AutoGrowTextarea class="field-input composer-textarea"`.
- `Mission.tsx` `MissionComposer`: `mission-composer-textarea` → `AutoGrowTextarea`
  with the composer chrome.

## Call sites enumerated (rule 35)
- `ChatComposer` rendered: `main.tsx:736`, `Mission.tsx:799`, `Mission.tsx:841`.
- Textarea queried by id/selector: `CommandPalette.tsx:85`, `main.tsx:980`
  (`#solidChatComposer textarea`) → preserve `#chatTextarea` under `#solidChatComposer`.
- Density test: `test/*composer-density*` pins the 56px floor → keep
  `--chat-textarea-height`.
- Goal textareas: `GoalDialogHost.tsx:63-91`.
- Mission textarea: `Mission.tsx:960`.

## Tests (rule 36)
- Primitive unit test: height calc caps at `maxLines`; overflow beyond cap keeps
  `overflow-y:auto`; `.composer-textarea` is present.
- Surface tests: goal dialog + mission launcher + chat all render the primitive
  (assert `.composer-textarea` / auto-grow class) — guards against regressing to
  the bespoke/fixed textareas (assert the old `mission-composer-textarea` /
  fixed `.field-input`-only path is gone).
- Keep `workspace-composer-density` green.

## Verify (rule 24/25)
- Rebuild overlay; re-capture goal dialog via `script/snap-goal.ts` and add a
  mission-launcher snap; confirm visible scrollbar + auto-grow in the PNGs.

## Dev scaffolding already added
- `main.tsx` `__OC_DEV__` extended with `openGoalDialog` + `ensureGoalHost`.
- `script/snap-goal.ts` (puppeteer capture, mirrors `snap-settings.ts`).
