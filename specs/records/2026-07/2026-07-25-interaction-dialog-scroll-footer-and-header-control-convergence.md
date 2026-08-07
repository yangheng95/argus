# Interaction Dialog Scroll Footer And Header Control Convergence

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Diagnose and repair the Question popup that leaves a large blank lower region after scrolling, and make the adjacent Environment and Right Dock message-header controls use the same background, border, geometry, and interaction language. |
| Acceptance criteria | A long Question keeps one bounded content scroller while its semantic header and Answer/Skip actions remain fixed against the popup edges before and after scrolling; no blank region can appear below the actions; short Questions retain natural height; the Environment and Right Dock controls share one icon-action chrome recipe in rest, hover, focus, and expanded/pressed states; real desktop Vite/browser screenshots are generated and personally reviewed. |
| Hard constraints | Keep `Question -> InteractionDialogHost -> InteractionCard` as the single interaction renderer; keep Kobalte Dialog/Popover and the shared Button primitive; do not add a second popup, fallback, state gate, temporary iframe, local signal override, or alternate interaction source. Desktop-only scope. Run Playwright through Node, use an isolated Vite/browser fixture, preserve unrelated dirty worktree changes, do not restart or touch the user's running OpenCorvus/Overlay process, use `dsw-33987` commit subjects, and push the accepted current branch to `legacy-remote`. |
| Supplied evidence | The 853 x 659 screenshot shows the Question shell still occupying almost the full 640px ceiling after scrolling while Answer/Skip and their divider stop around the middle, leaving a large white region below. The 290 x 53 crop shows the adjacent Environment sliders button as transparent/unframed while the Right Dock button has a circular surface and border. |
| Sources read | `AGENTS.md`; Browser skill; `2026-07-15-task-attention-interaction-dialog.md`; `2026-07-21-interaction-dialog-adaptive-height-and-disabled-hover.md`; `2026-07-16-header-toggle-agent-rail-visual-alignment.md`; `2026-07-17-overlay-primitive-system-convergence.md`; `InteractionDialogHost.tsx`; `InteractionCard.tsx`; `Dialog.tsx`; `TaskDirBar.tsx`; `ChatHeaderRightDockToggle.tsx`; `App.tsx`; `card.css`; `conversation.css`; focused source and Node browser tests; current generated long-dialog screenshots. |
| Whole-repository search | `rg` enumerated every `InteractionDialogHost`, `interaction-dialog-form`, `interaction-card__content`, `project-runtime-status-dropdown`, `chat-header-toolbar-toggle`, and `data-toolbar-compact` occurrence across production, tests, and specs. The interaction popup has one host and one shared renderer. `card.css` owns the dialog-specific nested flex layout. The Environment trigger is the only production `data-toolbar-compact` owner; the adjacent Right Dock control is the only current `chat-header-toolbar-toggle` owner. Existing tests explicitly freeze the two conflicting header recipes and do not assert bottom-edge footer attachment after a constrained-layout disturbance. |
| Independent agent feedback | None. The user did not request sub-agents; the coupled Overlay surface and visual acceptance remain with the primary agent. |
| Git baseline | `ff03be1bce17b2a647f4cbb7bda57fed03d70512` on `v0.0.18beta`, equal to `legacy-remote/v0.0.18beta` before implementation. The worktree contains unrelated concurrent edits which must remain unstaged and untouched. |

## Causal chain

1. Observable: after the operator scrolls a long Question, the outer popup keeps its maximum height but the action divider and buttons can stop in the middle, exposing a large blank region below.
2. Direct trigger: the outer form and inner card split vertical responsibility across two nested flex containers. The form owns the 640px ceiling, while `.interaction-card { flex: 0 1 auto; }` explicitly has no growth responsibility. If WebKit recomputes the inner card below the constrained form height during a scroll/layout update, no child is allowed to reclaim the released space.
3. Deeper cause: the 2026-07-21 adaptive-height repair correctly removed unconditional growth to fix short-dialog blank space, but retained nested flex sizing as the long-dialog footer attachment mechanism. Its browser fixture proves a continuously overflowing Chromium case; it does not disturb the constrained inner used size or prove that the footer remains attached to the outer bottom afterward.
4. Header mismatch: the Environment trigger and Right Dock trigger are adjacent shared Button icon actions, but `conversation.css` assigns the former a feature-local 28px transparent recipe and the latter a shared 30px surfaced recipe. The visual mismatch is therefore a duplicated chrome source, not an icon problem.
5. Root repair: replace the dialog's nested flex sizing dependency with an intrinsic CSS grid whose bounded content track is the sole shrink/scroll owner and whose action track is always the final row; project both header controls through the existing `chat-header-toolbar-toggle` recipe and delete the feature-local compact chrome rules.

