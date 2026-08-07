# Work Card Static Wave Scope

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User correction | The running `WORK` main-conversation card must not have a card-surface wave. Only the dedicated Agent card may keep a card-surface wave; all other card surfaces stay static. Only running Tool name/detail text may keep the text wave. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-aaac699c-f8ee-4f9d-9fa5-29fdf74cc30c.png` was inspected at original resolution. The main `WORK` conversation bubble visibly carries the traveling aqua surface band while its running `websearch` Tool text also carries the intended text treatment. |
| Acceptance criteria | A running main-conversation `WORK` bubble has no pseudo-element surface animation. A running exact-session conversation bubble in the Right Dock is also static because it is the same ordinary conversation-card renderer. A running dedicated compact Agent card (`.subagent-progress-card`) retains the existing paint-only surface wave. Running Tool name/detail text retains `tool-active-wave`; pending and terminal Tool text, narrative, User cards, artifacts, and every other card surface remain static. Reduced-motion behavior remains static. A real desktop page is opened and the exact Work/Tool region is captured and personally reviewed. |
| Hard constraints | Remove the over-broad projection at its single Cascading Style Sheets (CSS) owner. Do not add state, a timer, a renderer, a new keyframe, a negative override, a fallback, a compatibility branch, a gate, a temporary frame, a query override, a local signal, a synthetic message, a User Interface (UI) automated test, a fixture, or a screenshot baseline. Do not add, modify, update, delete, or run existing UI automated tests. Browser control uses the Browser skill through Node.js, never Bun. Preserve unrelated dirty backend-test and spec-index changes. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/12-overlay-card-system.md`; `2026-07-29-running-execution-wave-scope-and-text-contrast.md`; `2026-07-29-agent-wave-and-trailing-tool-disclosure.md`; `2026-07-29-conversation-streaming-text-wave.md`; `2026-07-28-subagent-running-surface-wave-and-selection-stability.md`; `Conversation.tsx`; `ConversationCard.tsx`; `ChatBubble.tsx`; `SubagentConversationPanel.tsx`; `SubagentProgressGrid.tsx`; `conversation.css`; `messages.css`; and introducing commit `8ec16b545c`. |
| Whole-repository grep | Searches covered every wave/shimmer animation, keyframe, mask, `.chat-bubble::before`, `.subagent-progress-card::before`, `chat-bubble-row`, `data-kind`, and `data-status` production owner. `messages.css` owns the only text wave and already scopes it to running Tool name/detail consumers. `conversation.css` owns the only surface wave. `ChatBubble.tsx` projects both main `WORK` and exact-session messages as `.chat-bubble-row[data-kind="agent"]`; `SubagentConversationPanel.tsx` reuses `ConversationCard`, so it is not a distinct Agent-card renderer. `SubagentProgressGrid.tsx` alone emits the dedicated `.subagent-progress-card` identity. |
| Independent review | Claude Code `2.1.147` was invoked from the repository root with only `Read,Grep,Glob`, no session persistence, streaming output, and explicit prohibitions on edits, UI tests, delegation, and worktrees. It exited before reading the repository because the local command-line interface is not authenticated (`Not logged in`). No Claude finding is claimed; the primary agent owns the evidence-based correction and final second review. |
| Git baseline | Branch `work-v0.0.24beta-yr-0729` and `myhexin/work-v0.0.24beta-yr-0729` were converged at `ff58137c8c` after fetch. Existing changes in `conversation-history-recovery-routes.test.ts` and both shared spec indexes are unrelated and must be preserved. |

## Cause Chain

1. `ChatBubble.tsx` correctly represents a backend Agent-authored main message
   with `data-kind="agent"`. Its visible identity label can be `WORK`.
2. The earlier animation implementation treated that protocol kind as a visual
   component identity by selecting every
   `.chat-bubble-row[data-kind="agent"]`. This is the direct reason the supplied
   `WORK` bubble receives `chat-bubble::before` and
   `agent-running-surface-wave`.
3. The Right Dock exact-session panel renders the same `ConversationCard` and
   `ChatBubble`; it is an ordinary conversation bubble, not the dedicated Agent
   card requested to wave.
4. The dedicated Agent card has a separate, explicit production identity:
   `.subagent-progress-card`, emitted only by `SubagentProgressGrid.tsx`.
5. The root correction is to remove every ordinary chat-bubble selector from
   the shared surface-wave block, leaving the existing pseudo-element,
   animation, keyframe, stacking, timing, and reduced-motion boundary owned only
   by `.subagent-progress-card`. Tool text animation remains unchanged.

