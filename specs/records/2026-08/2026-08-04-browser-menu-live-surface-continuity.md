# Browser menu native-layer continuity repair

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | The supplied desktop screenshots show that opening the Browser ellipsis menu removes the rendered page. Selecting `选择一个元素` does not restore the Browser layer, and clicking the blank page exposes `Browser preview native operation and surface release failed` together with `Browser preview native lease was detached before its queued command started.` After the first real-page review, the user clarified that the Browser component must not move down; the dropdown itself must occupy the higher layer. |
| Acceptance criteria | Opening the ellipsis menu keeps the real Browser page visible at exactly the same position and size. The complete dropdown remains readable and interactive above the operating-system child WebView. Choosing element selection dismisses the menu, arms the existing in-guest picker on the same live tab, and lets a page click produce the native selection highlight/comment surface without a lease-detachment or surface-release error. Clicking outside dismisses the menu and leaves the unchanged full page visible without an error. |
| Hard constraints | Preserve the native Tauri/WebView2 child as the only live URL, title, history, page, and selection source. Use Tauri's mature native menu primitive for the higher operating-system popup layer and retain the existing guest picker. Do not move, resize, hide, close, recreate, or retarget the Browser WebView for menu presentation. Do not add an iframe, screenshot substitute, second renderer, compatibility path, fallback, gate, hard-coded menu dimensions, state machine, worktree, or UI automated test. UI acceptance uses a real desktop page, Node-driven Browser/Playwright interaction, screenshots, and personal visual review. |
| Sources read | Root `AGENTS.md`; Browser control skill; both supplied screenshots; `specs/current/architecture/07-panel.md`; `2026-08-03-browser-chrome-control-and-menu-occlusion.md`; `2026-07-29-browser-tab-task-preview-separation.md`; `2026-07-29-right-dock-codex-parity-and-browser-tab-instances.md`; `BrowserPreviewPanel.tsx`; shared DropdownMenu primitive and menu styles; Browser native transport; native-surface occlusion service; Tauri Browser WebView lifecycle; official Tauri JavaScript `Menu.popup` and Rust `ContextMenu::popup_at` documentation; installed Tauri 2.11.1 menu plugin source. |
| Whole-repository grep | Searched production code, current architecture, August/July records, native contracts, and directly related tests for the two reported errors, Browser menu/selection labels, native lease commands, occlusion ownership, WebView bounds/show/hide/close, menu layering, and selection callbacks. The reported disappearance is caused by the August 3 menu owner calling global occlusion, whose Browser hook detaches the current lease and hides the WebView before Kobalte opens. Selection can then be queued without a current lease while dismissal begins a replacement lease. Host CSS cannot cover the child WebView, while Tauri already exposes a native popup layer. No UI test is to be run. |
| Independent agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and second review. |
| Git baseline | `work-v0.0.29beta-yr-0803` was clean at `a84962d89d`, synchronized with `legacy-remote/work-v0.0.29beta-yr-0803` (`0 0` divergence), and already pushed through the normal hook before this plan was created. |

## Causal chain

1. The Browser page is an operating-system child WebView that z-orders above
   host Hypertext Markup Language (HTML), while the former ellipsis content was
   a host Kobalte menu.
2. The August 3 repair made that menu acquire global native-surface occlusion.
   The Browser hook implements occlusion by detaching its lease and closing the
   child surface. The blank page is therefore current intended behavior, not a
   Baidu rendering failure.
3. The selection checkbox can toggle while no active Browser lease exists.
   Dismissal then starts a replacement lease while old selection/current-page
   commands settle, exposing the detached-lease and cleanup aggregation errors.
4. CSS stacking cannot place host HTML above an operating-system child WebView.
   The first implementation attempt kept the lease alive by excluding the menu
   strip from the WebView bounds, but that moved and reduced the Browser page
   and was explicitly rejected by the user.
5. Tauri's native menu is a real operating-system popup positioned relative to
   the owning window. It occupies the layer above the child WebView, dismisses
   through platform menu behavior, and invokes explicit item actions without
   mutating the Browser surface or its lease.

## Implementation and verification plan

1. Remove only the Browser-menu occlusion owner. Keep the panel registered with
   global native-surface occlusion for Settings/dialog surfaces that genuinely
   cover the whole page.
2. Replace the host Kobalte dropdown with Tauri's native `Menu`, anchored at the
   ellipsis button's logical window coordinates. Preserve the current zoom
   display, zoom out/reset/in actions, separator, and checked element-selection
   action as native menu items.
3. Let the platform popup own outside-click dismissal. Menu creation and
   dismissal never call Browser surface sync, close, hide, resize, or lease
   transition; item callbacks directly update the existing zoom or selection
   owners.
4. Remove obsolete Kobalte menu styles, declare the official Tauri JavaScript
   application programming interface (API) dependency, and update current
   Browser architecture. Global dialogs continue to own full-surface occlusion.
5. Run focused positive non-UI checks, Overlay typecheck/build, localization and
   documentation health, plus `git diff --check`. Do not add, modify, or run UI
   automation.
6. Launch a real desktop page. Inspect and screenshot the operating-system menu
   above the unmoved page, real outside-click dismissal, element-picker
   activation, selection highlight/comment surface, and absence of visible
   lease or cleanup errors. Repeat visual review after the first pass.
7. Record evidence here, commit with the `dsw-33987` prefix, fetch/reconcile the
   tracked legacy remote branch, and push through the normal hook.

## Real-page evidence

- The isolated desktop app loaded `https://www.baidu.com/` in the real child
  WebView. Before, during, and after menu presentation, the Browser surface was
  unchanged at logical `(1286.29, 119.14)`, `360.00 × 862.00`.
- `native-menu-page-unmoved-front-dpi.png` shows the operating-system menu above
  the still-visible, unmoved Baidu page. It contains the current `100%` zoom,
  zoom out/reset/in actions, and `Select an element`.
- A real operating-system pointer click outside the menu dismissed it. The
  Browser surface retained the same bounds, selection remained inactive, and
  the visible error list was empty.
- A real operating-system pointer click on `Select an element` dismissed the
  menu and armed the existing guest runtime on the same unchanged surface.
  Clicking Baidu's `新闻` node produced the guest outline/comment panel;
  `native-menu-selection-comment-front-dpi.png` was personally reviewed and the
  visible error list remained empty.

## Progress

- [x] Recall, causal chain, and implementation plan recorded.
- [x] Product and architecture changes complete.
- [x] Non-UI/static verification complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Commit and legacy remote push complete.

## Static verification

- `bun run typecheck` in `packages/overlay`: passed.
- `bun run check:i18n` in `packages/overlay`: passed.
- `bun run build:vite` in `packages/overlay`: passed with 7,073 modules
  transformed.
- Historical-link and product-document single-source tests: passed.
- Document-health test: 60 passed, 0 failed after the new record was staged.
- `bun run docs:check`: passed with 311 operations and 24 groups.
- `git diff --check`: passed.

## Delivery

- Implementation commit `1ad8666366` was pushed to legacy remote branch
  `work-v0.0.29beta-yr-0803` through the normal pre-push hook.
