# Parent Execution Wave Scope

## Recall

| Item                  | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement      | Remove the wave from every Tool text row and compact Agent card that is not executing. When the owning Task is failed, cancelled, completed, or otherwise not running, all nested Tool and Agent waves must also stop even if a child record still says `running`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Supplied evidence     | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-6e9da016-a834-4e8a-97ad-c70f11e30bf1.png` was inspected at original resolution. The selected Task is visibly failed while the nested `universal-build` compact Agent card still carries the running surface wave.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Acceptance criteria   | Tool text uses `tool-active-wave` only when that exact Tool has canonical status `running` and the selected owning Task or standalone conversation has canonical status `active`. The compact Agent card uses `agent-running-surface-wave` only when that exact Agent has canonical status `running` and the same parent execution is `active`. Failed, cancelled, completed, queued, idle, missing, and cross-selection parent data keep all nested Tool/Agent waves static. Main and exact-session conversation cards remain static. Compact Agent Tool rows remain static. Reduced-motion remains static. The real failed Task from the supplied evidence is opened, its target region is captured, and the screenshot is personally reviewed.                                                                                                                   |
| Hard constraints      | Project the canonical selected board status once at the shared application surface and conjunct it with existing child `data-status`; do not rewrite persisted child facts, introduce state, a timer, a fallback, a compatibility branch, a status machine, a gate, a synthetic message, a fixture, a query override, a local signal, an iframe, a new keyframe, or a second animation owner. Do not add, modify, update, delete, or run User Interface (UI) automated tests. Browser control uses the Browser skill through Node.js, never Bun. Preserve all unrelated dirty-worktree changes.                                                                                                                                                                                                                                                                     |
| Sources read          | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/12-overlay-card-system.md`; `2026-07-30-work-card-static-wave-scope.md`; `2026-07-29-running-execution-wave-scope-and-text-contrast.md`; `2026-07-29-agent-wave-and-trailing-tool-disclosure.md`; `2026-07-27-subagent-card-pulse-and-tool-status-removal.md`; `App.tsx`; `Conversation.tsx`; `ConversationArtifactSummary.tsx`; `SubagentProgressGrid.tsx`; `SubagentConversationPanel.tsx`; `ChatBubble.tsx`; `CardParts.tsx`; `subagent-presentation.ts`; `board.ts`; `messages.css`; and `conversation.css`.                                                                                                                                                                                                                                                          |
| Whole-repository grep | Searches covered every `wave`, shimmer, mask animation, keyframe, Tool `data-status`, Agent `data-status`, selected Task/session status reader, terminal classifier, main Conversation mount, compact Agent renderer, and exact-session Right Dock renderer. `messages.css` owns the sole Tool text wave across nested Tool cards, inline Tool rows, and main/Right-Dock execution disclosures. `conversation.css` owns the sole compact Agent surface wave. `App.tsx` is the common ancestor of the center transcript and Right Dock and already reads `boardStore`; task boards expose `board.task.status`, standalone conversation boards expose `board.status`, and `ConversationArtifactSummary.tsx` already treats only standalone `active` as executing. Compact Agent Tool events intentionally remain static under the prior whole-card activity contract. |
| Independent review    | Claude Code `2.1.147` was checked with `command`, version, and help from the repository root, then invoked with only `Read,Grep,Glob`, no session persistence, streaming output, and explicit prohibitions on edits, delegation, worktrees, and UI tests. It exited before reading the repository because the local command-line interface is not authenticated (`Not logged in`). No Claude finding is claimed; the primary agent owns both evidence reviews.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Git baseline          | Delivery branch is `work-v0.0.24beta-yr-0729`. Fetch showed local HEAD `341500c8ad` one commit ahead of `myhexin/work-v0.0.24beta-yr-0729`; that commit and dirty `Board.tsx`, `main.tsx`, and `07-panel.md` changes belong to concurrent work and must be preserved. This delivery owns only the parent execution projection, the two existing animation selectors/comments, current card-system architecture, this record, its visual artifact, and the two shared spec indexes.                                                                                                                                                                                                                                                                                                                                                                                  |

## Follow-up Recall: Double Wave Cadence

