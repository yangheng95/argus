# Sub-Agent Tab Border And Menu Count Refinement

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | In the supplied Right Dock screenshot, stop the child-Agent `work` tab boundary from being obscured and remove the number rendered after the horizontal-more icon. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-41c66b5d-bbb9-442d-bb5a-124cd0d4846c.png` was inspected at original resolution. It shows the `SubagentConversationPanel` selector row with two `work` tabs and a trailing `more-horizontal` trigger followed by `2`. |
| Acceptance criteria | Every child-Agent tab has a visible resting boundary instead of making unselected tabs look borderless; the selected tab retains its existing accent boundary; the fixed complete-Agent trigger shows only the horizontal-more icon; the menu still exposes every canonical Agent and selection continues through `props.onSessionSelect`; a real desktop page is opened and the affected row is captured and personally reviewed. |
| Hard constraints | Keep Kobalte Tabs and DropdownMenu plus the shared Button, Avatar, Icon, and StatusIndicator primitives. Preserve `conversationAgentRecordsForSource(boardStore.selectedSource)` as the sole collection, `props.sessionID` as the selected identity, and `props.onSessionSelect` as the sole selection writer. Do not add a fallback, compatibility path, gate, state machine, local selection signal, query override, fixture, screenshot baseline, or User Interface (UI) automated test. Do not add, modify, update, delete, or run existing UI automated tests. Preserve unrelated dirty workspace changes. Browser interaction must use Node.js rather than Bun. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/12-overlay-card-system.md`; `2026-07-27-subagent-conversation-tab-overflow.md`; `2026-07-28-right-dock-subagent-tab-standard-typography.md`; `SubagentConversationPanel.tsx`; `inspector.css`; shared `Tabs.tsx`; and `tabs.css`. |
| Whole-repository grep | `SubagentConversationPanel.tsx` is the sole production markup owner for `subagent-conversation-panel__agent-tab`, `subagent-conversation-panel__agent-tabs`, `subagent-conversation-panel__agent-menu-count`, and `data-ui="subagent-agent-menu-trigger"`. `inspector.css` is the sole feature-local style owner. `main.tsx` is the only production mount and retains selection ownership. Existing source/browser UI tests mention the selector but are prohibited from modification or execution in this task. |
| Independent review | Claude Code `2.1.147` was invoked from the repository root with only `Read,Grep,Glob`, no session persistence, streaming output, and explicit prohibitions on edits, UI tests, delegation, and worktrees. It exited before reading the repository because the local command-line interface is not authenticated (`Not logged in`). No Claude finding is claimed; the primary Agent owns the evidence-based repair and second review. |
| Git baseline | Branch `work-v0.0.24beta-yr-0729` and `myhexin/work-v0.0.24beta-yr-0729` were converged at `52ca2ead54`. Pre-existing Overlay and specification changes are unrelated and will be preserved and excluded from this task's selective commits. |

## Cause Chain

1. `SubagentConversationPanel` correctly projects every canonical child-Agent
   record into a Kobalte `Tab` inside one horizontally scrollable `TabList`.
2. `.subagent-conversation-panel__agent-tab.oc-tab` explicitly gives every tab
   a transparent border. Only `[data-selected]` replaces it with a visible
   accent-mixed border. The supplied screenshot therefore shows the selected
   first `work` tab outlined and the unselected second `work` tab borderless;
   no painted boundary is being covered by another element.
3. The fixed complete-Agent menu is correctly outside that scroll viewport,
   but its trigger separately renders
   `.subagent-conversation-panel__agent-menu-count` from `records().length`.
   The count is presentation-only; it is not selection, availability, or
   overflow state.
4. The root repair is therefore local to the sole selector owner: give every
   tab a token-based resting boundary, retain the stronger selected boundary,
   and delete the redundant count child and its dead style. The canonical
   overflow menu and selection flow remain unchanged.

## Codex Review Feedback

The initial draft attributed the screenshot to scroll-viewport clipping. A
second source-to-pixel review rejected that unsupported causal link: the first
selected tab boundary is fully painted in the supplied image, while the second
tab lacks a boundary exactly as the explicit `border: ... solid transparent`
rule requires. The plan is revised before product edits to repair the real
resting-border source rather than changing overflow behavior.

## Complete Call-Site Disposition

