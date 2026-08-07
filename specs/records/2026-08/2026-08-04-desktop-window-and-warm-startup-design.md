# Desktop Window and Warm Startup Design

Date: 2026-08-04
Status: approved for autonomous implementation

## Recall

| Item | Evidence |
| --- | --- |
| User request | Size the desktop client as a proportion of the current display and center it horizontally and vertically; change the startup progress copy to `正在准备Agent运行环境...`; when the managed backend is already healthy, skip the loading surface and enter the main application directly. |
| Acceptance criteria | A fresh desktop launch uses 80% of the primary monitor work area subject to the existing `1120x720` legal minimum and is centered within that work area; a cold backend visibly shows the updated loading copy and real progress; a warm backend never exposes the loading surface before the mounted application; failure/retry remains visible; the real client is launched and screenshots are personally reviewed. |
| Hard constraints | One Tauri window and one startup event stream; Tauri configuration remains the authored numeric source; no fallback, second splash window, resize feedback loop, gate, state machine, UI automated test, or WebView resize after construction; Playwright may only be launched by Node for one-off manual visual inspection. |
| Sources read | `AGENTS.md`; `specs/current/architecture/99-principles.md`; `specs/records/2026-06/2026-06-23-overlay-panel-legal-size-contract.md`; `specs/records/2026-08/2026-08-03-packaged-startup-progress.md`; `specs/records/2026-08/2026-08-03-packaged-startup-handoff-repair.md`; `packages/overlay/src-tauri/tauri.conf.json`; `packages/overlay/src-tauri/src/main.rs`; `packages/overlay/src/index.html`; `packages/overlay/src/main.tsx`; `packages/overlay/src/services/window.ts`; `packages/overlay/src/services/tauri-transport.ts`; Tauri 2.11.1 local crate sources and current official window API documentation. |
| Whole-repository grep | `overlay_main_size_constraints` has one setup consumer. `WebviewWindowBuilder::from_config` has one main-window construction site. `spawn_startup_worker` is called by startup page load and retry. `show_window` is called by page load, tray show/restart/click, and no other startup owner. `overlay:startup-progress` has one Rust producer and one `index.html` consumer. `__opencorvusStartupReady` is produced only by `index.html` and consumed only by `main.tsx`. The fixed loading phrase exists twice in `index.html`. The historical `overlay-window-size-contract.test.ts` has already been deleted. |
| Existing user work | Uncommitted landing download files under `packages/web`, its positive non-UI resolver test, and two landing screenshots predate this task. They are unrelated and must remain untouched and unstaged. |
| Independent review | Claude Code read-only review attempt 1 ended with `error_max_budget_usd`; the reduced retry exceeded the bounded shell timeout before returning a terminal result. Neither attempt modified the worktree or produced valid review feedback. The primary Agent therefore records no independent conclusion and must perform an evidence-based second self-review after implementation. |

## Root cause

The main window is authored as a fixed `1280x760` surface. Setup builds that
exact size, while the only runtime constraints derive the legal minimum and
Windows resize aspect behavior. No current owner reads the monitor work area,
so the initial size and position cannot adapt to the display.

The startup flash has a separate direct trigger. The `PageLoadEvent::Finished`
handler calls `show_window` before it starts `ensure_server_with_progress`.
`index.html` therefore becomes visible with its static loading child even when
`current_server_info` immediately returns an already-running managed backend.
The later health probe and `ready` event are correct, but they arrive after the
wrong reveal. Changing the health check or hiding the loading text would only
mask that ordering defect.

## Considered approaches

### 1. Native construction and evidence-owned reveal — selected

Keep the existing Tauri window and startup event stream. Add the 80% initial
work-area ratio to `tauri.conf.json`, calculate logical construction geometry
from the primary monitor's physical work area and scale factor, and pass that
geometry to `WebviewWindowBuilder` before `build`. Cold-start preparation owns
the first loading reveal; a healthy warm start keeps the window hidden until
Solid has replaced the loading child and mounted the application.

This preserves construction-time WebView2 sizing, Tauri's single numeric
source, the existing minimum contract, and one backend-readiness authority.

### 2. Frontend resize and reveal after page load — rejected

JavaScript could call `setSize`, `center`, and `show` after the document loads.
That would make frontend and Rust both own native geometry, resize WebView2
after construction, and weaken the existing first-paint constraint.

### 3. Separate splash window — rejected

