# Running execution wave scope and narrative contrast

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | The running Agent card's narrative is currently lighter than Tool-call text. Make narrative darker and remove its wave. Only a Tool that is still executing and an Agent card that is still executing may wave. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-b2166906-4140-40a0-a97c-676ec8fdd2e1.png` was inspected at original resolution. The running `MISSION` card shows pale narrative paragraphs while the Tool rows below are visibly darker. |
| Acceptance criteria | Narrative text remains static at the canonical body foreground in running and terminal Agent cards. It is visibly darker than the low-emphasis Tool-call text. Only `running` Tool labels and details retain the current text wave; pending and terminal Tools stay static. Canonical `running` Agent cards, including ordinary conversation cards, exact-session cards, and compact child-Agent cards, receive one surface-only wave. Terminal Agent cards and reduced-motion rendering stay static. No wave changes text geometry or masks Agent narrative. |
| Hard constraints | Reuse `CardNode.status`, existing `data-status`, `tool-active-wave`, `--ui-duration-loop-tool-wave`, and the existing Agent stage colour. Do not add state, timers, fallback, gate, synthetic messages, UI tests, fixture changes, or screenshot baselines. Do not modify or run existing UI automation tests. Preserve unrelated dirty Composer, workspace, dialog-title, Right Dock, localization, and specification work. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/12-overlay-card-system.md`; `2026-07-24-agent-card-palette-and-running-tool-wave.md`; `2026-07-27-active-tool-wave-all-agent-surfaces.md`; `2026-07-28-subagent-running-surface-wave-and-selection-stability.md`; `2026-07-29-conversation-streaming-text-wave.md`; `TextPart.tsx`; `text-part-model.ts`; `CardParts.tsx`; `ConversationCard.tsx`; `ChatBubble.tsx`; `Card.tsx`; `SubagentProgressGrid.tsx`; `messages.css`; `markdown.css`; `chat-bubble.css`; `conversation.css`; palette and motion tokens; current Git history and dirty-worktree diff. |
| Whole-repository grep | `TextPart.tsx` alone emits `.md-active-text`; `CardParts.tsx` passes one Agent-card running flag to every narrative part. `messages.css` alone masks `.conversation-body .chat-bubble .md-active-text` together with status-driven Tool text. `.msg-text` already uses `--text` (`#343a3d` in light theme), while compact Tool disclosure uses the lighter `--transcript-tool-foreground` derived from `--text-muted`. `ConversationCard.tsx` routes every `agent` node through `ChatBubble`; the top-level row and bubble both expose canonical status. `SubagentProgressGrid.tsx` is the only compact child-Agent renderer and exposes the same status. `conversation.css` previously owned the shared directional Agent-surface wave, but the 2026-07-29 refinement deleted it when ordinary narrative was added to the Tool text mask. |
| Independent review feedback | No sub-agent was spawned because the user did not request delegation. Claude Code `2.1.147` was invoked from the repository root with only `Read,Grep,Glob`, no session persistence, and no worktree/delegation capability, but exited before reading the repository because the local CLI is not authenticated (`Not logged in`). The primary agent therefore owns both evidence reviews and records that unavailable review honestly. |
| Git baseline | Delivery branch is `work-v0.0.24beta-yr-0729`. The concurrently authored plan commit `baa2d9a703` was reviewed and pushed to `myhexin` before this task's files changed. Unrelated user-owned working-tree changes remain unstaged and must be preserved. |

## Causal chain

1. Every Text part in a running Agent card receives `streaming=true`, so its
   trailing block is emitted as `.md-active-text`.
2. `messages.css` currently includes all such active narrative in the same
   opacity mask as running Tool labels/details. The 40% to 70% mask therefore
   makes narrative lighter than Tool rows and animates it even though narrative
   is not the execution affordance requested now.
3. The same earlier refinement removed the independent surface pseudo-element
   wave from running child-Agent cards. Removing only the narrative selector
   would fix text but would leave canonical running Agent cards without the
   requested surface wave.
