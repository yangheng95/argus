# Overlay close confirmation

## Requirement

The titlebar close button must ask for confirmation and must no longer hide the
window into the system tray.

## Grep inventory

| Area                   | Evidence                                                                                                                                               | Decision                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `WindowControls.tsx`   | `CLOSE_HINT_KEY`, `nativeMessage`, `win.hide()`, `win.minimize()` implement the current tray-hide behavior.                                            | Replace with `nativeConfirm` and a host native quit command. Delete the one-shot background notice state.               |
| App dialog             | `services/app-dialog.ts`, `utils/native.ts`, `AppDialogHost.tsx` provide the canonical store-backed confirm dialog.                                    | Reuse `nativeConfirm`; do not add a second dialog path.                                                                 |
| Host native chokepoint | `services/window.ts` owns window commands, `host-transport.ts` owns the native command union, and `tauri-transport.ts` maps commands to `invokeTauri`. | Add one `quitOverlay()` service function over a `window.quit` native command and map it to a Tauri invoke.              |
| Tauri tray             | `src-tauri/src/main.rs` tray menu `quit` calls `stop_server(app); app.exit(0)`.                                                                        | Extract the same behavior into `overlay_quit` so the close button exits cleanly instead of destroying only the webview. |
| Tray hide menu         | `src-tauri/src/main.rs` tray menu `hide` still calls `window.hide()`.                                                                                  | Preserve explicit tray menu behavior; requirement targets the titlebar close button.                                    |
| i18n                   | `titlebar.background_notice*` describes tray hide.                                                                                                     | Replace with close-confirm title/message/labels in both locales.                                                        |

## Implementation

1. Add `overlay_quit` in Tauri and register it in both invoke handler lists.
2. Add `window.quit` to `NativeCommand` and map it in the Tauri transport.
3. Change `WindowControls` close handler to `nativeConfirm(...)`; on confirm call
   `quitOverlay()`.
4. Add tests that pin the close button contract and the native command mapping.

## Acceptance

- Clicking titlebar close opens the shared app confirm dialog.
- Cancel leaves the overlay running and visible.
- Confirm exits through the same server cleanup path as tray Quit.
- The titlebar close code no longer calls `hide()` or falls back to minimize.
