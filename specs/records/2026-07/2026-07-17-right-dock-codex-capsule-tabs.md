# Right Dock Codex Capsule Tabs

## Recall

| Item | Detail |
| --- | --- |
| User requirement | “这个按钮太丑了，参考图二(codex)实现一版。” The current screenshot shows flat Right Dock labels with a black active underline; the supplied Codex reference shows each open tool as a light-gray rounded tab containing its icon, label, and visible close affordance, followed by a separate add action. |
| Acceptance criteria | Every open Right Dock tool uses one compact rounded light-gray container; leading icon, ellipsized label, and always-visible close action read as one tab; no active underline remains; selected state stays legible without producing a high-contrast filled button; the global add/overflow/Dock-close actions remain separate; Terminal still opens directly into xterm without a secondary title bar; a real built desktop fixture is inspected by screenshot. |
| Hard constraints | Keep the shared Kobalte Tabs and Button primitives, existing panel catalog, keyboard semantics, overflow measurement, and close/add behavior. Change the single Right Dock surface recipe instead of creating a second tab implementation. Do not reintroduce Terminal session chrome, a fallback, a preview override, an iframe, or mobile scope. Run Playwright only through the Node browser runner and do not refresh or restart the user's running Overlay. Preserve unrelated dirty Work Ledger, left-rail, shadow, scrollbar, token, test, and spec changes. |
| Sources read | `AGENTS.md`; browser-control skill; both user screenshots; `2026-07-17-right-dock-flat-tabs-and-terminal-single-title.md`; current `RightDock.tsx`; shared Tabs/Button primitives; `workspace.css`; `right-dock-panel-ownership.test.ts`; `terminal-reference-visual-browser.test.ts`; and current git status/diff. |
| Whole-repository grep | `RightDock.tsx` is the single DOM owner of `.right-dock-tab`, its icon/label/close action, the open/overflow collection, and global toolbar actions. `workspace.css` is the single Right Dock tab visual owner. The previous underline contract is asserted only by `right-dock-panel-ownership.test.ts` and `terminal-reference-visual-browser.test.ts`; other browser tests address tab behavior, titles, overflow, and close navigation and must remain compatible. `TerminalPanel.tsx` and `terminal.css` already contain no secondary title strip and require no production change. |
| Independent agent feedback | None. The user did not request sub-agents and the current collaboration boundary forbids proactive delegation. |
| Git baseline | Delivery branch is `work-v0.0.8beta-yr-0717`; task discovery started at `a7c38dccc`, matching `legacy-remote`. The shared worktree already contains unrelated edits, including a separate `workspace.css` shadow hunk, so commits must stage only task-owned files/hunks. |

## Root Cause

The visible mismatch is caused by an incorrect Right Dock surface recipe, not by the Tabs
primitive or panel state. The previous change explicitly forced a transparent background,
created a `::after` active underline, and hid `.right-dock-tab__close` until hover/focus.
Those three choices make the control read like a browser-page navigation label. The Codex
reference instead groups icon, title, and close affordance inside a persistent desktop tab
surface. Because `RightDock.tsx` already provides exactly that semantic structure, the
root fix is to replace the local surface recipe and its old tests, not to add DOM or a
parallel component.

## Call-Site Disposition

| Surface | Disposition |
| --- | --- |
| `RightDock.tsx` | Preserve canonical Tabs/Button DOM, labels, close behavior, add/overflow actions, ordering, and measurement. No production component change is expected. |
| `workspace.css` Right Dock tab block | Replace transparent/underline styling with the reference's rounded `--surface-hover` capsule, compact spacing, and always-visible close action. Preserve overflow hiding and toolbar geometry. |
| `right-dock-panel-ownership.test.ts` | Replace the obsolete transparent/underline assertions with the single capsule recipe, visible close action, and absent pseudo-indicator contract. |
| `terminal-reference-visual-browser.test.ts` | In the real built fixture, assert capsule background/radius/height, close placement/visibility, absent underline, direct xterm adjacency, PTY input, focus ownership, and write a task-scoped screenshot. |
| `TerminalPanel.tsx`, `terminal.css`, service and `/pty` | Keep unchanged; they remain the canonical single xterm lifecycle without secondary chrome. |
| Other Right Dock interaction tests | Keep unchanged; they validate behavior rather than the superseded visual recipe. Re-run the relevant suite to prove no interaction regression. |

## Implementation And Verification Plan

1. Commit and push this Recall before production edits.
2. Replace only the Right Dock tab CSS block and update the two obsolete contracts.
3. Run focused source tests, Overlay typecheck/i18n, production Vite build, and documentation health checks.
4. Start the existing isolated built fixture through the Node Playwright runner, inspect the generated Right Dock screenshot, and correct any visual mismatch before re-running.
5. Review the complete task-owned diff and repeat the whole-repository grep for stale underline/hidden-close assumptions.
6. Record evidence, selectively commit only task-owned hunks, and push the delivery branch to `legacy-remote` through all hooks.

