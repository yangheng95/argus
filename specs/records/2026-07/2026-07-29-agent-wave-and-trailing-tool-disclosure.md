# Agent Wave Scope And Trailing Tool Disclosure

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | Keep the card-surface wave on Agent cards only. Every other card surface stays static, while only running Tool text uses the text wave. Move the Tool expand/collapse chevron behind the Tool icon, name, and detail instead of rendering it at the leading edge. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-f68c37ee-31d0-4e55-a220-99bfe58e1422.png` was inspected at original resolution. It shows one running `WORK` Agent surface containing static narrative and low-emphasis Tool rows. |
| Acceptance criteria | A canonical running Agent conversation card and compact child-Agent card keep one paint-only surface wave. Non-Agent card surfaces, terminal Agent cards, Agent narrative, and reduced-motion rendering stay static. A running Tool name/detail retains the existing text mask; pending and terminal Tools remain static. Every Tool execution disclosure renders its existing right/down state chevron after the Tool summary, including the non-Tool summary fallback, without changing click, keyboard, title, accessible name, expansion state, truncation, or row height. A real desktop page is opened, the Tool is expanded and collapsed, and task-scoped screenshots are personally reviewed. |
| Hard constraints | Reuse the shared `Button` and `Icon` primitives, the existing `ExecutionDisclosureRun`, `conversation-ui.ts` expansion authority, canonical `data-kind` and `data-status`, `tool-active-wave`, and `agent-running-surface-wave`. Do not add a renderer, state source, timer, fallback, compatibility path, gate, handwritten icon, responsive scope, User Interface (UI) automated test, fixture, or screenshot baseline. Do not add, modify, update, delete, or run existing UI automated tests. Browser control uses the Browser skill through Node.js, never Bun. Preserve every unrelated dirty-worktree change. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/12-overlay-card-system.md`; `2026-07-29-running-execution-wave-scope-and-text-contrast.md`; `2026-07-29-conversation-streaming-text-wave.md`; `2026-07-29-tool-disclosure-state-icons.md`; `2026-07-28-tool-disclosure-size-parity.md`; `CardParts.tsx`; `Card.tsx`; `ChatBubble.tsx`; `ConversationCard.tsx`; `SubagentProgressGrid.tsx`; `conversation-ui.ts`; `message-part.ts`; `messages.css`; `conversation.css`; and the introducing commits `8ec16b545c` and `f96ae15f9a`. |
| Whole-repository grep | Searches covered every wave/shimmer animation, keyframe, mask, `ExecutionDisclosureRun`, `work-details-toggle`, `msg-transcript-disclosure__marker`, `CardParts`, `collapseWorkDetails`, `executionDisclosureKey`, `conversationDisclosureExpanded`, and `setConversationDisclosureExpanded` production call site. `conversation.css` owns the sole card-surface wave and scopes it to running Agent conversation rows and compact child-Agent cards. `messages.css` owns the sole text wave and scopes it to running Tool labels/details. `CardParts.tsx` owns the sole execution disclosure renderer. `ChatBubble.tsx` has three collapsed-detail projections and `Card.tsx` has one recursive projection; all consume that same renderer. `conversation-ui.ts` remains the only expansion-state authority. |
| Independent review | Claude Code `2.1.147` was invoked from the repository root with only `Read,Grep,Glob`, no session persistence, streaming output, and explicit prohibitions on edits, UI tests, delegation, and worktrees. It exited before reading the repository because the local command-line interface is not authenticated (`Not logged in`). No Claude finding is claimed; the primary agent owns the evidence-based diagnosis and final second review. |
| Git baseline | Branch `work-v0.0.24beta-yr-0729` and `myhexin/work-v0.0.24beta-yr-0729` were converged at `fe5b84ca0c` after a normal pre-push hook passed. Concurrently authored changes in backend tests, Composer, Workspace, panel architecture, July records, and shared spec indexes are unrelated and must remain intact. |

## Cause Chain

1. `ExecutionDisclosureRun` renders one mature Button containing the disclosure
   marker, Tool identity icon, Tool name, and optional detail.
2. Commit `f96ae15f9a` restored the state marker for Tool summaries by placing it
   before the shared Tool summary. Expansion semantics are correct, but the
   child order makes the chevron the first visible item.
3. Moving only the existing marker after the existing summary corrects the
   information hierarchy without creating another control or state owner.
4. The trailing marker must not shrink when Tool detail is long. The existing
   marker geometry already defines its exact size, so the canonical transcript
   marker style must also make it a non-shrinking flex item.
5. Wave scope does not need a second implementation: the production grep proves
   the existing card animation is Agent-only and the existing text mask is
   running-Tool-only. The repair preserves those owners and verifies them
   through the real page.

## Complete Call-Site Disposition