## Complete call-site disposition

| Call site / owner | Disposition |
| --- | --- |
| `InteractionDialogHost.tsx` | Retain as the sole Dialog owner and sole dialog-surface mount of `InteractionCard`. |
| `InteractionCard.tsx` | Retain the shared content/actions DOM and all reply state; no alternate renderer or JavaScript height state. |
| `card.css` interaction dialog rules | Replace nested flex sizing with intrinsic grid tracks; retain natural short height, the scaled maximum, one content scroller, and fixed header/actions. |
| `interaction-dialog-host.test.ts` | Replace the flex-specific source assertion with the grid ownership and bottom-row contract. |
| `interaction-card-textarea-browser.test.ts` | Add a constrained-layout disturbance followed by scroll-to-bottom and assert/screenshot that actions remain attached to the form bottom with no blank region. |
| `TaskDirBar.tsx` Environment trigger | Change only its chrome role to the existing shared message-header toolbar role; preserve Popover behavior, identity, and state attributes. |
| `ChatHeaderRightDockToggle.tsx` | Retain unchanged as the canonical message-header toolbar chrome reference. |
| `conversation.css` | Delete the Environment-only compact visual recipe; let both controls consume the one existing message-header toolbar recipe. |
| `task-cwd-row-layout.test.ts` and architecture guards | Replace expectations that freeze transparent feature-local chrome with single-recipe assertions. |
| `titlebar-toolbar-toggle-browser.test.ts` | Assert equal rendered size, rest background, border, and radius for the adjacent Environment and Right Dock controls; capture the shared header surface. |
| Historical specs | Retain as historical evidence. This record supersedes only the nested-flex footer attachment and the earlier request for a visually distinct transparent Environment rest state. |

## Implementation plan

1. Add failing source/rendered regressions for the footer-to-shell bottom invariant and shared toolbar chrome.
2. Convert the dialog-specific card layout to intrinsic grid rows without changing interaction data, selection, or reply ownership.
3. Route the Environment trigger through `chat-header-toolbar-toggle` and remove the duplicate compact visual rules.
4. Run focused source tests, Overlay typecheck/i18n/build, and the Node-launched interaction/header browser fixtures.
5. Inspect fresh desktop screenshots at original resolution, iterate if any blank space or chrome drift remains, then run documentation health and a second call-site/diff review.
6. Stage only task-owned files, commit with the required prefix, fetch/reconcile the legacy remote branch without disturbing parallel changes, push to `legacy-remote`, and verify remote equality.

## Verification ledger

| Verification | Result |
| --- | --- |
| Focused source contracts | `bun test packages/overlay/test/interaction-dialog-host.test.ts packages/overlay/test/task-cwd-row-layout.test.ts`: 18 passed. |
| Architecture ownership guard | `bun test packages/overlay/test/overlay-architecture-guards.test.ts -t "project runtime controls are owned"`: 1 passed. The full architecture-guard file is not claimed because concurrent work currently leaves unrelated removed-card and duplicate-selector assertions in flight. |
| Interaction popup browser acceptance | Node-launched headed Vite fixture passed. It covers desktop and minimum-window 640px-bounded scrolling, keyboard traversal, scroll-to-bottom, an explicit constrained inner reflow, and a restored short-content intrinsic-height state. Every state asserts that the action row ends within one rendered pixel of the form bottom. |
| Message-header browser acceptance | Node-launched headed Vite fixture passed both tests. The Environment and Right Dock triggers render the same 30px geometry, rest background, border, radius, and shadow, and remain ordered after `Open in`. |
| Visual review | Personally inspected `long-content-minimum-window-bottom.png`, `constrained-reflow-footer-attached.png`, `short-content-intrinsic-height.png`, and `codex-message-header-toolbar-closed.png` at original resolution. The actions remain attached to the popup bottom; short content does not occupy the 640px ceiling; the adjacent header icon controls now share one visual language. |
| Overlay checks | `bun run typecheck`, `bun run check:i18n`, and `bun run build:vite` passed. The Vite build transformed 7040 modules and completed successfully; only existing third-party directive and chunk-size warnings were emitted. |
| Documentation checks | `historical-docs-links.test.ts` and `document-health.test.ts` passed together: 83 passed. Because the shared worktree's monthly index also contains a concurrent untracked research record, the final run used an isolated validation index copied from the real task-only staging snapshot and marked only that already-present concurrent record as intent-to-add; the real index remained task-only. |
| Scope/diff hygiene | `git diff --check` passed. `rg` reconfirmed one production interaction dialog host, one Environment trigger, no production `data-toolbar-compact`, and one shared `chat-header-toolbar-toggle` style recipe. Unrelated dirty files and concurrent commits remain untouched. |
