# User Message Hover Metadata

## Recall

### User requirements

- Use the supplied Codex outgoing-message hover screenshot as the reference for OpenCorvus user messages.
- Remove the always-visible user identity, runtime status, duration, and timestamp row above the outgoing bubble.
- Place the timestamp and copy action below the user bubble and reveal them only while the message is hovered or keyboard-focused.
- Preserve the current message content, alignment, copy behavior, and all non-user agent transcript behavior.

### Acceptance criteria

- A resting user message shows only its right-aligned message bubble; user identity, execution status, duration, timestamp, and copy chrome are absent from the visible surface.
- Hovering the user message reveals one right-aligned metadata row directly below the bubble containing the timestamp followed by the copy action.
- Keyboard focus within the user message reveals the same row, and the copy action remains a shared `Button` with the existing clipboard behavior and localized accessible label.
- The metadata row reserves its geometry while transparent so hover does not move the transcript.
- Agent turns retain their persistent identity header and existing action capabilities.
- A real isolated desktop page is captured before hover and during hover, personally inspected, corrected if necessary, and recaptured.

### Hard constraints

- Follow `AGENTS.md`: no fallback renderer, duplicate state, compatibility path, gate, hard-coded presentation data, or hand-built replacement primitive.
- `ChatBubble` remains the single top-level message owner; `CardHeaderChrome` and the existing copy handler remain the single action owners.
- Use existing Solid control flow, `Button`, `Icon`, shared time formatting, and design tokens.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus or Overlay. Visual validation must use an isolated server and Node-started browser tooling.
- Do not add mobile or tablet scope; this is desktop reference parity only.
- Commit subjects start with `dsw-33987`, and commits are pushed to the current git-cc delivery branch.

