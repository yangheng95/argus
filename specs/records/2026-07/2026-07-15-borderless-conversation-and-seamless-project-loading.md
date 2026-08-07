# Borderless Conversation and Seamless Project Loading

## Recall

### User requirements

- Remove the standalone background, border, and color treatment around Agent conversation turns.
- Remove the standalone background-color boxes from the delegated-context and execution-detail expand/collapse titles.
- Keep the Work Ledger populated while switching projects so the page does not flash an empty skeleton state.

### Acceptance criteria

- Top-level Agent turns render directly on the conversation canvas with no independent fill, outline, radius, or shadow; identity, narrative, actions, status, and disclosure behavior remain intact.
- `Delegated context` and typed execution summaries such as `Tools 1` stay visible and keyboard accessible, but their resting, hover, and focus presentation does not paint a separate background box.
- A Work Ledger refresh with existing rows keeps those rows mounted while the request is pending and atomically replaces them when the response arrives.
- The skeleton remains available only for the true initial load where there are no rows to preserve.
- Focused unit tests, real browser interaction, and personally inspected desktop screenshots verify the final state.

### Hard constraints

- Preserve `ChatBubble`, `CardParts`, `LedgerList`, and `WorkLedger` as the single existing owners; do not add a second renderer, shadow data source, timeout-based transition, compatibility path, or loading gate.
- This record explicitly supersedes the tinted outlined Agent surface requested and recorded earlier on 2026-07-15; the newest user direction is borderless.
- Use existing Solid, Button, and design-token primitives. Keep focus accessibility even though background fills are removed.
- Desktop scope only. Do not add tablet or mobile work.
- Do not restart, refresh, stop, or otherwise interfere with the user's running OpenCorvus/Overlay. Visual verification uses an isolated Node-started browser fixture.
- Preserve unrelated dirty-worktree changes and stage only this task's attributable hunks.
- Commit subjects start with `dsw-33987` and the delivery branch is pushed to the legacy remote.

### Sources read before implementation

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-15-agent-message-card-reference-surface.md`
- `specs/records/2026-07/2026-07-15-message-transcript-visual-language-repair.md`
- `specs/records/2026-07/2026-07-11-multi-agent-message-panel-redesign.md`
- `packages/overlay/src/components/ChatBubble.tsx`
- `packages/overlay/src/components/CardParts.tsx`
- `packages/overlay/src/components/LedgerList.tsx`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/services/workspace.ts`
- `packages/overlay/src/styles/surfaces/chat-bubble.css`
- `packages/overlay/src/styles/surfaces/messages.css`
- focused static and browser tests for conversation disclosures and Work Ledger loading
- user screenshots `codex-clipboard-ca588f8c-0af2-4ce0-87fa-07284b1979e2.png` and `codex-clipboard-57a21aa2-401e-41ae-a4ad-aa23a632ae02.png`

### Whole-repository search evidence

- `Conversation.tsx` routes top-level Agent/message turns to `ChatBubble`; `.chat-bubble-row[data-kind="agent"] .chat-bubble` in `chat-bubble.css` is the sole top-level Agent fill/border/padding owner.
- `CardParts.tsx` is the sole owner of both `delegated-context-toggle` and `work-details-toggle`. Their visual states are centralized in `messages.css`; no component change is required.
- `LedgerList` has one production caller, `WorkLedger`. It currently renders the skeleton whenever `loading` is true and renders rows only when loading is false, so retained rows are hidden during refresh.
- `WorkLedger.loadPage(false)` already preserves `rows()` until the authoritative response succeeds, aborts superseded requests, and replaces rows atomically. The data lifecycle is correct; only `LedgerList` discards the visible stale-while-refresh presentation.
- `selectWorkLedgerProject` uses the canonical `applyDirectory` lifecycle. That connection retarget temporarily produces `connecting`, which sets Work Ledger loading true and exposes the `LedgerList` replacement behavior.
- Existing tests that assert a tinted Agent surface and boxed disclosure states are the regression owners that must be updated. Initial empty loading accessibility remains owned by `ledger-loading-status` unit/browser coverage.

### Independent agent feedback

- No sub-agent was started because the user did not request delegation and the active collaboration policy forbids unrequested sub-agents. The main agent owns the required second review.

## Root cause

Two visual regressions and one loading projection conflict with the latest product direction. The Agent turn specialization paints a tinted bordered container even though the conversation canvas already supplies the containing surface. Both disclosure controls override the shared ghost button with collapsed and hover background fills, so their labels look like nested cards. Separately, `WorkLedger` correctly retains rows during refresh, but `LedgerList` hides them whenever `loading` is true and substitutes the skeleton; project switching therefore appears destructive even though the old dataset still exists in memory.

