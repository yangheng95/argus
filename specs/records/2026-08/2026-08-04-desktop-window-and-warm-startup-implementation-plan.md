# Desktop Window and Warm Startup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Sub-Agent execution is not authorized for this task.

**Goal:** Launch the desktop client at 80% of the primary monitor work area, centered on both axes, show updated copy only while backend preparation is real, and reveal the mounted main application directly when the managed backend is already healthy.

**Architecture:** Tauri configuration owns the proportional parameter and legal minimum; Rust projects it into construction-time logical geometry and owns cold/failure loading reveal. The existing startup event resolves the frontend readiness Promise, after which Solid mounts and the existing Tauri window boundary reveals the warm-start application on the next paint frame.

**Tech Stack:** Tauri 2.11.1, Rust, SolidJS, Vite, Bun, Node-launched one-off Playwright/manual screenshots.

## Global constraints

- `initialWorkAreaRatio` is exactly `0.8` and is authored only in `packages/overlay/src-tauri/tauri.conf.json`.
- Preserve the existing `1120x720` minimum and Windows native minimum-aspect constraint; do not derive a runtime maximum from the initial size.
- Do not resize the WebView after construction or add a resize feedback loop.
- Use the existing `overlay:startup-progress` and `__opencorvusStartupReady` chain; do not add a second splash window, readiness probe, event, gate, fallback, or state machine.
- The visible primary loading copy is exactly `正在准备Agent运行环境...`.
- Do not add, modify, update, or run UI automated tests. Delete the two directly discovered UI source/style-string tests without running them.
- Launch Playwright only through Node when performing one-off visual inspection.
- Do not restart, close, refresh, or reuse a currently running OpenCorvus/Overlay process. Build and launch a separate isolated validation client/process.
- Preserve and do not stage the pre-existing `packages/web`, landing resolver-test, and landing screenshot changes.
- Commit subjects start with `dsw-33987`; push the current delivery branch to `myhexin` without bypassing hooks.

## Recall

The complete user request, acceptance criteria, source inventory, grep results,
existing user work, failed Claude review attempts, root cause, and selected
design are recorded in
`specs/records/2026-08/2026-08-04-desktop-window-and-warm-startup-design.md`.
This implementation must reread that Recall after any context compaction.

---

### Task 1: Project configuration into construction-time window geometry

**Files:**
- Modify: `packages/overlay/src-tauri/tauri.conf.json`
- Modify: `packages/overlay/src-tauri/src/main.rs`

**Interfaces:**
- Consumes the main window `minWidth`, `minHeight`, the strict `plugins.opencorvus.initialWorkAreaRatio`, and Tauri `Monitor::work_area` / `scale_factor`.
- Produces one `OverlayWindowPlacement { size: OverlayWindowSize, position: tauri::LogicalPosition<f64> }` used only by the main `WebviewWindowBuilder` before `build`.

- [x] **Step 1: Add the authored ratio**

Add the application-owned Tauri plugin configuration:

```json
"plugins": {
  "opencorvus": {
    "initialWorkAreaRatio": 0.8
  }
}
```

- [x] **Step 2: Implement strict placement projection**

Deserialize the exact ratio with `deny_unknown_fields`, reject non-finite or
out-of-range values, convert the primary monitor physical work area to logical
coordinates with its scale factor, require the existing legal minimum to fit,
and calculate equal horizontal/vertical margins. Return an error instead of a
fixed-size or monitor fallback.

- [x] **Step 3: Apply placement before WebView construction**

Chain `.inner_size(placement.size.width, placement.size.height)` and
`.position(placement.position.x, placement.position.y)` on the existing
`WebviewWindowBuilder::from_config` before `.build()`. Keep the existing
background, min-size, and Windows geometry-constraint installation unchanged.

- [x] **Step 4: Format and check Rust**

Run:

```powershell
cargo fmt --manifest-path packages/overlay/src-tauri/Cargo.toml -- --check
cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml
```