### Hard-disk sources read before implementation

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-15-message-transcript-visual-language-repair.md`
- `packages/overlay/src/components/ChatBubble.tsx`
- `packages/overlay/src/styles/surfaces/chat-bubble.css`
- `packages/overlay/test/chat-bubble.test.ts`
- `packages/overlay/test/chat-bubble-role-distinction.test.ts`
- `packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts`
- User-supplied Codex and current-project screenshots.

### Whole-repository search evidence

| Surface / symbol | Complete call-site result | Planned disposition |
| --- | --- | --- |
| `ChatBubbleIdentity` | Defined once in `ChatBubble.tsx`; used by the top-level turn and compact child-agent identity. | Keep for agents and child agents; stop mounting it for the top-level user role. |
| `.chat-bubble__identity-row` | Mounted once in `ChatBubble.tsx`; styled only in `chat-bubble.css`; asserted by `chat-bubble.test.ts` and the agent browser test. | Keep as the agent header only; update tests to prove it is absent for user rows. |
| `.chat-bubble__stamp` | Rendered only by `ChatBubbleIdentity`; styled only in `chat-bubble.css`. | Preserve for agent identity and reuse the same formatter/title contract in the user footer. |
| `[data-ui="chat-bubble-copy-message"]` | Mounted once in `ChatBubble.tsx`; clipboard behavior is tested in the agent browser test; no second copy implementation exists. | Extract the existing button markup into one local component and project it into either the agent header or user footer. |
| `.chat-bubble__hover-actions` | Mounted once and styled only in `chat-bubble.css`; agent browser coverage asserts hidden/rest and hover/focus behavior. | Preserve for agent header actions; give the user footer its own semantic layout class while reusing the same shared action controls. |
| user bubble selectors | User shell/body styling is owned only by `chat-bubble.css`; role semantics and typography are guarded by `chat-bubble-role-distinction.test.ts`. | Add user-only bubble width/footer geometry without changing the agent transcript surface. |
| browser fixtures | `chat-bubble-disclosure-button-browser.test.ts` already renders both a user message and an agent turn from a production-shaped transcript. | Extend this existing fixture to assert and capture resting/hover user-message states; do not create a mocked parallel renderer. |

### Independent agent feedback

- No sub-agent was started because the user did not request delegation and the active collaboration policy forbids unrequested sub-agents. The main agent will perform the required second review.

## Root cause

`ChatBubble` currently uses one header topology for both outgoing user messages and agent turns. Right alignment reverses that header row, so the hidden action capsule occupies the far-left side of the broad user shell while identity, status, duration, and time remain above the short outgoing bubble. This is a structural mismatch with the Codex reference, where outgoing-message chrome belongs to a quiet footer attached to the message itself. CSS repositioning alone would retain incorrect identity/status content and would leave the action geometry owned by the wrong region.

## Implementation plan

1. Split the existing top-level `ChatBubble` chrome by semantic role inside the same component: agents retain the identity header; user messages render body-first and one footer containing the timestamp and existing actions.
2. Extract only the repeated copy-button markup into a local component so agent and user projections share the same clipboard state and handler; do not duplicate action behavior.
3. Add user-only token-based geometry so the bubble/footer form one right-aligned content-width unit, the footer is transparent and non-interactive at rest, and hover/focus reveals it without layout shift.
4. Update focused static tests and extend the existing production-shaped browser fixture with resting and hover geometry/visibility assertions plus screenshots.
5. Run focused unit tests, typecheck/build, spec health, and the Node browser test. Inspect the real screenshots, correct any mismatch, then repeat verification and perform a second diff review.
6. Commit and push the implementation to the current git-cc delivery branch.

## Verification plan

```powershell
bun test packages/overlay/test/chat-bubble.test.ts packages/overlay/test/chat-bubble-role-distinction.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay build
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts
git diff --check
```

The browser review must inspect a desktop user message at rest and on hover, confirm that the footer is directly below and right-aligned with the bubble, and confirm that no transcript movement occurs when the footer becomes visible.

## Implementation summary

- `ChatBubble` now branches only its top-level chrome by normalized semantic role. Agent and child-agent identity surfaces are unchanged; a user turn no longer mounts the identity/status/duration header.
- The existing `ChatBubbleActions` projection is local to the canonical component and is mounted once per active branch, so user and agent turns share `CardHeaderChrome`, the shared `Button` primitive, one clipboard state, and one copy handler.
- User turns render one absolutely positioned footer in reserved block space. Its timestamp and actions are transparent and non-interactive at rest, then become visible and interactive through the parent bubble's hover or focus-within state without moving the row.
- The user footer uses the new `shortStamp` formatter from the existing time utility to match Codex's minute-level visible time while preserving `fullStampWithRelative` as the detailed tooltip. Existing agent and activity timestamps retain their precise visible format.
- User bubble width now follows its content rather than the broad 70% shell, binding the footer's right edge to the message bubble instead of leaving the copy action at the far-left edge of the row.
- The existing production-shaped browser fixture now covers resting and hover visibility, absent user execution metadata, timestamp format, bubble/footer geometry, stable row height, user-message clipboard behavior, keyboard-focus reveal, and page/element screenshots.

## Validation

- Focused Overlay unit tests: 8 passed, 0 failed.
- Overlay TypeScript typecheck: passed.
- Overlay Vite production build: passed; the existing chunk-size advisory remains non-failing.
- Node-started browser fixture `chat-bubble-disclosure-button-browser.test.ts`: passed with a real built Overlay, production-shaped transcript, hover, clipboard, keyboard focus, and screenshots.
- Spec historical-link, document-health, and product-doc single-source tests: passed before implementation and are rerun for final delivery.
- Git diff whitespace check: passed.

## Visual review

- Resting element: `.scratch/overlay-user-message-rest.png`.
- Hover element: `.scratch/overlay-user-message-hover.png`.
- Resting full page: `.scratch/overlay-user-message-rest-page.png`.
- Hover full page: `.scratch/overlay-user-message-hover-page.png`.
- Personally inspected: the resting user turn contains only the right-aligned bubble; the hover page places minute-level time and the copy icon immediately below it; the footer and body right edges align; no user identity/status row remains; the agent transcript below is visually unchanged.

## Second review

- The diff retains `ChatBubble` as the only top-level turn renderer and `CardParts` as the only message-part renderer.
- No fallback, compatibility selector, hidden message, second clipboard implementation, duplicate timestamp state, new UI dependency, literal color, mobile scope, or process intervention was introduced.
- The user footer's hidden state reserves geometry, and the browser assertion proves the row height is unchanged across hover.
- The copied user message is verified from the browser's clipboard test hook, while the existing agent-copy regression still passes later in the same run.
- The user's running OpenCorvus/Overlay was not restarted, refreshed, closed, or otherwise manipulated; all visual work used the isolated Node browser fixture.
