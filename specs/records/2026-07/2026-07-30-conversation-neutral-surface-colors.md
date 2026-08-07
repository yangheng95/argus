# Conversation Neutral Surface Colors

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | The supplied `WORK` conversation crop has the wrong surrounding background color and the wrong message-card color. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-1062f30d-bdef-4130-b0d2-21aa74ebc80c.png` was inspected at original resolution. Its exact-session reading canvas is `rgb(244, 244, 245)` while the Work card is a stage-tinted aqua `rgb(231, 248, 247)`. |
| Acceptance criteria | Main Conversation and Right Dock exact-session transcripts use the canonical `--chat-canvas` reading surface. Top-level Agent/Work message cards use one neutral theme surface rather than a stage-derived fill. User-card treatment, card geometry, identity, avatar/status stage color, Tool disclosure behavior, running Tool text treatment, and compact Agent progress-card treatment remain unchanged. The real desktop task and exact Work-card region are opened, captured, and personally reviewed. |
| Hard constraints | Correct the two existing single owners. Do not add raw colors, a palette, a renderer, component state, a fallback, compatibility selector, gate, query override, temporary frame, synthetic message, mobile/tablet scope, or a User Interface (UI) automated test. Do not add, modify, update, delete, or run existing UI test files. Browser control and screenshots use the Browser skill through Node.js. Preserve unrelated dirty icon and Work Ledger changes. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/12-overlay-card-system.md`; the July 15 Agent-card surface record; July 19 message/Tool tone record; July 24 color removal/restoration record; July 27 border-removal record; July 29 Conversation/Dock convergence and edge-to-edge records; July 30 static Work-card record; `App.tsx`; `ChatBubble.tsx`; `ConversationCard.tsx`; `SubagentConversationPanel.tsx`; `card-color.ts`; `light.css`; `dark.css`; `vscode-dark.css`; `conversation.css`; `workspace.css`; `inspector.css`; `card.css`; `chat-bubble.css`; and `messages.css`. |
| Whole-repository grep | Production search enumerated every `--conversation-card-background`, `--card-stage`, `.subagent-conversation-panel`, `--chat-canvas`, and Tool-surface consumer. `chat-bubble.css` is the sole top-level Agent message-fill owner. `SubagentConversationPanel.tsx` reuses `ConversationCard`/`ChatBubble`; `inspector.css` is the sole exact-session canvas owner. `messages.css` consumes the inherited card background for expanded Tool tone. Main Conversation already uses `--chat-canvas`. Stage color remains independently consumed by avatars, status, Agent rail, compact progress cards, and other structured card identities. |
| Independent review | No sub-agent was created because the user did not request delegation. Claude Code 2.1.147 was invoked once from the repository root with only `Read,Grep,Glob`, streaming output, no session persistence, and explicit prohibitions on edits, delegation, worktrees, and UI tests. It returned `Not logged in` before reading the repository, so no Claude finding is claimed. |
| Git baseline | Branch `work-v0.0.24beta-yr-0729` and `legacy-remote/work-v0.0.24beta-yr-0729` are converged at `52ca2ead54`. Existing uncommitted header-icon and Work Ledger pin-color changes are unrelated and must remain unstaged. |

## Cause Chain

1. The screenshot is not a theme-palette failure. The light theme already
   defines `--chat-canvas` as white and `--surface-inset` as neutral gray.
2. The exact-session Right Dock explicitly replaces the reading canvas with
   `--surface-inset`; this is why its gutter is gray while main Conversation is
   white despite both rendering the same `ConversationCard`.
3. `ChatBubble.tsx` truthfully projects the Agent stage through `--card-stage`.
   `chat-bubble.css` then mixes seven percent of that stage into
   `--surface`; this is the direct reason the Work card is aqua.
4. The stage mix was previously intentional, but the user's current visual
   correction supersedes that fill decision. Stage identity does not need the
   whole card surface because avatar, status, rail, and compact Agent card
   already consume the canonical stage token.
5. The correct repair is therefore to make the exact-session panel consume the
   same `--chat-canvas` as main Conversation and make the existing
   `--conversation-card-background` owner consume a neutral theme surface.
   Nested expanded Tools continue to derive their restrained tone from the same
   message-card token, so no second Tool color source is introduced.

## Complete Call-Site Disposition

