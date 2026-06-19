# Chat Composer Resize Keyboard Separator

Date: 2026-06-19

ARIA means Accessible Rich Internet Applications. DOM means Document Object
Model. UI means User Interface.

## Problem

Gibbs found that the chat composer resize handle is exposed as
`role="separator"` but only supports pointer dragging. It cannot receive Tab
focus and does not expose separator value metadata, so keyboard and assistive
technology users cannot adjust the composer height.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `ChatComposer.tsx` | `.chat-resize-handle` owns pointer resize for `--chat-textarea-height`. |
| `ConfigDialogHost.tsx` | The settings sidebar resizer already exposes `tabIndex`, `aria-valuemin/max/now`, `aria-controls`, and a keyboard resize handler. |
| `composer-toolbar-retired.test.ts` | Existing composer tests only assert the handle exists and has CSS. |
| `chat-composer-button-primitives.test.ts` | Existing browser coverage checks composer button focus and hover, not resize keyboard behavior. |

## Evidence Sweep

| Command | Result | Decision |
| --- | --- | --- |
| `rg -n "chat-resize-handle|textarea-height|handleResize" packages/overlay/src packages/overlay/test` | The handle has pointer events only; CSS already has `.chat-resize-handle:focus-visible`, but the element is not focusable. | Add real keyboard semantics instead of deleting the focus affordance. |
| `rg -n "aria-valuemin|nextConfigSidebarKeyboardWidth" packages/overlay/src packages/overlay/test` | `ConfigDialogHost` already has an adjustable separator pattern backed by helper tests. | Mirror the same contract for the composer handle. |
| `rg -n "ChatComposer|chatTextarea" packages/overlay/test/browser` | Existing app browser fixtures mount the real `#solidChatComposer` textarea. | Add a real browser test for focus and Arrow/Home/End resize behavior. |

## Fix Plan

1. Add a small composer resize helper that owns min, max, step, clamp, and keyboard next-value logic.
2. Make `.chat-resize-handle` focusable and expose `aria-controls`, `aria-valuemin`, `aria-valuemax`, and `aria-valuenow`.
3. Route pointer resize and keyboard resize through the same `applyTextareaResizeHeight` function.
4. Add source tests for the new separator contract and helper unit tests for clamp/keyboard behavior.
5. Add a Node Playwright browser test that focuses the real handle, verifies focus-visible styling, and checks ArrowUp, ArrowDown, Home, and End against `--chat-textarea-height` and `aria-valuenow`.

## Acceptance

- Tab can focus `.chat-resize-handle`.
- ArrowUp increases the composer textarea floor once.
- ArrowDown decreases it once.
- Home and End move to the same min and max bounds used by pointer resize.
- The visible focus affordance remains reachable in the screenshot.