| Owner or consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/SubagentConversationPanel.tsx` | Delete only the count `<span>` from the complete-Agent trigger. Preserve the trigger, menu, canonical `records()` projection, tab reveal, and direct selection callbacks. |
| `packages/overlay/src/styles/surfaces/inspector.css` | Replace the transparent resting tab boundary with a token-based visible boundary, retain the existing selected accent boundary, remove the now-unused trigger gap, and delete the orphaned count rule. Preserve single-line horizontal overflow and hidden scrollbar chrome. |
| `packages/overlay/src/components/ui/Tabs.tsx` and `styles/primitives/tabs.css` | Keep unchanged; the shared Kobalte primitive and design tokens are correct and must not absorb a feature-specific Dock fix. |
| `packages/overlay/src/main.tsx` and `store/conversation-agents.ts` | Keep unchanged; they own the mount, selected session, and canonical Agent collection. |
| Existing Overlay UI tests and browser fixtures | Do not add, modify, update, delete, or run. UI acceptance uses static/build checks plus real-page interaction, screenshots, and personal visual review. |
| Current architecture and prior July records | Keep unchanged; exact-session ownership, canonical collection, menu selection, and overflow architecture do not change. This record owns only the visual refinement. |

## Implementation And Verification Plan

1. Commit and push this Recall before product edits.
2. Remove the presentation-only count child and its dead selector.
3. Correct the feature-local resting tab boundary without changing primitive,
   overflow, collection, selection, or transcript behavior.
4. Run Overlay typecheck, localization validation, production build,
   documentation-health checks, and `git diff --check`; do not run UI tests.
5. Use the existing real Vite and OpenCorvus processes where possible. Open
   the real affected Dock state, exercise the complete-Agent menu and keyboard
   focus path, capture the exact selector row, and personally inspect the
   result. Do not manufacture records or selection state.
6. Re-grep every owner, review the exact diff and screenshot a second time,
   update this record, selectively commit only task-owned paths/hunks, fetch,
   push to `myhexin`, and verify remote convergence.

## Progress

- [x] Screenshot, architecture, prior records, primitive, markup, styles, call
      sites, running local processes, and Git baseline inspected.
- [x] Authentication-blocked Claude Code review attempt recorded honestly.
- [x] Recall, cause chain, call-site disposition, and verification plan
      recorded.
- [x] Recall committed as `c933b9ed46` and pushed to git-cc before the product
      correction.
- [x] Product correction and static verification complete: Overlay typecheck,
      localization validation, the production Vite build, the 22-case
      historical-document link suite, the 63-case document-health suite, the
      8-case product-document single-source suite, `docs:check`, target-path
      `git diff --check`, and the final owner grep pass.
- [x] Real-page interaction, screenshot review, and second review complete.
- [x] Final record update, task-owned commit, and git-cc push prepared for the
      delivery commit below; the remote convergence result is reported in the
      user-facing handoff.

## Delivery Evidence

- The real project `test-E10` and task `修复公开开源项目缺陷` supplied three
  canonical Agent sessions through the existing OpenCorvus backend at
  `127.0.0.1:7878`: root
  `ses_0512d30cfffe717JgEECgJ2gaP` plus children
  `ses_0511ac11bffeFVN1NiHN7wXaub` and
  `ses_051164a68ffeq0vHS6VocCg3Gh`.
- The real Overlay was served by Node.js Vite at `127.0.0.1:5173`. The
  existing Settings surface selected the backend URL, and the visible child
  progress card opened the native Right Dock sub-Agent conversation. No
  fixture, query override, local signal, synthetic record, or temporary frame
  was used.
- All three `work` tabs show complete resting boundaries. The selected tab
  retains the stronger accent boundary. The complete-Agent trigger has empty
  visible text and renders only `more-horizontal`; its `aria-label` and title
  remain `All agents (3)` so assistive technology retains the useful count.
- Opening the trigger exposed all three real Agent menu items. `ArrowDown`
  moved focus to the first real menu item, proving the existing DropdownMenu
  keyboard path remained intact.
- The affected row was captured at
  [`../../artifacts/2026-07-30-subagent-tab-border-menu.png`](../../artifacts/2026-07-30-subagent-tab-border-menu.png)
  and personally reviewed twice. The requested boundary and count changes are
  visibly correct, with no layout or overflow regression in the row.
- No User Interface automated test was added, modified, updated, deleted, or
  run.
