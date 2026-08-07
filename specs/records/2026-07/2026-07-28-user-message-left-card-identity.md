# 2026-07-28 User Message Left Card Identity

## Recall

### User requirement

- Messages sent from the Composer must no longer use the current right-aligned
  user-message layout.
- All conversation turns must read from left to right.
- The user avatar must live inside the message card, following the supplied
  compact identity-row reference: avatar, identity, status/time metadata, then
  message content.

### Acceptance criteria

1. A user-authored turn resolves to `data-align="left"` through the canonical
   bubble alignment projection.
2. The user avatar is rendered by the existing `ChatBubbleIdentity` owner inside
   the user card header; there is no avatar sibling outside the card body.
3. User and agent cards share the same left edge and the same identity-row
   structure while preserving exact user role semantics and message actions.
4. User message text, files, image attachments, copy/rewind actions, timestamps,
   and expanded behavior remain functional.
5. Targeted unit tests, Overlay typecheck/build, browser geometry assertions, and
   a task-scoped desktop screenshot pass.

### Hard constraints

- Keep `ChatBubble` as the only message/agent conversation renderer selected by
  `ConversationCard`.
- Reuse `ChatBubbleIdentity`, `Avatar`, `CardHeaderChrome`, design tokens, and
  existing browser fixtures. Do not add a second user-card component or local
  identity source.
- Replace the right-aligned implementation; do not retain a compatibility
  branch, fallback style, or duplicated footer/action surface.
- Do not restart, refresh, close, or otherwise interfere with a running
  OpenCorvus or overlay process. Visual verification must use an isolated test
  page or an already available read-only page.
- Playwright browser validation runs through Node, never Bun.
- This is desktop-only UI acceptance; no mobile or responsive scope is added.

### Sources read

- User reference screenshots:
  `codex-clipboard-bb431725-8937-4166-a7fb-1b39bc1e7eb1.png` and
  `codex-clipboard-843a88b8-04fe-4193-99ee-e49e7584b130.png`.
- `AGENTS.md`.
- `specs/README.md` and `specs/records/2026-07/README.md`.
- `specs/records/2026-07/2026-07-28-work-conversation-experience.md`.
- `packages/overlay/src/components/{ConversationCard,ChatBubble,Avatar}.tsx`.
- `packages/overlay/src/utils/{chat-bubble,message}.ts`.
- `packages/overlay/src/styles/surfaces/chat-bubble.css`.
- `packages/overlay/test/{chat-bubble,chat-bubble-role-distinction,chat-bubble-routing,message-image-preview}.test.ts`.
- `packages/overlay/test/browser/{agent-card-separation-browser,conversation-image-attachments-browser}.test.ts`.

### Whole-repository search evidence

Searches covered `flex-row-reverse`, `justify-end`, `items-end`, `ml-auto`,
`self-end`, `direction: rtl`, user-role conditions, `data-align="right"`,
`bubbleAlign`, `chat-bubble__user-avatar`, `chat-bubble__user-footer`, and
`chat-bubble__user-message-surface`.

| Owner / call site | Current responsibility | Disposition |
| --- | --- | --- |
| `utils/chat-bubble.ts::bubbleAlign` | Maps normalized user role to `right` | Replace with the single left alignment used by every bubble role. |
| `components/ConversationCard.tsx` | Routes message and agent nodes to `ChatBubble` | Preserve as the single renderer. |
| `components/ChatBubble.tsx` | Hides the identity row for users, renders a body-adjacent user avatar, and duplicates user actions in an absolute footer | Render the shared identity row for users, remove the external avatar and duplicate footer, and keep actions in the shared header. |
| `styles/surfaces/chat-bubble.css` | Owns right alignment, a text-only user surface, external avatar geometry, and footer positioning | Replace with a left-aligned user card using the existing card/identity primitives. |
| `test/chat-bubble-routing.test.ts` | Asserts role-based right alignment | Change to assert canonical left alignment for user and non-user roles. |
| `test/chat-bubble*.test.ts` | Locks the old external-avatar/footer structure | Replace with in-card identity/header assertions and explicit retirement assertions for old selectors. |
| `test/message-image-preview.test.ts` | Assumes the text-only user surface class | Point structural coverage at the unified user body/card. |
| `test/browser/agent-card-separation-browser.test.ts` | Proves the avatar is outside the body and the user card is right-aligned | Change geometry checks to prove a left-aligned user card and avatar contained by its identity row/card. |
| `test/browser/conversation-image-attachments-browser.test.ts` | Reads the old user message surface bounds | Read the unified user card/body bounds. |
| Browser HTML-only fixtures with literal `data-align="right"` | Synthetic scroll/light-theme fixtures not rendered through `ChatBubble` | Replace only literals that model conversation user turns so fixtures match the canonical projection. |

