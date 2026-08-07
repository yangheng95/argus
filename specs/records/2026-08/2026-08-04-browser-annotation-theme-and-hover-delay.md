# Browser annotation theme and hover-delay refinement

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Make the Browser annotation component background match the client background, show the `Right-click to annotate node` hint on pointer hover, and change the hover duration to 1.5 seconds. |
| Acceptance criteria | The injected annotation hover HUD, comment panel, right-click menu, pointer hint, textarea, and actions use the active client's semantic surface/text/border/control colors rather than a fixed dark palette. A stationary pointer shows the localized right-click annotation hint after 1500 milliseconds; pointer movement or competing annotation UI clears it. The real desktop Browser page is interacted with, screenshotted, and personally reviewed in the active client theme. |
| Hard constraints | Keep the native Tauri child WebView and its one injected guest interaction runtime as the only Browser-page and annotation owners. Derive appearance from the active client semantic tokens; do not duplicate theme palettes, introduce fallback styling, add another overlay, create a worktree, or add/modify/run UI automated tests. Browser/Playwright inspection must run through Node. Preserve unrelated working-tree changes. |
| Sources read | Root `AGENTS.md`; in-app Browser control skill; supplied screenshot; `specs/current/architecture/07-panel.md`; `2026-08-03-browser-chrome-control-and-menu-occlusion.md`; `BrowserPreviewPanel.tsx`; `browser-preview-native.ts`; shared transport protocol; Tauri guest-selection runtime; light/dark/VS Code Dark palette sources; theme observation service. |
| Whole-repository grep | The localized hint text and all guest annotation surfaces converge in `BROWSER_PREVIEW_SELECTION_RUNTIME`. Its HUD, panel, context menu, hint, textarea, and buttons use fixed dark `rgba`/white colors, while the client already exposes canonical `--surface`, `--surface-inset`, `--surface-hover`, `--text-strong`, `--text-muted`, `--border`, and `--accent` values. The stationary-pointer timer is the single literal `3000` in that runtime. The existing selection command carries only localized labels, so exact client-theme parity requires extending that single presentation contract rather than recreating palette values in Rust or guest code. Related UI automation files were not opened or run. |
| Independent agent feedback | None. The user did not request sub-agents; the primary agent owns implementation and second review. |
| Git baseline | The branch matched `myhexin/work-v0.0.29beta-yr-0803`. An empty pre-change checkpoint was committed and pushed at `e3a14380bf`; unrelated pre-existing working-tree changes remain unstaged and preserved. |

## Causal chain

1. The annotation controls must render inside the native child WebView so they
   remain above the visited page.
2. That injected document cannot inherit Cascading Style Sheets (CSS) custom
   properties from the parent client document.
3. The guest runtime currently compensates with one fixed dark palette, so a
   light client necessarily produces the dark panel shown in the supplied
   screenshot.
4. The existing host-to-guest selection presentation call is the correct
   single bridge for both localized copy and active semantic colors.
5. Passing the client's resolved semantic colors over that bridge removes the
   duplicate palette and lets theme changes update the already-mounted guest
   runtime without replacing the Browser WebView.

## Implementation and verification plan

1. Replace the labels-only native selection payload with one presentation
   payload containing the localized labels and the client-resolved semantic
   annotation palette.
2. Observe the applied client theme and republish the presentation to the
   mounted guest runtime so light, dark, VS Code Dark, and system-resolved
   palettes keep one source.
3. Render every injected annotation surface from those guest-root semantic
   variables and change the single stationary-pointer threshold from 3000 to
   1500 milliseconds.
4. Update the current Browser architecture contract and this record without
   creating UI test files.
5. Run transport/Overlay typechecks, Rust compilation, production build,
   localization/document checks, and `git diff --check`.
6. Launch or reuse a real desktop Browser page, verify the resting page, the
   hint before/after 1.5 seconds, right-click menu, and comment panel, capture
   task-scoped screenshots, inspect them manually, and correct any mismatch.
7. Perform a second code/visual review, record evidence here, commit only this
   task's files with the `dsw-33987` prefix, reconcile the git-cc branch, and
   push through the normal hook.

## Progress

- [x] Recall, causal chain, and implementation plan recorded.
- [x] Product and architecture changes complete.
- [x] Non-UI/static verification and real-page visual acceptance complete.
- [x] Second code and visual review complete.

## Real-page acceptance evidence

- Ran the development Tauri client against a real native Browser child WebView
  at `http://127.0.0.1:9422/` with Playwright driven by Node.
- The client's resolved `--surface` and the injected comment panel, context
  menu, and pointer-hint backgrounds all measured `rgb(255, 255, 255)` in the
  active light theme. Text resolved to the client's `rgb(24, 27, 29)`.
- With the pointer stationary over the page node, the localized hint remained
  hidden at 1015 milliseconds and was visibly rendered as
  `右键标注节点` at 1663 milliseconds, consistent with the single 1500
  millisecond runtime threshold.
- Captured and manually inspected task-scoped images for the pre-threshold
  hover state, visible hint, right-click menu, toolbar-driven comment panel,
  and right-click-driven comment panel. The injected surfaces use the light
  client surface and maintain readable text, borders, controls, and shadow.

## Static and contract verification

- `bun run --cwd packages/transport-protocol typecheck`
- `bun run --cwd packages/overlay typecheck`
- `cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml` with an
  isolated valid compile-only payload
- `bun test packages/transport-protocol/test/contract.test.ts packages/overlay/test/browser-preview-native.test.ts`
  — 36 passed, 0 failed
- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/overlay build:vite`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts packages/opencorvus/test/script/document-health.test.ts`
  — 70 passed, 0 failed with the two concurrent August record files present
  in an isolated validation index
- `bun run docs:check`
- `git diff --check`

The second review confirmed that fixed guest annotation colors are gone, the
presentation schema is strict at the shared TypeScript and Rust boundaries,
theme changes republish the same presentation contract without remounting the
native page, and unrelated working-tree changes remain outside this delivery.
