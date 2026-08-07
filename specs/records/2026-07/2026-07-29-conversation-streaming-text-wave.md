# Conversation Streaming and Running Tool Text Wave

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Reproduce the quiet Codex traveling-light effect in the main OpenCorvus conversation and the right-side Squad experience. |
| User refinements | The first implementation felt too continuous. The final requirement is a lighter, slower wave with a longer resting interval. In the right-side Squad panel, the card surface and ordinary narrative must remain static; only the text of a Tool that is currently running may wave. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-ede024c9-f645-431c-b729-f94f8bc098e6.png` and `C:/Users/10132/AppData/Local/Temp/codex-clipboard-06b534f3-595b-4bf8-b91f-66334ebdc7e1.png` were inspected. The reference is a horizontal opacity band across text, not geometric distortion, flashing, or a whole-surface shimmer. |
| Final acceptance criteria | Main-conversation live narrative uses the wave. Running Tool labels/details use the same wave in both main and right-side exact-session conversations. The right-side Agent card, ordinary narrative, completed/error Tool rows, and frozen/terminal narrative stay static. One cycle is 3.4 seconds: motion through 65% of the cycle and a hold from 65% through 100%. The mask ranges from the existing faint opacity (40%) to dim opacity (70%). Reduced-motion rendering stays static and readable. |
| Hard constraints | Reuse the canonical running/pending Tool status, `.md-active-text`, `tool-active-wave`, and `--ui-duration-loop-tool-wave`. Do not add a second state source, JavaScript timer, renderer, keyframe, fallback, gate, iframe, query override, synthetic message, or UI automated test. Operate and inspect a real current-source page; do not alter the user's native running OpenCorvus process. |
| Sources read | Root `AGENTS.md`; Browser control skill; both supplied screenshots; `2026-07-29-ui-automated-test-prohibition.md`; `2026-07-24-agent-card-palette-and-running-tool-wave.md`; `2026-07-27-active-tool-wave-all-agent-surfaces.md`; `2026-07-28-subagent-running-surface-wave-and-selection-stability.md`; `TextPart.tsx`; `text-part-model.ts`; `CardParts.tsx`; `ConversationCard.tsx`; `ChatBubble.tsx`; `Card.tsx`; `Conversation.tsx`; `ConversationAgentRail.tsx`; `SubagentConversationPanel.tsx`; `subagent-conversation.ts`; `messages.css`; `markdown.css`; `chat-bubble.css`; `conversation.css`; and motion tokens. |
| Whole-repository grep | `CardParts.tsx` is the sole production caller of `TextPart`; `.md-active-text` exists only for the live streaming tail. `ConversationCard.tsx` remains the sole conversation dispatcher. The right exact-session panel renders that same shared chain. `messages.css` owns the sole text-mask wave. The previous right-side surface wave was separately owned by `conversation.css` pseudo-elements on `.subagent-progress-card` and `.subagent-conversation-panel .chat-bubble`; those owners must be removed rather than hidden by another layer. |
| Independent-agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and second review. |
| Git baseline | `work-v0.0.24beta-yr-0729` and `myhexin/work-v0.0.24beta-yr-0729` both pointed to `974cde4d71` before this record. The worktree was clean. The initial plan commit is `85f0ffca84`. |

## Causal chain

1. The original gap was that live narrative text remained uniformly painted
   while active Tool text already had a directional mask.
2. Extending the existing text mask solved that gap, but applying it to every
   shared `.chat-bubble` would also animate narrative inside the right-side
   exact-session panel, contrary to the user's refined scope.
3. The earlier right-side whole-card wave was an independent pseudo-element
   animation in `conversation.css`; changing text opacity could not remove it.
4. The final single-source result therefore scopes live narrative to
   `.conversation-body`, keeps the shared status-driven Tool selectors for both
   surfaces, and removes the obsolete right-side whole-card pseudo-element
   owner.

## Call-site disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/TextPart.tsx` | Preserve `.md-active-text` as the sole active streaming-tail marker. |
| `packages/overlay/src/components/{CardParts,ChatBubble,Card}.tsx` | Preserve canonical card status propagation; add no presentation state. |
| `packages/overlay/src/components/SubagentConversationPanel.tsx` and `services/subagent-conversation.ts` | Preserve exact-session routing and canonical status projection. |
| `packages/overlay/src/styles/surfaces/messages.css` | Scope live narrative to `.conversation-body`; retain shared running/pending Tool selectors; lighten the mask peak; add the end-of-cycle hold to the sole keyframe. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Remove the former Sub-agent progress/exact-session whole-card pseudo-element wave and its keyframe. Keep the static running border treatment. |
| `packages/overlay/src/styles/tokens/design-language.css` | Change the existing shared Tool-wave duration token from 2 seconds to 3.4 seconds. |
| Existing UI tests and fixtures | Do not add, modify, update, delete, or run them. UI acceptance is real-page operation, screenshot capture, computed-style diagnosis, and personal visual review only. |

## Implementation and verification plan

1. Implement the final selector, mask, timing, and whole-card removal in the
   existing CSS owners.
2. Run Overlay typecheck/build and required documentation-health verification;
   do not run UI tests.
3. Use an isolated current-source Vite frontend and current-source OpenCorvus
   backend, operate the actual desktop UI, create a real Mission/Task/Agent
   chain, and inspect both main-conversation streaming and right-side Agent
   content. The user's native backend remains untouched.
4. Re-grep all owners, inspect the exact diff, perform a second visual review,
   update this record, commit with the `dsw-33987` prefix, reconcile with
   git-cc, and push.

## Visual evidence

- `.scratch/conversation-streaming-wave-light-final.png`: current-source main
  conversation streaming in light theme; inspected for readability, low
  contrast, and absence of layout movement.
- `.scratch/squad-tool-text-wave-light-final.png`: real Mission → Task →
  `source-investigator` exact-session panel; inspected to confirm the Agent card
  and ordinary narrative are static and the former whole-card overlay is gone.
- Runtime computed-style inspection on the real exact-session panel confirmed
  `chat-bubble::before` has no content/background/animation and
  `.md-active-text` has `animation-name: none`. Main-conversation inspection
  confirmed `tool-active-wave`, `3.4s`, and a 40% → 70% → 40% mask.

## Verification

- `bun run typecheck` in `packages/overlay`: passed.
- `bun run build:vite` in `packages/overlay`: passed; existing dependency
  directive and chunk-size warnings only.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`:
  22 passed.
- `bun test packages/opencorvus/test/script/document-health.test.ts`:
  63 passed.
- No UI automated test was added, modified, updated, deleted, or run.

## Progress

- [x] Supplied evidence, prior decisions, render chain, motion owner, and UI-test prohibition reviewed.
- [x] Final selector, lighter mask, 3.4-second cycle, longer hold, and whole-card removal implemented.
- [x] Type/build/document verification complete.
- [x] Real-page main/Squad visual acceptance complete.
- [x] Second grep/diff review and delivery preparation complete; commit and git-cc push follow this recorded verification.
