# Goal Title And Windows Maximize Work-Area Repair

## Recall

### User request

The user supplied two current Overlay screenshots and requested:

1. left-align every embedded Environment Goals title; and
2. stop the bottom of the application from being covered when the Windows
   window is maximized.

### Acceptance criteria

- Every `.task-progress__pill-title` renders with left-aligned text while the
  existing shared icon/identifier/title column geometry remains unchanged.
- Maximizing the frameless Windows Overlay uses the active monitor work area,
  not the complete monitor rectangle, so the Windows taskbar cannot cover the
  sidebar footer or any other bottom application content.
- Secondary monitors, including monitors with negative virtual-screen
  coordinates and non-bottom taskbars, derive the correct work-area-relative
  maximized position and size.
- The footer identity button, version line, avatar, and connection badge remain
  completely inside the browser viewport in the legal desktop frame.
- Focused source tests, Rust tests, Overlay typecheck/build, a Node-launched
  browser test, task-scoped screenshot review, documentation health, and a
  second diff review pass.

### Hard constraints

- `TaskProgressBar` remains the single embedded Goal projection and retains the
  existing parent-grid/subgrid alignment repair.
- The existing Win32 window subclass remains the single native pre-commit
  geometry owner; extend it instead of adding resize feedback, frontend
  viewport compensation, a second maximize command, or a post-maximize patch.
- Reuse the active monitor's Win32 `MONITORINFO.rcWork` source. Do not assume
  the primary monitor, a bottom taskbar, or a fixed taskbar height.
- Do not restart, refresh, close, or otherwise disturb the user's running
  OpenCorvus/Overlay process. Playwright runs through Node, not Bun.
- No mobile or tablet scope is authorized.
- Commit subjects start with `dsw-33987`; deliver through the `myhexin`
  git-cc remote.

### Sources read