| Item                  | Evidence and requirement                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement      | Keep the corrected execution-state boundary, but make every Tool and compact Agent wave animation last twice as long and leave twice as much time between waves.                                                                                                                                                                                           |
| Acceptance criteria   | Both `tool-active-wave` and `agent-running-surface-wave` report a `6.8s` cycle instead of `3.4s`. Their shared 65% travel and 35% rest phases remain unchanged as proportions, so both the visible travel duration and the quiet interval become exactly twice their current wall-clock length. Non-running children and non-active parents remain static. |
| Whole-repository grep | Production has exactly two wave keyframes and two animation consumers. Both consume the single `--ui-duration-loop-tool-wave` token from `design-language.css`; no other motion token or animation consumes it. Therefore changing that canonical token from `3.4s` to `6.8s` is the complete implementation and preserves the single source.              |
| Call-site disposition | `design-language.css`: replace `3.4s` with `6.8s`. `messages.css` and `conversation.css`: preserve the two existing keyframes, 65%/35% phase split, easing, reduced-motion boundary, and parent/child status selectors. `App.tsx` and lifecycle stores remain unchanged.                                                                                   |
| Verification boundary | Do not add, modify, update, delete, or run UI automated tests. Re-run typecheck, localization, production build, docs health, owner grep, and whitespace checks. On a real current-source page, inspect an executing Tool/Agent if available and confirm the computed duration is `6.8s`; personally review a screenshot of the affected surface.          |

## Cause Chain

1. Tool rows and compact Agent cards truthfully expose their own canonical
   lifecycle through `data-status`.
2. The two animation selectors currently test only the child status
   `running`.
3. A failed or cancelled Task can retain a stale child Tool or Agent record
   whose last observed lifecycle is still `running`; the supplied screenshot
   proves that state combination.
4. CSS therefore continues the animation because it has no knowledge of the
   parent execution lifecycle. Rewriting child status would corrupt persisted
   evidence and would still duplicate lifecycle ownership.
5. The root correction is to project the selected board's raw canonical
   execution status once on the common application panel and require
   `active` parent status together with the existing child `running` status in
   both animation selectors.

## Complete Call-Site Disposition

