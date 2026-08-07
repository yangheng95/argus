# Codex Agent Rail Gutter Density

## Recall

| Item | Detail |
| --- | --- |
| User requirement | “这个地方调整下，参考 codex。” The red box identifies the empty-looking vertical region between the Work Ledger and the Mission conversation in the supplied OpenCorvus screenshot. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-a19b7b33-fbbd-407c-bf87-6fbd3f1b1e7f.png` and `C:/Users/10132/AppData/Local/Temp/codex-clipboard-72a0a491-7973-43d4-8909-ddb16821efca.png`, both inspected at original resolution. The OpenCorvus crop shows a broad transparent activity gutter after the one-pixel Dock separator; the Codex crop keeps its navigation edge visually narrow and lets the rounded content surface begin immediately beside the Sidebar. |
| Acceptance criteria | A populated desktop conversation uses a compact 24 CSS-pixel Agent Rail gutter instead of the current 46-pixel slot. Resting ticks are quiet 8-pixel marks; pointer/focus proximity still expands the active and two neighboring ticks through a clearly visible 8/12/16/20-pixel ladder. The rail remains centered, scrollable, clickable, and transparent; its Kobalte tooltip still opens to the right and stays within the viewport. The workspace begins directly after the existing one-pixel resize separator; message cards and composer never overlap the rail; empty conversations still render no rail. Focused tests, a Node-launched real-browser fixture, task-scoped screenshots, manual visual review, Overlay checks, document health, second review, commit, and git-cc push must pass. |
| Hard constraints | Desktop-only. Preserve `ConversationAgentRail`, the canonical `Button`/Kobalte `Tooltip`, `conversationAgentStore`, click-to-locate, pointer/focus proximity, `#chatScroll`, `--ui-sidebar-width`, `#leftPaneResizer`, and the single workspace/message inset calculation. Do not add a second rail, hidden hit-target overlay, feature gate, fallback, compatibility selector, temporary iframe, mobile/tablet scope, worktree, or interference with the user's running OpenCorvus/Overlay. Playwright runs with Node. Preserve unrelated in-progress Button primitive and Work Ledger edits in the shared worktree. |
| Sources read | Root `AGENTS.md`; Browser skill; `specs/current/architecture/07-panel.md` and `99-principles.md`; the July 8 Agent Rail geometry record; July 14 centering record; July 16 Codex visual-alignment record; July 17 first-activity/cursor-expansion record; July 19 message/composer/scrollbar alignment and tooltip records; supplied screenshots; current `App.tsx`, `ConversationAgentRail.tsx`, `conversation.css`, rail source/browser tests, workspace geometry tests, and current Git blame/history. |
| Whole-repository grep | `App.tsx` owns the only production `ConversationAgentRail` mount immediately inside `#workspaceMain`; `ConversationAgentRail.tsx` owns records, proximity, focus, tooltip, and locate behavior but no width value; `conversation.css` is the only production owner of `--conversation-agent-rail-width`, the tick ladder, transparent host, and message-start clearance. Exact 46/16/22/27/32 contracts are asserted only by `conversation-agent-rail.test.ts`, `overlay-architecture-guards.test.ts`, and the real `conversation-agent-rail-scroll-browser.test.ts` geometry range/hover ladder. Other rail test and document occurrences consume behavior, identity, streaming, i18n, pressure, tooltip, or historical evidence and keep their current contracts. `pane.ts`, `workspace.css`, and titlebar/pane browser tests prove the separate one-pixel Dock resizer and workspace boundary already coincide and require no change. |
| Independent-agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | Work began on branch `work-v0.0.10beta-yr-0719` with local and `myhexin` synchronized at `f22232881`. Concurrent Button primitive and Work Ledger work remained untouched; those commits and the subsequent `v0.0.10beta` merge advanced both local and remote together to `1ac9f2118` before this task's final staging. |

## Causal chain

1. **Observable:** the highlighted gap looks like a second empty panel between the left Dock and Mission content.
2. **Direct trigger:** `#leftPaneResizer` is only one pixel wide; the visible bulk comes from `.conversation-agent-rail-host`, which overlays the workspace edge at a fixed 46-pixel width. The message-start clearance consumes the same width, making that transparent host read as reserved whitespace.
3. **Deep cause:** the 46-pixel slot was retained when the rail moved from a symmetric message-grid column to a workspace-edge overlay. That historical width was no longer tied to the current compact visual target, and a later cursor-expansion repair restored 16/22/27/32-pixel markers inside it.
4. **Why prior paths did not root-fix it:** July 16 changed only marker widths while explicitly preserving the 46-pixel slot; July 17 correctly restored meaningful proximity expansion after the compressed 8/8/9/10 ladder made hover feedback disappear. Neither reconsidered the now-overlay-owned gutter itself. July 19 moved the scroll owner to the full panel but kept 46 pixels as message-start clearance.
5. **Root repair:** keep the same overlay, interaction, tooltip, and clearance owners, but make their single width contract compact. A 24-pixel host matches the existing compact control rhythm, while an 8/12/16/20 ladder preserves strong cursor-following expansion without overflowing that host.

## Call-site disposition