## Complete Call-Site Disposition

| Owner or consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/ChatBubble.tsx` | Preserve truthful `data-kind`, `data-status`, main/Right-Dock rendering, narrative, Tool disclosures, and semantic identity. A protocol kind must not be rewritten to repair presentation. |
| `packages/overlay/src/components/ConversationCard.tsx` | Preserve the shared dispatcher used by main and exact-session conversations. |
| `packages/overlay/src/components/SubagentConversationPanel.tsx` | Preserve its shared `ConversationCard` projection; exact-session bubbles become static through the single CSS correction. |
| `packages/overlay/src/components/SubagentProgressGrid.tsx` | Preserve `.subagent-progress-card`, canonical status, and compact Agent-card behavior. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Delete the four ordinary `.chat-bubble-row[data-kind="agent"]` selector branches from isolation, pseudo-element, child stacking, and running animation ownership. Keep the existing dedicated Agent-card wave implementation and keyframe. |
| `packages/overlay/src/styles/surfaces/messages.css` | Preserve the sole status-driven running Tool name/detail text wave without changes. |
| `specs/current/architecture/12-overlay-card-system.md` | Correct the current contract: only the compact dedicated Agent card owns the surface wave; main and exact-session conversation bubbles remain static while nested running Tool text uses its canonical presentation. |
| Prior July records | Preserve as historical evidence. This record supersedes their over-broad statement that ordinary or exact-session Agent conversation bubbles are surface-wave consumers. |
| Existing Overlay UI tests and browser fixtures | Do not add, modify, update, delete, or run. UI acceptance uses static/build checks plus real-page interaction, screenshots, and personal visual review. |

## Implementation And Verification Plan

1. Commit and push this Recall before product edits.
2. Remove the ordinary chat-bubble selector branches from the sole surface-wave
   block and correct the current card-system architecture paragraph.
3. Run Overlay typecheck, localization validation, production build,
   documentation-health checks, and `git diff --check`; do not run UI tests.
4. Start an isolated real OpenCorvus page from the current source. Inspect the
   supplied Work/Tool surface, capture the exact card region, and verify the
   Work pseudo-element has no animation while Tool ordering/text presentation
   remains intact. Do not manufacture a running state.
5. Re-grep every owner, perform a second exact-diff and screenshot review,
   update this record and both spec indexes, fetch/converge, selectively commit
   only task-owned paths and hunks, push to `myhexin`, and verify remote
   convergence.

## Progress

- [x] Supplied screenshot, architecture, history, render identities, animation
      owners, all production call sites, and dirty Git baseline inspected.
- [x] Authentication-blocked Claude Code review attempt recorded honestly.
- [x] Recall, causal chain, complete call-site disposition, and verification
      plan recorded.
- [x] Recall commit `4808f8bb8e` and git-cc push complete.
- [x] Product and architecture correction plus static/build verification complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Final record/index update and product commit `e3622e9fba` pushed to
      git-cc; final record convergence follows in its own traceable commit.

## Visual Evidence

The current production build was served by an isolated local OpenCorvus process
on port `7884`; the process identity was verified before shutdown. The existing
real task `用户反馈洞察网站与季度路线图` supplied the ordinary `WORK` conversation
card without fixtures, query overrides, local signals, or manufactured running
state.

The inspected `.chat-bubble-row[data-kind="agent"] .chat-bubble::before`
computed to `content: none`, `background-image: none`, and
`animation-name: none`. The real desktop screenshot
[`2026-07-30-work-card-static.png`](../../artifacts/2026-07-30-work-card-static.png)
was personally reviewed: the `WORK` card is static, its narrative remains dark
and legible, and every visible Tool disclosure chevron follows its Tool text.
The persisted task was terminal, so no running state was synthesized merely to
demonstrate the retained Tool text wave; the unchanged canonical
`messages.css` selector remains limited to running Tool name/detail text.

## Verification

| Check | Result |
| --- | --- |
| Overlay TypeScript typecheck | Passed |
| Overlay localization validation | Passed |
| Overlay production Vite build | Passed; only existing dependency directive and chunk-size warnings were emitted |
| Biome check for `conversation.css` | Passed |
| Historical documentation link checks | Passed: 22 checks |
| Document-health checks | Passed: 63 checks |
| `git diff --check` | Passed |
| Whole-owner grep | Passed: `agent-running-surface-wave` is consumed only by `.subagent-progress-card[data-status="running"]::before`; `tool-active-wave` remains owned only by running Tool name/detail text |
| Real-page computed style and screenshot review | Passed |