A dedicated splash can isolate loading, but it creates a second window,
handoff lifecycle, and visibility source for behavior already represented by
the existing static startup child. It is unnecessary and violates the
single-source requirement.

## Design

### Initial geometry

`tauri.conf.json` remains the authored source for `minWidth`, `minHeight`, and
the new `initialWorkAreaRatio: 0.8` application parameter. Rust parses that
ratio strictly, reads `App::primary_monitor().work_area()` and `scale_factor()`,
and derives logical work-area dimensions. The constructed width and height are
the greater of the 80% result and the existing legal minimum; setup fails
explicitly when the work area cannot contain that legal minimum. The position
is the work-area origin plus half of the remaining space on each axis.

The builder receives the calculated logical inner size and position before
`build`. No `WindowEvent::Resized -> set_size` feedback, runtime maximum, saved
geometry, or second default-size source is introduced. Existing minimum-size
and Windows native aspect constraints remain installed after construction.

### Startup visibility and data flow

The page-load handler starts the existing worker but no longer reveals the
window. The worker owns a per-run `std::sync::Once` reveal:

1. Any real preparation/extraction/start progress reveals the static loading
   surface before emitting its first event.
2. A startup failure reveals the same surface before emitting the failed event,
   so Retry and View log remain available even when no prior progress existed.
3. An already-managed healthy backend produces no preparation event. Its
   `ready` event resolves `__opencorvusStartupReady` while the window remains
   hidden.
4. `main.tsx` replaces the static child, mounts `OverlayRoot`, waits for the
   next animation frame, and asks the existing Tauri-window boundary to show
   and focus the native window. The first visible warm-start frame is therefore
   the application, not loading.

The listener is installed by the inline module before the page-load-finished
callback starts the worker, preserving the existing no-lost-ready ordering.
Retry reuses the same worker and event stream; tray-initiated show/restart
continues to use the existing `show_window` owner.

### Loading copy

The loading status above the progress bar is fixed to
`正在准备Agent运行环境...`. Progress events continue to own byte counts,
percentage, failure detail, and log path but no longer replace the primary
status with implementation phrases such as extraction filenames or backend
phase names. This is one visible-copy owner, not a second progress source.

### Test and visual boundary

No automated assertion may inspect the loading text, window dimensions,
visibility, rendered DOM, or screenshots. The task directly discovered
`packages/overlay/test/window-control-visibility.test.ts` and
`packages/overlay/test/window-opacity-shell-tokens.test.ts`; both are source/
style-string UI tests and must be deleted without running. The already-deleted
`overlay-window-size-contract.test.ts` remains absent.

Existing Rust tests for startup progress serialization and the real HTTP health
probe remain valid non-UI contracts. Verification uses `cargo test` for those
contracts, Rust formatting/checking, Overlay typecheck/build, documentation
health, and a real isolated desktop client. Cold and warm starts are manually
observed and captured; screenshots are evidence, never a baseline or pass/fail
script.

## Files

| Path | Responsibility |
| --- | --- |
| `packages/overlay/src-tauri/tauri.conf.json` | Authored initial work-area ratio plus existing legal minimum. |
| `packages/overlay/src-tauri/src/main.rs` | Strict geometry projection, construction-time placement, cold/failure loading reveal, and removal of eager page-load reveal. |
| `packages/overlay/src/index.html` | Fixed visible loading copy while retaining event-owned percentage/error data. |
| `packages/overlay/src/main.tsx` | Mount application, synchronize one paint frame, then request native reveal. |
| `packages/overlay/src/services/window.ts` | Existing frontend native-window boundary gains the reveal operation. |
| `packages/overlay/test/window-control-visibility.test.ts` | Delete discovered UI source-string automation. |
| `packages/overlay/test/window-opacity-shell-tokens.test.ts` | Delete discovered UI style-string automation. |
| `specs/records/2026-08/*desktop-window-and-warm-startup*` and indexes | Recall, plan, and verification evidence. |

## Acceptance

- The initial client window occupies 80% of the primary display work area when
  that is above the existing legal minimum, and its work-area margins are equal
  horizontally and vertically.
- Cold startup visibly says `正在准备Agent运行环境...` above the real progress
  bar and retains Retry/View log failure actions.
- Warm startup with the existing managed backend healthy reveals the mounted
  main application without a visible loading frame.
- No second window, readiness source, geometry source, fallback, UI automation,
  or resize feedback loop exists.
- Static/non-UI verification, real client screenshots, second review, scoped
  commit, and `myhexin` push complete without touching the landing work.
