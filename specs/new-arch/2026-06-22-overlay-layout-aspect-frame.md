# Overlay Layout Aspect Frame

Date: 2026-06-22
Status: Verified

## Acronyms

- CSS: Cascading Style Sheets, the browser styling and layout language.
- GUI: Graphical User Interface, the visible overlay surface.
- OS: Operating System, the desktop window manager that owns native window resize.
- QA: Quality Assurance, the verification pass that checks the delivered behavior.
- RAF: Request Animation Frame, the browser callback used to run visual work once per frame.
- TS: TypeScript, the typed JavaScript language used by the overlay web layer.
- UI: User Interface, visible controls and layout surfaces.
- Win32: Windows 32-bit API family, the native Windows desktop API surface.
- WM: Window Message, the Win32 message family used for native window events.

## Task Definition

Prevent illegal overlay aspect ratios from changing the operable UI scale or
stretching panels, while preserving the existing center workbench panel minimum
width contract. Illegal native feedback-loop resizing remains forbidden because
it caused live resize jank.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate source, no blind patches, test every change, visually verify UI work, and commit/push every round. |
| `2026-06-22-overlay-viewport-size-contract.md` | Native minimum dimensions are `1120x720`; pane and center workbench minimum widths are token-owned. |
| `2026-06-22-native-resize-no-set-size-loop.md` | Do not restore `WindowEvent::Resized -> window.set_size(...)`; native live resize feedback caused jank. |
| `2026-06-22-center-workbench-panel-min-size-contract.md` | `--ui-workbench-panel-min-width` remains the only center panel minimum width source; multiple open panels scroll instead of compressing. |
| `2026-06-22-window-resize-center-layout-frame.md` | Window resize work is frame-coalesced and center workbench geometry has one RAF owner. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Native creation minimum | `src-tauri/tauri.conf.json` sets `minWidth: 1120` and `minHeight: 720`. | Keep the native minimum dimensions as the OS-owned hard floor. |
| Native startup aspect | `src-tauri/src/main.rs` derives `overlay_min_aspect_ratio()` from the configured minimum size. | Keep startup aspect correction; do not add a `WindowEvent::Resized -> set_size()` correction loop. |
| Native Windows live sizing | `src-tauri/src/main.rs` can install a Win32 subclass during setup. | Constrain the mutable `WM_SIZING` rectangle before the OS commits the resize, so native illegal aspect ratios never enter the WebView. |
| Browser shell size | `base.css` sets body `min-width`, `min-height`, and `height: 100vh`. | Replace raw viewport height with a legal layout-frame height derived from the same minimum size tokens. |
| UI zoom | `services/theme.ts` computes scale from raw viewport dimensions. | Compute scale from the legal overlay layout frame so a tall/narrow illegal viewport cannot enlarge the UI. |
| Center workbench panel minimum | `main.tsx` and `workspace.css` resolve `--ui-workbench-panel-min-width`. | Preserve this source and extend browser coverage for illegal aspect viewports. |
| Tests | `overlay-window-size-contract.test.ts` and `center-workbench-separator-browser.test.ts` cover min dimensions and panel width. | Extend both plus a pure utility test for legal layout-frame math. |

## Root Cause

After removing the native live resize `set_size()` loop, there was no remaining
native owner for the minimum aspect-ratio part of the `1120x720` contract. The
browser shell and zoom service also treated any raw viewport height as valid.
That creates two observable defects: the app surface can stretch beyond the
aspect ratio implied by the `1120x720` contract, and `applyZoom()` can scale the
UI from the illegal viewport height even though the minimum panel-width contract
is defined for the legal frame.

## Fix Plan

1. Change overlay minimum dimensions into numeric CSS source tokens, then derive
   `--ui-overlay-min-width`, `--ui-overlay-min-height`, and the minimum aspect
   ratio from those tokens.
2. Clamp the body layout frame height with that derived aspect ratio while
   preserving the existing native minimum width and height floor.
3. Install a Windows `WM_SIZING` subclass that constrains the mutable resize
   rectangle to the same minimum aspect ratio before the OS commits the resize.
4. Add a small pure TS utility that constrains a viewport to the same legal
   overlay layout frame.
5. Route `applyZoom()` and `stepZoom()` through that utility instead of raw
   viewport dimensions.
6. Extend static tests for the token, shell, and native sizing contract.
7. Extend the center workbench browser test with an illegal tall viewport
   screenshot and assertions that the body frame is aspect-clamped and open
   panels stay at or above `--ui-workbench-panel-min-width`.
8. Run focused unit/static tests, Rust tests, overlay typecheck, browser visual test, visual
   inspection, self-review, commit, and push.

## Acceptance

- No native live resize `set_size()` feedback loop is restored.
- Native Windows live resizing constrains illegal tall rectangles in
  `WM_SIZING`, before the WebView receives an illegal aspect-ratio surface.
- Browser shell height is clamped to the minimum aspect ratio derived from the
  `1120x720` overlay minimum contract.
- UI zoom uses the same legal layout frame, so illegal tall viewports do not
  inflate UI scale.
- Center workbench panel minimum width remains token-owned by
  `--ui-workbench-panel-min-width`.
- Illegal tall viewport browser evidence shows open center panels remain at or
  above the panel minimum and do not overlap.
- Focused tests, typecheck, browser visual test, visual QA, and self-review pass.

## Verification

- PASS: `bun test packages/overlay/test/overlay-layout-frame.test.ts packages/overlay/test/overlay-window-size-contract.test.ts packages/overlay/test/workspace-surface-consistency.test.ts --timeout 30000`.
- PASS: `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml overlay_ -- --nocapture`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`.
- Visual QA reviewed:
  `.scratch/center-workbench-three-panel-min-width.png`,
  `.scratch/center-workbench-three-panel-min-width-1120.png`, and
  `.scratch/center-workbench-illegal-tall-aspect-frame.png`.

## Self Review

- Rechecked native resize ownership: `main.rs` still rejects
  `tauri::WindowEvent::Resized` and the removed `overlay_window_needs_resize`
  loop, while Windows `WM_SIZING` constrains the rectangle before the OS
  finishes resizing.
- Rechecked source ownership: overlay min width, min height, min aspect ratio,
  and center workbench panel minimum all derive from CSS tokens; no duplicate
  panel minimum was added.
- Rechecked the web layout frame: browser/dev illegal tall evidence is
  aspect-clamped instead of stretched, and the blank area below the shell is a
  browser fixture artifact that native `WM_SIZING` prevents in the real overlay.
- Rechecked zoom input: `applyZoom()` and `stepZoom()` now consume the legal
  overlay layout frame and do not read `visualViewport`.