| Call site | Decision |
| --- | --- |
| `packages/overlay/src/components/App.tsx` | Keep the only rail mount, Dock resizer order, and workspace DOM unchanged. |
| `packages/overlay/src/components/ConversationAgentRail.tsx` | Keep record projection, `data-proximity`, Button hit targets, focus, right-opening Tooltip, and locate behavior unchanged. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Change the canonical workspace rail width from 46 to 24 pixels, change the single tick ladder from 16/22/27/32 to 8/12/16/20 pixels, and reduce the rail's inline padding to one pixel so the 20-pixel active line fits after the canonical Button's transparent borders. Keep host positioning, transparency, vertical centering, overflow, and message-start formula unchanged. |
| `packages/overlay/test/conversation-agent-rail.test.ts` | Update the exact single-source geometry assertions and keep all ownership/interaction guards. |
| `packages/overlay/test/overlay-architecture-guards.test.ts` | Update the canonical host-width architecture assertion; do not relax the overlay/message-clearance guards. |
| `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts` | Replace the broad 34–54-pixel host range and old hover ladder with exact scaled 24-pixel host and 8/12/16/20 proximity assertions. Keep large/narrow message/composer/scrollbar and click/focus/overflow coverage, and capture compact-rest/hover screenshots. |
| Other Agent Rail source/browser tests | Keep unchanged: they own records, streaming, tooltip content/placement, global pressure, i18n, and first-activity behavior rather than gutter density. |
| `pane.ts`, `workspace.css`, Sidebar/pane tests | Keep unchanged: they already prove the workspace begins immediately after the canonical one-pixel resize separator. |
| `specs/README.md`, July index, document-health tests | Index this task record and run the required health checks without altering unrelated records. |

## Implementation and verification plan

1. Update focused source/browser expectations first so the current 46-pixel gutter and old ladder fail the new contract.
2. Change only the canonical width/marker/padding values in `conversation.css`; retain every DOM, state, data, tooltip, scroll, and resize owner.
3. Run focused rail/pane/workspace tests, Overlay typecheck/i18n/build, historical links, document health, and `git diff --check`.
4. Launch the real Overlay fixture through Node, inspect desktop rest/hover screenshots at original resolution, and iterate until the divider-to-content rhythm matches the Codex reference without collision or clipping.
5. Re-read the diff and screenshots, fetch/merge newer git-cc work if present, selectively commit only this task's files/hunks with the `dsw-33987` prefix, push the current branch to `myhexin`, and verify remote convergence.

## Progress

- [x] Supplied screenshots, current architecture, historical geometry decisions, Git history, and whole-repository call sites audited.
- [x] Focused regressions and production geometry updated. The first real-browser hover run exposed an 18-pixel rendered active line because the canonical Button contributes two transparent border pixels; reducing only the rail's inline padding from two to one pixel retained that primitive and produced the intended 20-pixel line.
- [x] Source/type/build/document checks pass: 144 focused rail/pane/workspace tests, 137 post-correction rail/architecture tests, 20 tooltip/mount tests, Overlay TypeScript and i18n checks, Vite production build through the Node browser runner, 21 historical-link tests, and 61 document-health tests.
- [x] Real desktop screenshots inspected and corrected. The Node-launched Playwright fixture passed both the full scroll/geometry scenario and the bounded tooltip-context scenario; original-resolution review covered compact resting ticks, cursor-following expansion, single activity, and the narrow 1120×760 composer/card layout. The in-app Browser could not leave its native connection-error data page because of its URL policy, so it was not counted as acceptance evidence; task-scoped Node/Playwright rendering and direct original-resolution screenshot inspection are the visual evidence.
- [x] Second review and selective staging complete; delivery commit and git-cc convergence are reported in the final handoff after verification.

## Verification evidence

| Surface | Evidence |
| --- | --- |
| Source geometry | `bun test packages/overlay/test/conversation-agent-rail.test.ts packages/overlay/test/overlay-architecture-guards.test.ts packages/overlay/test/pane-resizer-css.test.ts packages/overlay/test/overlay-left-rail-density.test.ts packages/overlay/test/workspace-surface-continuity.test.ts` — 144 passed. After the border/padding correction, the two direct rail suites were rerun — 137 passed. |
| Browser geometry and visual state | `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts` — passed after the intentional first-run failure exposed the Button-border geometry. `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-hover-context-browser.test.ts` — passed. The runner also completed the Vite production build. |
| Task screenshots | `.scratch/conversation-agent-rail-scroll-browser/left-rail.png`, `cursor-following-expanded-lines.png`, `single-activity-left-rail.png`, and `fixed-composer-near-bottom-1120x760.png`, each inspected at original resolution. The 24-pixel host no longer reads as a second panel; resting and active marks remain centered; tooltip, message card, and composer do not collide with the rail. |
| Supporting checks | `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/overlay check:i18n`, tooltip/mount focused tests, historical-doc links, and document-health all passed. |

## Second review

The final source diff preserves one production width owner, one tick-ladder owner, and the existing message-clearance formula. It changes no DOM, store, lifecycle, resize, scroll, or tooltip ownership; introduces no gate, fallback, compatibility selector, hidden hit target, alternate source, or responsive scope. The browser assertions use the runtime `--ui-scale` value for the 24-pixel host and exact rendered tick widths, so a future regression cannot restore the broad blank gutter while leaving unit-string tests green. The supplied reference, wide screenshot, narrow screenshot, and single-activity screenshot agree on the intended compact divider-to-content rhythm.
