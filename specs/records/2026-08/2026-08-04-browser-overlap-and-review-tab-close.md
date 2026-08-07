# Browser overlap and Review tab close repair

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | The supplied desktop screenshot shows the Environment Information branch popup passing behind the live Browser page, and the Review tab close action does not close its tab. |
| Acceptance criteria | The branch popup remains completely visible and interactive above the unchanged native Browser WebView, preserves compact long-list scrolling and branch selection, and dismisses normally. Clicking the Review tab close action removes that exact tab and selects the preceding remaining tab while also closing the legacy diff-workspace presentation state. |
| Hard constraints | Preserve the native Tauri/WebView2 child as the only live Browser page. Reuse the shared parent-owned native styled menu surface; do not move, resize, hide, recreate, or replace the Browser with Hypertext Markup Language (HTML), an iframe, or a screenshot. Do not add or run user interface (UI) automated tests. Do not create a worktree, fallback, gate, duplicate data source, state machine, or literal stacking workaround. Use Node-driven real-page interaction and screenshots for UI acceptance. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/07-panel.md`; August 3 Browser/menu and branch-scroll records; August 4 Browser continuity and shared native-menu records; `TaskDirBar.tsx`; `RightDock.tsx`; `main.tsx`; `BrowserPreviewPanel.tsx`; native-menu surface service, contract, renderer, and styles; native-surface occlusion service. |
| Whole-repository grep | Searched production Overlay, native host, current architecture, August/July records, and focused test names for Browser WebView ownership, native occlusion, Environment Information, branch menus, Right Dock tabs, Review/diff close, and menu placement. The branch list is still a Kobalte portal in the main HTML WebView and therefore cannot cover the operating-system child Browser WebView. The Review close handler returns immediately after clearing `workspaceOpen`, leaving the `diff` tab in `centerWorkbenchPanels`. |
| Existing-test disposition | `right-panel-tabs-flat.test.ts` and `right-panel-tier2-labels.test.ts` are prohibited UI/source-string tests. `right-panel-defaults.test.ts` contains retained-source absence assertions prohibited by the negative-test rule. They were directly encountered in the touched Right Dock path and will be deleted without running. Positive VCS transport/store and native-surface service contracts remain untouched. |
| Independent agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and second review. |
| Git baseline | Branch `work-v0.0.29beta-yr-0803` was clean and synchronized with `myhexin/work-v0.0.29beta-yr-0803` at `0 0`; the normal pre-push hook passed before implementation. |

## Causal chain

1. The Environment Information panel and branch list are host HTML portals.
2. The Browser page is an operating-system child WebView, so host CSS stacking
   cannot place the branch list above it. The observed clipping is a native
   surface boundary, not an insufficient `z-index`.
3. The existing parent-owned native styled menu window already solves this
   boundary for Browser and Right Dock menus without disturbing the live page.
   It needs a reusable side placement and compact bounded-list presentation for
   the branch selector.
4. The Review tab is the `diff` entry in `centerWorkbenchPanels`. Its close
   branch clears only `workspaceOpen` and returns before the canonical tab
   removal function, so the rendered tab remains open by construction.

## Implementation and verification plan

1. Generalize the shared native menu surface with explicit bottom-end and
   right-start placement plus a compact-list presentation whose block size is
   supplied from the live Overlay viewport.
2. Replace the Environment branch Kobalte portal with that single native menu
   surface, preserving canonical branch loading, current selection, retry, and
   branch-switch actions.
3. Make Review close clear the legacy diff-workspace presentation and continue
   through the canonical exact-tab removal path.
4. Update current Browser/menu and Right Dock ownership architecture, remove the
   directly encountered prohibited tests, and keep positive non-UI contracts.
5. Run Overlay typecheck, localization, production build, documentation health,
   and `git diff --check`; do not run UI tests.
6. Launch or reuse the real desktop application, interact with the Environment
   branch popup above a live Browser page, close the Review tab, capture fresh
   screenshots, and personally review both outcomes twice.
7. Record evidence here, commit with the `dsw-33987` prefix, fetch/reconcile the
   tracked git-cc branch, and push through the normal hook.

## Progress

- [x] Recall, causal chain, and implementation plan recorded.
- [x] Product and architecture changes complete.
- [x] Overlay typecheck, localization check, and production build complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Commit and git-cc push complete.

## Acceptance evidence

- The isolated debug desktop application rendered a real native Browser child at
  `https://www.baidu.com/` while the Environment branch selector opened in the
  shared native menu window. The menu remained fully painted above the Browser
  surface and retained its own scrollbar.
- The real scratch repository supplied 21 branches. The compact menu measured
  `355px` client height against `602px` scroll height and reached `248px`
  scroll offset through direct wheel interaction, demonstrating bounded list
  scrolling rather than viewport overflow.
- The Review close control was exercised through the real rendered application.
  The open Review-tab count changed from one to zero, the Right Dock remained
  open, and its canonical empty tool chooser became visible.
- Fresh screenshots were personally inspected at
  `.scratch/browser-overlap-review-close/branch-menu-virtual-screen.png`,
  `.scratch/browser-overlap-review-close/branch-menu-scrolled-focused.png`, and
  `.scratch/browser-overlap-review-close/review-tab-closed-empty-dock.png`.
  The first two show the branch menu above the unchanged Baidu Browser child;
  the last shows Review absent after closure. No user interface automated test
  or screenshot assertion was created or run.
- During acceptance, unrelated edits triggered Vite hot-module reloads in the
  isolated application. Their timestamps explain two transient returns to the
  new-chat surface; a stable rerun after the reload confirmed the close result
  above. Those parallel working-tree edits are not part of this repair.