## Progress

- [x] Read rules, reference images, previous record, implementation, tests, and git state.
- [x] Enumerate owners, callers, old contracts, and concurrent-work boundaries.
- [x] Recall commit/push (`17b81e916`).
- [x] Implement the capsule recipe and regression contracts.
- [x] Complete focused/build/browser/visual/document verification.
- [x] Second review, implementation commit/push (`107798ab7`), and result record.

## Implementation Result

- The existing `.right-dock-tab` Kobalte surface now uses the shared light
  `--surface-hover` material in both resting and selected states, an 8px tokenized
  radius, 32px primitive height, 184px reference-derived minimum width, 8px sibling
  spacing, and 12px leading inset. Selected state is expressed by text color rather
  than an underline.
- Each existing close Button is now always visible and vertically centered inside its
  tab. The icon, ellipsized title, and close action remain one semantic tab group;
  overflow, add, and Dock-close actions keep their original owners and behavior.
- The obsolete `::after` underline and hover/focus-only close-display rules were
  deleted instead of retained as an alternate path. `RightDock.tsx`, the shared Tabs
  primitive, the panel catalog, and all state/keyboard logic were unchanged.
- Terminal remains the direct xterm panel delivered by the prior single-title change;
  no secondary session title, toolbar, close button, or add button was reintroduced.

## Visual Review

The first real built-fixture screenshot proved the capsule grouping and visible close
actions but showed that a 136px short-title tab was too compact relative to the supplied
Codex reference. Scaling the reference's 48px captured control height back to the
canonical 32px primitive height yielded an approximately 184px desktop tab, so the
surface was corrected to that width and re-rendered.

A subsequent Browser-first fixture exposed a blank Browser title because that fixture
has no preview target; that screenshot was rejected as invalid visual evidence rather
than accepted. The final fixture uses the reference's own `Review` + `Terminal` pairing,
asserts both visible labels, and then opens the canonical project-scoped PTY. I inspected
`.scratch/right-dock-codex-capsule-tabs.png` at original resolution: both tabs are
184x32 light-gray rounded rectangles with an 8px gap, balanced leading icons and
always-visible close glyphs; the global plus/Dock close stay separate; there is no
underline, duplicate title row, clipped text, or accidental seam.

## Verification Result

| Evidence | Result |
| --- | --- |
| Focused source/architecture | Right Dock ownership, Terminal, Tabs primitive, startup chrome, architecture, and workspace continuity: 23 passed, 0 failed, 351 assertions. |
| Overlay contracts | `bun run --cwd packages/overlay typecheck` and `check:i18n`: passed. |
| Production build | Vite production build passed with 2,492 modules transformed; the existing large-chunk warning remains informational. |
| Task-scoped desktop visual/behavior | `node ... browser-runner.mjs ... terminal-reference-visual-browser.test.ts`: passed after visual correction; it verifies Review/Terminal labels, 184x32 geometry, 8px spacing/radius, light fill, visible close placement, absent Terminal secondary chrome, direct canvas geometry, PTY output/input, focus, and screenshot. |
| Existing Right Dock interaction E2E | The full `titlebar-toolbar-toggle-browser.test.ts` passed 2/2, covering add/close/selection/overflow behavior against the changed tab width. |
| Documentation | Product single-source, historical-link, and document-health suites passed 81/81 with 1,282 assertions. |
| Push hooks | Repository SDK/runtime checks, all-package typecheck, route inventory, generated docs, Overlay i18n, and secret scan passed before the legacy remote push. |
| Diff hygiene | Task files pass `git diff --check`; grep finds no production underline or hover-only close contract. The separate workspace-shadow hunk and all other concurrent edits remain outside `107798ab7`. |

## Second Review

- `RightDock.tsx` remains the only DOM/state owner; the solution changes one local CSS
  recipe and does not create a second tab implementation or modify shared Settings tabs.
- Both resting and selected tabs deliberately share the same quiet material, matching
  the reference while preserving selection through text color and canonical Kobalte
  semantics/focus. Hover cannot regress to the old underline because that pseudo-element
  no longer exists.
- Increasing the minimum width affects the existing overflow calculation through real
  measured shell widths; the existing browser interaction suite passed, so hidden tabs,
  overflow access, close, and selection still converge on the canonical collection.
- The real fixture reaches the built Overlay through visible user interactions, obtains
  project-scoped `/vcs` and PTY evidence, and uses Node Playwright. It does not use a
  production mock, iframe, local signal/query override, or the user's running Overlay.

## Delivery Result

- Plan commit `17b81e916` and implementation commit `107798ab7` both use the required
  `dsw-33987` prefix and are pushed to
  `legacy-remote/work-v0.0.8beta-yr-0717`.
- The implementation commit contains only the Right Dock tab hunk and its two regression
  tests. Concurrent Work Ledger, left-rail, shadow, scrollbar, token, browser-test, and
  historical-record changes were preserved and not staged or committed by this task.
