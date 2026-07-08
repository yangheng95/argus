# Overlay Square Aspect Window

Date: 2026-07-08
Status: Verified

## Acronyms

- CSS: Cascading Style Sheets, the browser styling and layout language.
- GUI: Graphical User Interface, the visible overlay surface.
- OS: Operating System, the desktop window manager that owns native window resize.
- TS: TypeScript, the typed JavaScript language used by the overlay web layer.
- UI: User Interface, visible controls and layout surfaces.
- Win32: Windows 32-bit API family, the native Windows desktop API surface.
- WM: Window Message, the Win32 message family used for native window events.

## Task Definition

Relax the overlay window aspect-ratio contract so a square overlay window is
legal. Preserve the existing `1120px` minimum width and `720px` minimum height
layout floor; this task changes the aspect ceiling for tall windows, not the
minimum-width contract or a new compact layout.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| User request 2026-07-08 | "之前窗口的长宽比限制的太死了，放松到至少可以是正方形的overlay窗口". |
| `AGENTS.md` | No fallback or compatibility path, no duplicate source, inspect existing plans before edits, test every change, visually verify overlay UI work, do not restart/kill running OpenCorvus or overlay processes without explicit permission. |
| `2026-06-22-overlay-layout-aspect-frame.md` | Current runtime derives a minimum aspect ratio from the `1120x720` minimum frame and applies it in native Windows sizing, browser shell CSS, and TS layout-frame math. |
| `2026-06-23-overlay-panel-legal-size-contract.md` | Fullscreen width is legal; do not restore max-aspect clamping or `WindowEvent::Resized -> set_size` feedback loops. |
| `packages/overlay/test/overlay-window-size-contract.test.ts` | Static contract currently expects generated `--ui-overlay-min-aspect-ratio` and Windows `WM_SIZING` minimum-aspect ownership. |
| Full-repo grep | The aspect consumers are `packages/overlay/src-tauri/src/main.rs`, `packages/overlay/src/styles/cascade/base.css`, `packages/overlay/src/utils/overlay-layout-frame.ts`, `packages/overlay/script/overlay-size-contract.ts`, and the overlay size/browser tests. |
| Independent agent feedback | Not spawned: the available subagent tool requires explicit user authorization for delegation; this request did not ask for subagents. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Tauri native size floor | `packages/overlay/src-tauri/tauri.conf.json` sets `minWidth: 1120` and `minHeight: 720`. | Keep these floors so this change does not become a narrow-layout redesign. |
| Generated CSS contract | `renderOverlaySizeContractStyle()` emits min width/height units and derives `--ui-overlay-min-aspect-ratio` from those units. | Keep generated ownership, but change the generated aspect value to a square `1 / 1` contract. |
| Browser shell | `base.css` computes body shell height from `--ui-overlay-min-aspect-ratio`. | The same formula remains; the generated ratio change makes `1120x1120` legal. |
| TS layout frame | `constrainOverlayLayoutFrame()` derives the ratio from minimum width/height. | Consume the square aspect contract in the same utility so zoom/layout consumers match CSS. |
| Rust native startup and resize | `main.rs` derives `overlay_min_aspect_ratio()` from configured min width/height and applies it in startup sizing and Win32 `WM_SIZING`. | Change the native aspect rule to the same square ratio without adding a resize feedback loop. |
| Static tests | `overlay-window-size-contract.test.ts` and `overlay-layout-frame.test.ts` encode the current `1120/720` aspect behavior. | Update them to require square-aspect legality and to keep the old too-tall clamp only above square. |
| Browser visual test | `center-workbench-separator-browser.test.ts` captures `1120x1000` as illegal-tall. | Change this proof to square-legal `1120x1120` and a separate over-square clamp if needed. |

## Fix Plan

1. Preserve Tauri `minWidth: 1120` and `minHeight: 720`.
2. Change the generated browser aspect token to a square `1 / 1` minimum
   aspect ratio while keeping min width/height tokens generated from Tauri.
3. Change TS layout-frame math to use the same square aspect contract.
4. Change Rust startup and Windows `WM_SIZING` constraints to allow square
   windows and clamp only portrait/taller-than-square rectangles.
5. Update static, pure, Rust, and browser tests for square legality.
6. Run focused tests, node-started browser visual proof, inspect screenshots,
   then do a second source review.

## Acceptance

- A `1120x1120` overlay frame is legal in CSS, TS layout-frame math, and native
  Windows resize math.
- A taller-than-square frame is still clamped to square, so portrait windows do
  not become a new UI contract.
- Existing `1120px` minimum width and `720px` minimum height remain the only
  native minimum floor.
- No max-aspect token, fallback size, compact breakpoint, or resize feedback
  loop is introduced.
- Focused tests, browser screenshot proof, and second review pass.

## Verification Plan

- `bun test packages/overlay/test/overlay-window-size-contract.test.ts packages/overlay/test/overlay-layout-frame.test.ts --timeout 30000`
- `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml overlay_ -- --nocapture`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`
- Visual QA: inspect the generated square-aspect screenshot and confirm the
  overlay shell uses the full square frame without panel overlap.

## Implementation

- `overlay-size-contract.ts` now generates `--ui-overlay-min-aspect-ratio` as
  a square `1 / 1` ratio while leaving `--ui-overlay-min-width` and
  `--ui-overlay-min-height` sourced from the Tauri main-window minimums.
- `overlay-layout-frame.ts` now receives `minimumAspectRatio` explicitly and
  `overlayLayoutFrameSize()` reads it from the generated CSS token through the
  shared layout-token resolver.
- `layout-tokens.ts` now resolves unitless numeric layout tokens through the
  same hidden probe pattern used for pixel tokens, without inventing a default.
- `main.rs` now carries the square minimum aspect ratio in
  `OverlayWindowConstraints`, so startup sizing and Windows `WM_SIZING` allow
  square windows and clamp only taller-than-square rectangles.
- `center-workbench-separator-browser.test.ts` now opens the current explicit
  right-toolbar titlebar toggle before using right activity buttons, then
  captures square and portrait-clamped aspect evidence.

## Verification

- PASS: `bun test packages/overlay/test/overlay-window-size-contract.test.ts packages/overlay/test/overlay-layout-frame.test.ts --timeout 30000`.
- PASS: `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml overlay_ -- --nocapture`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`.
- PASS: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`.
- PASS: `git diff --check -- <changed files>`.

## Visual QA

- Reviewed `.scratch/center-workbench-square-aspect-frame.png`: the
  `1120x1120` frame uses the square shell height, the right toolbar is visible,
  and the open center workbench panels do not overlap.
- Reviewed `.scratch/center-workbench-portrait-clamped-aspect-frame.png`: the
  `1120x1300` browser fixture clamps the overlay shell to square height and
  leaves only fixture whitespace below the shell; native Windows sizing prevents
  that taller-than-square surface from being committed.

## Self Review

- Rechecked that `tauri.conf.json` still owns the `1120x720` native minimum
  floor and this task did not create a `720px` compact layout.
- Rechecked that no `--ui-overlay-max-aspect`, `overlay_max_aspect_ratio`,
  `max_aspect_size`, or `WindowEvent::Resized -> set_size` path was added.
- Rechecked that the old `minimum.width / minimum.height` TS derivation is
  gone, so CSS and TS use the generated square aspect token instead of separate
  formulas.
- Rechecked the current dirty worktree before delivery; many unrelated files
  remain modified from other active work, so this record identifies only the
  files touched for this square-aspect task.