| Owner or consumer | Decision |
| --- | --- |
| `packages/overlay/src/styles/surfaces/inspector.css` `.subagent-conversation-panel` | Replace `--surface-inset` with `--chat-canvas`; preserve selector, tabs, scrolling, padding, and all interaction behavior. |
| `packages/overlay/src/styles/surfaces/chat-bubble.css` Agent-row token | Replace the stage/surface mix with the existing neutral `--surface-inset` token. Preserve `--conversation-card-background` as the single card/Tool provenance. |
| `packages/overlay/src/styles/surfaces/messages.css` | Preserve the expanded Tool surface/header derivation from `--conversation-card-background`; it automatically follows the neutral card correction. |
| `packages/overlay/src/components/ChatBubble.tsx` and `utils/card-color.ts` | Preserve truthful stage projection. Stage remains visible through identity consumers and is not rewritten to solve presentation. |
| Main `Conversation`, Right Dock `SubagentConversationPanel`, and shared `ConversationCard` | Preserve the single renderer and data path. Both surfaces converge through their existing CSS owners. |
| Theme palette files | Preserve. They already provide the correct semantic white canvas and neutral inset surface for light, dark, and VS Code Dark themes. |
| `card.css`, avatars, status, Agent rail, compact progress cards | Preserve their stage-aware structured identity treatment. |
| `specs/current/architecture/12-overlay-card-system.md` | Record that ordinary Agent message surfaces are neutral while stage remains an identity token; main and exact-session reading canvases share `--chat-canvas`. |
| Historical July records | Preserve as historical evidence. This record supersedes their stage-derived whole-message fill decision. |
| Existing/new UI tests | Do not add, modify, update, delete, or run. Acceptance is typecheck/build integrity plus real-page interaction, screenshot, and personal visual review. |

## Implementation And Verification Plan

1. Commit and push this Recall and its indexes before product edits.
2. Correct the exact-session canvas and Agent message-card token at their two
   canonical CSS owners, then update the current card-system architecture.
3. Run Overlay typecheck, localization validation, production build,
   documentation health, formatting/static checks, and `git diff --check`.
   Do not run UI tests.
4. Start an isolated real OpenCorvus page, select the existing real task, open
   the exact Work/Conversation region and Right Dock exact-session surface when
   available, then capture and personally inspect the corrected colors.
5. Re-grep every production owner, perform a second exact-diff and screenshot
   review, update this record with evidence, fetch/converge, commit only
   task-owned files, push to `legacy-remote`, and verify remote convergence.

## Progress

- [x] Inspect supplied screenshot, pixel colors, current architecture, history,
      render identities, all production color owners, and dirty Git baseline.
- [x] Attempt the required read-only Claude Code review and record the
      authentication blocker.
- [x] Record Recall, causal chain, complete call-site disposition, and plan.
- [x] Commit and push the pre-implementation plan.
- [x] Implement the two single-owner color corrections and architecture update.
- [x] Complete static/build verification and real-page visual acceptance.
- [x] Complete second review, final commit, push, and remote convergence.

## Visual Evidence

The current production Overlay was built and served by a real source
OpenCorvus process on the dynamically discovered port `53510`. The existing
real Work conversation `用户反馈洞察网站与季度路线图` was selected from the live Work
Ledger; no fixture, query override, local signal, synthetic message, temporary
frame, or manufactured card state was used.

The task-bound screenshot
[`2026-07-30-conversation-neutral-surfaces.png`](../../artifacts/2026-07-30-conversation-neutral-surfaces.png)
was inspected at its original 1280×720 resolution. The Conversation reading
surface is white, User and Work cards use quiet neutral gray materials, and
the Work avatar/status retain their turquoise identity. Narrative, Tool rows,
disclosures, timestamps, Composer, and card geometry remain legible and
unchanged.

A bounded computed-style inspection of the same real page reported:

| Surface | Rendered evidence |
| --- | --- |
| Main `#chatScroll` | `background: rgb(255, 255, 255)` |
| Work `.chat-bubble` | `background: rgb(244, 244, 245)` with no background image |
| Work `--conversation-card-background` | `rgb(244, 244, 245)` |
| Work `--card-stage` | Retained the canonical assistant stage mix for identity consumers |
| Mounted `.subagent-conversation-panel` | `background: rgb(255, 255, 255)` |

The real Right Dock was also opened through its visible control and personally
reviewed. Its header/body remain continuous with the Conversation canvas. The
selected Work has no active child-session transcript to display, so no
exact-session state was synthesized merely to populate that panel.

## Verification

| Check | Result |
| --- | --- |
| Overlay TypeScript typecheck | Passed |
| Overlay localization validation | Passed |
| Overlay production Vite build | Passed through the package-local Node/Vite entry point; 7,055 modules transformed and only existing dependency-directive/chunk-size warnings were emitted |
| Biome check for the two CSS owners and current architecture | Passed |
| Historical documentation links | Passed |
| Document health | Passed |
| Whole-owner grep | Passed: the Agent message token is neutral, exact-session canvas consumes `--chat-canvas`, Tool surfaces still inherit the card token, and stage color remains consumed by identity surfaces |
| `git diff --check` | Passed |
| Real-page screenshot and second visual review | Passed |

## Delivery

- Pre-implementation Recall: `8c45825f14`
- Product, architecture, and visual evidence: `09c4c1fbe3`
- legacy remote branch: `legacy-remote/work-v0.0.24beta-yr-0729`
- The product commit and remote branch converged after the required pre-push
  typecheck, route inventory, API documentation, localization, and secret
  checks passed.
