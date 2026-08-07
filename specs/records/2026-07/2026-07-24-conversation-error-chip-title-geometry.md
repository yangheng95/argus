# Conversation Error Chip And Title Geometry

## Recall

### User request

The user supplied a current Overlay screenshot and requested that the broken
conversation layout be repaired by reducing the error-information width while
preserving the normal conversation title content.

### Acceptance criteria

- A failed Agent conversation card keeps its visible, copyable error reason.
- The leading Agent identity title remains on one line at its intrinsic width.
- The trailing action icons remain on one line at their fixed control widths.
- The error-reason chip is the only flexible middle lane: it receives the
  remaining width and truncates when that width is insufficient.
- Long error text remains one line with ellipsis; its full value remains in the
  existing title tooltip, accessible label, and clipboard action.
- The title and error chip boxes do not overlap at the supplied desktop width.
- A Node-launched Chromium check captures and reviews the repaired row.

### Hard constraints

- Preserve `CardHeaderChrome` as the one renderer for the error-reason action.
- Preserve the existing error text, accessibility, tooltip, and copy behavior.
- Do not add a second error surface or hide the failure behind hover.
- Do not refresh, restart, or interfere with the user's running Overlay.
- Playwright browser verification runs through Node, not Bun.
- Commit subjects start with `dsw-33987`; delivery uses the `myhexin` remote.

### Sources read

- `AGENTS.md`
- supplied screenshot at 1433 x 186
- `specs/current/architecture/07-panel.md`
- `specs/records/2026-07/2026-07-23-goal-title-and-windows-maximize-work-area-repair.md`
- `packages/overlay/src/components/ChatBubble.tsx`
- `packages/overlay/src/components/CardHeaderChrome.tsx`
- `packages/overlay/src/styles/surfaces/chat-bubble.css`
- `packages/overlay/src/styles/surfaces/card.css`
- `packages/overlay/test/chat-bubble.test.ts`
- `packages/overlay/test/coding-assistant-panel.test.ts`
- `packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts`
- `packages/overlay/test/browser/visible-final-message-card-browser.test.ts`

### Whole-repository search evidence

- `CardHeaderChrome.tsx` is the only product renderer for
  `data-ui="card-error-reason"` and preserves the full reason through native
  title text, an accessible label, and click-to-copy behavior.
- `card.css` owns the shared error chip and already truncates its text to one
  line.
- `chat-bubble.css` is the only conversation-specific override. Its
  `:has(> ...card-error-reason)` rule changes the action group to
  `flex: 1 1 auto`, and its button override raises the maximum width to 60% of
  the shell or 560px. This is the direct source of the screenshot's oversized
  pink error line.
- `ChatBubble.tsx` renders the normal identity/title button and
  `CardHeaderChrome` as siblings in `.chat-bubble__identity-row`; therefore the
  expanded error action directly reduces the title lane.
- Existing source tests require the error to remain visible without hover but
  do not constrain its geometry. Existing browser tests cover normal identity
  typography but not a long failed-session reason beside that identity.

### Independent agent feedback

A read-only screenshot review identified `Chat` as the normal leading
conversation identity, the long `ProcessorUnsafeRetryError...` text as the
middle error element, and the controls at the right edge as the trailing action
lane. The user's follow-up clarified the required geometry: leading and
trailing content keep their intrinsic sizes, and only the middle error text
absorbs or releases remaining width.

## Diagnosis

The shared error action is already single-line and ellipsized. The breakage is
the flex ownership around it: the leading disclosure/title button is allowed to
shrink and wrap, while the error/action wrapper does not distinguish the
flexible error text from the fixed trailing icon controls.

The repair belongs in `chat-bubble.css`. In an error row, the leading identity
becomes intrinsic and non-wrapping, the error/action wrapper receives the
remaining row width, the error button alone grows and shrinks inside that
wrapper, and `.chat-bubble__actions` remains fixed. No percentage or pixel cap
is needed because the sibling flex contracts define the available middle width
directly.

## Call-Point Disposition

| Surface                | Call point                                    | Disposition                                                                                                 |
| ---------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Conversation identity  | `ChatBubble.tsx` -> `.chat-bubble__head-main` | In error rows, preserve at intrinsic non-wrapping width.                                                    |
| Error action rendering | `ChatBubble.tsx` -> `CardHeaderChrome`        | Preserve one visible, accessible, copyable action.                                                          |
| Shared error chip      | `card.css`                                    | Preserve shared truncation and interaction behavior.                                                        |
| Conversation override  | `chat-bubble.css`                             | Give remaining width to the error wrapper, make only error text flexible, and keep trailing controls fixed. |
| Source regression      | `chat-bubble.test.ts`                         | Assert the leading/middle/trailing flex contract and reject fixed error caps.                               |
| Rendered regression    | focused browser fixture                       | Render the real class structure at screenshot width, assert title/error containment and capture the row.    |

## Verification Plan

- `bun test packages/overlay/test/chat-bubble.test.ts packages/overlay/test/coding-assistant-panel.test.ts`
- `bun run --cwd packages/overlay build:vite`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-error-chip-title-geometry-browser.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `git diff --check`

## Outcome

Implemented the failed-conversation header as a three-lane flex contract:

- the leading disclosure, Agent identity, status, timestamp, and duration keep
  intrinsic non-wrapping width;
- the middle error reason receives all remaining width and retains the shared
  one-line ellipsis, tooltip, accessible label, and copy behavior; and
- the trailing action group remains fixed and fully visible.

Verification completed:

- focused `ChatBubble` source regression: 5 passed;
- Overlay TypeScript typecheck passed;
- production Vite build passed;
- Node-launched Chromium geometry test passed at the supplied 1433px width;
- rendered geometry measured 186px for the leading lane, 1015px for the
  flexible middle/action wrapper, and 46px for the fixed trailing controls;
- original-resolution screenshot review confirmed the title stays on one line,
  the long error truncates before the actions, and the trailing controls retain
  complete bounds without overlap;
- `git diff --check` passed.
