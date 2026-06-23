# Chat Composer Button Primitive Owner

Date: 2026-06-18

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model.

## Problem

Independent GUI review found `ChatComposer` still renders its send/stop action
and attachment remove action as raw `<button>` elements with local button
classes. The composer already uses shared primitives for its textarea and
prompt profile selector, so these two controls leave a second button system
beside `components/ui/Button.tsx` and `primitives/button.css`.

The risk is visible UI drift: focus ring, hover, disabled, icon sizing, and
button density can diverge between the main composer and other operation
surfaces.

## Recall

| Source                                              | Relevant constraint                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                         | UI work must reuse mature primitives, avoid double sources, and verify visually.                             |
| `2026-06-18-agent-reply-box-primitives.md`          | Reply actions route through `Button` while layout classes remain surface-owned.                              |
| `2026-06-18-card-trace-action-button-owner.md`      | Operation controls should use `Button` and stable `data-ui` selectors instead of private raw button classes. |
| `packages/overlay/src/components/ui/Button.tsx`     | `Button` owns the canonical `.oc-button` class plus `variant`, `size`, and `tone` data attributes.           |
| `packages/overlay/src/styles/primitives/button.css` | Focus, hover, disabled, icon-action, and solid button chrome live in the primitive.                          |

## Impact Sweep

| Sweep                                                                                                                                                                     | Result                                                                                                                                                                                          | Decision                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n -F "chat-send" packages/overlay/src packages/overlay/test specs/new-arch`                                                                                          | Live source: `ChatComposer.tsx`, `composer.css`, density/architecture/icon/browser tests. `base.css` owns only `--ui-chat-send-size`.                                                           | Retire `class="chat-send"` and `.chat-send*` state selectors; keep `chat-send-icon` and `chat-send-label` as internal layout hooks. |
| `rg -n -F "chat-attachment-remove" packages/overlay/src packages/overlay/test specs/new-arch`                                                                             | Live source: raw remove button in `ChatComposer.tsx`, private hover class in `composer.css`, architecture guard.                                                                                | Replace raw class with `Button data-ui="chat-attachment-remove"`; style only layout/sizing through `.oc-button[data-ui=...]`.       |
| `rg -n -e 'class="chat-send' -e 'class="chat-attachment-remove' -e '\.chat-send' -e '\.chat-attachment-remove' packages/overlay/src packages/overlay/test specs/new-arch` | No other production owner emits these private classes. Tests and fixture HTML are the only other active references.                                                                             | Update tests to assert Button ownership and data selectors.                                                                         |
| `rg -n -e 'sendDataUI' -e 'chatSend' -e 'btnTaskInterrupt' packages/overlay/src packages/overlay/test specs/new-arch`                                                     | `sendDataUI` is context-specific (`mission-composer-submit`, `coding-assistant-composer-submit`), while `#chatSend` and `#btnTaskInterrupt` remain stable IDs for legacy DOM integration/tests. | Preserve IDs and incoming `sendDataUI`; use existing `data-mode` as the stable composer style hook.                                 |

## Fix Plan

1. Import `Button` in `ChatComposer`.
2. Replace attachment remove with `Button variant="ghost" size="icon"
tone="neutral" data-chrome="icon-action" data-ui="chat-attachment-remove"`
   and the shared `Icon name="close"`.
3. Replace send/stop with `Button`; use `variant="solid"`, `size="md"`,
   `tone={props.busy ? "danger" : "accent"}`, and keep `data-mode`.
4. Move composer CSS from private raw button classes to
   `.chat-compose-row .oc-button[data-mode]` and
   `.chat-attachment-item .oc-button[data-ui="chat-attachment-remove"]`.
   Keep internal icon/label layout selectors.
5. Update static tests so `ChatComposer` has no raw `<button>` and the legacy
   button caller allowance for `chat-send` drops to zero.
6. Add/extend browser fixture coverage for send, stop, disabled, attachment
   remove, hover/focus, and screenshot evidence.

## Acceptance

- `ChatComposer.tsx` imports and uses `Button` for all operation buttons.
- `ChatComposer.tsx` no longer contains raw `<button` or `class="chat-send"` /
  `class="chat-attachment-remove"`.
- Runtime CSS no longer has private `.chat-send:hover`,
  `.chat-send:disabled`, `.chat-send:focus-visible`, or
  `.chat-attachment-remove:hover` button chrome.
- Composer send/stop and attachment remove render as `.oc-button` controls.
- Existing send/stop IDs, submit behavior, stop behavior, labels, and
  attachment removal callbacks are preserved.
- Browser evidence proves focus-visible and hover states remain readable and
  saves a screenshot.