- `AGENTS.md`
- Browser control skill
- both supplied screenshots at original resolution
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/07-panel.md`
- `specs/records/2026-07/2026-07-23-overlay-goal-status-settings-macos-keyboard-repair.md`
- `specs/records/2026-07/2026-07-22-environment-goals-density-and-chat-scrollbar.md`
- `specs/records/2026-07/2026-07-08-overlay-square-aspect-window.md`
- `specs/records/2026-07/2026-07-16-platform-specific-window-chrome-repair.md`
- `specs/records/2026-07/2026-07-16-single-visible-titlebar.md`
- `packages/overlay/src/components/TaskProgressBar.tsx`
- `packages/overlay/src/components/App.tsx`
- `packages/overlay/src/components/SidebarVersionLabel.tsx`
- `packages/overlay/src/components/WindowControls.tsx`
- `packages/overlay/src/styles/surfaces/card.css`
- `packages/overlay/src/styles/surfaces/sidebar.css`
- `packages/overlay/src/styles/surfaces/activity.css`
- `packages/overlay/src/styles/surfaces/workspace.css`
- `packages/overlay/src/styles/cascade/base.css`
- `packages/overlay/src-tauri/src/main.rs`
- `packages/overlay/src-tauri/tauri.conf.json`
- `packages/overlay/test/overlay-window-size-contract.test.ts`
- `packages/overlay/test/browser/goal-group-css-residue-browser.test.ts`
- `packages/overlay/test/browser/sidebar-version-tooltip.test.ts`
- Microsoft Win32 documentation for `WM_GETMINMAXINFO`,
  `MonitorFromWindow`, and `MONITORINFO`.

### Whole-repository search evidence

- `TaskProgressBar` has one product mount in `TaskDirBar.tsx`.
  `TaskProgressBar.tsx` owns the icon/identifier/title DOM and `card.css` owns
  all `.task-progress__*` geometry. The current shared parent grid already
  aligns title column starts, but `.task-progress__pill-title` does not
  override the shared Button primitive's centered text alignment.
- Rendered Goal geometry coverage is centralized in
  `goal-group-css-residue-browser.test.ts`; source ownership coverage is in
  `task-progress-collapse.test.ts`.
- `WindowControls.tsx` is the only non-macOS Tauri maximize caller and delegates
  to Tauri `toggleMaximize`.
- `main.rs` installs one Windows `SetWindowSubclass` callback. It handles
  `WM_SIZING` for minimum dimensions and square-aspect enforcement, then
  delegates all other messages through `DefSubclassProc`.
- No production path handles `WM_GETMINMAXINFO`, `MINMAXINFO`,
  `MonitorFromWindow`, `GetMonitorInfoW`, `rcWork`, or a monitor work-area
  projection.
- `tauri.conf.json` constructs one desktop window and Rust removes decorations
  on Windows/Linux before showing it. There is no second Windows window
  definition or maximize geometry source.
- The sidebar footer has one mount in `App.tsx`; `sidebar.css` owns its flex
  layout and `sidebar-version-tooltip.test.ts` is its rendered browser
  regression owner.
- `overlay-window-size-contract.test.ts` is the focused static/native ownership
  test for the Windows subclass, `WM_SIZING`, and minimum shell dimensions.

### Independent agent feedback

None. The user did not request sub-agents or parallel review, and the active
delegation policy forbids spawning them for this task.

## Diagnosis

### Goal title alignment

The earlier repair correctly made all Goal rows share one grid and subgrid, so
their title column starts at one coordinate. The remaining screenshot defect
is text alignment inside that shared column: the title inherits the shared
Button primitive's centered text alignment. This is why short Goal titles
visibly sit toward the middle even though the title column itself is aligned.
The feature-local title cell must explicitly own `text-align: left`.

### Maximized window bottom occlusion

The Windows application is frameless after construction and the HTML maximize
control calls Tauri's native maximize operation. The existing Win32 subclass
constrains only interactive `WM_SIZING`; it does not override maximized
position or dimensions. The screenshot's footer continuing behind the taskbar
is therefore the visible symptom, while the missing
`WM_GETMINMAXINFO` work-area projection is the direct native geometry gap.

Microsoft documents `WM_GETMINMAXINFO` as the message for overriding the
default maximized position and dimensions. `MonitorFromWindow` resolves the
monitor containing the window, while `MONITORINFO.rcWork` is the taskbar-aware
work rectangle in virtual-screen coordinates. The repair must convert that
work rectangle into a monitor-relative `ptMaxPosition` plus `ptMaxSize` in the
existing subclass. A CSS bottom inset would only mask one taskbar placement and
would leave the native window itself incorrectly sized.

Visual verification exposed a second, independent clip inside the same
screenshot. `SidebarVersionLabel` uses `Button size="sm"`, whose primitive
selector has higher specificity than `.chat-version-copy` and therefore keeps
the button at the compact chip height. The two text rows and 28-pixel avatar
overflow that used height; `.chat-version` then clips them because its own
intrinsic height follows the fixed-height button. The footer is already a
full-row action, so the existing `data-chrome="row-action"` Button contract is
the correct single source for content-owned automatic height.

Primary references:

- https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-getminmaxinfo
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-monitorfromwindow
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-monitorinfo

## Call-Point Disposition

| Surface / API | Call point | Disposition |
| --- | --- | --- |
| Embedded Goals | `TaskDirBar.tsx` -> `TaskProgressBar` | Preserve the one render and all behavior. |
| Goal row DOM | `TaskProgressBar.tsx` | Preserve icon, identifier, and title cells. |
| Goal row CSS | `card.css` | Add left alignment only to the title cell. |
| Goal browser regression | `goal-group-css-residue-browser.test.ts` | Assert shared title-left coordinate and `text-align: left`; capture the focused Environment screenshot. |
| Maximize UI | `WindowControls.tsx` | Preserve Tauri `toggleMaximize`; do not add frontend geometry. |
| Windows subclass | `main.rs` | Extend the one callback to process `WM_GETMINMAXINFO` from the active monitor work area while retaining `WM_SIZING`. |
| Work-area math | `main.rs` | Add one pure rectangle-to-maximized-bounds projection used by the callback and Rust tests. |
| Native ownership test | `overlay-window-size-contract.test.ts` | Require the new message/API ownership and reject frontend/taskbar padding compensation. |
| Footer browser regression | `sidebar-version-tooltip.test.ts` | Assert footer/button/content bottom containment at the legal desktop viewport and save a focused screenshot. |
| Footer identity button | `SidebarVersionLabel.tsx` | Use the existing full-row Button chrome so the avatar and both text rows determine button height. |
| Shell sizing | `base.css`, `activity.css`, `workspace.css`, `sidebar.css` | Keep unchanged unless rendered evidence disproves current bounded flex ownership. |

## Implementation Plan

1. Add focused source/browser assertions for left-aligned Goal title text and
   bottom-contained footer content.
2. Add pure Windows monitor/work-area geometry types and tests, then process
   `WM_GETMINMAXINFO` in the existing native subclass with
   `MonitorFromWindow(MONITOR_DEFAULTTONEAREST)` and `GetMonitorInfoW`.
3. Run the focused Bun and Rust tests, Overlay typecheck/i18n/build, and the
   Node-launched browser tests.
4. Inspect the Goal and footer screenshots at original resolution, correct any
   visual mismatch, and rerun the affected checks.
5. Run documentation health, `git diff --check`, and a second source review;
   update this record with exact evidence, commit, fetch/converge, and push to
   `myhexin`.

## Verification Plan

- `bun test packages/overlay/test/task-progress-collapse.test.ts packages/overlay/test/overlay-window-size-contract.test.ts`
- `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml overlay_ -- --nocapture`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/goal-group-css-residue-browser.test.ts packages/overlay/test/browser/sidebar-version-tooltip.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/overlay build:vite`
- `cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml --locked`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `git diff --check`

## Outcome

Implemented the two requested visual repairs at their owning layers:

- `.task-progress__pill-title` now explicitly left-aligns text without changing
  the existing shared Goal grid.
- The existing Windows window subclass now handles `WM_GETMINMAXINFO`, lets the
  underlying Tauri/TAO procedure preserve its tracking-size values, and then
  projects the active monitor's `rcWork` into the maximized position and size.
- `SidebarVersionLabel` now uses the existing full-row Button chrome, allowing
  the avatar and two text lines to own the button height instead of overflowing
  a compact chip.

Verification completed:

- Focused Bun contracts: 14 passed.
- Windows Rust tests: 21 passed, including bottom-taskbar, negative-origin
  secondary-monitor, and invalid-work-area cases.
- Overlay TypeScript typecheck and panel internationalization check passed.
- Locked Cargo check passed.
- Node-launched browser validation: 2 passed after a production Vite build.
- Documentation health and historical-link validation: 82 passed.
- Original-resolution review of
  `.scratch/goal-status-environment-progress.png` confirmed all rendered Goal
  titles share one left edge and left-aligned text.
- Original-resolution review of
  `.scratch/sidebar-footer-maximized-work-area.png` confirmed the avatar,
  product name, version, and connection badge are wholly visible and contained
  by the footer.

The user's running OpenCorvus/Overlay process was not restarted, refreshed, or
otherwise disturbed. The native maximize correction takes effect when a build
containing this change is next launched.