Expected: both exit 0 without running a UI test.

### Task 2: Make real startup evidence own visibility

**Files:**
- Modify: `packages/overlay/src-tauri/src/main.rs`
- Modify: `packages/overlay/src/main.tsx`
- Modify: `packages/overlay/src/services/window.ts`

**Interfaces:**
- Consumes the existing preparation progress callback and `ready` Promise.
- Produces one cold/failure native reveal in Rust and one post-render native reveal through `getTauriWindowHandle()`.

- [x] **Step 1: Remove eager page-load reveal**

Delete only the `show_window` call from the main `PageLoadEvent::Finished`
handler. Leave worker creation in that callback so the inline event listener is
already installed.

- [x] **Step 2: Reveal loading once from real preparation**

Create one per-worker `std::sync::Once`. Call it before emitting the first
preparation progress and before emitting a failure. Its closure obtains the
main window and calls the existing `show_window`; it does not run for `ready`.

- [x] **Step 3: Add the frontend native reveal boundary**

Add `showOverlayWindow(): Promise<void>` to `services/window.ts`. It obtains the
window exclusively through `getTauriWindowHandle`, then calls `show()` and
`setFocus()` when Tauri is present. Browser development has no native window to
reveal and keeps the already-visible page.

- [x] **Step 4: Reveal only after Solid owns the host**

Immediately after `render(() => <OverlayRoot />, overlayAppHost)`, await one
`requestAnimationFrame`, then await `showOverlayWindow()`. Do not add a timer,
poll, second health request, or DOM-state classifier.

- [x] **Step 5: Run non-UI startup contracts**

Run the focused Rust tests for `startup_progress_*` and `server_health_probe_*`
through Cargo's name filters. Expected: current serialization/HTTP contracts
pass; no visible UI assertion is executed.

### Task 3: Update loading copy and remove discovered UI automation

**Files:**
- Modify: `packages/overlay/src/index.html`
- Delete: `packages/overlay/test/window-control-visibility.test.ts`
- Delete: `packages/overlay/test/window-opacity-shell-tokens.test.ts`

**Interfaces:**
- Produces the exact fixed loading status while event facts continue to update percentage, error actions, and log path.

- [x] **Step 1: Make the primary status copy exact**

Set the initial status to `正在准备Agent运行环境...` and stop assigning event
`message` values to that primary status. Keep real progress percentage and
failure-action updates unchanged.

- [x] **Step 2: Delete old UI tests without running them**

Delete both files listed above. They inspect Tauri/TSX/CSS source strings and
visible layout/appearance, which is prohibited UI automation. They have no
dedicated fixture or runner configuration.

- [x] **Step 3: Typecheck and build the Overlay**

Run:

```powershell
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay build:vite
```

Expected: exit 0. Do not inspect built HTML through an automated UI assertion.

### Task 4: Validate cold and warm startup on a real isolated client

**Files:**
- Create: `specs/artifacts/2026-08-04-desktop-client-cold-start.jpg`

**Interfaces:**
- Produces one-off visual evidence, never a fixture or screenshot baseline.

- [x] **Step 1: Build an isolated desktop validation binary/package**

Use the repository's existing Tauri packaging command and an isolated runtime
root. Do not stop, restart, refresh, or attach to any currently running client.

- [x] **Step 2: Inspect cold startup**

Launch the isolated client with no managed backend, observe the centered
proportional window, exact copy, and real progress, and capture the cold-start
screenshot. Personally inspect centering, size, copy, progress, clipping, and
first-frame background.

- [ ] **Step 3: Inspect warm startup**

While the isolated client's managed backend remains healthy, trigger the
existing frontend reload/reopen path that reuses that backend. Confirm the
first visible frame is the mounted application and capture the warm-start
screenshot. Personally inspect that no loading frame is visible.

