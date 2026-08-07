# Native First-frame Window Reveal

Date: 2026-07-31
Status: Third revised design in implementation

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | The portable desktop client briefly shows an empty black window before its loading effect. The user selected a presentation consistent with the main interface and approach A: no separate splash surface. |
| Acceptance criteria | A cold-start main window becomes visible only after its existing page has loaded, so the first visible surface is the existing dark loading/main interface rather than an empty native WebView frame. |
| Hard constraints | Desktop-only; retain the existing single Tauri main window and static HTML loading surface. No iframe, timer, duplicate loading UI, fallback, state machine, or UI automated test. Verify through a real packaged-client launch and manual screenshot review. |
| Read records | `2026-07-31-overlay-startup-and-overscroll-containment.md` and earlier revisions of this record. |
| Whole-repository grep | `rg` found the unique main-window `transparent`, `backgroundColor`, and `visible` configuration; every `show_window` call; the unique `setup` initial reveal; and no existing application page-load callback. Tauri 2.11.1 local sources expose `Builder::on_page_load` and `PageLoadEvent::Finished`. |
| Independent agent feedback | None; the user did not request delegation. |

## Root Cause Revision 3

The repeated screenshot has a precise boundary: the approximately 1920 × 1140 black rectangle matches the configured 1280 × 760 logical client at 150% Windows display scaling. The pale right and bottom regions are desktop outside the window, not a client-area resize gap.

The frameless opaque construction-time revision was packaged and reproduced a Windows `AppHangB1` hang. It is rejected: construction-time decoration removal is unsafe for this client and must not be retried.

The stable portable client confirms the actual main interface is dark. Its setup code displays the main native window before it starts the embedded server and before WebView2 completes its first page load. The empty black rectangle is therefore an unpainted WebView2 backing frame exposed by the immediate `show_window` call, not a mismatch of the final UI theme.

Tauri 2.11.1 exposes a native completed-page callback. Binding the existing main-window reveal to that single completion event keeps one window and the existing loading page, while withholding the window until there is a real page for WebView2 to present.

## Design

1. Keep the configured main window hidden during setup.
2. Register one native `on_page_load` callback and reveal only the `main` window when its initial navigation has finished.
3. Preserve the existing runtime window setup, static HTML loading surface, and all tray/restart reveal paths.
4. Do not add a timer, fallback, second window, or second startup UI.

## Implementation Plan

### Task 1: Reveal the existing main window after its first completed load

**Files:**

- Modify: `packages/overlay/src-tauri/src/main.rs`
- Modify: this record

- [ ] Register the native completed-page callback before setup.
- [ ] Remove the setup-time initial `show_window` call.
- [ ] Preserve the runtime surface, geometry, tray, and restart behavior.
- [ ] Build the real packaged client, cold-launch it, and manually inspect startup and the loaded workspace. Do not create, update, or run UI automated tests.
- [ ] Run Rust formatting/checking, `git diff --check`, and the required historical docs-links test.

## Call-site Disposition

| `show_window` call site | Disposition |
| --- | --- |
| `setup` initial main window | Replace the immediate reveal with the completed initial page-load callback. |
| Tray menu `show` | Preserve: explicit user request to restore the window. |
| Tray menu `restart` | Preserve: explicit reload and restore operation. |
| Tray icon click | Preserve: explicit user request to restore the window. |

## Verification Plan

1. Compile and package the native client with the completed-page reveal callback.
2. Ensure the prior client process is stopped, launch the packaged executable, and capture the native window at startup.
3. Manually review that the first visible surface is the existing dark application/loading surface, with no empty native black frame or client-area edge.
4. After it reaches the loaded application, review the normal workspace to ensure the main window is responsive.
5. Run `cargo fmt --check`, `cargo check`, `bun test test\\script\\historical-docs-links.test.ts` from `packages/opencorvus`, and `git diff --check`.