No additional production user-message renderer or role-based alignment owner was
found. Unrelated right-aligned metadata and settings styles remain unchanged.

### Independent agent feedback

The user did not request multiple agents or a parallel audit. Under the active
delegation boundary, no sub-agent was started; the primary agent owns the
implementation and second review.

### Git baseline

- Branch: `work-v0.0.23beta-yr-0728`.
- Remote: `legacy-remote`.
- The worktree was clean.
- `git fetch legacy-remote` followed by
  `git rev-list --left-right --count HEAD...legacy-remote/work-v0.0.23beta-yr-0728`
  returned `0 0`.

## Design

`ChatBubble` will expose one card anatomy for top-level conversation turns:

1. left-aligned shell;
2. identity row inside the card, using `ChatBubbleIdentity`;
3. expanded body below the identity row;
4. one header-owned action surface.

The normalized role remains semantic data for labels, icons, colors, and
behavior, but no longer changes horizontal reading direction. User turns remain
always expanded and non-collapsible.

## Execution plan

1. Commit and push this indexed implementation record as the pre-code baseline.
2. Replace the role-dependent alignment and user-only external avatar/footer
   markup.
3. Converge the user card styles on the shared left card and identity-row
   primitives.
4. Update unit and Node/Playwright browser regressions, including explicit
   assertions that the former right/external-avatar implementation is absent.
5. Run targeted tests, Overlay typecheck/build, spec health tests, and a
   task-scoped browser screenshot.
6. Review the diff and screenshot a second time, then commit and push the final
   implementation to `legacy-remote`.

## Validation

- `bun test packages/overlay/test/chat-bubble-routing.test.ts
  packages/overlay/test/chat-bubble.test.ts
  packages/overlay/test/chat-bubble-role-distinction.test.ts
  packages/overlay/test/message-image-preview.test.ts`: 27 passed, 0 failed.
- `node test/browser-runner.mjs
  test/browser/agent-card-separation-browser.test.ts`: 1 passed, 0 failed
  after the isolated Vite fixture reached the real checker.
- The browser fixture asserts `data-align="left"`, one in-card identity row, no
  external avatar, a non-transparent card surface, shared lane edges, avatar
  containment by the identity row, and body containment below that row.
- Node/Playwright and the in-app Browser both rendered and inspected the exact
  task region. The latter measured `direction: ltr`, `text-align: left`, one
  identity row, zero external avatars, and an avatar rectangle contained inside
  the card and identity row.
- Visual evidence:
  `.scratch/user-message-left-card-identity-dark.png` and
  `.scratch/agent-card-separation-dark.png`. Both dark and light compositions
  were inspected; the avatar/identity/status/time line is inside the card and
  the body follows below it from the same left axis.
- `node test/browser-runner.mjs
  test/browser/conversation-image-attachments-browser.test.ts`: 1 passed, 0
  failed after the fixture was brought up to the current `/chat/capability`
  startup contract. The real page proves thumbnails stay deduplicated, precede
  message text, remain keyboard reachable, and now align from the left.
- `bun --cwd packages/overlay typecheck`: passed after concurrent Goal retry
  work completed its `BoardPanelProps` contract.
- The required pre-code plan commit/push could not be isolated because unrelated
  concurrent tasks began staging and committing the shared spec indexes during
  this task. No unrelated change was committed by this task; the implementation,
  tests, this record, and only this record's two index insertions were isolated
  in the final task commit.