The user stopped Computer Use with Escape after cold-start evidence was saved,
then explicitly requested that the current code be committed. No further
desktop interaction was performed, so the warm-start screenshot and manual
no-flash observation remain unverified in this delivery.

- [ ] **Step 4: Correct and repeat when evidence differs**

If either screenshot or interaction violates the design, fix the root owner,
rerun static checks, and repeat both real observations. Do not encode the
observation as a Playwright test or pass/fail script.

### Task 5: Verify, review, record, and deliver

**Files:**
- Modify: this plan
- Modify: `specs/records/2026-08/README.md`
- Modify: `specs/README.md`

**Interfaces:**
- Produces fresh verification evidence, a second review verdict, scoped commits, and git-cc delivery.

- [x] **Step 1: Run required documentation and diff checks**

```powershell
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

- [x] **Step 2: Perform the second review**

Reread the design, inspect every task-owned diff, enumerate all `show_window`,
startup-worker, readiness Promise, placement, and window-config call points,
and verify the landing changes remain byte-for-byte untouched. Record any
review correction in this plan before editing.

- [x] **Step 3: Append exact implementation evidence**

Record command exits, Rust test counts, build result, isolated runtime path,
cold/warm observations, screenshot paths personally inspected, remaining
limitations, and the second-review verdict.

- [ ] **Step 4: Commit and push only task-owned files**

Stage exact paths, review the staged diff, commit with a `dsw-33987` subject,
and push `HEAD` to `myhexin/work-lcx-v0.0.30beta` without bypassing hooks.

## Plan self-review

- Spec coverage: proportional construction, centering, legal minimum, cold
  copy/progress, warm direct mount, failure/retry, test deletion, non-UI checks,
  real screenshots, second review, scoped commit, and push all have owners.
- Placeholder scan: no deferred or ambiguous implementation step remains.
- Type consistency: the plan uses one `OverlayWindowPlacement`, one configured
  `initialWorkAreaRatio`, the existing startup Promise/event, and the existing
  Tauri window-handle boundary throughout.
- Scope: all edits are inside the desktop startup/window surface, its two
  discovered obsolete UI tests, and required spec indexes. Landing work is
  explicitly excluded.

## Implementation evidence

- `cargo fmt --manifest-path packages/overlay/src-tauri/Cargo.toml -- --check`
  and `cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml`
  exited 0 on 2026-08-04.
- `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml startup_progress_ -- --nocapture`
  passed 3 tests; the `server_health_probe_` filter passed 2 tests. No User
  Interface (UI) automation was run.
- `bun run --cwd packages/overlay typecheck` exited 0. With
  `NODE_OPTIONS=--max-old-space-size=8192`, `bun run --cwd packages/overlay build:vite`
  transformed 7062 modules and exited 0; only existing bundler warnings were
  emitted.
- Historical documentation links passed 2 tests. Document health and product
  documentation single-source checks passed 68 tests. `git diff --check`
  exited 0.
- A release-mode Tauri client was built and launched with the isolated runtime
  root `.scratch/desktop-window-release-validation-20260804`. The cold window
  was observed at origin `(256, 153)` with captured bounds `1380x852`, displaying
  the exact copy `正在准备Agent运行环境...` and real progress at 45%. The screenshot
  was personally re-opened and inspected at
  `specs/artifacts/2026-08-04-desktop-client-cold-start.jpg`.
- Second review enumerated all `show_window`, startup-worker, readiness Promise,
  placement, and window-config call points. The startup page-load callback no
  longer reveals the window; cold/failure evidence owns the Rust reveal, and
  the mounted frontend owns the healthy warm reveal. No second geometry or
  readiness source was found. The unrelated `packages/web` changes remain
  unstaged.
- Limitation: the user stopped Computer Use with Escape before the warm-start
  reload observation, then requested that the code be committed. The warm
  no-loading behavior is implemented and statically reviewed, but its final
  manual screenshot acceptance was not completed in this delivery.
