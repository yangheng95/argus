# Browser context-menu style isolation

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | The supplied Browser screenshot shows the injected `Annotate node` right-click action as a large, thickly outlined button. The user asked for an ordinary right-click menu appearance. |
| Acceptance criteria | Right-clicking a real page node opens a compact menu surface with one normal-density menu row, a light border, restrained radius and elevation, client-theme colors, and a soft hover/keyboard highlight. The visited page cannot restyle the annotation menu button. Activating the item still opens the existing node-comment panel for the same node. |
| Hard constraints | Preserve the native Browser child WebView and the one injected guest annotation runtime. Reuse the existing client-derived semantic palette and existing right-click/comment behavior; do not add a second renderer, fallback, compatibility path, gate, worktree, or User Interface (UI) automated test. Verify on a real page with interaction, screenshots, and personal visual review. Preserve unrelated working-tree changes. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot `codex-clipboard-7171ec75-8acf-4905-8e41-3b00b375525f.png`; current Browser panel architecture; prior Browser annotation theme record; Tauri guest-selection runtime; canonical Overlay dropdown/context-menu recipe; native-menu recipe. |
| Whole-repository grep | The screenshot geometry matches the injected `BROWSER_PREVIEW_SELECTION_RUNTIME` menu. Its item uses inline base styles but remains in the visited page's light Document Object Model (DOM), so page selectors such as `button:focus` can supply the thick outline and other control styling. The runtime already owns all annotation chrome and receives the client semantic palette. `packages/overlay/test/context-menu.test.ts` contained prohibited frontend-source string and negative assertions; its positive event-policy contracts remain eligible. `packages/overlay/test/browser-preview-native.test.ts` is a non-UI service/transport contract and remains intact. |
| Independent agent feedback | None. The user did not request sub-agents; the primary agent owns implementation and second review. |
| Git baseline | `work-v0.0.30beta-yr-0804` matched `legacy-remote/work-v0.0.30beta-yr-0804` at `3ab118a7b6` before implementation. Pre-existing native-menu, workspace, design-token, architecture, and record edits remain unstaged and preserved. |

## Causal chain

1. Annotation controls must render inside the live child WebView so they remain
   above the native page surface and can use real DOM hit-testing.
2. The current annotation root is an ordinary page descendant. Inline styles
   set its intended geometry, but they do not form a styling boundary.
3. The visited page can therefore match the injected `button`, especially its
   automatically focused state, and paint the thick black outline visible in
   the screenshot.
4. Adding more selector-specific resets would only chase individual websites.
   A Shadow DOM boundary is the browser platform's single mature mechanism for
   isolating component internals from document selectors.
5. Mounting the existing annotation children under that boundary removes the
   pollution source while retaining the current runtime, palette contract,
   selection owner, and comment flow.

## Implementation and verification plan

1. Give the one guest annotation host a Shadow DOM root and mount its existing
   outline, heads-up display, comment panel, context menu, and pointer hint
   beneath that boundary.
2. Align the context surface and item with the canonical Overlay menu recipe:
   compact padding and row height, normal system typography, a restrained
   radius, no control outline/shadow, and one semantic hover/focus fill.
3. Preserve activation, Escape, outside-dismissal, node selection, and comment
   submission ownership; remove the encountered prohibited source-string and
   negative assertions without running UI tests.
4. Update the current Browser architecture contract and documentation indexes.
5. Run Rust compilation, Overlay typecheck/build, localization/document health,
   and diff checks. Do not run UI tests.
6. Launch or reuse a real desktop Browser page, right-click a page node, capture
   and inspect the normal and highlighted menu states plus the resulting comment
   panel, then correct any visual mismatch.
7. Perform a second code and visual review, record evidence here, commit only
   this task's changes with the `dsw-33987` prefix, reconcile the legacy remote branch,
   and push through the normal hook.

## Progress

- [x] Recall, causal chain, and implementation plan recorded.
- [x] Product and architecture changes complete.
- [x] Non-UI/static verification complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Commit and legacy remote push complete.

## Real-page acceptance evidence

- Built the current Tauri client in the isolated
  `.scratch/browser-context-menu-qa/target` output, launched it with an isolated
  runtime home and WebView2 profile, and connected Playwright through Node to
  its native WebView debugging endpoint.
- Opened the real Right Dock Browser, navigated its native child WebView to
  `https://www.baidu.com/`, and right-clicked the live `新闻` navigation link.
  This is the same page family and node region visible in the user's supplied
  screenshot.
- `.scratch/browser-context-menu-qa/context-menu-final.png` shows the final
  Browser-region menu. Its measured surface is `160 × 41.14` CSS pixels and its
  one row is `32` CSS pixels high. The row resolves to weight `400`, has no
  outline or control shadow, and uses the client-projected hover fill.
- Runtime inspection confirmed that the annotation host has one Shadow DOM
  root and the menu item lives beneath it. Baidu's focus styling therefore no
  longer produces the screenshot's thick black button outline.
- The first visual pass exposed Shadow DOM event retargeting at the document
  capture listener: pointer-down was initially misclassified as an outside
  click. The runtime now resolves membership from the composed event path.
  After rebuilding, clicking `Annotate node` opened the existing focused
  comment panel for `新闻`; `.scratch/browser-context-menu-qa/comment-panel-final.png`
  records that state, and clicking `Cancel` closed it normally.
- Personal visual review confirmed a compact ordinary context menu with a
  restrained border, radius, elevation, text size, row density, and soft
  highlight. A second code review confirmed that selection ownership,
  presentation colors, dismissal, activation, comment focus, and cancellation
  still converge on the original guest runtime.

## Static and contract verification

- `cargo build --manifest-path packages/overlay/src-tauri/Cargo.toml --target-dir .scratch/browser-context-menu-qa/target`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/overlay build:vite`
- `bun test packages/overlay/test/context-menu.test.ts` — 2 passed, 0 failed
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts packages/opencorvus/test/script/document-health.test.ts` — 70 passed, 0 failed
- `bun run docs:check`
- `git diff --check`

The first shared-target `cargo check` attempt timed out while two concurrent
Cargo tasks held build resources; the isolated full native build above entered
the real compiler and completed without errors. The first documentation-health
run also correctly rejected another concurrent task's indexed but then-untracked
record; that task subsequently committed its record before this delivery's
final staged documentation verification.

Implementation commit `49990a2152` passed the normal legacy remote pre-push hook and
was pushed to `legacy-remote/work-v0.0.30beta-yr-0804`.
