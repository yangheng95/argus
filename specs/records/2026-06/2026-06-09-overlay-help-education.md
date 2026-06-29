# Overlay Help Education

## Grep Evidence

| Surface    | Evidence                                                                                                                                                                                                        | Decision                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Help menu  | `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx` renders Refresh, DevTools, Logs, About, and Connection Diagnostics under `menu.id === "help"`                                                    | Remove Refresh, Logs, and Connection Diagnostics from Help. Keep About and DevTools. Add documentation entries as explicit learning actions.       |
| Logs       | `packages/overlay/src/main.tsx` owns `logOpen`; `CommandPalette.tsx` currently finds the old Help Logs menu item through DOM lookup                                                                             | Keep LogViewer feature. Replace menu DOM lookup with the existing `oc:open-logs` event path.                                                       |
| DevTools   | `theme.ts` calls `HostTransport.native({ kind: "devtools.toggle" })`; Tauri registers `overlay_toggle_devtools` only with the `devtools` cargo feature                                                          | Enable the Tauri devtools feature by default so the visible Help action has a registered native command. Do not leave the click as a silent no-op. |
| Docs / SDK | `packages/web/src/content/docs/start/quickstart.mdx`, `packages/web/src/content/docs/sdk.mdx`, and `packages/web/src/content/docs/reference/sdk.mdx` are the docs source; overlay has only generic `nativeOpen` | Add one overlay documentation-entry source and open entries through `nativeOpen`.                                                                  |
| i18n       | `titlebar.logs`, `titlebar.connection_diagnostics`, and `titlebar.devtools` live in both overlay locale files                                                                                                   | Keep keys still used outside Help; add documentation entry labels and tooltip text in both locales.                                                |

## Implementation

1. Add `services/documentation.ts` as the single overlay source for documentation links.
2. Update `TitlebarMenubar.tsx` so Help contains Documentation, SDK Reference, DevTools, and About; delete the old Help-only Refresh, Logs, and Connection Diagnostics items.
3. Make menu items expose meaningful `title` and `aria-label` text from their visible label and meta description.
4. Register the explicit `oc:open-logs` listener in `main.tsx`, and update Command Palette to dispatch it directly.
5. Enable Tauri's `devtools` feature by default in `src-tauri/Cargo.toml`.
6. Update tests to lock the new Help contract and the Command Palette log event path.