## Implementation plan

1. Replace the Agent turn specialization with a transparent, borderless, unpadded canvas-aligned surface while retaining its identity/content structure and interaction states.
2. Remove resting, collapsed, hover, and focus background fills from both canonical disclosure toggles while preserving text/icon feedback and focus-visible accessibility.
3. Make `LedgerList` render its skeleton only for `loading && items.length === 0`, keep existing items mounted while loading, and expose the refresh state through `aria-busy` without adding visible loading chrome.
4. Update focused static and browser assertions for transparent conversation/disclosure surfaces and stale-while-refresh row continuity; retain the initial-empty skeleton accessibility contract.
5. Run focused tests, Overlay typecheck/build/i18n, document health, real isolated browser interaction and screenshots, then perform a second diff review.

## Verification plan

```powershell
bun test packages/overlay/test/chat-bubble.test.ts packages/overlay/test/message-embed.test.ts packages/overlay/test/ledger-loading-status.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts packages/overlay/test/browser/ledger-loading-status-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Implementation and validation

- The top-level Agent specialization in `chat-bubble.css` now resolves to transparent fill, zero border, zero radius, zero padding, visible overflow, and no shadow. Identity, metadata, narrative, actions, child-agent ownership, and execution logic were not changed.
- Both canonical disclosure controls in `messages.css` retain the shared ghost `Button` primitive but no longer paint collapsed, hover, or focus backgrounds. Their glyph/text color still strengthens on hover/focus, and the primitive focus-visible outline remains available.
- `LedgerList` now distinguishes initial loading from refresh loading. It keeps existing rows mounted whenever `items.length > 0`, reserves `LedgerLoadingStatus` for `loading && items.length === 0`, and exposes in-place refresh through `aria-busy` on the stable list container.
- Focused unit regressions passed: 12 tests, 0 failures, 127 expectations.
- Real Node-browser regressions passed for the borderless Agent fixture, stale-while-refresh project list, initial-empty loading skeleton, complete ChatBubble disclosure interaction, and message/delegated-context chronology.
- Overlay TypeScript passed. Overlay i18n passed after concurrent Worktree locale edits settled. The production Vite build passed through the browser runner; its existing large-chunk advisory remains non-failing and unrelated.
- Product documentation single-source checks passed. The first document-health run found two workspace artifacts rather than product regressions: this new record was not yet tracked, another in-progress titlebar record was already linked but untracked, and the isolated Vite cache contained a generated Java source-map string that the historical scratch scanner interpreted as a root spec path. The exact generated map created by this fixture was removed; the unrelated titlebar record remains owned by its concurrent task.
- `git diff --check` passed.

## Visual review

- `.scratch/project-switch-stale-refresh.png`: reviewed in the real Solid fixture while `aria-busy=true`; `Project A task` remains visible, the list contains one real row, and no skeleton is present before the authoritative `Project B task` replacement.
- `.scratch/agent-card-separation-light.png`: reviewed after expanding the real work disclosure. Agent turns sit directly on the conversation canvas without outlined/tinted wrappers; identities, prose, execution rail, and pure-text summary remain visually ordered.
- `.scratch/agent-card-separation-dark.png`: reviewed after the same interaction. The borderless surface remains legible without introducing a dark hover slab or nested disclosure box.
- `.scratch/message-card-chronological-turns-browser/delegated-context-zh.png`: reviewed in Simplified Chinese. `调度上下文` renders as an unboxed disclosure row and retains its caret, label, and content relationship.
- `.scratch/message-card-chronological-turns-browser/timeline-top.png`: reviewed across user, assistant, orchestrator, architect, running, completed, delegated-context, and follow-up states; no Agent-sized background card remains.

## Second review

- The change replaces the prior tinted Agent-card direction directly; it does not retain a compatibility selector or a second surface family.
- Work Ledger still has one request/data owner. No stale cache, delayed timeout, duplicated project state, or fallback dataset was added; the existing retained `rows()` signal is simply no longer hidden during refresh.
- Initial loading accessibility is preserved by the existing single live-status skeleton. Refresh loading is announced by the stable list's `aria-busy` state without visually destroying its contents.
- All user-visible style values reuse existing tokens and the shared Button focus behavior. No raw colors, new dependencies, or handwritten interaction primitive were introduced.
- The user's running OpenCorvus/Overlay process was not restarted, refreshed, stopped, or used as the test target. All screenshots came from isolated Node-started fixtures, and their temporary process was terminated after review.