| Owner or consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/CardParts.tsx` — `ExecutionDisclosureRun` | Move the existing marker after the shared Tool/fallback summary. Preserve the Button, icons, status attributes, label/detail projection, accessible name, title, click handler, and state write. |
| `packages/overlay/src/components/CardParts.tsx` — `ChronologicalCollapsedParts` | Preserve the sole execution-run dispatch to `ExecutionDisclosureRun`. |
| `packages/overlay/src/components/ChatBubble.tsx` — three `CardParts` projections | Preserve; main and exact-session Agent conversations inherit the shared order automatically. |
| `packages/overlay/src/components/Card.tsx` — one recursive `CardParts` projection | Preserve; structured cards inherit the shared order automatically. |
| `packages/overlay/src/store/conversation-ui.ts` | Preserve `conversationDisclosureExpanded` and `setConversationDisclosureExpanded` as the only presentation-state source. |
| `packages/overlay/src/utils/message-part.ts` | Preserve `executionDisclosureKey` and execution-run partitioning. |
| `packages/overlay/src/styles/surfaces/messages.css` — Tool text wave | Preserve the status-driven running Tool name/detail mask and its reduced-motion boundary. |
| `packages/overlay/src/styles/surfaces/messages.css` — transcript marker | Add the non-shrinking flex contract to the existing shared marker geometry so the trailing state icon remains visible after long summaries. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Preserve the sole running Agent card-surface wave; its two selectors already exclude User, Tool, artifact, and terminal card surfaces. |
| Shared Button and Icon primitives | Preserve. They already provide the mature control, focus, keyboard, and glyph semantics. |
| Existing Overlay UI tests and browser fixtures | Do not add, modify, update, delete, or run. UI acceptance uses type/build checks plus real-page interaction, screenshots, and personal visual review. |

## Implementation And Verification Plan

1. Commit and push this Recall before product edits.
2. Reorder the existing disclosure marker and make its canonical marker geometry
   non-shrinking. Do not change wave selectors or expansion state.
3. Run Overlay typecheck, localization validation, production build,
   documentation-health checks, and `git diff --check`; do not run UI tests.
4. Start or reuse a current-source real OpenCorvus desktop page through the
   Browser skill. Inspect a running Agent/Tool presentation, click the same Tool
   disclosure open and closed, capture the exact card region, and personally
   verify the trailing chevron and wave scope.
5. Re-grep all owners, inspect the exact diff and screenshots a second time,
   update this record and both spec indexes, fetch/converge, commit only
   task-owned paths and hunks, push to `myhexin`, and verify remote convergence.

## Progress

- [x] Supplied image, architecture, history, wave owners, disclosure renderer,
      state owner, all production call sites, and dirty Git baseline inspected.
- [x] Authentication-blocked Claude Code review attempt recorded honestly.
- [x] Recall, causal chain, complete call-site disposition, and verification
      plan recorded.
- [x] Recall commit and git-cc push complete.
- [x] Product implementation and static/build verification complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Final record/index update, commit, push, and remote convergence complete.

## Visual Evidence

- `specs/artifacts/2026-07-29-trailing-tool-disclosure-collapsed.png`
  shows the current-source production build served by an isolated real
  OpenCorvus backend at `http://127.0.0.1:7883/ui/`. The persisted Work
  conversation from the supplied screenshot was selected, and its visible Tool
  rows render their state chevrons after the icon, name, and detail.
- `specs/artifacts/2026-07-29-trailing-tool-disclosure-expanded.png`
  shows the same real `read` disclosure after a pointer click. The trailing
  right chevron changes to a trailing down chevron and the canonical event body
  opens below it without moving the control to the leading edge.
- Bounded runtime inspection of the fourteen real disclosures reported the
  exact child order `tool-icon`, `tool-name`, `tool-detail`, `marker`; the marker
  resolves to `flex: 0 0 auto`. The selected completed Agent and sampled
  non-Agent surface pseudo-elements both reported `animation-name: none`.
- The supplied image remains the real running-state evidence: the `WORK` Agent
  has the existing card-surface wave and its Tools carry the text treatment.
  No local signal, query override, temporary frame, synthetic message, or
  fabricated running state was introduced to manufacture another capture.

## Verification

- `bunx biome check packages/overlay/src/components/CardParts.tsx packages/overlay/src/styles/surfaces/messages.css`: passed.
- `bun run typecheck` in `packages/overlay`: passed.
- `bun run check:i18n` in `packages/overlay`: passed.
- `bun run build:vite` in `packages/overlay`: passed with existing dependency
  directive and chunk-size warnings only.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`:
  22 passed.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: the first
  run reached the checker and found one concurrently indexed but not yet tracked
  edge-to-edge Conversation record; after that independent record was committed,
  the unchanged command passed all 63 checks.
- `git diff --check` on both product files: passed.
- Real-page disclosure interaction passed in both collapsed and expanded
  states; the same control returned to `aria-expanded="false"` after the second
  click.
- A second source/diff review found exactly two animation owners
  (`agent-running-surface-wave` and `tool-active-wave`) and no over-broad card
  selector or duplicate disclosure renderer.
- Commit `6077721055` contains the implementation, both screenshots, completed
  record, and both index entries and was pushed normally to `myhexin`.
- No UI automated test was added, modified, updated, deleted, or run.
