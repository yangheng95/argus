# Shared native styled menu surface

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | The user supplied a screenshot of the Right Dock `+` menu and asked for that button to use the same higher layer as the Browser ellipsis menu, without moving the Browser component. The six-item menu must follow the screenshot's rounded white card, icon, spacing, and shadow treatment. The Browser ellipsis menu must receive the same visual treatment. |
| Acceptance criteria | Opening `+` leaves the live Browser page at the same position and size while a styled menu appears above it with Browser, Review, Files, Screenshots, Requirements, and Goals. Opening Browser `...` uses the same surface and design language for zoom and element selection. Either menu dismisses on outside focus/click; actions still call their existing owners. |
| Hard constraints | The native Browser WebView remains the single live page source and is never moved, resized, hidden, detached, recreated, or retargeted for either menu. The two triggers share one owned Tauri WebviewWindow menu surface and one item protocol rather than retaining host/native alternatives. Do not add a fallback, compatibility branch, state machine, gate, iframe, screenshot substitute, worktree, or UI automated test. Use real desktop interaction and personally reviewed screenshots for UI acceptance. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied menu screenshot; current panel architecture; the August 3 Browser occlusion record; the August 4 Browser live-surface record; `RightDock.tsx`; `BrowserPreviewPanel.tsx`; `main.tsx`; Overlay cascade and token styles; Tauri configuration/capabilities; installed Tauri `WebviewWindow`, Window parent, focus, positioning, and event application programming interface (API) declarations. |
| Whole-repository grep | The Right Dock `+` still uses a host Kobalte DropdownMenu, and `main.tsx` makes every Browser panel inactive while that host menu is open. Browser `...` uses Tauri's operating-system Menu, which preserves the page but cannot render the supplied product styling. Tauri Window options support an owned parent, transparent/undecorated surface, taskbar exclusion, focus, and screen positioning. The default capability does not yet authorize WebviewWindow creation or mutation and covers only `main`. |
| Independent agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and second review. |
| Git baseline | `work-v0.0.29beta-yr-0803` was clean at `58919be3ce`, synchronized with `legacy-remote/work-v0.0.29beta-yr-0803` (`0 0` divergence), and fetched before implementation. |

## Causal chain

1. The live page is an operating-system child WebView. Host Hypertext Markup
   Language (HTML) stacking cannot cover it, regardless of Cascading Style
   Sheets (CSS) `z-index`.
2. The `+` menu is still host HTML, so `main.tsx` deactivates the Browser while
   it is open. This makes the page disappear and contradicts the explicit
   unmoved-page requirement.
3. Browser `...` was promoted to an operating-system Menu, which solves layer
   ownership but delegates all presentation to the platform and therefore
   cannot match the supplied rounded product menu.
4. A Tauri WebviewWindow owned by `main` is a real window above both the host
   and the Browser child, while its document can render the shared product
   styles. One reusable owned surface can therefore solve both triggers
   without changing the Browser lease.

## Implementation and verification plan

1. Add one dedicated menu document and Solid surface that consumes a typed
   item model, uses shared icons/tokens, owns keyboard focus, and emits real
   action/dismiss events to the main window.
2. Add one frontend service that creates/reuses the parent-owned transparent
   WebviewWindow, positions it from the trigger rectangle, publishes the
   current menu model after the popup document is ready, and dispatches the
   chosen action to the existing owner.
3. Replace the Right Dock `+` Kobalte content and Browser native Menu with that
   service. Remove the `+`-open Browser deactivation so the existing WebView
   lease remains mounted and unchanged.
4. Update Tauri capabilities and current architecture, remove obsolete menu
   styles/imports, and retain no parallel menu implementation.
5. Run focused positive non-UI checks, Overlay typecheck/build, localization,
   documentation health, and `git diff --check`. Do not add, modify, or run UI
   automation.
6. Launch the real desktop app, interact with both triggers over a live page,
   capture screenshots, personally review geometry/style/page continuity and
   action/dismiss behavior, then perform a second code and visual review.
7. Record evidence, commit with the `dsw-33987` prefix, fetch/reconcile the
   tracked legacy remote branch, and push through the normal hook.

## Progress

- [x] Recall, causal chain, and implementation plan recorded.
- [x] Product and architecture changes complete.
- [x] Non-UI/static verification complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Commit and legacy remote push complete (`6bf0a07592`, `legacy-remote/work-v0.0.29beta-yr-0803`).

## Real-page acceptance evidence

- An isolated debug desktop instance opened `https://www.baidu.com/` in the
  real Browser child WebView. Opening the Right Dock add menu left the active
  Browser panel at the same bounds and retained the same live page URL while
  the owned menu window rendered above it.
- The reviewed add-menu capture `add-menu-clean-final-2.png` shows the requested
  rounded white card, product icons, grouped separators, spacing, and shadow
  above the unchanged Baidu page.
- The reviewed Browser-menu capture `browser-menu-clean-final.png` shows the
  same card treatment with the compact zoom toolbar and element-selection row.
- Activating element selection and clicking Baidu's News node rendered the
  selection outline and comment panel inside the still-visible Browser WebView.
  A subsequent blank page click retained the comment panel without navigation
  or error; canceling restored the normal page.
- Clicking the parent workbench outside the native menu dismissed it, changed
  the trigger's expanded state to false, retained one active Browser panel and
  the same Baidu URL, and produced no alert or native cleanup error.

## Static verification evidence

- `bun run typecheck` passed.
- `bun run check:i18n` passed with panel revision `995b8750d5dfdef1`.
- `bun run build:vite` passed after transforming 7,071 modules and emitted both
  `index.html` and `native-menu.html` production entries.
- The historical-link, product-document single-source, and document-health
  suites passed: 70 tests, 1,188 expectations, zero failures.
- `bun run docs:check` passed for 311 operations across 24 groups.
- `git diff --check` passed.
