# Settings and Config Fail Fast Writes

## Problem

General Settings can currently report success when persistence failed. The
front-end settings store swallows `settings.save` errors, `loadSettings()` turns
native load failures into defaults, and `patchConfig()` returns `null` when the
server is disconnected or the `PATCH /config` request fails. The UI then shows a
saved state or leaves an interactive toggle visually changed even though the
single source was not updated.

## Call Points

| Surface                          | File                                                                                                                                                        | Decision                                                                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Settings load/save source        | `packages/overlay/src/store/settings.ts`                                                                                                                    | Keep Tauri/browser native `settings.load` / `settings.save` as the single source. Missing settings may use defaults; native errors and malformed payloads must throw.                                  |
| Config patch source              | `packages/overlay/src/services/config.ts`                                                                                                                   | `patchConfig()` must throw when disconnected or when `PATCH /config` fails; only a successful server response updates `appStore.config`.                                                               |
| General Settings save button     | `packages/overlay/src/components/settings/GeneralPanel.tsx`                                                                                                 | Await `saveSettings()` before showing Saved; show an inline settings error on failure.                                                                                                                 |
| Desktop notifications toggle     | `packages/overlay/src/components/settings/GeneralPanel.tsx`                                                                                                 | Persist through `saveSettings()` and revert the local toggle if persistence fails.                                                                                                                     |
| INFORMATION MISSING debug toggle | `packages/overlay/src/components/settings/GeneralPanel.tsx`                                                                                                 | Await `patchConfig()` and rely on unchanged `appStore.config` to keep the checkbox on the old value when the server rejects the write.                                                                 |
| Other settings callers           | `main.tsx`, `task.ts`, `connection.ts`, `workspace.ts`, `CommandPalette.tsx`, `ExecutorSelector.tsx`, `TitlebarMenubar.tsx`, `WorkspaceEditorLaunchers.tsx` | Leave behavior unchanged this slice; the shared helper now throws so these callers no longer have a hidden catch in the helper.                                                                        |
| Other config callers             | `ExecutorSelector.tsx`, `AgentModelsPanel.tsx`, `PermissionsPanel.tsx`, `NetworkPanel.tsx`, `TitlebarMenubar.tsx`, config service helpers                   | Keep the shared `patchConfig()` contract; existing awaited callers will now receive real errors. Fire-and-forget callers remain visible through rejected promises rather than helper-level swallowing. |
| Tests                            | `executor-settings.test.ts`, `general-panel-notification-single-source.test.ts`, browser General Settings coverage                                          | Assert native settings failures throw, `patchConfig()` no longer returns `null`, and GeneralPanel shows a real error with no Saved state.                                                              |

## Implementation

1. Make `saveSettings()` return `Promise<void>` and reject when the native command
   fails or does not acknowledge persistence.
2. Make `loadSettings()` propagate native load errors and reject malformed
   non-object payloads; defaults are used only for absent persisted settings.
3. Make `patchConfig()` throw instead of returning `null` on disconnected or
   failed config writes.
4. Add GeneralPanel error state using the existing `config-status-box` styling.
5. Add a real browser test for General Settings save failure and config toggle
   failure, with screenshot capture of the error state.

## Verification

- `bun test packages/overlay/test/executor-settings.test.ts packages/overlay/test/general-panel-notification-single-source.test.ts`
- Node Playwright browser test for General Settings failure behavior.
- `bun run --cwd packages/overlay typecheck`
- Visual review of the captured General Settings failure notice.