| Owner or consumer                                                                                                                         | Decision                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/overlay/src/components/App.tsx`                                                                                                 | Project one `data-conversation-execution-status` value on the common `.panel` ancestor. Use the selected Task's `board.task.status` only when IDs match, or the standalone board's `board.status` only when Session IDs match; otherwise project no active status. |
| `packages/overlay/src/styles/surfaces/messages.css`                                                                                       | Conjunct the common parent `[data-conversation-execution-status="active"]` with every existing child Tool `[data-status="running"]` consumer. Preserve the single mask, duration, keyframe, child status, and reduced-motion boundary.                             |
| `packages/overlay/src/styles/surfaces/conversation.css`                                                                                   | Conjunct the same parent active status with the existing compact Agent `[data-status="running"]::before` consumer. Preserve the dedicated-card identity, paint-only wave, geometry, and reduced-motion boundary.                                                   |
| `packages/overlay/src/components/{Conversation,ConversationCard,ChatBubble,CardParts,SubagentProgressGrid,SubagentConversationPanel}.tsx` | Preserve canonical child status projection, main/Right-Dock rendering, compact Agent identity, and exact-session routing. No child fact is rewritten.                                                                                                              |
| `packages/overlay/src/store/board.ts` and backend status projection                                                                       | Preserve. They remain the canonical lifecycle sources; this UI correction does not add another classifier or persisted state.                                                                                                                                      |
| `packages/overlay/src/utils/subagent-presentation.ts`                                                                                     | Preserve compact activity projection. Internal compact Tool rows intentionally remain static because the compact Agent surface is their single activity affordance.                                                                                                |
| `specs/current/architecture/12-overlay-card-system.md`                                                                                    | State the two-factor parent-active plus child-running motion contract and terminal-parent dominance.                                                                                                                                                               |
| Existing Overlay UI tests and browser fixtures                                                                                            | Do not add, modify, update, delete, or run. UI acceptance uses type/build/static checks plus real-page interaction, computed styles, screenshots, and personal visual review.                                                                                      |

## Implementation And Verification Plan

1. Commit and push this Recall before product edits.
2. Add the common raw execution-status projection and conjunct both existing
   animation selectors with parent `active`.
3. Run Overlay typecheck, localization validation, production build,
   documentation-health checks, targeted static grep, and `git diff --check`;
   do not run UI tests.
4. Start or reuse a real current-source OpenCorvus page, open the exact failed
   Task from the supplied evidence, inspect the target Tool/Agent region,
   confirm computed animations are `none`, capture the region, and personally
   review it. Exercise a real active execution if available without
   manufacturing state; otherwise retain the unchanged child-running selector
   contract and report the evidence boundary honestly.
5. Re-grep all owners, perform a second exact-diff and screenshot review,
   update this record and both indexes, fetch/converge, selectively commit only
   task-owned paths/hunks, push through normal hooks to `myhexin`, and verify
   remote convergence.

## Progress

- [x] Supplied screenshot, architecture, history, render/status chains,
      animation owners, every production call site, Git baseline, and
      authentication-blocked Claude review inspected.
- [x] Recall, cause chain, complete call-site disposition, and verification
      plan recorded.
- [x] Recall commit `085a674192` and git-cc push complete.
- [x] Product and architecture correction plus static/build verification
      complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Follow-up doubled-wave cadence implementation and real-page review
      complete.
- [x] Implementation commit `0cc52f12e3`, final record update, and git-cc
      convergence complete.

## Visual Evidence

The current production build was served by an isolated source OpenCorvus
process on port `7884`; the process identity was verified before shutdown and
the port was released. No fixture, query override, local signal, synthetic
message, temporary frame, or manufactured lifecycle was used.

The supplied real Task `Phase 02: 重启反馈洞察完整交付` reproduced the exact
inconsistent facts behind the bug: the common parent projected `failed`, while
the compact `universal-build` Agent still projected its persisted child status
as `running`. After the correction, the Agent surface pseudo-element computed
to `animation-name: none` and `opacity: 0`. Every visible compact Tool label
and detail also computed to `animation-name: none`; completed Tool rows stayed
static through their own child status, and compact Tool rows retained their
intentional no-nested-wave contract. The companion real `Phase 01` Task
projected `cancelled` and exposed no running animated descendants.

[`2026-07-30-parent-execution-wave-static.png`](../../artifacts/2026-07-30-parent-execution-wave-static.png)
was captured from the current-source desktop page and personally reviewed at
original resolution. It shows the selected failed Task, unchanged Tool
disclosure hierarchy, and the stale-running `universal-build` card as a stable,
legible surface without the traveling band. No active Work Ledger item existed
in the real project, so no active lifecycle was manufactured merely to create a
second screenshot. The unchanged conjunctive CSS requires real parent `active`
and real child `running` before either existing keyframe can apply.

The follow-up cadence pass changed only the shared
`--ui-duration-loop-tool-wave` token from `3.4s` to `6.8s`. Production CSS
still contains exactly the same two consumers and keyframes with their 65%
travel and 35% rest phases, so the Tool and compact Agent waves now spend
twice as long moving and twice as long between movements. On the isolated
current-source page, the computed root token was `6.8s`, and both production
consumers resolved through that token. No real active execution existed in the
loaded project, so no lifecycle was manufactured to force a moving screenshot.
The real failed Task instead re-confirmed the boundary: its stale-running
`universal-build` Agent still computed `animation-name: none` and
`animation-duration: 0s`.

[`2026-07-30-parent-execution-wave-6-8s.png`](../../artifacts/2026-07-30-parent-execution-wave-6-8s.png)
was captured from that current-source page and personally reviewed at original
resolution. It preserves the Task hierarchy and legibility while failed-state
Tool rows remain visually static.

## Verification

| Check                                                    | Result                                                                                                                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overlay TypeScript typecheck                             | Passed                                                                                                                                                                 |
| Overlay localization validation                          | Passed                                                                                                                                                                 |
| Overlay production Vite build                            | Passed; only existing dependency directive and chunk-size warnings were emitted                                                                                        |
| Targeted formatting checks for Prettier-owned task paths | Passed                                                                                                                                                                 |
| Historical documentation link and document-health checks | Passed: 85 tests, 1,385 assertions                                                                                                                                     |
| `git diff --check`                                       | Passed                                                                                                                                                                 |
| Whole-owner grep                                         | Passed: the repository still has exactly one Tool text wave and one compact Agent surface wave; both consumers now require common parent `active` plus child `running` |
| Real failed-Task computed style                          | Passed: parent `failed`, stale child Agent `running`, pseudo-element `animation-name: none`, `opacity: 0`                                                              |
| Real cancelled-Task computed style                       | Passed: parent `cancelled`, no animated running Tool/Agent descendant                                                                                                  |
| Real-page screenshot and personal visual review          | Passed                                                                                                                                                                 |
| Shared wave cadence                                      | Passed: computed token `6.8s`; both Tool and compact Agent consumers resolve through it                                                                                |
| Follow-up real failed-Task boundary                      | Passed: stale-running Agent remains `animation-name: none` and `animation-duration: 0s`                                                                                |
| UI automated tests                                       | None added, modified, updated, deleted, or run                                                                                                                         |
