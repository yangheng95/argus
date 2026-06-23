# Native Resize No Set Size Loop

Date: 2026-06-22
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the visible overlay surface.
- OS: Operating System, the desktop window manager that owns live window resize.
- UI: User Interface, visible controls and layout surfaces.

## Task Definition

Remove the native live-resize feedback loop that calls `set_size()` from inside
Tauri's `WindowEvent::Resized` callback. Minimum window dimensions remain owned
by the Tauri window configuration and startup sizing keeps using the configured
minimum contract.

## Recall

| Source                                            | Constraint carried forward                                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                       | No fallback, no gate, no blind patching, test every change, visually verify UI-related changes, and commit/push each round. |
| `2026-06-22-overlay-viewport-size-contract.md`    | Native minimum dimensions are `1120x720`; startup sizing reads the configured main window minimum.                          |
| `2026-06-22-overlay-resize-frame-coalescing.md`   | Browser resize work is already frame-coalesced; do not add debounce or alternate resize owners.                             |
| `2026-06-22-window-resize-center-layout-frame.md` | Center workbench layout has one browser RAF owner after window resize.                                                      |
| Locke read-only resize audit 2026-06-22           | `WindowEvent::Resized` calls `window.set_size(...)`, which can fight the OS during live dragging and cause resize jank.     |

## Call Point Inventory

| Surface                 | Evidence                                                                                                                    | Decision                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Native creation minimum | `tauri.conf.json` sets `minWidth: 1120` and `minHeight: 720`.                                                               | Keep this as the native live minimum size owner.                                       |
| Setup minimum           | `main.rs` setup calls `window.set_min_size(...)` with `overlay_main_min_size(app.config())`.                                | Keep; this reinforces the config-owned minimum at runtime without per-resize feedback. |
| Startup sizing          | `startup_overlay_window_size(...)` uses `constrain_overlay_window_size(...)` before initial `window.set_size(...)`.         | Keep startup sizing; it runs once, outside user live dragging.                         |
| Live resize             | `RunEvent::WindowEvent { event: WindowEvent::Resized(size) }` computes a constrained size and calls `window.set_size(...)`. | Remove this branch so OS live resize is not echoed back by the app.                    |
| Dead helper             | `overlay_window_needs_resize(...)` is only used by the live resize branch.                                                  | Delete with the branch.                                                                |
| Static tests            | `overlay-window-size-contract.test.ts` currently expects the live resize branch.                                            | Change the contract to reject live resize `set_size` ownership.                        |
| Rust tests              | Existing Rust tests cover `constrain_overlay_window_size(...)` and startup minimum floor.                                   | Keep them to prove the startup contract remains intact.                                |

## Root Cause

The previous viewport size contract fixed illegal small native windows by adding
both a configuration minimum and a live resize correction path. The correction
path runs inside every native `WindowEvent::Resized` event and calls
`window.set_size(...)` when the current size does not match the helper's
constrained result. During manual window dragging, that app-issued resize can
generate another OS resize event and compete with the user's drag operation,
which matches the reported "resize window is very stuck" symptom.

## Fix Plan

1. Remove the `WindowEvent::Resized` branch that calls `window.set_size(...)`.
2. Delete `overlay_window_needs_resize(...)` because it is no longer used.
3. Update the static overlay size contract test to require `set_min_size(...)`
   and startup sizing, while forbidding live resize `set_size(...)`.
4. Run the focused static test, Rust size tests, overlay typecheck, and browser
   visual resize/titlebar tests.
5. Review visual screenshots at legal sizes before commit/push.

## Acceptance

- Native minimum size remains `1120x720`.
- Startup sizing still uses the configured minimum contract.
- Live native resize no longer calls `set_size(...)` from `WindowEvent::Resized`.
- Browser resize RAF owners remain unchanged.
- No fallback, debounce, alternate resize owner, or hidden layout path is added.

## Verification

- PASS: `bun test packages/overlay/test/overlay-window-size-contract.test.ts --timeout 30000`.
- PASS: `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml overlay_window_size -- --nocapture`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-menubar.test.ts packages/overlay/test/browser/center-workbench-separator-browser.test.ts`.
- Visual QA reviewed:
  `.scratch/overlay-minimum-1120-full.png`,
  `.scratch/center-workbench-three-panel-min-width.png`, and
  `.scratch/center-workbench-separator-desktop-resize.png`.

## Self Review

- Rechecked native resize ownership: `main.rs` no longer contains
  `tauri::WindowEvent::Resized` or `overlay_window_needs_resize(...)`.
- Rechecked startup ownership: setup still applies `set_min_size(...)`, and
  initial sizing still uses `startup_overlay_window_size(...)`.
- Rechecked Rust unit coverage: minimum dimensions, startup floor, and startup
  aspect helper still pass.
- Rechecked browser visual evidence: legal `1120x720`, three-panel center
  workbench layout, and desktop resize screenshots remain coherent.