4. The root correction is to keep narrative on its existing static `--text`
   foreground, keep the Tool wave status-driven and text-only, and restore one
   status-driven paint-only wave across the Agent card surface implementations.

## Call-site disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/TextPart.tsx` and `text-part-model.ts` | Preserve incremental rendering and `.md-active-text`; it remains a rendering marker, not a motion trigger. |
| `packages/overlay/src/components/CardParts.tsx`, `ChatBubble.tsx`, `ConversationCard.tsx`, and `SubagentProgressGrid.tsx` | Preserve canonical status propagation and DOM identity; add no presentation state. |
| `packages/overlay/src/styles/surfaces/messages.css` | Remove the narrative selector and pending Tool selectors from the existing Tool wave, then update its ownership comment. Preserve the running Tool consumers, mask, keyframe, duration, and reduced-motion boundary. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Restore one directional, paint-only Agent surface wave shared by canonical running conversation Agent cards and compact child-Agent cards. Scope the bubble selector to `data-kind="agent"` so User cards and Tool cards never inherit it. |
| `packages/overlay/src/styles/surfaces/chat-bubble.css`, `markdown.css`, and palette/motion tokens | Preserve. Their existing body foreground, card surface, stage colour, positioning, overflow, and timing sources already satisfy the corrected contract. |
| `packages/overlay/test/**` | Do not add, modify, delete, update, or run. UI acceptance uses static checks plus real-page interaction, screenshots, computed-style diagnosis, and manual visual review only. |

## Implementation and verification plan

1. Commit and push this Recall before production edits.
2. Remove narrative from the Tool text mask and restore the shared running-Agent
   surface wave without changing component state or layout.
3. Run formatting/diff checks, Overlay TypeScript, localization validation, and
   the production Vite build. Do not run UI tests.
4. Start a current-source page with Node, operate the actual desktop UI, capture
   task-scoped screenshots of running and terminal Agent/Tool states, inspect
   narrative contrast and computed motion, and iterate until correct.
5. Re-grep every owner, perform a second exact-diff and visual review, update
   this record, run documentation-health checks, selectively commit only
   task-owned hunks, fetch/converge with `myhexin`, and push through normal hooks.

## Progress

- [x] Screenshot, architecture, history, render chain, colour/motion sources,
      dirty-worktree boundaries, and all call sites inspected.
- [x] Root cause and implementation plan recorded.
- [x] Recall commit and git-cc push complete.
- [x] Implementation and static/build validation complete.
- [x] Real desktop integrated page inspected and corrected.
- [x] Second review, documentation evidence, implementation commit, and git-cc
      push complete.

## Visual evidence

- `specs/artifacts/2026-07-29-running-execution-wave-static-contrast.png` is a
  current-source build served by the real OpenCorvus backend and inspected at
  original resolution. Agent narrative is dark and stable while the completed
  Tool disclosure is visibly lighter.
- Computed styles on that page report narrative `rgb(52, 58, 61)` with
  `animation-name: none`; the completed Tool foreground is the 92%-alpha muted
  foreground and also static. The completed Agent surface pseudo-element has
  `animation-name: none`.
- A real running-state capture was attempted through both an existing active
  Task and a real Chat send. The unrelated existing data failed before an Agent
  run could start: the Task conversation returned HTTP 500, while Chat creation
  and follow-up returned existing Task Artifact and Instance lifecycle errors.
  No fixture, signal, query override, or synthetic message was substituted.

## Verification

- Overlay TypeScript check passed.
- Overlay localization check passed.
- Production Vite build completed and the backend served the new build at
  `/ui/`.
- Historical-document link validation passed.
- The full-worktree document-health run reached the checker and its only
  failure is outside this delivery: five concurrently authored July records
  are already linked from the shared monthly index but remain untracked. This
  delivery's record and both index entries are present and resolve.
- `git diff --check` passed.
- No UI automated test was added, modified, updated, deleted, or run.
