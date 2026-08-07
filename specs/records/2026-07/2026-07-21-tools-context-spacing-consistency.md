# Tools Context Spacing Consistency

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Make the vertical distance between each collapsed `Tools n` disclosure and its preceding assistant context consistent, as shown by `C:/Users/10132/AppData/Local/Temp/codex-clipboard-53148e57-888b-47d6-8aad-ab6706a63e6d.png`. |
| Acceptance criteria | A collapsed Tools disclosure following narrative text has the same measured context gap whether the narrative is rendered as parsed Markdown or as the active streaming text block; the disclosure remains transparent, compact, keyboard-operable, and chronologically located; multi-message Agent cards preserve their message grouping and timestamp ownership. Focused source tests, a Node-launched isolated real page, computed geometry, and personally inspected desktop screenshots pass. |
| Hard constraints | Keep `CardParts` as the only chronological execution/disclosure renderer, `TextPart` as the only narrative renderer, and existing Button/Markdown primitives. Use existing spacing tokens; add no renderer fork, fallback, state machine, gate, mobile scope, worktree, or temporary iframe. Do not restart, refresh, or otherwise alter the user's running OpenCorvus/Overlay process. Preserve unrelated dirty Mailbox, Provider, landing-page, Tool-tooltip, and dialog work. |
| Supplied evidence | The original-resolution screenshot was inspected. It shows two collapsed `Tools 1` rows whose preceding single-line assistant contexts have visibly different vertical gaps. |
| Sources read | `AGENTS.md`; Browser skill; `specs/current/architecture/07-panel.md`; the 2026-07-17 Tools/Reasoning density, plain-stream, inline-flow, and message-hover-time records; `CardParts.tsx`; `TextPart.tsx`; `text-part-model.ts`; `card-message-run.ts`; `messages.css`; `markdown.css`; `card.css`; `chat-bubble.css`; focused source/browser tests and fixtures. |
| Whole-repository search evidence | `rg` enumerated every `msg-work-details`, `chat-bubble__body-inner`, `card-message-run`, `msg-text`, `md-frozen-block`, and `md-active-text` owner and consumer. Production rendering remains singular. `markdown.css` gives parsed paragraphs a bottom margin while active streaming text has no matching margin; `chat-bubble.css` currently removes the generic body gap whenever Tools exists, leaving that renderer-shape difference observable at the narrative-to-disclosure boundary. Direct regression consumers are `chat-bubble.test.ts`, `message-embed.test.ts`, `message-part-chronology-browser.test.ts`, and `chat-bubble-disclosure-button-browser.test.ts`. |
| Independent agent feedback | None. The user did not request delegation, so no sub-agent was started. |
| Git baseline | `HEAD` and `legacy-remote/work-v0.0.13beta-yr-0721` both resolve to `6b4948af4`; the existing dirty worktree belongs to concurrent tasks and will not be staged by this repair. |

## Evidence and causal chain

`CardParts` emits narrative and execution runs in one chronological path, so the
visible difference is not caused by two Tool renderers. `TextPart` deliberately
uses two DOM shapes: parsed Markdown is nested below `.md-frozen-block` and
inherits the paragraph margin from `markdown.css`, while the active streaming
tail is a plain `.md-active-text` block without that margin. The Agent body
removes its generic flex gap as soon as any aggregate execution disclosure is
present. Consequently, the remaining distance before the next Tools disclosure
is decided accidentally by the preceding narrative DOM shape instead of by one
transcript spacing contract.

The repair belongs at the existing narrative-to-execution boundary. It must
neutralize only the final Markdown margin adjacent to Tools and assign the gap
to the Tools disclosure through the existing spacing scale. It must not change
Markdown spacing elsewhere, the disclosure Button's height, chronological
grouping, or Tool rendering.

## Call-site decisions

| Call site | Decision |
| --- | --- |
| `styles/surfaces/chat-bubble.css` | Own the Agent narrative-to-Tools boundary: zero the final parsed-Markdown margin only when that narrative is immediately followed by `.msg-work-details`, then apply one token-backed top gap to the disclosure. Preserve generic narrative and message-run separation. |
| `CardParts.tsx`, `TextPart.tsx`, `text-part-model.ts` | No production change. Preserve the single chronological renderer and incremental streaming behavior. |
| `styles/surfaces/messages.css`, `styles/surfaces/markdown.css` | No production change. Preserve the Tools row primitive and global Markdown rhythm; the conversation-specific adjacency owner absorbs the boundary difference. |
| `test/chat-bubble.test.ts` | Assert a single token-backed narrative-to-Tools spacing contract and explicit parsed-Markdown margin neutralization. |
| `test/browser/fixtures/message-part-chronology/*` | Render the real production styles and representative parsed/streaming narrative-to-Tools pairs without inventing alternate UI markup. |
| `test/browser/message-part-chronology-browser.test.ts` | Measure both gaps, require sub-pixel equality, preserve chronology/interaction, and capture task-scoped desktop screenshots. |
| `test/browser/chat-bubble-disclosure-button-browser.test.ts` | Keep the full Overlay conversation coverage and verify the existing aggregate disclosure remains compact and transparent. |

## Implementation and verification plan

1. Add focused failing source/browser assertions that expose the parsed-Markdown versus active-streaming gap difference on the real component path.
2. Add the conversation-scoped narrative-to-Tools spacing contract using the existing spacing token and remove only the adjacent final Markdown margin contribution.
3. Run focused unit/source tests, Overlay typecheck and internationalisation, then start the isolated Vite fixture with Node.
4. Use the in-app browser to inspect computed geometry and current-task screenshots at a desktop viewport; iterate until both gaps match visually and numerically.
5. Run documentation health, inspect the scoped diff a second time, fetch/reconcile legacy remote, commit only task-owned files/hunks with the required `dsw-33987` prefix, push `legacy-remote`, and verify local/remote equality.

## Progress

- [x] Read constraints, current architecture, prior decisions, and all production/test call sites.
- [x] Identified the renderer-shape margin difference at the narrative-to-Tools boundary.
- [x] Added regression coverage and the single spacing contract.
- [x] Completed real-browser visual verification and second review.
- [x] Committed and pushed the verified repair to legacy remote.

## Verification

- The focused fixture reproduced the pre-fix mismatch exactly: parsed Markdown
  measured `5.0000019px` before Tools while the active streaming block measured
  approximately `0px`.
- After the repair, the Node-launched headed browser measured `4.0000019px` and
  `3.9999981px`; both disclosures remain 24px tall with transparent backgrounds.
- The in-app browser independently loaded `http://127.0.0.1:5216/`, exposed the
  parsed paragraph margin as `0px`, the active-text margin as `0px`, and both
  disclosure margins as `4px`. Its console warning/error log was empty.
- Original-resolution review of `.scratch/tools-context-spacing-dark.png` shows
  matching narrative-to-Tools rhythm in the two renderer states. Review of
  `.scratch/overlay-transcript-dark-default.png` and
  `.scratch/overlay-transcript-dark-expanded.png` confirms the full conversation
  keeps the compact disclosure and expanded Tool surfaces without clipping or
  chronology regressions.
- `bun test packages/overlay/test/chat-bubble.test.ts packages/overlay/test/message-embed.test.ts packages/overlay/test/streaming-text-render.test.ts packages/overlay/test/card-message-run.test.ts`
  passed with 16 tests and 153 expectations.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/tools-context-spacing-browser.test.ts`
  passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts`
  passed after its geometry assertion accepted sub-pixel rounding and required
  the new 4px narrative gap.
- `bun run --cwd packages/overlay typecheck` and
  `bun run --cwd packages/overlay check:i18n` passed.
